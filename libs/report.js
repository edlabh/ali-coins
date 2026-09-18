const { z } = require('zod');
const { formatDate, formatTime, formatDuration } = require('../time_utils');
const { maskUser } = require('../config');
const { getCheckinCoinsFromStreak } = require('./ui/balance');
const logger = require('../logger');

/**
 * Esquema Zod de validação do contrato JSON do relatório unificado
 */
const unifiedReportSchema = z.object({
  type: z.literal('unified_report'),
  user: z.string().optional(),
  checkin: z
    .object({
      alreadyCollected: z.boolean(),
      coinsGainedToday: z.string(),
      streakDays: z.union([z.number(), z.string()]),
      previousStreakDays: z.union([z.number(), z.string()]).optional().nullable(),
      totalBalance: z.string(),
      duration: z.string()
    })
    .nullable(),
  tasks: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string(),
            status: z.string(),
            coins: z.string().optional(),
            estimatedCoins: z.string().optional()
          })
        )
        .optional(),
      initialBalance: z.union([z.number(), z.string()]).optional(),
      finalBalance: z.union([z.number(), z.string()]).optional(),
      coinsGained: z.union([z.number(), z.string()]).optional(),
      finalCoins: z.string(),
      duration: z.string()
    })
    .nullable(),
  meta: z.object({
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    totalDuration: z.string().optional(),
    step1Duration: z.string().optional(),
    step2Duration: z.string().optional(),
    finalBalance: z.string(),
    totalCoinsGained: z.union([z.number(), z.string()]).optional(),
    checkinCoinsGained: z.union([z.number(), z.string()]).optional(),
    tasksCoinsGained: z.union([z.number(), z.string()]).optional(),
    tasksError: z.string().optional()
  })
});

/**
 * Esquema Zod de validação do contrato JSON do relatório multi-conta
 */
const multiAccountReportSchema = z.object({
  type: z.literal('multi_account_report'),
  accounts: z.array(
    z.object({
      user: z.string(),
      checkin: z
        .object({
          alreadyCollected: z.boolean(),
          coinsGainedToday: z.string(),
          streakDays: z.union([z.number(), z.string()]),
          previousStreakDays: z.union([z.number(), z.string()]).optional().nullable(),
          totalBalance: z.string(),
          duration: z.string()
        })
        .nullable(),
      tasks: z
        .object({
          results: z
            .array(
              z.object({
                title: z.string(),
                status: z.string(),
                coins: z.string().optional(),
                estimatedCoins: z.string().optional()
              })
            )
            .optional(),
          initialBalance: z.union([z.number(), z.string()]).optional(),
          finalBalance: z.union([z.number(), z.string()]).optional(),
          coinsGained: z.union([z.number(), z.string()]).optional(),
          finalCoins: z.string(),
          duration: z.string()
        })
        .nullable(),
      error: z.string().optional(),
      tasksError: z.string().optional(),
      isImportedSessionExpired: z.boolean().optional(),
      duration: z.string().optional(),
      meta: z.object({
        finalBalance: z.string(),
        totalCoinsGained: z.union([z.number(), z.string()]).optional(),
        checkinCoinsGained: z.union([z.number(), z.string()]).optional(),
        tasksCoinsGained: z.union([z.number(), z.string()]).optional(),
        tasksError: z.string().optional()
      })
    })
  ),
  meta: z.object({
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    totalDuration: z.string().optional(),
    totalAccounts: z.number(),
    successfulAccounts: z.number()
  })
});

