const { formatDate, formatTime } = require('../time_utils');
const logger = require('../logger');

/**
 * Renderiza o relatório do check-in diário
 * @param {object} checkinResult
 * @param {object} [options={}]
 * @param {boolean} [options.json=false]
 */
function renderCheckinReport(checkinResult, options = {}) {
  if (options.json) {
    process.stdout.write(JSON.stringify({ type: 'checkin', ...checkinResult }, null, 2) + '\n');
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
}

/**
 * Renderiza o relatório de tarefas diárias
 * @param {object} tasksResult
 * @param {object} [options={}]
 * @param {boolean} [options.json=false]
 */
function renderTasksReport(tasksResult, options = {}) {
  if (options.json) {
    process.stdout.write(JSON.stringify({ type: 'tasks', ...tasksResult }, null, 2) + '\n');
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
  const finalBalance =
    tasksResult && tasksResult.finalCoins && tasksResult.finalCoins !== 'N/D'
      ? tasksResult.finalCoins
      : checkinResult
        ? `${checkinResult.totalBalance} moedas`
        : 'N/D';

  if (options.json) {
    const jsonOutput = {
      type: 'unified_report',
      user: checkinResult ? checkinResult.userEmail : undefined,
      checkin: checkinResult
        ? {
            alreadyCollected: checkinResult.alreadyCollected,
            coinsGainedToday: checkinResult.coinsGainedToday,
            streakDays: checkinResult.streakDays,
            totalBalance: checkinResult.totalBalance,
            duration: checkinResult.duration
          }
        : null,
      tasks: tasksResult
        ? {
            results: tasksResult.results,
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
        finalBalance
      }
    };
    process.stdout.write(JSON.stringify(jsonOutput, null, 2) + '\n');
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
      logger.info(`  • ${r.title}: ${r.status} (${r.coins || ''})`);
    }
  }

  logger.info('---------------------------------------------------------------');
  logger.info(`Saldo Total Atualizado: ${finalBalance}`);
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
}

module.exports = {
  renderCheckinReport,
  renderTasksReport,
  renderUnifiedReport
};
