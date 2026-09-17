const { waitWithScroll } = require('../../browser');
const defaultLogger = require('../../logger');

/**
 * Executa tarefa de busca por produtos
 * @param {object} params
 * @param {import('playwright').Page} params.page
 * @param {string} [params.query='fone bluetooth']
 * @param {number} [params.scrollWaitSeconds=10]
 * @param {object} [params.logger]
 * @returns {Promise<boolean>}
 */
async function executeSearchTask({
  page,
  query = 'fone bluetooth',
  scrollWaitSeconds = 10,
  config = {},
  logger = defaultLogger
} = {}) {
  logger.info(`Executando busca por produto: "${query}"...`);
  const searchInput = await page.$('input').catch(() => null);
  if (searchInput) {
    if (searchInput.fill) await searchInput.fill(query).catch(() => {});
    if (searchInput.press) await searchInput.press('Enter').catch(() => {});
  }
  if (typeof waitWithScroll === 'function') {
    await waitWithScroll(page, scrollWaitSeconds, {
      taskScrollMaxMs: config?.TASK_SCROLL_MAX_MS,
      earlyExitOnNoProgress: true
    });
  }
  return true;
}

module.exports = {
  executeSearchTask
};
