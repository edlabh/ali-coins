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
  logger = defaultLogger,
  signal = null
} = {}) {
  logger.info(`Executando busca por produto: "${query}"...`);
  // Seletor específico e VISÍVEL: o primeiro `<input>` do documento costuma ser um campo
  // oculto (CSRF/tracking) e o `fill` falhava silenciosamente, sem iniciar a busca.
  let searchInput = await page
    .$(
      'input[type="search"], input[name*="SearchText" i], input[placeholder*="search" i], input[aria-label*="search" i], input[name*="search" i]'
    )
    .catch(() => null);
  if (!searchInput && typeof page.$$ === 'function') {
    // Último recurso: primeiro input VISÍVEL (evita o oculto)
    const candidates = await page.$$('input').catch(() => []);
    for (const candidate of candidates) {
      const visible =
        typeof candidate.isVisible === 'function'
          ? await candidate.isVisible().catch(() => false)
          : true;
      if (visible) {
        searchInput = candidate;
        break;
      }
    }
  }
  if (searchInput) {
    if (searchInput.fill) await searchInput.fill(query).catch(() => {});
    if (searchInput.press) await searchInput.press('Enter').catch(() => {});
  } else {
    logger.warn('Campo de busca não localizado na página; tarefa de busca não iniciada.');
  }
  if (typeof waitWithScroll === 'function') {
    await waitWithScroll(page, scrollWaitSeconds, {
      taskScrollMaxMs: config?.TASK_SCROLL_MAX_MS,
      earlyExitOnNoProgress: true,
      abortSignal: signal
    });
  }
  return true;
}

module.exports = {
  executeSearchTask
};
