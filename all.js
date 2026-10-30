const { flushAndExit } = require('./libs/exit');
const logger = require('./logger');
const { main } = require('./libs/runner/multi');

if (require.main === module) {
  main().catch(async (err) => {
    logger.error({ err: err.message }, 'Erro não tratado no processo principal.');
    await flushAndExit(1);
  });
}

module.exports = {
  main
};
