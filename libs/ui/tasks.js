/**
 * Facade fina para manipulação e execução de tarefas.
 * Delega a lógica pura para os submódulos em libs/tasks/*.
 */
const dispatcher = require('../tasks/dispatcher');
const surprise = require('../tasks/surprise');

function isInteractiveOrAppOnly(task) {
  return dispatcher.isInteractiveOrAppOnly(task);
}

async function executeSurpriseItems(...args) {
  return await surprise.executeSurpriseItems(...args);
}

async function openTaskDrawer(...args) {
  return await dispatcher.openTaskDrawer(...args);
}

async function extractTasksFromDrawer(...args) {
  return await dispatcher.extractTasksFromDrawer(...args);
}

async function executeTaskAction(...args) {
  return await dispatcher.executeTaskAction(...args);
}

module.exports = {
  isInteractiveOrAppOnly,
  executeSurpriseItems,
  openTaskDrawer,
  extractTasksFromDrawer,
  executeTaskAction,
  findNextPendingTask: dispatcher.findNextPendingTask,
  recordTaskAttempt: dispatcher.recordTaskAttempt,
  resetTaskAttempt: dispatcher.resetTaskAttempt,
  markSpecialOrAppOnly: dispatcher.markSpecialOrAppOnly,
  classifyTaskStatus: dispatcher.classifyTaskStatus,
  findTaskElement: dispatcher.findTaskElement,
  getRoundKey: dispatcher.getRoundKey,
  recordRoundAttempt: dispatcher.recordRoundAttempt,
  withTimeout: dispatcher.withTimeout
};