/**
 * Determina se houve quebra de sequência (streak break)
 * Regras:
 * 1. currentStreak e previousStreak devem ser números válidos.
 * 2. previousStreak deve ser > 1 (primeira execução ou dia 1 não tem histórico prévio de sequência quebrável).
 * 3. Se alreadyCollected, trata-se de re-execução no mesmo dia: a sequência já foi garantida e NUNCA quebra.
 * 4. No AliExpress, um streak quebrado sempre reseta para o Dia 1 (+10 moedas).
 *    Leituras intermediárias como 7 quando o streak anterior era > 7 (ex: 212 -> 7) são leituras do widget de 7 dias da semana,
 *    NUNCA uma quebra de sequência real.
 * 5. Quebra real: currentStreak === 1 quando previousStreak > 1 e !alreadyCollected.
 * @param {number|null} currentStreak
 * @param {number|null} previousStreak
 * @param {boolean} [alreadyCollected=false]
 * @returns {boolean}
 */
function isStreakBreak(currentStreak, previousStreak, alreadyCollected = false) {
  if (typeof currentStreak !== 'number' || isNaN(currentStreak)) return false;
  if (typeof previousStreak !== 'number' || isNaN(previousStreak)) return false;
  if (previousStreak <= 1) return false;

  // Se já foi coletado hoje (re-execução no mesmo dia), a sequência já foi garantida
  if (alreadyCollected) {
    return false;
  }

  // Leituras intermediárias (ex: 7 quando anterior era 212) são do ciclo semanal de 7 dias do AliExpress, nunca quebra real
  if (currentStreak > 1 && currentStreak < previousStreak) {
    return false;
  }

  // Quebra real de sequência: retorno ao dia 1 após histórico anterior > 1
  if (currentStreak === 1 && previousStreak > 1) {
    return true;
  }

  return false;
}

/**
 * Calcula as moedas ganhas no check-in para os relatórios.
 * IMPORTANTE: quando `alreadyCollected` é true, `coinsGainedToday` é apenas um eco
 * informativo do check-in já realizado (não é ganho desta execução) e deve ser ignorado.
 * Esta função é compartilhada entre os caminhos unificado e multi-conta para que o
 * cálculo não volte a divergir por cópia de código.
 * @param {object|null} checkin
 * @returns {number}
 */
