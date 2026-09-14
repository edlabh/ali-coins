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
