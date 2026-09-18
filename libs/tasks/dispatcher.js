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
const {
  openTaskDrawer,
  extractTasksFromDrawer,
  findTaskElement,
  ensureMainPage,
  getDrawerTasksWithRetry
} = require('./verifier');
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
  loggerArg = defaultLogger,
  signalArg = null,
  touchedCardsArg = null
) {
  let page, context, task, config, logger, signal, touchedCards;
  if (pageOrParams && (pageOrParams.page !== undefined || pageOrParams.task !== undefined)) {
    ({
      page,
      context = null,
      task,
      config = {},
      logger = defaultLogger,
      signal = null,
      touchedCards = null
    } = pageOrParams);
  } else {
    page = pageOrParams;
    context = contextArg || null;
    task = taskArg;
    config = configArg || {};
    logger = loggerArg || defaultLogger;
    signal = signalArg || null;
    touchedCards = touchedCardsArg || null;
  }

  // Cancela a ação cooperativamente entre etapas (o AbortSignal é disparado no timeout)
  const isAborted = () => Boolean(signal && signal.aborted);

  if (isAborted()) return {};

  const titleLower = (task?.title || '').toLowerCase();
  const descLower = (task?.desc || '').toLowerCase();

  // 1. Tarefa de produtos surpresa ("toque em 3 itens")
  if (
    titleLower.includes('surprise') ||
    titleLower.includes('surpresa') ||
    descLower.includes('tap 3') ||
    descLower.includes('toque em 3')
  ) {
    const roundOffset =
      task?.completedRounds && task.completedRounds > 0 ? task.completedRounds * 3 : 0;
    const attemptOffset = task?.attempt && task.attempt > 1 ? (task.attempt - 1) * 3 : 0;
    const startCardIdx = roundOffset + attemptOffset;
    await executeSurpriseItems({
      page,
      context,
      startIndex: startCardIdx,
      logger,
      signal,
      touchedCards
    });
    return {};
  }

  if (isAborted()) return {};

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
      logger,
      signal
    });
    return {};
  }

  if (isAborted()) return {};

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
      earlyExitOnNoProgress: true,
      abortSignal: signal
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
  ensureMainPage,
  getDrawerTasksWithRetry,

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