function computeCheckinCoinsGained(checkin) {
  if (!checkin || checkin.alreadyCollected !== false) {
    return 0;
  }
  if (checkin.coinsGainedToday && checkin.coinsGainedToday !== 'N/D') {
    const parsed = parseInt(String(checkin.coinsGainedToday).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  // Fallback se coinsGainedToday for ausente/N/D mas streakDays estiver presente
  if (checkin.streakDays && checkin.streakDays !== 'N/D') {
    const fromStreak = getCheckinCoinsFromStreak(checkin.streakDays);
    if (typeof fromStreak === 'number' && fromStreak > 0) return fromStreak;
  }
  return 0;
}

/**
 * Calcula as moedas ganhas pelas tarefas (somente valores numéricos válidos).
 * Se o check-in foi realizado nesta execução e o saldo inicial das tarefas
 * não tiver sido ajustado (correspondendo ao saldo pré-checkin), desconta as moedas
 * do check-in para que o extrato das tarefas reflita estritamente o ganho das tarefas.
 * @param {object|null} tasks
 * @param {object|null} [checkin=null]
 * @returns {number}
 */
function computeTasksCoinsGained(tasks, checkin = null) {
  if (!tasks || typeof tasks.coinsGained !== 'number' || !Number.isFinite(tasks.coinsGained)) {
    return 0;
  }
  const rawCoins = tasks.coinsGained;
  if (!checkin) return rawCoins;

  const checkinCoins = computeCheckinCoinsGained(checkin);
  if (checkinCoins <= 0) return rawCoins;

  const initBal = parseInt(String(tasks.initialBalance || '').replace(/\D/g, ''), 10);
  const checkinBal = parseInt(String(checkin.totalBalance || '').replace(/\D/g, ''), 10);

  // Se o saldo inicial das tarefas corresponde ao saldo pré-checkin (totalBalance - checkinCoins),
  // a diferença de saldo das tarefas absorveu as moedas do check-in. Descontamos para evitar soma/duplicação.
  if (!isNaN(initBal) && !isNaN(checkinBal) && initBal === checkinBal - checkinCoins) {
    return Math.max(0, rawCoins - checkinCoins);
  }

  return rawCoins;
}

/**
 * Resolve o saldo final consolidado (tarefas > check-in > 'N/D')
 * @param {object|null} checkin
 * @param {object|null} tasks
 * @returns {string}
 */
function computeFinalBalance(checkin, tasks) {
  if (tasks && tasks.finalCoins && tasks.finalCoins !== 'N/D') {
    return tasks.finalCoins;
  }
  if (checkin && checkin.totalBalance && checkin.totalBalance !== 'N/D') {
    return `${checkin.totalBalance} moedas`;
  }
  return 'N/D';
}

/**
 * Constrói o objeto estruturado do relatório unificado
 * @param {object} checkinResult
 * @param {object} tasksResult
 * @param {object} meta
 * @returns {object}
 */
function buildUnifiedReportPayload(checkinResult, tasksResult, meta = {}) {
  const finalBalance = computeFinalBalance(checkinResult, tasksResult);
  const checkinCoinsGained = computeCheckinCoinsGained(checkinResult);
  const tasksCoinsGained = computeTasksCoinsGained(tasksResult, checkinResult);
  const totalCoinsGained = checkinCoinsGained + tasksCoinsGained;

  let totalDuration = meta.totalDuration;
  if (!totalDuration || totalDuration === '0s') {
    if (meta.mainStartTime && meta.mainEndTime) {
      const ms = new Date(meta.mainEndTime) - new Date(meta.mainStartTime);
      if (ms > 0) totalDuration = formatDuration(ms);
    }
  }
  if (!totalDuration || totalDuration === '0s') {
    if (checkinResult?.startTime && tasksResult?.endTime) {
      const ms = new Date(tasksResult.endTime) - new Date(checkinResult.startTime);
      if (ms > 0) totalDuration = formatDuration(ms);
    } else if (
      checkinResult?.duration &&
      checkinResult.duration !== '0s' &&
      (!tasksResult || !tasksResult.duration || tasksResult.duration === '0s')
    ) {
      totalDuration = checkinResult.duration;
    } else if (
      tasksResult?.duration &&
      tasksResult.duration !== '0s' &&
      (!checkinResult || !checkinResult.duration || checkinResult.duration === '0s')
    ) {
      totalDuration = tasksResult.duration;
    }
  }
  if (!totalDuration) {
    totalDuration = meta.totalDuration || '0s';
  }

  let step1Duration = meta.step1Duration;
  if (!step1Duration || step1Duration === '0s') {
    if (checkinResult?.duration && checkinResult.duration !== '0s') {
      step1Duration = checkinResult.duration;
    }
  }

  let step2Duration = meta.step2Duration;
  if (!step2Duration || step2Duration === '0s') {
    if (tasksResult?.duration && tasksResult.duration !== '0s') {
      step2Duration = tasksResult.duration;
    }
  }

  return {
    type: 'unified_report',
    user:
      meta.user ||
      (checkinResult ? checkinResult.userEmail : tasksResult ? tasksResult.userEmail : undefined),
    checkin: checkinResult
      ? {
          alreadyCollected: checkinResult.alreadyCollected,
          coinsGainedToday: checkinResult.coinsGainedToday,
          streakDays: checkinResult.streakDays,
          previousStreakDays: checkinResult.previousStreakDays,
          totalBalance: checkinResult.totalBalance,
          duration: checkinResult.duration
        }
      : null,
    tasks: tasksResult
      ? {
          results: tasksResult.results,
          initialBalance: tasksResult.initialBalance,
          finalBalance: tasksResult.finalBalance,
          coinsGained: tasksResult.coinsGained,
          finalCoins: tasksResult.finalCoins,
          duration: tasksResult.duration
        }
      : null,
    meta: {
      startTime: meta.mainStartTime ? meta.mainStartTime.toISOString() : undefined,
      endTime: meta.mainEndTime ? meta.mainEndTime.toISOString() : undefined,
      totalDuration,
      step1Duration,
      step2Duration,
      finalBalance,
      totalCoinsGained,
      checkinCoinsGained,
      tasksCoinsGained,
      tasksError: meta.tasksError
    }
  };
}

/**
 * Envia notificação para Webhook genérico (Discord/Telegram/HTTP POST) com timeout de 5s
 * Nunca lança erro ou interrompe o fluxo de execução
 * @param {object} payload
 * @param {string} [customUrl]
 * @returns {Promise<boolean>}
 */
// Rastreamento de webhooks em voo vive em módulo leve (sem Playwright), consumido
// também por libs/exit.js para flush no encerramento.
const { trackWebhook, flushWebhooks } = require('./webhooks');

/**
 * Envia notificação para webhook, registrando a promessa em voo para flush no encerramento.
 * @param {object} payload
 * @param {string} [customUrl]
 * @returns {Promise<boolean>}
 */
function sendWebhookNotification(payload, customUrl = null) {
  return trackWebhook(performWebhookNotification(payload, customUrl));
}

async function performWebhookNotification(payload, customUrl = null) {
  const webhookUrl = customUrl || process.env.NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) return false;

  try {
    const isDiscord = webhookUrl.includes('discord.com/api/webhooks');
    const isTelegram = webhookUrl.includes('api.telegram.org/bot');

    let bodyData = JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };

    const targetUser =
      payload.user ||
      (payload.meta?.totalAccounts
        ? `${payload.meta.successfulAccounts}/${payload.meta.totalAccounts} contas`
        : 'N/D');
    const targetBalance =
      payload.meta?.finalBalance ||
      payload.finalCoins ||
      payload.totalBalance ||
      (payload.meta?.totalAccounts ? `${payload.meta.successfulAccounts} contas OK` : 'N/D');

    if (isDiscord) {
      let coinsText = 'N/D';
      if (typeof payload.meta?.totalCoinsGained === 'number') {
        coinsText = `+${payload.meta.totalCoinsGained} moedas (check-in +${payload.meta.checkinCoinsGained || 0} / tarefas +${payload.meta.tasksCoinsGained || 0})`;
      } else if (payload.coinsGainedToday !== undefined || payload.alreadyCollected !== undefined) {
        const checkinCoins = computeCheckinCoinsGained(payload);
        coinsText = `+${checkinCoins} moedas`;
      } else if (typeof payload.coinsGained === 'number') {
        coinsText = `+${payload.coinsGained} moedas`;
      }

      const summaryText =
        `**AliExpress Coins Report** (${payload.type || 'relatório'})\n` +
        `Conta: ${targetUser}\n` +
        `Ganhas hoje: ${coinsText}\n` +
        `Saldo: ${targetBalance}`;
      bodyData = JSON.stringify({
        content: summaryText,
        embeds: [
          {
            title: 'Relatório AliExpress Moedas',
            description: 'Execução concluída com sucesso.',
            fields: [
              { name: 'Tipo', value: String(payload.type || 'N/D'), inline: true },
              { name: 'Conta', value: String(targetUser), inline: true },
              { name: 'Ganhas hoje', value: String(coinsText), inline: true },
              { name: 'Saldo', value: String(targetBalance), inline: true },
              {
                name: 'Duração',
                value: String(payload.meta?.totalDuration || payload.duration || 'N/D'),
                inline: true
              }
            ]
          }
        ]
      });
    } else if (isTelegram) {
      let coinsText = '';
      if (typeof payload.meta?.totalCoinsGained === 'number') {
        coinsText = `\nGanhas hoje: +${payload.meta.totalCoinsGained} (check-in +${payload.meta.checkinCoinsGained || 0} / tarefas +${payload.meta.tasksCoinsGained || 0})`;
      }
      const text = `AliExpress Coins (${payload.type})\nConta: ${targetUser}${coinsText}\nSaldo: ${targetBalance}`;
      bodyData = JSON.stringify({ text });
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: bodyData,
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText },
        'Webhook notification retornou status não-2xx.'
      );
      return false;
    }
    logger.info('Notificação via Webhook enviada com sucesso.');
    return true;
  } catch (err) {
    logger.debug(
      { err: err.message },
      'Falha silenciosa ao enviar notificação webhook (job preservado).'
    );
    return false;
  }
}

