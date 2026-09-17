/**
 * Orquestrador fino de despacho e execução de tarefas do painel do AliExpress
 */
const { waitWithScroll } = require('../../browser');
const { executeSurpriseItems } = require('./surprise');
const { executeSearchTask } = require('./search');
const { executePrizeLandTask } = require('./prizeland');
const {
  isInteractiveOrAppOnly,
  findNextPendingTask,
  recordTaskAttempt,
  resetTaskAttempt,
  markSpecialOrAppOnly,
  classifyTaskStatus,
  getRoundKey,
  recordRoundAttempt,
  withTimeout
} = require('./state');
const { openTaskDrawer, extractTasksFromDrawer, findTaskElement } = require('./verifier');
const defaultLogger = require('../../logger');

/**
 * Executa uma ação de tarefa individual com base no título e descrição.
 * Suporta assinatura híbrida: tanto via objeto desestruturado quanto posicional.
 * @param {object|import('playwright').Page} pageOrParams
 * @param {import('playwright').BrowserContext} [contextArg]
 * @param {object} [taskArg]
 * @param {object} [configArg]
 * @param {object} [loggerArg]
 * @returns {Promise<{ isSpecialOrAppOnly?: boolean }>}
 */
async function executeTaskAction(
  pageOrParams,
  contextArg = null,
  taskArg = null,
  configArg = {},
  loggerArg = defaultLogger
) {
  let page, context, task, config, logger;
  if (pageOrParams && (pageOrParams.page !== undefined || pageOrParams.task !== undefined)) {
    ({ page, context = null, task, config = {}, logger = defaultLogger } = pageOrParams);
  } else {
    page = pageOrParams;
    context = contextArg || null;
    task = taskArg;
    config = configArg || {};
    logger = loggerArg || defaultLogger;
  }

  const titleLower = (task?.title || '').toLowerCase();
  const descLower = (task?.desc || '').toLowerCase();

  // 1. Tarefa de produtos surpresa ("toque em 3 itens")
  if (
    titleLower.includes('surprise') ||
    titleLower.includes('surpresa') ||
    descLower.includes('tap 3') ||
    descLower.includes('toque em 3')
  ) {
    const startCardIdx =
      task?.completedRounds && task.completedRounds > 0 ? task.completedRounds * 3 : 0;
    await executeSurpriseItems({ page, context, startIndex: startCardIdx, logger });
    return {};
  }

  let scrollSeconds =
    typeof config.SCROLL_WAIT_SECONDS === 'number' ? config.SCROLL_WAIT_SECONDS : 15;

  // Garante permanência mínima de 16 segundos para tarefas de super descontos / 15s
  if (
    titleLower.includes('desconto') ||
    titleLower.includes('discount') ||
    titleLower.includes('superdeal') ||
    titleLower.includes('super deal') ||
    titleLower.includes('15s') ||
    descLower.includes('15s') ||
    descLower.includes('15 s')
  ) {
    scrollSeconds = Math.max(16, scrollSeconds);
  }

  // 2. Tarefa de busca de palavras-chave
  if (
    titleLower.includes('search') ||
    titleLower.includes('pesquisa') ||
    titleLower.includes('buscar') ||
    descLower.includes('keywords') ||
    descLower.includes('palavra')
  ) {
    await executeSearchTask({
      page,
      query: 'fone bluetooth',
      scrollWaitSeconds: scrollSeconds,
      config,
      logger
    });
    return {};
  }

  // 3. Fazenda Mágica / Prize Land
  if (
    titleLower.includes('prize land') ||
    descLower.includes('prize land') ||
    descLower.includes('water') ||
    descLower.includes('regar') ||
    titleLower.includes('0.1') ||
    descLower.includes('0.1')
  ) {
    await executePrizeLandTask({ page, logger });
    return { isSpecialOrAppOnly: true };
  }

  // 4. Minigames e quizzes exclusivos de aplicativo
  if (
    titleLower.includes('merge boss') ||
    titleLower.includes('game') ||
    titleLower.includes('jogo') ||
    titleLower.includes('quiz')
  ) {
    return { isSpecialOrAppOnly: true };
  }

  // 5. Avaliações de pedidos entregues (requer produto entregue para avaliação)
  if (
    titleLower.includes('review') ||
    titleLower.includes('avalia') ||
    descLower.includes('review') ||
    descLower.includes('avalia')
  ) {
    logger.info(
      `Tarefa "${task?.title || ''}" requer pedido entregue para avaliação. Marcando como especial.`
    );
    return { isSpecialOrAppOnly: true };
  }

  // 6. Tarefas normais de navegação e scroll
  logger.info(`Executando navegação com scroll (${scrollSeconds}s): "${task?.title || ''}"...`);
  if (typeof waitWithScroll === 'function') {
    await waitWithScroll(page, scrollSeconds, {
      taskScrollMaxMs: config.TASK_SCROLL_MAX_MS,
      earlyExitOnNoProgress: true
    });
  }
  return {};
}

module.exports = {
  // Orquestração
  executeTaskAction,

  // Verificação e DOM
  openTaskDrawer,
  extractTasksFromDrawer,
  findTaskElement,

  // Máquina de estados
  isInteractiveOrAppOnly,
  findNextPendingTask,
  recordTaskAttempt,
  resetTaskAttempt,
  markSpecialOrAppOnly,
  classifyTaskStatus,
  getRoundKey,
  recordRoundAttempt,
  withTimeout
};
