/**
 * Facade fina para manipulação e execução de tarefas.
 * Delega a lógica pura para os submódulos em libs/tasks/*.
 */
const dispatcher = require('../tasks/dispatcher');
const surprise = require('../tasks/surprise');

function isInteractiveOrAppOnly(task) {
  return dispatcher.isInteractiveOrAppOnly(task);
}

async function executeSurpriseItems(targetPage, context, startIndex = 0) {
  return await surprise.executeSurpriseItems({ page: targetPage, context, startIndex });
}

async function openTaskDrawer(page) {
  return await dispatcher.openTaskDrawer({ page });
}

async function extractTasksFromDrawer(page) {
  return await dispatcher.extractTasksFromDrawer({ page });
}

async function executeTaskAction(activePage, context, pendingTask, config) {
  return await dispatcher.executeTaskAction({
    page: activePage,
    context,
    task: pendingTask,
    config
  });
}

module.exports = {
  isInteractiveOrAppOnly,
  executeSurpriseItems,
  openTaskDrawer,
  extractTasksFromDrawer,
  executeTaskAction,
  findNextPendingTask: dispatcher.findNextPendingTask,
  recordTaskAttempt: dispatcher.recordTaskAttempt,
  markSpecialOrAppOnly: dispatcher.markSpecialOrAppOnly,
  classifyTaskStatus: dispatcher.classifyTaskStatus,
  findTaskElement: dispatcher.findTaskElement
};