/**
 * Renderiza o relatório do check-in diário
 * @param {object} checkinResult
 * @param {object} [options={}]
 * @param {boolean} [options.json=false]
 */
function renderCheckinReport(checkinResult, options = {}) {
  if (options.json) {
    const payload = { type: 'checkin', ...checkinResult };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    // Mascara o e-mail antes de enviar a webhooks de terceiros (Discord/Telegram) — o stdout
    // local mantém o valor cru, que é o comportamento já esperado por quem consome --json.
    const webhookPayload = {
      ...payload,
      userEmail: checkinResult.userEmail
        ? maskUser(checkinResult.userEmail)
        : checkinResult.userEmail
    };
    sendWebhookNotification(webhookPayload).catch(() => {});
    return;
  }

  const checkinGained = computeCheckinCoinsGained(checkinResult);
  const reportLine1 = checkinResult.alreadyCollected
    ? 'já estava coletado (+0 moedas)'
    : `${checkinGained > 0 ? checkinGained : checkinResult.coinsGainedToday} moedas`;
  const reportLine2 = `${checkinResult.totalBalance} moedas`;
  const reportLine3 =
    checkinResult.streakDays !== 'N/D'
      ? `a sequência subiu (${checkinResult.streakDays} dias seguidos)`
      : 'sequência não identificada na página';

  logger.info('=== RELATORIO_OUTPUT ===');
  logger.info(reportLine1);
  logger.info(reportLine2);
  logger.info(reportLine3);
  logger.info('---------------------------------------------------------------');
  logger.info(`Data:                ${formatDate(checkinResult.startTime)}`);
  logger.info(`Hora de Início:      ${formatTime(checkinResult.startTime)}`);
  logger.info(`Hora de Finalização: ${formatTime(checkinResult.endTime)}`);
  logger.info(`Duração Total:       ${checkinResult.duration}`);
  logger.info('===============================================================\n');

  sendWebhookNotification({
    type: 'checkin',
    alreadyCollected: checkinResult.alreadyCollected,
    totalBalance: checkinResult.totalBalance,
    duration: checkinResult.duration
  }).catch(() => {});
}

