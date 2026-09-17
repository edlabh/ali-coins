/**
 * Máquina de estados e classificações para o fluxo de tarefas do AliExpress
 */

/**
 * Identifica se a tarefa exige interação direta no App nativo AliExpress ou condição especial
 * @param {object} task
 * @returns {boolean}
 */
function isInteractiveOrAppOnly(task) {
  if (!task) return false;
  const text = `${task.title || ''} ${task.desc || ''}`.toLowerCase();
  return (
    text.includes('prize land') ||
    text.includes('0.1') ||
    text.includes('water') ||
    text.includes('regar') ||
    text.includes('merge boss') ||
    text.includes('game') ||
    text.includes('jogo') ||
    text.includes('quiz') ||
    text.includes('review') ||
    text.includes('avalia')
  );
}

/**
 * Retorna chave única para rastrear tentativas de uma rodada específica da tarefa
 * @param {object} task
 * @returns {string}
 */
function getRoundKey(task) {
  if (!task) return '';
  return `${task.title || ''}:::${task.statusText || ''}`;
}

/**
 * Registra tentativa de execução de uma rodada específica
 * @param {object} roundAttemptsMap
 * @param {string} roundKey
 * @returns {number}
 */
function recordRoundAttempt(roundAttemptsMap, roundKey) {
  if (!roundKey || !roundAttemptsMap) return 0;
  roundAttemptsMap[roundKey] = (roundAttemptsMap[roundKey] || 0) + 1;
  return roundAttemptsMap[roundKey];
}

/**
 * Envolve função assíncrona com timeout estrito e cancelamento cooperativo.
 * A função recebe um AbortSignal que é abortado no timeout, permitindo que
 * tarefas longas (scroll, cliques, navegação) encerrem em vez de continuarem
 * operando no mesmo page em segundo plano.
 * @param {(signal: AbortSignal) => Promise<any>} asyncFn
 * @param {number} timeoutMs
 * @param {string} [timeoutMessage='Timeout excedido']
 * @returns {Promise<any>}
 */
