const { waitWithScroll } = require('../../browser');
const { SELECTORS } = require('../selectors');
const defaultLogger = require('../../logger');

/**
 * Busca pelo atalho embutido na central de moedas (layout aecoin-*, out/2026). Não existe
 * campo de texto: o botão "buscar agora" pesquisa o termo sugerido e abre o resultado
 * (coin-search/result.html) em NOVA aba. Retorna a página onde o resultado abriu, ou null
 * se o atalho não existir.
 * @param {import('playwright').Page} page
 * @param {object} logger
 * @returns {Promise<import('playwright').Page|null>}
 */
async function clickInlineSearchShortcut(page, logger) {
  const searchNowBtn = await page.$(SELECTORS.tasks.searchNow).catch(() => null);
  if (!searchNowBtn) return null;

  const keyword =
    typeof page.$eval === 'function'
      ? await page
          .$eval(SELECTORS.tasks.searchEntrance, (el) => (el.textContent || '').trim())
          .catch(() => '')
      : '';
  logger.info(`Busca embutida da central de moedas detectada; pesquisando "${keyword}"...`);

  const context = typeof page.context === 'function' ? page.context() : null;
  const popupPromise =
    context && typeof context.waitForEvent === 'function'
      ? context.waitForEvent('page', { timeout: 8000 }).catch(() => null)
      : Promise.resolve(null);

  if (typeof searchNowBtn.click === 'function') {
    await searchNowBtn.click({ timeout: 3000 }).catch(async () => {
      if (typeof searchNowBtn.evaluate === 'function') {
        await searchNowBtn.evaluate((el) => el.click()).catch(() => {});
      }
    });
  } else if (typeof searchNowBtn.evaluate === 'function') {
    await searchNowBtn.evaluate((el) => el.click()).catch(() => {});
  }

  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    return popup;
  }
  // Sem nova aba: o resultado pode ter aberto na mesma página
  return page;
}

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

  let resultPage = page;
  if (searchInput) {
    if (searchInput.fill) await searchInput.fill(query).catch(() => {});
    if (searchInput.press) await searchInput.press('Enter').catch(() => {});
  } else {
    const shortcutPage = await clickInlineSearchShortcut(page, logger);
    if (shortcutPage) {
      resultPage = shortcutPage;
    } else {
      logger.warn('Campo de busca não localizado na página; tarefa de busca não iniciada.');
    }
  }

  try {
    if (typeof waitWithScroll === 'function') {
      await waitWithScroll(resultPage, scrollWaitSeconds, {
        taskScrollMaxMs: config?.TASK_SCROLL_MAX_MS,
        earlyExitOnNoProgress: true,
        abortSignal: signal
      });
    }
  } finally {
    // A aba do resultado é nossa: fecha para o painel ser relido na página principal
    if (resultPage !== page && typeof resultPage.close === 'function') {
      await resultPage.close().catch(() => {});
    }
  }
  return true;
}

module.exports = {
  executeSearchTask
};
