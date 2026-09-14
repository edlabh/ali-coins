const { loadConfig, handleDryRun, isForce, isJson, checkAndDisplayHelp } = require('./config');
const { runCheckin } = require('./collect');
const { runTasks } = require('./do_tasks');
const { formatDateTime, formatDuration } = require('./time_utils');
const { launchBrowser } = require('./browser');
const { acquireLock, LockActiveError } = require('./lockfile');
const { renderUnifiedReport } = require('./libs/report');
const logger = require('./logger');

async function main() {
  if (checkAndDisplayHelp()) {
    process.exit(0);
  }

  // 1. Suporte a validação sem abrir navegador
  if (handleDryRun()) {
    process.exit(0);
  }

  // 2. Lockfile para evitar concorrência no cron
  let releaseLock = null;
  try {
    releaseLock = await acquireLock(isForce());
  } catch (err) {
    if (err instanceof LockActiveError) {
      process.exit(3);
    }
    logger.error({ err: err.message }, 'Falha ao adquirir lock exclusivo.');
    process.exit(1);
  }

  const mainStartTime = new Date();
  logger.info('===============================================================');
  logger.info('       ALIEXPRESS MOEDAS - MODO UNIFICADO (CHECK-IN + TAREFAS)');
  logger.info('===============================================================\n');

  const config = loadConfig(true);
  let browser = null;

  try {
    // 1 única instância compartilhada do Chromium para ambas as etapas
    browser = await launchBrowser({ headless: config.HEADLESS });

    // ETAPA 1: Check-in diário
    const step1StartTime = new Date();
    logger.info('>>> [ETAPA 1/2] Iniciando Check-in Diário...');
    logger.info(`    Dia e Hora de Início: ${formatDateTime(step1StartTime)}`);

    let checkinResult = null;
    try {
      checkinResult = await runCheckin({ browser });
    } catch (err) {
      const step1EndTime = new Date();
      const step1Duration = formatDuration(step1EndTime - step1StartTime);
      logger.error(
        { err: err.message, step1Duration },
        'Falha crítica na etapa de check-in / login. Interrompendo execução.'
      );
      process.exit(1);
    }

    const step1EndTime = new Date();
    const step1Duration = formatDuration(step1EndTime - step1StartTime);

    if (!checkinResult) {
      logger.error(
        { step1Duration },
        'Check-in não retornou resultado. Interrompendo execução.'
      );
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
        sessionData: checkinResult.sessionData,
        skipAutoLogin: true
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

    if (releaseLock) {
      await releaseLock();
      releaseLock = null;
    }

    // Código 2 se já havia sido coletado e nenhuma tarefa nova foi executada; 0 se sucesso com novas ações
    const hadNewCheckin = checkinResult && !checkinResult.alreadyCollected;
    const hadTaskActions = tasksResult && tasksResult.totalActions > 0;

    if (!hadNewCheckin && !hadTaskActions) {
      process.exit(2);
    }
    process.exit(0);
  } catch (fatalErr) {
    logger.error({ err: fatalErr.message }, 'Erro fatal durante a execução unificada.');
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (releaseLock) {
      await releaseLock();
    }
  }
}

main().catch((err) => {
  logger.error({ err: err.message }, 'Erro não tratado no processo principal.');
  process.exit(1);
});