async function withTimeout(asyncFn, timeoutMs, timeoutMessage = 'Timeout excedido') {
  const controller = new AbortController();
  let timerId;
  let hasTimedOut = false;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      hasTimedOut = true;
      controller.abort();
      const err = new Error(timeoutMessage);
      err.code = 'TASK_TIMEOUT';
      reject(err);
    }, timeoutMs);
  });

  const wrappedFnPromise = Promise.resolve()
    .then(() => asyncFn(controller.signal))
    .catch((err) => {
      if (hasTimedOut) return null; // evita unhandled rejection tardio da ação cancelada
      throw err;
    });

  try {
    return await Promise.race([wrappedFnPromise, timeoutPromise]);
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Encontra a próxima tarefa pendente elegível para execução ou resgate de moedas
 * Prioriza tarefas prontas para coleta (claimable) e aceita botões de ação (GO / IR)
 * @param {Array<object>} tasks Lista de tarefas extraídas da gaveta
 * @param {object} [attemptsMap={}] Mapa de tentativas por título
 * @param {number} [maxAttempts=4] Limite máximo de tentativas consecutivas por tarefa
 * @param {object} [options={}] Opções adicionais de controle de rodada e falha
 * @param {object} [options.roundAttemptsMap={}] Mapa de tentativas por (título + statusText)
 * @param {number} [options.maxRoundAttempts=3] Limite máximo por rodada sem progresso
 * @param {object} [options.failedTasks={}] Mapa de tarefas com desistência/falha
 * @returns {object|null}
 */
function findNextPendingTask(tasks, attemptsMapArg = {}, maxAttemptsArg = 4, optionsArg = {}) {
  if (!Array.isArray(tasks)) return null;

  let attemptsMap = attemptsMapArg;
  let maxAttempts = maxAttemptsArg;
  let options = optionsArg;

  // Suporte flexível se 2º argumento for objeto de opções
  if (attemptsMapArg && typeof attemptsMapArg === 'object' && !Array.isArray(attemptsMapArg)) {
    if (
      attemptsMapArg.attemptsMap !== undefined ||
      attemptsMapArg.roundAttemptsMap !== undefined ||
      attemptsMapArg.maxRoundAttempts !== undefined ||
      attemptsMapArg.failedTasks !== undefined
    ) {
      options = attemptsMapArg;
      attemptsMap = options.attemptsMap || {};
      maxAttempts = options.maxAttempts ?? maxAttemptsArg ?? 4;
    }
  }

  const roundAttemptsMap = options.roundAttemptsMap || {};
  const maxRoundAttempts = options.maxRoundAttempts ?? 3;
  const failedTasks = options.failedTasks || {};

  const isEligible = (t) => {
    if (!t || t.isDone) return false;
    if (failedTasks[t.title] || t.failureReason) return false;

    const attempts = attemptsMap[t.title] || 0;
    if (attempts >= maxAttempts) {
      if (!failedTasks[t.title]) {
        failedTasks[t.title] = `Falhou (limite de ${maxAttempts} tentativas atingido)`;
      }
      return false;
    }

    const roundKey = getRoundKey(t);
    const roundAttempts = roundAttemptsMap[roundKey] || 0;
    if (roundAttempts >= maxRoundAttempts) {
      if (!failedTasks[t.title]) {
        failedTasks[t.title] = `Falhou (sem progresso após ${maxRoundAttempts} tentativas)`;
      }
      return false;
    }

    return true;
  };

  // Prioridade 1: Tarefas com botão de resgate/coleta pendente (intermediária ou final)
  const claimableTask = tasks.find((t) => {
    if (!isEligible(t)) return false;
    return Boolean(t.isClaimable);
  });
  if (claimableTask) return claimableTask;

  // Prioridade 2: Tarefas executáveis (GO, IR ou rodadas pendentes)
  return (
    tasks.find((t) => {
      if (!isEligible(t)) return false;
      const isAction =
        t.isActionable ||
        t.btnText === 'GO' ||
        t.btnText === 'IR' ||
        (t.completedRounds !== null &&
          t.totalRounds !== null &&
          t.completedRounds < t.totalRounds &&
          !t.btnStyle?.includes('opacity: 0.5'));
      return Boolean(isAction);
    }) || null
  );
}

/**
 * Registra tentativa de execução de tarefa
 * @param {object} attemptsMap
 * @param {string} title
 * @returns {number} Novo contador de tentativas
 */
function recordTaskAttempt(attemptsMap, title) {
  if (!title) return 0;
  attemptsMap[title] = (attemptsMap[title] || 0) + 1;
  return attemptsMap[title];
}

/**
 * Reseta o contador de tentativas de uma tarefa quando há progresso de rodada
 * @param {object} attemptsMap
 * @param {string} title
 */
function resetTaskAttempt(attemptsMap, title) {
  if (!title || !attemptsMap) return;
  attemptsMap[title] = 0;
}

/**
 * Marca uma tarefa especial como finalizada para evitar novas tentativas
 * @param {object} attemptsMap
 * @param {string} title
 */
function markSpecialOrAppOnly(attemptsMap, title) {
  if (!title) return;
  attemptsMap[title] = 999;
}

/**
 * Classifica e gera o status amigável de uma tarefa para o relatório final
 * @param {object} task
 * @param {object} [options={}]
 * @param {object} [options.failedTasks={}] Mapa de tarefas com desistência/falha
 * @returns {string} Status descritivo formatado
 */
function classifyTaskStatus(task, options = {}) {
  if (!task) return 'Desconhecida';

  const failedTasks = options.failedTasks || {};
  if (failedTasks[task.title]) {
    return failedTasks[task.title];
  }
  if (task.failureReason) {
    return task.failureReason;
  }

  if (task.isDone) {
    if (task.totalRounds) {
      return `Concluída (${task.totalRounds}/${task.totalRounds})`;
    }
    return task.statusText ? `Concluída (${task.statusText})` : 'Concluída';
  }

  if (isInteractiveOrAppOnly(task)) {
    const titleLower = (task.title || '').toLowerCase();
    const descLower = (task.desc || '').toLowerCase();

    if (
      titleLower.includes('review') ||
      titleLower.includes('avalia') ||
      descLower.includes('review') ||
      descLower.includes('avalia')
    ) {
      return 'Requer pedido entregue elegível para avaliação';
    }

    if (titleLower.includes('quiz') || titleLower.includes('merge boss')) {
      return 'Requer interação direta no App AliExpress (minigame/quiz)';
    }

    return 'Exclusiva do App AliExpress (requer rega no app móvel)';
  }

  if (task.statusText) {
    return `Executada parcialmente (${task.statusText})`;
  }

  return 'Pendente';
}

module.exports = {
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