/**
 * Renderiza o relatório de tarefas diárias
 * @param {object} tasksResult
 * @param {object} [options={}]
 * @param {boolean} [options.json=false]
 */
function renderTasksReport(tasksResult, options = {}) {
  if (options.json) {
    const payload = { type: 'tasks', ...tasksResult };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    // Mascara o e-mail antes de enviar a webhooks de terceiros (mesma política do check-in);
    // o stdout local mantém o valor cru para quem consome --json.
    const webhookPayload = {
      ...payload,
      userEmail: payload.userEmail ? maskUser(payload.userEmail) : payload.userEmail
    };
    sendWebhookNotification(webhookPayload).catch(() => {});
    return;
  }

  logger.info('\n================ RESUMO DAS TAREFAS ================');
  if (Array.isArray(tasksResult.results)) {
    for (const r of tasksResult.results) {
      logger.info(`- ${r.title}: ${r.status} (${r.coins || ''})`);
    }
  }
  logger.info(`\nSaldo total final: ${tasksResult.finalCoins}`);
  logger.info('----------------------------------------------------');
  logger.info(`Data:                ${formatDate(tasksResult.startTime)}`);
  logger.info(`Hora de Início:      ${formatTime(tasksResult.startTime)}`);
  logger.info(`Hora de Finalização: ${formatTime(tasksResult.endTime)}`);
  logger.info(`Duração Total:       ${tasksResult.duration}`);
  logger.info('====================================================\n');

  sendWebhookNotification({
    type: 'tasks',
    finalCoins: tasksResult.finalCoins,
    duration: tasksResult.duration
  }).catch(() => {});
}

