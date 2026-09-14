/**
 * Agregador central dos submódulos de UI (navigation, balance, diagnostics, login, tasks)
 * Mantém compatibilidade com require('./libs/ui') e require('./libs/ui/index')
 */
const navigation = require('./navigation');
const balance = require('./balance');
const diagnostics = require('./diagnostics');
const login = require('./login');
const tasks = require('./tasks');

module.exports = {
  ...navigation,
  ...balance,
  ...diagnostics,
  ...login,
  ...tasks
};
