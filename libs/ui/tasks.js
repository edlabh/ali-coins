/**
 * Facade fina para manipulação e execução de tarefas.
 * Delega a lógica pura para os submódulos em libs/tasks/*.
 */
const dispatcher = require('../tasks/dispatcher');
const surprise = require('../tasks/surprise');

function isInteractiveOrAppOnly(task) {
  return dispatcher.isInteractiveOrAppOnly(task);
}

function isAppOnlySkippingEnabled(options) {
  return dispatcher.isAppOnlySkippingEnabled(options);
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

async function ensureMainPage(...args) {
  return await dispatcher.ensureMainPage(...args);
}

async function getDrawerTasksWithRetry(...args) {
  return await dispatcher.getDrawerTasksWithRetry(...args);
}

module.exports = {
  isInteractiveOrAppOnly,
  isAppOnlySkippingEnabled,
  APP_ONLY_DISABLED_STATUS: dispatcher.APP_ONLY_DISABLED_STATUS,
  executeSurpriseItems,
  openTaskDrawer,
  extractTasksFromDrawer,
  executeTaskAction,
  ensureMainPage,
  getDrawerTasksWithRetry,
  findNextPendingTask: dispatcher.findNextPendingTask,
  selectReopenableTasks: dispatcher.selectReopenableTasks,
  recordTaskAttempt: dispatcher.recordTaskAttempt,
  resetTaskAttempt: dispatcher.resetTaskAttempt,
  markSpecialOrAppOnly: dispatcher.markSpecialOrAppOnly,
  classifyTaskStatus: dispatcher.classifyTaskStatus,
  findTaskElement: dispatcher.findTaskElement,
  getRoundKey: dispatcher.getRoundKey,
  recordRoundAttempt: dispatcher.recordRoundAttempt,
  withTimeout: dispatcher.withTimeout
};