/**
 * Renderiza o relatório consolidado final (modo unificado all.js)
 * @param {object} checkinResult
 * @param {object} tasksResult
 * @param {object} meta
 * @param {object} [options={}]
 * @param {boolean} [options.json=false]
 */
function renderUnifiedReport(checkinResult, tasksResult, meta = {}, options = {}) {
  const jsonOutput = buildUnifiedReportPayload(checkinResult, tasksResult, meta);

  if (options.json) {
    process.stdout.write(JSON.stringify(jsonOutput, null, 2) + '\n');
    sendWebhookNotification(jsonOutput).catch(() => {});
    return;
  }

  logger.info('\n===============================================================');
  logger.info('                RELATÓRIO CONSOLIDADO FINAL');
  logger.info('===============================================================');

  if (checkinResult) {
    const dailyTier =
      (checkinResult.streakDays && checkinResult.streakDays !== 'N/D'
        ? getCheckinCoinsFromStreak(checkinResult.streakDays)
        : null) ||
      (checkinResult.coinsGainedToday && checkinResult.coinsGainedToday !== '0'
        ? checkinResult.coinsGainedToday
        : 70);

    logger.info(`Conta: ${maskUser(checkinResult.userEmail)}`);
    logger.info(
      `Sequência (Streak): ${checkinResult.streakDays} dias seguidos (+${dailyTier} moedas/dia)`
    );
    const checkinGained =
      jsonOutput.meta.checkinCoinsGained ?? computeCheckinCoinsGained(checkinResult);
    logger.info(
      `Check-in Diário: ${checkinResult.alreadyCollected ? 'Já coletado hoje (+0 moedas)' : `Coletado com sucesso (+${checkinGained} moedas)`}`
    );
  }

  if (tasksResult && tasksResult.results) {
    logger.info('\nTarefas do Painel "Ganhe mais moedas":');
    for (const r of tasksResult.results) {
      logger.info(`  • ${r.title}: ${r.status} (${r.coins || r.estimatedCoins || ''})`);
    }
    logger.info(
      `Ganho Real pelas Tarefas: +${jsonOutput.meta.tasksCoinsGained ?? tasksResult.coinsGained ?? 0} moedas`
    );
  }

  logger.info('---------------------------------------------------------------');
  logger.info(
    `Moedas Ganhas Hoje:     +${jsonOutput.meta.totalCoinsGained || 0} moedas (check-in +${jsonOutput.meta.checkinCoinsGained || 0} / tarefas +${jsonOutput.meta.tasksCoinsGained || 0})`
  );
  logger.info(`Saldo Total Atualizado: ${jsonOutput.meta.finalBalance}`);
  logger.info('---------------------------------------------------------------');
  if (meta.mainStartTime && meta.mainEndTime) {
    logger.info(`Data:                ${formatDate(meta.mainStartTime)}`);
    logger.info(`Hora de Início:      ${formatTime(meta.mainStartTime)}`);
    logger.info(`Hora de Finalização: ${formatTime(meta.mainEndTime)}`);
  }
  if (meta.step1Duration) logger.info(`Duração Etapa 1:     ${meta.step1Duration}`);
  if (meta.step2Duration) logger.info(`Duração Etapa 2:     ${meta.step2Duration}`);
  if (meta.totalDuration) logger.info(`Duração Total:       ${meta.totalDuration}`);
  logger.info('===============================================================\n');

  sendWebhookNotification(jsonOutput).catch(() => {});
}

/**
 * Constrói o objeto estruturado do relatório multi-conta
 * @param {Array<{ account?: object, user?: string, checkinResult?: object, tasksResult?: object, error?: string }>} accountResults
 * @param {object} meta
 * @returns {object}
 */
