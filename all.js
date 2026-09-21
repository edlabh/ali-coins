const {
  loadConfig,
  handleDryRun,
  isForce,
  isJson,
  checkAndDisplayHelp,
  loadAccounts,
  syncAccountSessions,
  maskUser
} = require('./config');
const { formatDateTime, formatDuration, calculateAccountBackoff } = require('./time_utils');
const { version: APP_VERSION } = require('./package.json');
const { acquireLock, LockActiveError } = require('./lockfile');
const {
  renderUnifiedReport,
  renderMultiAccountReport,
  buildUnifiedReportPayload,
  buildMultiAccountReportPayload,
  isStreakBreak
} = require('./libs/report');
const { sendTelegram, shouldSkipAccountNotification } = require('./libs/notify');
const { closeCachedDesktopContext } = require('./libs/ui');
const { sendHeartbeat } = require('./libs/heartbeat');
const { startAccountTimer } = require('./libs/timing');
const { setupGlobalCrashHandler } = require('./libs/crash');
const { flushAndExit } = require('./libs/exit');
const logger = require('./logger');

let currentConfig = null;
let currentAccount = null;

setupGlobalCrashHandler(() => ({
  config: currentConfig,
  account: currentAccount,
  scriptName: 'all.js'
}));

async function main() {
  if (checkAndDisplayHelp()) {
    await flushAndExit(0);
  }

  // 1. Suporte a validação sem abrir navegador
  if (await handleDryRun()) {
    await flushAndExit(0);
  }

  const { runCheckin } = require('./collect');
  const { runTasks } = require('./do_tasks');
  const { launchBrowser } = require('./browser');

  const accounts = loadAccounts(process.env, __dirname);
  const isMulti = accounts.length > 1;
  if (isMulti) {
    syncAccountSessions(accounts, __dirname);
  }

  // Valida a configuração ANTES de adquirir qualquer lock: uma config inválida não deve
  // deixar lock órfão (o main().catch encerra com exit 1 sem nunca ter travado a conta).
  const config = loadConfig(true);
  currentConfig = config;

  // 2. Lockfile para conta única (evita concorrência global no cron)
  let releaseSingleLock = null;
  let browser = null;
  let gracefulExitRef = null;

  // Encerramento por sinal: registrado ANTES do lockfile para rodar PRIMEIRO — fecha o
  // browser (requisições em voo) e só então libera o lock, evitando que outra instância
  // inicie a mesma conta enquanto o Chromium anterior ainda finaliza.
  const handleShutdownSignal = (signal) => {
    logger.warn({ signal }, 'Sinal de encerramento recebido; fechando browser e liberando lock...');
    if (typeof gracefulExitRef === 'function') {
      void gracefulExitRef(1);
      return;
    }
    try {
      process.kill(process.pid, signal);
    } catch {
      process.exit(1);
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => handleShutdownSignal(signal));
  }

  if (!isMulti) {
    try {
      releaseSingleLock = await acquireLock(isForce(), null, accounts[0]?.lockPath);
    } catch (err) {
      if (err instanceof LockActiveError) {
        try {
          await sendHeartbeat('fail', { config, error: err });
          await sendTelegram({
            config,
            chatId: accounts[0]?.telegramChatId,
            event: 'lock_active',
            error: err
          });
        } catch (tgErr) {
          logger.warn({ err: tgErr.message }, 'Falha ao enviar notificação Telegram de lock.');
        }
        await flushAndExit(3);
      }
      logger.error({ err: err.message }, 'Falha ao adquirir lock exclusivo.');
      try {
        await sendHeartbeat('fail', { config, error: err });
        await sendTelegram({
          config,
          chatId: accounts[0]?.telegramChatId,
          event: 'failure',
          error: err
        });
      } catch (tgErr) {
        logger.warn({ err: tgErr.message }, 'Falha ao enviar notificação Telegram de erro.');
      }
      await flushAndExit(1);
    }
  }

  const mainStartTime = new Date();
  logger.info('===============================================================');
  logger.info(
    isMulti
      ? `       ALIEXPRESS MOEDAS - MODO MULTI-CONTA (${accounts.length} CONTAS)`
      : '       ALIEXPRESS MOEDAS - MODO UNIFICADO (CHECK-IN + TAREFAS)'
  );
  logger.info('===============================================================\n');

  // Dead man's switch: sinal de início
  await sendHeartbeat('start', { config });

  // Encerramento com limpeza real: process.exit() não executa o bloco finally,
  // então fechamos o browser e liberamos o lock antes de sair em QUALQUER caminho.
  // O close é limitado no tempo: um Chromium travado nunca pode impedir o encerramento.
  const withTimeoutFallback = (promise, ms) => {
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
      if (timer.unref) timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  };

  const gracefulExit = async (code) => {
    if (browser) {
      const currentBrowser = browser;
      browser = null;
      await withTimeoutFallback(
        currentBrowser.close().catch(() => {}),
        10000
      );
    }
    if (releaseSingleLock) {
      const release = releaseSingleLock;
      releaseSingleLock = null;
      await release().catch(() => {});
    }
    await flushAndExit(code);
  };
  // O handler de sinais usa esta referência para fechar browser + liberar lock antes de sair.
  gracefulExitRef = gracefulExit;

  try {
    // 1 única instância compartilhada do Chromium para a execução
    browser = await launchBrowser({ headless: config.HEADLESS });

    if (!isMulti) {
      // ----------------- FLUXO CONTA ÚNICA -----------------
      const account = accounts[0] || null;
      currentAccount = account;

      // ETAPA 1: Check-in diário
      const step1StartTime = new Date();
      logger.info('>>> [ETAPA 1/2] Iniciando Check-in Diário...');
      logger.info(`    Dia e Hora de Início: ${formatDateTime(step1StartTime)}`);

      let checkinResult = null;
      try {
        checkinResult = await runCheckin({ browser, account, config, skipReport: true });
      } catch (err) {
        const step1EndTime = new Date();
        const step1Duration = formatDuration(step1EndTime - step1StartTime);
        if (err.name === 'TwoFactorRequiredNonInteractive' || err.is2FARequired) {
          logger.error(
            '[2FA Não-Interativo] O AliExpress exigiu verificação de código 2FA durante execução sem terminal interativo (cron/CI). ' +
              'Finalizando rapidamente (<5s) para evitar travamento. ' +
              'Solução: execute localmente com "./run_all.sh", resolva o 2FA e use "node export_session.js" / "node import_session.js".'
          );
          await sendHeartbeat('fail', { config, error: err });
          try {
            await sendTelegram({
              config,
              chatId: account?.telegramChatId,
              event: '2fa_required',
              error: err
            });
          } catch (tgErr) {
            logger.warn({ err: tgErr.message }, 'Falha ao enviar notificação Telegram de 2FA.');
          }
          await gracefulExit(5);
        }
        if (err.isImportedSessionExpired) {
          logger.error(
            '[Sessão Remota Expirada] Login falhou no servidor remoto. A sessão importada expirou ou foi invalidada pelo AliExpress. ' +
              'Sugestão: gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
          );
        }
        logger.error(
          { err: err.message, step1Duration },
          'Falha crítica na etapa de check-in / login. Interrompendo execução.'
        );
        await sendHeartbeat('fail', { config, error: err });
        try {
          await sendTelegram({
            config,
            chatId: account?.telegramChatId,
            event: 'failure',
            error: err
          });
        } catch (tgErr) {
          logger.warn({ err: tgErr.message }, 'Falha ao enviar notificação Telegram de erro.');
        }
        await gracefulExit(1);
      }

      const step1EndTime = new Date();
      const step1Duration = formatDuration(step1EndTime - step1StartTime);

      if (!checkinResult) {
        logger.error({ step1Duration }, 'Check-in não retornou resultado. Interrompendo execução.');
        await sendHeartbeat('fail', {
          config,
          error: new Error('Check-in não retornou resultado.')
        });
        try {
          await sendTelegram({
            config,
            chatId: account?.telegramChatId,
            event: 'failure',
            error: 'Check-in não retornou resultado.'
          });
        } catch (tgErr) {
          logger.warn({ err: tgErr.message }, 'Falha ao enviar notificação Telegram de erro.');
        }
        await gracefulExit(1);
      }

      logger.info(
        `>>> [ETAPA 1/2] Concluída em ${formatDateTime(step1EndTime)} | Duração: ${step1Duration}`
      );

      // ETAPA 2: Execução das tarefas diárias
      const step2StartTime = new Date();
      logger.info('>>> [ETAPA 2/2] Iniciando Execução Sequencial das Tarefas Diárias...');
      logger.info(`    Dia e Hora de Início: ${formatDateTime(step2StartTime)}`);

      let tasksResult = null;
      let tasksError = null;
      try {
        tasksResult = await runTasks({
          browser,
          account,
          config,
          sessionData: checkinResult.sessionData,
          initialBalance: checkinResult.totalBalance,
          skipAutoLogin: true,
          skipReport: true
        });
      } catch (err) {
        // Falha da etapa de tarefas não invalida o check-in, mas precisa ficar visível
        // no relatório (antes era apenas um warn e sumia do payload).
        tasksError = err.message;
        logger.warn({ err: err.message }, 'Aviso na etapa de tarefas.');
      }

      const step2EndTime = new Date();
      const step2Duration = formatDuration(step2EndTime - step2StartTime);
      logger.info(
        `>>> [ETAPA 2/2] Concluída em ${formatDateTime(step2EndTime)} | Duração: ${step2Duration}`
      );

      // ETAPA 3: Relatório consolidado
      const mainEndTime = new Date();
      const totalDuration = formatDuration(mainEndTime - mainStartTime);

      const unifiedPayload = buildUnifiedReportPayload(checkinResult, tasksResult, {
        user:
          account?.maskedUser ||
          (process.env.ALI_USER ? maskUser(process.env.ALI_USER) : undefined),
        mainStartTime,
        mainEndTime,
        totalDuration,
        step1Duration,
        step2Duration,
        tasksError
      });

      renderUnifiedReport(
        checkinResult,
        tasksResult,
        {
          mainStartTime,
          mainEndTime,
          totalDuration,
          step1Duration,
          step2Duration,
          tasksError
        },
        { json: isJson() }
      );

      if (releaseSingleLock) {
        await releaseSingleLock();
        releaseSingleLock = null;
      }

      // Verificação de quebra de sequência (Streak Break)
      const currentStreak =
        typeof checkinResult?.streakDays === 'number'
          ? checkinResult.streakDays
          : parseInt(String(checkinResult?.streakDays).replace(/[^0-9]/g, ''), 10);
      const previousStreak =
        typeof checkinResult?.previousStreakDays === 'number'
          ? checkinResult.previousStreakDays
          : null;

      const streakBroken = isStreakBreak(
        !isNaN(currentStreak) ? currentStreak : null,
        previousStreak,
        checkinResult?.alreadyCollected
      );

      if (streakBroken) {
        logger.error(
          {
            previousStreak,
            currentStreak,
            totalBalance: checkinResult?.totalBalance
          },
          '🚨 ALERTA CRÍTICO: Streak quebrado! A sequência diária de check-in foi interrompida ou resetada.'
        );
      }

      // Código 4 se streak foi quebrado (perda irreversível após dias de sequência)
      // Código 2 se já havia sido coletado e nenhuma tarefa nova foi executada; 0 se sucesso com novas ações
      // Considera "nova ação" também quando o check-in do dia foi creditado via extrato
      // (ex.: feito pelo usuário no app), mesmo que o bot não tenha clicado.
      const hadNewCheckin =
        checkinResult &&
        (!checkinResult.alreadyCollected || checkinResult.checkinCoinsFromLedger === true);
      const hadTaskActions = tasksResult && tasksResult.totalActions > 0;
      const event = streakBroken
        ? 'streak_break'
        : !hadNewCheckin && !hadTaskActions
          ? 'already_collected'
          : 'success';

      try {
        await sendTelegram({
          config,
          chatId: account?.telegramChatId,
          report: unifiedPayload,
          event
        });
      } catch (tgErr) {
        logger.warn({ err: tgErr.message }, 'Falha ao enviar notificação Telegram de resultado.');
      }

      if (streakBroken) {
        await sendHeartbeat('fail', {
          config,
          error: new Error(
            `Streak quebrado: ontem ${previousStreak} dias -> hoje ${currentStreak} dias`
          ),
          report: unifiedPayload
        });
        await gracefulExit(4);
      }

      await sendHeartbeat('success', { config, report: unifiedPayload });

      if (!hadNewCheckin && !hadTaskActions) {
        await gracefulExit(2);
      }
      await gracefulExit(0);
    } else {
      // ----------------- FLUXO MULTI-CONTA SEQUENCIAL -----------------
      const accountReports = [];
      let anyAccountHadNewAction = false;
      let anyAccountSuccess = false;
      let anyAccountStreakBroken = false;
      let anyAccount2FARequired = false;
      // Distingue "todas as contas com lock ativo" (exit 3) de falha genérica de lock (exit 1)
      let lockActiveCount = 0;
      let nonLockFailureCount = 0;
      let consecutiveFailures = 0;
      // Espaçamento mínimo entre envios ao Telegram no mesmo run (anti-rajada)
      const NOTIFY_MIN_SPACING_MS = 3000;
      let lastNotifyAt = 0;

      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        currentAccount = account;
        logger.info(
          `\n>>> [CONTA ${i + 1}/${accounts.length}] Iniciando execução para: ${account.maskedUser} (versão v${APP_VERSION})`
        );

        const accTimer = startAccountTimer();
        let accStep1Duration = '0s';
        let accStep2Duration = '0s';

        // Garante isolamento estrito de cookies e storage fechando contextos remanescentes
        if (browser && typeof browser.contexts === 'function') {
          for (const ctx of browser.contexts()) {
            await ctx.close().catch(() => {});
          }
        }

        let releaseAccountLock = null;
        try {
          releaseAccountLock = await acquireLock(isForce(), null, account.lockPath);
        } catch (err) {
          consecutiveFailures++;
          const lockTiming = accTimer.end('lock');
          if (err instanceof LockActiveError) {
            lockActiveCount++;
            logger.warn(
              { account: account.maskedUser },
              `Lock ativo para a conta ${account.maskedUser}. Pulando...`
            );
            accountReports.push({
              account,
              user: account.maskedUser,
              checkinResult: null,
              tasksResult: null,
              isLockActive: true,
              error: 'Lock ativo por outro processo',
              duration: lockTiming.duration,
              startTime: lockTiming.startTime,
              endTime: lockTiming.endTime
            });
            if (i < accounts.length - 1) {
              const backoffMs = calculateAccountBackoff(consecutiveFailures - 1);
              logger.info(
                { account: account.maskedUser, backoffMs },
                `Aguardando backoff de ${backoffMs}ms antes de tentar próxima conta...`
              );
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
            continue;
          }
          nonLockFailureCount++;
          logger.error(
            { err: err.message, account: account.maskedUser },
            'Falha ao adquirir lock da conta.'
          );
          accountReports.push({
            account,
            user: account.maskedUser,
            checkinResult: null,
            tasksResult: null,
            error: err.message,
            duration: lockTiming.duration,
            startTime: lockTiming.startTime,
            endTime: lockTiming.endTime
          });
          if (i < accounts.length - 1) {
            const backoffMs = calculateAccountBackoff(consecutiveFailures - 1);
            logger.info(
              { account: account.maskedUser, backoffMs },
              `Aguardando backoff de ${backoffMs}ms antes de tentar próxima conta...`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
          continue;
        }

        let accCheckin = null;
        let accTasks = null;
        let accTasksError = null;
        let accError = null;
        let accImportedExpired = false;
        let accIs2FARequired = false;
        let accStreakBroken = false;
        let pendingBackoffMs = 0;

        try {
          // Etapa 1: Check-in
          logger.info(`>>> [CONTA ${i + 1}/${accounts.length}] [ETAPA 1/2] Check-in Diário...`);
          const step1Timer = startAccountTimer();
          accCheckin = await runCheckin({ browser, account, config, skipReport: true });
          const step1Timing = step1Timer.end('step1');
          accStep1Duration = step1Timing.duration;
          logger.info(
            `>>> [CONTA ${i + 1}/${accounts.length}] [ETAPA 1/2] Concluída em ${formatDateTime(step1Timing.endTime)} | Duração: ${accStep1Duration}`
          );

          const accCurrentStreak =
            typeof accCheckin?.streakDays === 'number'
              ? accCheckin.streakDays
              : parseInt(String(accCheckin?.streakDays).replace(/[^0-9]/g, ''), 10);
          const accPreviousStreak =
            typeof accCheckin?.previousStreakDays === 'number'
              ? accCheckin.previousStreakDays
              : null;

          accStreakBroken = isStreakBreak(
            !isNaN(accCurrentStreak) ? accCurrentStreak : null,
            accPreviousStreak,
            accCheckin?.alreadyCollected
          );

          if (accStreakBroken) {
            anyAccountStreakBroken = true;
            logger.error(
              {
                account: account.maskedUser,
                previousStreak: accPreviousStreak,
                currentStreak: accCurrentStreak
              },
              `🚨 ALERTA CRÍTICO: Streak quebrado para a conta ${account.maskedUser}!`
            );
          }

          // Etapa 2: Tarefas
          logger.info(`>>> [CONTA ${i + 1}/${accounts.length}] [ETAPA 2/2] Tarefas Diárias...`);
          const step2Timer = startAccountTimer();
          try {
            accTasks = await runTasks({
              browser,
              account,
              config,
              sessionData: accCheckin?.sessionData,
              initialBalance: accCheckin?.totalBalance,
              skipAutoLogin: true,
              skipReport: true
            });
          } catch (taskErr) {
            accTasksError = taskErr.message;
            logger.warn(
              { err: taskErr.message, account: account.maskedUser },
              'Aviso na etapa de tarefas.'
            );
          }
          const step2Timing = step2Timer.end('step2');
          accStep2Duration = step2Timing.duration;
          logger.info(
            `>>> [CONTA ${i + 1}/${accounts.length}] [ETAPA 2/2] Concluída em ${formatDateTime(step2Timing.endTime)} | Duração: ${accStep2Duration}`
          );

          anyAccountSuccess = true;
          consecutiveFailures = 0;
          const hadNewCheckin =
            accCheckin &&
            (!accCheckin.alreadyCollected || accCheckin.checkinCoinsFromLedger === true);
          const hadTaskActions = accTasks && accTasks.totalActions > 0;
          if (hadNewCheckin || hadTaskActions) {
            anyAccountHadNewAction = true;
          }

          accTimer.end('success');
        } catch (accErr) {
          consecutiveFailures++;
          nonLockFailureCount++;
          accTimer.end('error');
          accError = accErr.message;
          accImportedExpired = Boolean(accErr.isImportedSessionExpired);
          if (accErr.name === 'TwoFactorRequiredNonInteractive' || accErr.is2FARequired) {
            accIs2FARequired = true;
            anyAccount2FARequired = true;
            logger.error(
              { account: account.maskedUser },
              '[2FA Não-Interativo] O AliExpress exigiu verificação 2FA sem terminal interativo (cron/CI). Finalizando conta rapidamente.'
            );
          }
          if (accImportedExpired) {
            logger.error(
              { account: account.maskedUser },
              '[Sessão Remota Expirada] A sessão importada da conta expirou. Gere uma nova sessão com "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
            );
          }
          logger.error(
            { err: accErr.message, account: account.maskedUser },
            `Falha na execução da conta ${account.maskedUser}. Continuando com as próximas.`
          );
          if (i < accounts.length - 1) {
            // A espera acontece DEPOIS do finally (que libera o lock da conta): dormir
            // segurando o lock fazia outra instância receber LockActiveError (exit 3).
            pendingBackoffMs = calculateAccountBackoff(consecutiveFailures - 1);
            logger.info(
              {
                account: account.maskedUser,
                consecutiveFailures,
                backoffMs: pendingBackoffMs,
                nextAccount: accounts[i + 1]?.maskedUser
              },
              `Aguardando backoff exponencial com jitter de ${pendingBackoffMs}ms antes de tentar próxima conta...`
            );
          }
        } finally {
          if (releaseAccountLock) {
            await releaseAccountLock();
          }
          // Fecha o contexto desktop reaproveitado ao terminar a conta (evita reter
          // RAM/cookies entre contas e não vaza a sessão de uma conta para a próxima).
          await closeCachedDesktopContext().catch(() => {});
        }

        // Backoff FORA do finally: o lock da conta já foi liberado antes de dormir.
        if (pendingBackoffMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, pendingBackoffMs));
          pendingBackoffMs = 0;
        }

        const accTiming = accTimer.end();
        // Envio individual por conta é OPCIONAL (TELEGRAM_PER_ACCOUNT, padrão desligado).
        // Quando desligado e a conta usa o mesmo chat do consolidado, a mensagem individual
        // é suprimida para evitar rajada ao mesmo destino. O consolidado é sempre enviado.
        const skipAccountNotify = shouldSkipAccountNotification(
          account.telegramChatId,
          config.TELEGRAM_CHAT_ID,
          { perAccountEnabled: config.TELEGRAM_PER_ACCOUNT === true }
        );
        if (account.telegramChatId && !skipAccountNotify) {
          try {
            const accPayload = buildUnifiedReportPayload(accCheckin, accTasks, {
              user: account.maskedUser,
              mainStartTime: accTiming.startTime,
              mainEndTime: accTiming.endTime,
              totalDuration: accTiming.duration,
              step1Duration: accStep1Duration,
              step2Duration: accStep2Duration,
              tasksError: accTasksError
            });
            const accEvent = accIs2FARequired
              ? '2fa_required'
              : accStreakBroken
                ? 'streak_break'
                : accError
                  ? 'failure'
                  : (accCheckin &&
                        (!accCheckin.alreadyCollected ||
                          accCheckin.checkinCoinsFromLedger === true)) ||
                      (accTasks && accTasks.totalActions > 0)
                    ? 'success'
                    : 'already_collected';
            const msSinceLastNotify = Date.now() - lastNotifyAt;
            if (lastNotifyAt && msSinceLastNotify < NOTIFY_MIN_SPACING_MS) {
              await new Promise((resolve) =>
                setTimeout(resolve, NOTIFY_MIN_SPACING_MS - msSinceLastNotify)
              );
            }
            await sendTelegram({
              config,
              chatId: account.telegramChatId,
              report: accPayload,
              event: accEvent,
              error: accError
            });
            lastNotifyAt = Date.now();
          } catch (tgErr) {
            logger.warn(
              { err: tgErr.message, account: account.maskedUser },
              'Falha ao enviar notificação Telegram para a conta individual.'
            );
          }
        }

        accountReports.push({
          account,
          user: account.maskedUser,
          checkinResult: accCheckin,
          tasksResult: accTasks,
          tasksError: accTasksError,
          error: accError,
          isImportedSessionExpired: accImportedExpired,
          is2FARequired: accIs2FARequired,
          streakBroken: accStreakBroken,
          startTime: accTiming.startTime,
          endTime: accTiming.endTime,
          duration: accTiming.duration
        });
      }

      const mainEndTime = new Date();
      const totalDuration = formatDuration(mainEndTime - mainStartTime);

      const multiPayload = buildMultiAccountReportPayload(accountReports, {
        mainStartTime,
        mainEndTime,
        totalDuration
      });

      renderMultiAccountReport(
        accountReports,
        {
          mainStartTime,
          mainEndTime,
          totalDuration
        },
        { json: isJson() }
      );

      // Só considera "todas bloqueadas" quando houve lock ativo em alguma conta, nenhuma
      // conta obteve sucesso e não houve falha genérica (ex: erro de I/O no lockfile).
      const allAccountsLocked =
        !anyAccountSuccess && lockActiveCount > 0 && nonLockFailureCount === 0;

      // Falha parcial (qualquer conta com erro não-lock ou 2FA) deve ser tratada como
      // falha do processo: antes, com >= 1 conta OK, saía 0 e enviava heartbeat "success",
      // mascarando contas quebradas para o dead man's switch (e o run_all.sh, que só
      // retenta no exit 1, não reprocessava as contas que falharam).
      const anyAccountFailed = nonLockFailureCount > 0 || anyAccount2FARequired;

      let multiEvent = 'success';
      if (allAccountsLocked) multiEvent = 'lock_active';
      else if (anyAccountStreakBroken) multiEvent = 'streak_break';
      else if (anyAccount2FARequired && !anyAccountSuccess) multiEvent = '2fa_required';
      else if (!anyAccountSuccess || anyAccountFailed) multiEvent = 'failure';
      else if (!anyAccountHadNewAction) multiEvent = 'already_collected';

      // Espaça do último envio por-conta (quando houver) para não competir pelo mesmo
      // destino/limite de taxa do Telegram, reduzindo descartes por timeout.
      const msSinceLastNotify = Date.now() - lastNotifyAt;
      if (lastNotifyAt && msSinceLastNotify < NOTIFY_MIN_SPACING_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, NOTIFY_MIN_SPACING_MS - msSinceLastNotify)
        );
      }
      try {
        await sendTelegram({ config, report: multiPayload, event: multiEvent });
        lastNotifyAt = Date.now();
      } catch (tgErr) {
        logger.warn({ err: tgErr.message }, 'Falha ao enviar notificação Telegram consolidada.');
      }

      if (allAccountsLocked) {
        await sendHeartbeat('fail', {
          config,
          error: new Error('Todas as contas estavam com lock ativo'),
          report: multiPayload
        });
        await gracefulExit(3);
      }
      if (anyAccountStreakBroken) {
        await sendHeartbeat('fail', {
          config,
          error: new Error('Streak quebrado em conta multi-conta'),
          report: multiPayload
        });
        await gracefulExit(4);
      }
      if (anyAccount2FARequired && !anyAccountSuccess) {
        await sendHeartbeat('fail', {
          config,
          error: new Error('2FA requerido em ambiente não-interativo'),
          report: multiPayload
        });
        await gracefulExit(5);
      }
      if (!anyAccountSuccess) {
        await sendHeartbeat('fail', {
          config,
          error: new Error('Todas as contas falharam na execução'),
          report: multiPayload
        });
        await gracefulExit(1);
      }

      if (anyAccountFailed) {
        await sendHeartbeat('fail', {
          config,
          error: new Error('Uma ou mais contas falharam na execução'),
          report: multiPayload
        });
        await gracefulExit(1);
      }

      await sendHeartbeat('success', { config, report: multiPayload });

      if (!anyAccountHadNewAction) {
        await gracefulExit(2);
      }
      await gracefulExit(0);
    }
  } catch (fatalErr) {
    await sendHeartbeat('fail', { config, error: fatalErr });
    if (fatalErr.name === 'TwoFactorRequiredNonInteractive' || fatalErr.is2FARequired) {
      logger.error(
        '[2FA Não-Interativo] O AliExpress exigiu verificação de código 2FA durante execução sem terminal interativo (cron/CI). ' +
          'Finalizando rapidamente (<5s) para evitar travamento. ' +
          'Solução: execute localmente com "./run_all.sh", resolva o 2FA e use "node export_session.js" / "node import_session.js".'
      );
      try {
        await sendTelegram({ config, event: '2fa_required', error: fatalErr });
      } catch (tgErr) {
        logger.warn(
          { err: tgErr.message },
          'Falha ao enviar notificação Telegram em erro fatal 2FA.'
        );
      }
      await gracefulExit(5);
    }
    if (fatalErr.isImportedSessionExpired) {
      logger.error(
        '[Sessão Remota Expirada] Falha durante a execução: a sessão importada expirou ou foi invalidada pelo AliExpress. ' +
          'Gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
      );
    }
    logger.error({ err: fatalErr.message }, 'Erro fatal durante a execução unificada.');
    try {
      await sendTelegram({ config, event: 'failure', error: fatalErr });
    } catch (tgErr) {
      logger.warn({ err: tgErr.message }, 'Falha ao enviar notificação Telegram em erro fatal.');
    }
    await gracefulExit(1);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (releaseSingleLock) {
      await releaseSingleLock();
    }
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    logger.error({ err: err.message }, 'Erro não tratado no processo principal.');
    await flushAndExit(1);
  });
}

module.exports = {
  main
};
