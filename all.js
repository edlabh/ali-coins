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
const { acquireLock, LockActiveError } = require('./lockfile');
const {
  renderUnifiedReport,
  renderMultiAccountReport,
  buildUnifiedReportPayload,
  buildMultiAccountReportPayload,
  isStreakBreak
} = require('./libs/report');
const { sendTelegram } = require('./libs/notify');
const { sendHeartbeat } = require('./libs/heartbeat');
const logger = require('./logger');

async function main() {
  if (checkAndDisplayHelp()) {
    process.exit(0);
  }

  // 1. Suporte a validação sem abrir navegador
  if (await handleDryRun()) {
    process.exit(0);
  }

  const { runCheckin } = require('./collect');
  const { runTasks } = require('./do_tasks');
  const { launchBrowser } = require('./browser');

  const accounts = loadAccounts(process.env, __dirname);
  const isMulti = accounts.length > 1;
  if (isMulti) {
    syncAccountSessions(accounts, __dirname);
  }

  // 2. Lockfile para conta única (evita concorrência global no cron)
  let releaseSingleLock = null;
  if (!isMulti) {
    try {
      releaseSingleLock = await acquireLock(isForce(), null, accounts[0]?.lockPath);
    } catch (err) {
      if (err instanceof LockActiveError) {
        try {
          const cfg = loadConfig(false);
          await sendHeartbeat('fail', { config: cfg, error: err });
          await sendTelegram({
            config: cfg,
            chatId: accounts[0]?.telegramChatId,
            event: 'lock_active',
            error: err
          });
        } catch (tgErr) {
          logger.warn({ err: tgErr.message }, 'Falha ao enviar notificação Telegram de lock.');
        }
        process.exit(3);
      }
      logger.error({ err: err.message }, 'Falha ao adquirir lock exclusivo.');
      try {
        const cfg = loadConfig(false);
        await sendHeartbeat('fail', { config: cfg, error: err });
        await sendTelegram({
          config: cfg,
          chatId: accounts[0]?.telegramChatId,
          event: 'failure',
          error: err
        });
      } catch (tgErr) {
        logger.warn({ err: tgErr.message }, 'Falha ao enviar notificação Telegram de erro.');
      }
      process.exit(1);
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

  const config = loadConfig(true);

  // Dead man's switch: sinal de início
  await sendHeartbeat('start', { config });

  let browser = null;

  try {
    // 1 única instância compartilhada do Chromium para a execução
    browser = await launchBrowser({ headless: config.HEADLESS });

    if (!isMulti) {
      // ----------------- FLUXO CONTA ÚNICA -----------------
      const account = accounts[0] || null;

      // ETAPA 1: Check-in diário
      const step1StartTime = new Date();
      logger.info('>>> [ETAPA 1/2] Iniciando Check-in Diário...');
      logger.info(`    Dia e Hora de Início: ${formatDateTime(step1StartTime)}`);

      let checkinResult = null;
      try {
        checkinResult = await runCheckin({ browser, account, skipReport: true });
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
          process.exit(5);
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
        process.exit(1);
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
        process.exit(1);
      }

      logger.info(
        `>>> [ETAPA 1/2] Concluída em ${formatDateTime(step1EndTime)} | Duração: ${step1Duration}`
      );

      // ETAPA 2: Execução das tarefas diárias
      const step2StartTime = new Date();
      logger.info('>>> [ETAPA 2/2] Iniciando Execução Sequencial das Tarefas Diárias...');
      logger.info(`    Dia e Hora de Início: ${formatDateTime(step2StartTime)}`);

      let tasksResult = null;
      try {
        tasksResult = await runTasks({
          browser,
          account,
          sessionData: checkinResult.sessionData,
          initialBalance: checkinResult.totalBalance,
          skipAutoLogin: true,
          skipReport: true
        });
      } catch (err) {
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
        step2Duration
      });

      renderUnifiedReport(
        checkinResult,
        tasksResult,
        {
          mainStartTime,
          mainEndTime,
          totalDuration,
          step1Duration,
          step2Duration
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
      const hadNewCheckin = checkinResult && !checkinResult.alreadyCollected;
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
        process.exit(4);
      }

      await sendHeartbeat('success', { config, report: unifiedPayload });

      if (!hadNewCheckin && !hadTaskActions) {
        process.exit(2);
      }
      process.exit(0);
    } else {
      // ----------------- FLUXO MULTI-CONTA SEQUENCIAL -----------------
      const accountReports = [];
      let anyAccountHadNewAction = false;
      let anyAccountSuccess = false;
      let anyAccountStreakBroken = false;
      let anyAccount2FARequired = false;
      let allAccountsLocked = true;
      let consecutiveFailures = 0;

      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        logger.info(
          `\n>>> [CONTA ${i + 1}/${accounts.length}] Iniciando execução para: ${account.maskedUser}`
        );

        const accStartTime = new Date();
        let accStep1Duration = '0s';
        let accStep2Duration = '0s';
        let accEndTime = null;
        let accTotalDuration = '0s';

        // Garante isolamento estrito de cookies e storage fechando contextos remanescentes
        if (browser && typeof browser.contexts === 'function') {
          for (const ctx of browser.contexts()) {
            await ctx.close().catch(() => {});
          }
        }

        let releaseAccountLock = null;
        try {
          releaseAccountLock = await acquireLock(isForce(), null, account.lockPath);
          allAccountsLocked = false;
        } catch (err) {
          consecutiveFailures++;
          accEndTime = new Date();
          accTotalDuration = formatDuration(accEndTime - accStartTime);
          if (err instanceof LockActiveError) {
            logger.warn(
              { account: account.maskedUser },
              `Lock ativo para a conta ${account.maskedUser}. Pulando...`
            );
            accountReports.push({
              account,
              user: account.maskedUser,
              checkinResult: null,
              tasksResult: null,
              error: 'Lock ativo por outro processo',
              duration: accTotalDuration,
              startTime: accStartTime,
              endTime: accEndTime
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
            duration: accTotalDuration,
            startTime: accStartTime,
            endTime: accEndTime
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
        let accError = null;
        let accImportedExpired = false;
        let accIs2FARequired = false;
        let accStreakBroken = false;

        try {
          // Etapa 1: Check-in
          logger.info(`>>> [CONTA ${i + 1}/${accounts.length}] [ETAPA 1/2] Check-in Diário...`);
          const accStep1StartTime = new Date();
          accCheckin = await runCheckin({ browser, account, skipReport: true });
          const accStep1EndTime = new Date();
          accStep1Duration = formatDuration(accStep1EndTime - accStep1StartTime);
          logger.info(
            `>>> [CONTA ${i + 1}/${accounts.length}] [ETAPA 1/2] Concluída em ${formatDateTime(accStep1EndTime)} | Duração: ${accStep1Duration}`
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
          const accStep2StartTime = new Date();
          try {
            accTasks = await runTasks({
              browser,
              account,
              sessionData: accCheckin?.sessionData,
              initialBalance: accCheckin?.totalBalance,
              skipAutoLogin: true,
              skipReport: true
            });
          } catch (taskErr) {
            logger.warn(
              { err: taskErr.message, account: account.maskedUser },
              'Aviso na etapa de tarefas.'
            );
          }
          const accStep2EndTime = new Date();
          accStep2Duration = formatDuration(accStep2EndTime - accStep2StartTime);
          logger.info(
            `>>> [CONTA ${i + 1}/${accounts.length}] [ETAPA 2/2] Concluída em ${formatDateTime(accStep2EndTime)} | Duração: ${accStep2Duration}`
          );

          anyAccountSuccess = true;
          consecutiveFailures = 0;
          const hadNewCheckin = accCheckin && !accCheckin.alreadyCollected;
          const hadTaskActions = accTasks && accTasks.totalActions > 0;
          if (hadNewCheckin || hadTaskActions) {
            anyAccountHadNewAction = true;
          }

          accEndTime = new Date();
          accTotalDuration = formatDuration(accEndTime - accStartTime);
        } catch (accErr) {
          consecutiveFailures++;
          accEndTime = new Date();
          accTotalDuration = formatDuration(accEndTime - accStartTime);
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
            const backoffMs = calculateAccountBackoff(consecutiveFailures - 1);
            logger.info(
              {
                account: account.maskedUser,
                consecutiveFailures,
                backoffMs,
                nextAccount: accounts[i + 1]?.maskedUser
              },
              `Aguardando backoff exponencial com jitter de ${backoffMs}ms antes de tentar próxima conta...`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        } finally {
          if (releaseAccountLock) {
            await releaseAccountLock();
          }
        }

        if (account.telegramChatId) {
          try {
            const accPayload = buildUnifiedReportPayload(accCheckin, accTasks, {
              user: account.maskedUser,
              mainStartTime: accStartTime,
              mainEndTime: accEndTime || new Date(),
              totalDuration: accTotalDuration,
              step1Duration: accStep1Duration,
              step2Duration: accStep2Duration
            });
            const accEvent = accIs2FARequired
              ? '2fa_required'
              : accStreakBroken
                ? 'streak_break'
                : accError
                  ? 'failure'
                  : !accCheckin?.alreadyCollected || (accTasks && accTasks.totalActions > 0)
                    ? 'success'
                    : 'already_collected';
            await sendTelegram({
              config,
              chatId: account.telegramChatId,
              report: accPayload,
              event: accEvent,
              error: accError
            });
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
          error: accError,
          isImportedSessionExpired: accImportedExpired,
          is2FARequired: accIs2FARequired,
          streakBroken: accStreakBroken,
          startTime: accStartTime,
          endTime: accEndTime || new Date(),
          duration: accTotalDuration
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

      let multiEvent = 'success';
      if (allAccountsLocked) multiEvent = 'lock_active';
      else if (anyAccountStreakBroken) multiEvent = 'streak_break';
      else if (anyAccount2FARequired && !anyAccountSuccess) multiEvent = '2fa_required';
      else if (!anyAccountSuccess) multiEvent = 'failure';
      else if (!anyAccountHadNewAction) multiEvent = 'already_collected';

      try {
        await sendTelegram({ config, report: multiPayload, event: multiEvent });
      } catch (tgErr) {
        logger.warn({ err: tgErr.message }, 'Falha ao enviar notificação Telegram consolidada.');
      }

      if (allAccountsLocked) {
        await sendHeartbeat('fail', {
          config,
          error: new Error('Todas as contas estavam com lock ativo'),
          report: multiPayload
        });
        process.exit(3);
      }
      if (anyAccountStreakBroken) {
        await sendHeartbeat('fail', {
          config,
          error: new Error('Streak quebrado em conta multi-conta'),
          report: multiPayload
        });
        process.exit(4);
      }
      if (anyAccount2FARequired && !anyAccountSuccess) {
        await sendHeartbeat('fail', {
          config,
          error: new Error('2FA requerido em ambiente não-interativo'),
          report: multiPayload
        });
        process.exit(5);
      }
      if (!anyAccountSuccess) {
        await sendHeartbeat('fail', {
          config,
          error: new Error('Todas as contas falharam na execução'),
          report: multiPayload
        });
        process.exit(1);
      }

      await sendHeartbeat('success', { config, report: multiPayload });

      if (!anyAccountHadNewAction) {
        process.exit(2);
      }
      process.exit(0);
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
      process.exit(5);
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
    process.exit(1);
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
  main().catch((err) => {
    logger.error({ err: err.message }, 'Erro não tratado no processo principal.');
    process.exit(1);
  });
}

module.exports = {
  main,
  calculateAccountBackoff
};
