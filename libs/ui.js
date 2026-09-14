/**
 * Facade para re-exportar os submódulos da camada de interface/UI
 * Mantém compatibilidade com require('./libs/ui') em collect.js e do_tasks.js
 */
const navigation = require('./ui/navigation');
const balance = require('./ui/balance');
const diagnostics = require('./ui/diagnostics');
const login = require('./ui/login');
const tasks = require('./ui/tasks');

module.exports = {
  ...navigation,
  ...balance,
  ...diagnostics,
  ...login,
  ...tasks
};
