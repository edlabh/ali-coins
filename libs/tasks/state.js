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
 * Encontra a próxima tarefa pendente elegível para execução (pending -> GO)
 * @param {Array<object>} tasks Lista de tarefas extraídas da gaveta
 * @param {object} attemptsMap Mapa de tentativas por título
 * @param {number} maxAttempts Limite máximo de tentativas por tarefa
 * @returns {object|null}
 */
function findNextPendingTask(tasks, attemptsMap = {}, maxAttempts = 4) {
  if (!Array.isArray(tasks)) return null;
  return (
    tasks.find((t) => {
      if (t.isDone) return false;
      if (t.btnText !== 'GO') return false;
      const attempts = attemptsMap[t.title] || 0;
      return attempts < maxAttempts;
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
 * @returns {string} Status descritivo formatado
 */
function classifyTaskStatus(task) {
  if (!task) return 'Desconhecida';

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
  markSpecialOrAppOnly,
  classifyTaskStatus
};