function buildMultiAccountReportPayload(accountResults = [], meta = {}) {
  const accounts = accountResults.map((item) => {
    const checkin = item.checkinResult;
    const tasks = item.tasksResult;
    const finalBalance = computeFinalBalance(checkin, tasks);
    // Mesmo cálculo compartilhado do relatório unificado: respeita alreadyCollected e isola moedas do check-in
    const checkinCoinsGained = computeCheckinCoinsGained(checkin);
    const tasksCoinsGained = computeTasksCoinsGained(tasks, checkin);
    const totalCoinsGained = checkinCoinsGained + tasksCoinsGained;

    let accountDuration = item.duration;
    if (!accountDuration || accountDuration === '0s') {
      if (item.startTime && item.endTime) {
        const ms = new Date(item.endTime) - new Date(item.startTime);
        if (ms > 0) accountDuration = formatDuration(ms);
      }
    }
    if (!accountDuration || accountDuration === '0s') {
      if (checkin?.startTime && tasks?.endTime) {
        const ms = new Date(tasks.endTime) - new Date(checkin.startTime);
        if (ms > 0) accountDuration = formatDuration(ms);
      } else if (
        checkin?.duration &&
        checkin.duration !== '0s' &&
        (!tasks || !tasks.duration || tasks.duration === '0s')
      ) {
        accountDuration = checkin.duration;
      } else if (
        tasks?.duration &&
        tasks.duration !== '0s' &&
        (!checkin || !checkin.duration || checkin.duration === '0s')
      ) {
        accountDuration = tasks.duration;
      }
    }

    return {
      user: item.account ? item.account.maskedUser : item.user || 'Desconhecido',
      checkin: checkin
        ? {
            alreadyCollected: checkin.alreadyCollected,
            coinsGainedToday: checkin.coinsGainedToday,
            streakDays: checkin.streakDays,
            previousStreakDays: checkin.previousStreakDays,
            totalBalance: checkin.totalBalance,
            duration: checkin.duration
          }
        : null,
      tasks: tasks
        ? {
            results: tasks.results,
            initialBalance: tasks.initialBalance,
            finalBalance: tasks.finalBalance,
            coinsGained: tasks.coinsGained,
            finalCoins: tasks.finalCoins,
            duration: tasks.duration
          }
        : null,
      error: item.error || undefined,
      // Preserva a falha da etapa de tarefas (check-in OK) para o alerta consolidado
      tasksError: item.tasksError || undefined,
      // Preserva o sinal de sessão importada expirada para o alerta consolidado do Telegram
      isImportedSessionExpired: Boolean(item.isImportedSessionExpired),
      duration: accountDuration,
      meta: {
        finalBalance,
        totalCoinsGained,
        checkinCoinsGained,
        tasksCoinsGained,
        tasksError: item.tasksError || undefined
      }
    };
  });

  const successfulAccounts = accountResults.filter((a) => !a.error).length;

  let totalDuration = meta.totalDuration;
  if (!totalDuration || totalDuration === '0s') {
    if (meta.mainStartTime && meta.mainEndTime) {
      const ms = new Date(meta.mainEndTime) - new Date(meta.mainStartTime);
      if (ms > 0) totalDuration = formatDuration(ms);
    }
  }

  return {
    type: 'multi_account_report',
    accounts,
    meta: {
      startTime: meta.mainStartTime ? meta.mainStartTime.toISOString() : undefined,
      endTime: meta.mainEndTime ? meta.mainEndTime.toISOString() : undefined,
      totalDuration,
      totalAccounts: accountResults.length,
      successfulAccounts
    }
  };
}

/**
 * Renderiza o relatório consolidado final multi-conta
 * @param {Array<object>} accountResults
 * @param {object} meta
 * @param {object} [options={}]
 * @param {boolean} [options.json=false]
 */
