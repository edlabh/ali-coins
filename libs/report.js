const { z } = require('zod');
const { formatDate, formatTime } = require('../time_utils');
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
    tasksCoinsGained: z.union([z.number(), z.string()]).optional()
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
      meta: z.object({
        finalBalance: z.string(),
        totalCoinsGained: z.union([z.number(), z.string()]).optional(),
        checkinCoinsGained: z.union([z.number(), z.string()]).optional(),
        tasksCoinsGained: z.union([z.number(), z.string()]).optional()
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
 * Constrói o objeto estruturado do relatório unificado
 * @param {object} checkinResult
 * @param {object} tasksResult
 * @param {object} meta
 * @returns {object}
 */
function buildUnifiedReportPayload(checkinResult, tasksResult, meta = {}) {
  const finalBalance =
    tasksResult && tasksResult.finalCoins && tasksResult.finalCoins !== 'N/D'
      ? tasksResult.finalCoins
      : checkinResult
        ? `${checkinResult.totalBalance} moedas`
        : 'N/D';

  let checkinCoinsGained = 0;
  if (
    checkinResult?.coinsGainedToday &&
    checkinResult.coinsGainedToday !== 'N/D' &&
    checkinResult.alreadyCollected === false
  ) {
    const parsed = parseInt(String(checkinResult.coinsGainedToday).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed)) checkinCoinsGained = parsed;
  }

  let tasksCoinsGained = 0;
  if (tasksResult && typeof tasksResult.coinsGained === 'number') {
    tasksCoinsGained = tasksResult.coinsGained;
  }

  const totalCoinsGained = checkinCoinsGained + tasksCoinsGained;

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
      totalDuration: meta.totalDuration,
      step1Duration: meta.step1Duration,
      step2Duration: meta.step2Duration,
      finalBalance,
      totalCoinsGained,
      checkinCoinsGained,
      tasksCoinsGained
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
async function sendWebhookNotification(payload, customUrl = null) {
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
      } else if (payload.coinsGainedToday) {
        coinsText = `+${payload.coinsGainedToday} moedas`;
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
    sendWebhookNotification(payload).catch(() => {});
    return;
  }

  const reportLine1 = checkinResult.alreadyCollected
    ? `já estava coletado (+${checkinResult.coinsGainedToday} moedas)`
    : `${checkinResult.coinsGainedToday} moedas`;
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
    sendWebhookNotification(payload).catch(() => {});
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
    logger.info(`Conta: ${checkinResult.userEmail}`);
    logger.info(
      `Sequência (Streak): ${checkinResult.streakDays} dias seguidos (+${checkinResult.coinsGainedToday} moedas/dia)`
    );
    logger.info(
      `Check-in Diário: ${checkinResult.alreadyCollected ? 'Já coletado hoje' : 'Coletado com sucesso'} (+${checkinResult.coinsGainedToday} moedas)`
    );
  }

  if (tasksResult && tasksResult.results) {
    logger.info('\nTarefas do Painel "Ganhe mais moedas":');
    for (const r of tasksResult.results) {
      logger.info(`  • ${r.title}: ${r.status} (${r.coins || r.estimatedCoins || ''})`);
    }
    logger.info(`Ganho Real pelas Tarefas: +${tasksResult.coinsGained || 0} moedas`);
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
    const finalBalance =
      tasks && tasks.finalCoins && tasks.finalCoins !== 'N/D'
        ? tasks.finalCoins
        : checkin
          ? `${checkin.totalBalance} moedas`
          : 'N/D';

    let checkinCoinsGained = 0;
    if (checkin?.coinsGainedToday && checkin.coinsGainedToday !== 'N/D') {
      const parsed = parseInt(String(checkin.coinsGainedToday).replace(/[^0-9]/g, ''), 10);
      if (!isNaN(parsed)) checkinCoinsGained = parsed;
    }

    let tasksCoinsGained = 0;
    if (tasks && typeof tasks.coinsGained === 'number') {
      tasksCoinsGained = tasks.coinsGained;
    }

    const totalCoinsGained = checkinCoinsGained + tasksCoinsGained;

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
      meta: {
        finalBalance,
        totalCoinsGained,
        checkinCoinsGained,
        tasksCoinsGained
      }
    };
  });

  const successfulAccounts = accountResults.filter((a) => !a.error).length;

  return {
    type: 'multi_account_report',
    accounts,
    meta: {
      startTime: meta.mainStartTime ? meta.mainStartTime.toISOString() : undefined,
      endTime: meta.mainEndTime ? meta.mainEndTime.toISOString() : undefined,
      totalDuration: meta.totalDuration,
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

    if (res.checkinResult) {
      logger.info(
        `  • Sequência (Streak): ${res.checkinResult.streakDays} dias (+${res.checkinResult.coinsGainedToday} moedas/dia)`
      );
      logger.info(
        `  • Check-in: ${res.checkinResult.alreadyCollected ? 'Já coletado' : 'Coletado com sucesso'} (+${res.checkinResult.coinsGainedToday} moedas)`
      );
    }

    if (res.tasksResult && res.tasksResult.results) {
      logger.info(`  • Tarefas executadas: ${res.tasksResult.totalActions || 0}`);
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
  buildUnifiedReportPayload,
  buildMultiAccountReportPayload,
  sendWebhookNotification,
  renderCheckinReport,
  renderTasksReport,
  renderUnifiedReport,
  renderMultiAccountReport,
  isStreakBreak
};