function renderMultiAccountReport(accountResults = [], meta = {}, options = {}) {
  const jsonOutput = buildMultiAccountReportPayload(accountResults, meta);

  if (options.json) {
    process.stdout.write(JSON.stringify(jsonOutput, null, 2) + '\n');
    sendWebhookNotification(jsonOutput).catch(() => {});
    return;
  }

  logger.info('\n===============================================================');
  logger.info(`       RELATÓRIO CONSOLIDADO FINAL - MULTI-CONTA (${accountResults.length} contas)`);
  logger.info('===============================================================');

  accountResults.forEach((res, idx) => {
    const userDisplay = res.account ? res.account.maskedUser : res.user || `Conta ${idx + 1}`;
    logger.info(`\n[Conta ${idx + 1}/${accountResults.length}]: ${userDisplay}`);
    if (res.error) {
      logger.info(`  • Status: FALHA (${res.error})`);
      return;
    }

    const accMeta = jsonOutput.accounts[idx]?.meta;

    if (res.checkinResult) {
      const dailyTier =
        (res.checkinResult.streakDays && res.checkinResult.streakDays !== 'N/D'
          ? getCheckinCoinsFromStreak(res.checkinResult.streakDays)
          : null) ||
        (res.checkinResult.coinsGainedToday && res.checkinResult.coinsGainedToday !== '0'
          ? res.checkinResult.coinsGainedToday
          : 70);

      logger.info(
        `  • Sequência (Streak): ${res.checkinResult.streakDays} dias (+${dailyTier} moedas/dia)`
      );
      const accCheckinGained =
        accMeta?.checkinCoinsGained ?? computeCheckinCoinsGained(res.checkinResult);
      logger.info(
        `  • Check-in: ${res.checkinResult.alreadyCollected ? 'Já coletado (+0 moedas)' : `Coletado com sucesso (+${accCheckinGained} moedas)`}`
      );
    }

    if (res.tasksResult && res.tasksResult.results) {
      // totalActions conta ações executadas de fato; results inclui tarefas puladas/desativadas.
      const executedTasks = res.tasksResult.totalActions ?? res.tasksResult.results.length;
      logger.info(`  • Tarefas executadas: ${executedTasks}`);
      for (const r of res.tasksResult.results) {
        logger.info(`    - ${r.title}: ${r.status} (${r.coins || ''})`);
      }
    }

    const finalBal =
      res.tasksResult && res.tasksResult.finalCoins && res.tasksResult.finalCoins !== 'N/D'
        ? res.tasksResult.finalCoins
        : res.checkinResult
          ? `${res.checkinResult.totalBalance} moedas`
          : 'N/D';
    logger.info(`  • Saldo Final: ${finalBal}`);

    if (accMeta) {
      logger.info(
        `  • Moedas Ganhas Hoje: +${accMeta.totalCoinsGained || 0} moedas (check-in +${accMeta.checkinCoinsGained || 0} / tarefas +${accMeta.tasksCoinsGained || 0})`
      );
    }
  });

  logger.info('\n---------------------------------------------------------------');
  if (meta.mainStartTime && meta.mainEndTime) {
    logger.info(`Data:                ${formatDate(meta.mainStartTime)}`);
    logger.info(`Hora de Início:      ${formatTime(meta.mainStartTime)}`);
    logger.info(`Hora de Finalização: ${formatTime(meta.mainEndTime)}`);
  }
  if (meta.totalDuration) logger.info(`Duração Total:       ${meta.totalDuration}`);
  logger.info('===============================================================\n');

  sendWebhookNotification(jsonOutput).catch(() => {});
}

module.exports = {
  unifiedReportSchema,
  multiAccountReportSchema,
  computeCheckinCoinsGained,
  computeTasksCoinsGained,
  computeFinalBalance,
  buildUnifiedReportPayload,
  buildMultiAccountReportPayload,
  sendWebhookNotification,
  flushWebhooks,
  renderCheckinReport,
  renderTasksReport,
  renderUnifiedReport,
  renderMultiAccountReport,
  isStreakBreak
};
