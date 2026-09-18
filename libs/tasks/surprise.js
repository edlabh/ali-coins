const { SELECTORS } = require('../selectors');
const defaultLogger = require('../../logger');

/**
 * Toca em 3 produtos na página de anúncios de ofertas/tarefas
 * Re-consulta elementos dinamicamente a cada toque para evitar stale element reference
 * pós goBack() e suporta paginação por scroll em múltiplas rodadas.
 * @param {object|import('playwright').Page} pageOrParams
 * @param {import('playwright').BrowserContext} [contextArg]
 * @param {number} [startIndexArg=0]
 * @param {object} [loggerArg]
 * @returns {Promise<number>} Quantidade de itens clicados
 */
async function executeSurpriseItems(
  pageOrParams,
  contextArg = null,
  startIndexArg = 0,
  loggerArg = defaultLogger,
  signalArg = null
) {
  let page, context, startIndex, logger, signal;
  if (
    pageOrParams &&
    typeof pageOrParams === 'object' &&
    ('page' in pageOrParams || 'startIndex' in pageOrParams)
  ) {
    ({
      page,
      context = null,
      startIndex = 0,
      logger = defaultLogger,
      signal = null
    } = pageOrParams);
  } else {
    page = pageOrParams;
    context = contextArg || null;
    startIndex = typeof startIndexArg === 'number' ? startIndexArg : 0;
    logger = loggerArg || defaultLogger;
    signal = signalArg || null;
  }

  if (!page) {
    logger.warn('executeSurpriseItems chamado sem instância válida de page.');
    return 0;
  }

  const feedUrl = typeof page.url === 'function' ? page.url() : '';
  logger.info(`Executando tarefa: tocar em 3 itens (a partir do card #${startIndex + 1})...`);
  if (typeof page.waitForSelector === 'function') {
    await page.waitForSelector(SELECTORS.tasks.productCard, { timeout: 4000 }).catch(() => {});
  }

  let clickedCount = 0;
  const targetClicks = 3;

  for (let i = 0; i < targetClicks; i++) {
    if (signal && signal.aborted) {
      logger.warn('Execução de itens surpresa cancelada por timeout.');
      break;
    }
    const targetIdx = startIndex + i;

    // Garante que o DOM tenha cards suficientes antes de tentar obter o elemento
    let currentCards =
      typeof page.$$ === 'function' ? await page.$$(SELECTORS.tasks.productCard) : [];

    if (targetIdx >= currentCards.length && typeof page.evaluate === 'function') {
      await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
      if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(1000).catch(() => {});
      }
      currentCards =
        typeof page.$$ === 'function' ? await page.$$(SELECTORS.tasks.productCard) : [];
    }

    if (currentCards.length === 0) {
      if (typeof page.waitForSelector === 'function') {
        await page.waitForSelector(SELECTORS.tasks.productCard, { timeout: 3000 }).catch(() => {});
      }
      currentCards =
        typeof page.$$ === 'function' ? await page.$$(SELECTORS.tasks.productCard) : [];
      if (currentCards.length === 0) {
        logger.warn(
          `Nenhum card de produto encontrado no DOM para o clique ${i + 1}/${targetClicks}.`
        );
        break;
      }
    }

    // Seleciona card no índice desejado ou faz fallback circular
    const cardIndex = targetIdx < currentCards.length ? targetIdx : targetIdx % currentCards.length;
    const card = currentCards[cardIndex];

    logger.info(`Tocando item ${i + 1}/3 (card #${cardIndex + 1})...`);

    if (card && card.scrollIntoViewIfNeeded) {
      await card.scrollIntoViewIfNeeded().catch(() => {});
    }
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(400).catch(() => {});
    }

    const beforeUrl = typeof page.url === 'function' ? page.url() : '';
    let itemTab = null;
    if (context && typeof context.waitForEvent === 'function') {
      const tabPromise = context.waitForEvent('page', { timeout: 3500 }).catch(() => null);
      if (card && card.click) {
        await card.click({ delay: 50, timeout: 4000 }).catch(async () => {
          if (typeof page.evaluate === 'function') {
            await page.evaluate((el) => el.click(), card).catch(() => {});
          }
        });
      }
      itemTab = await tabPromise;
    } else if (card && card.click) {
      await card.click({ delay: 50, timeout: 4000 }).catch(async () => {
        if (typeof page.evaluate === 'function') {
          await page.evaluate((el) => el.click(), card).catch(() => {});
        }
      });
    }

    // Fallback para captura de nova aba se o waitForEvent não capturou
    if (!itemTab && context && typeof context.pages === 'function') {
      const allPages = context.pages();
      if (allPages && allPages.length > 1) {
        itemTab =
          allPages.find(
            (p) => p !== page && (typeof p.isClosed === 'function' ? !p.isClosed() : true)
          ) || null;
      }
    }

    if (itemTab) {
      if (typeof itemTab.waitForLoadState === 'function') {
        await itemTab.waitForLoadState('domcontentloaded').catch(() => {});
      }
      if (typeof itemTab.waitForTimeout === 'function') {
        await itemTab.waitForTimeout(1500).catch(() => {});
      }
      if (typeof itemTab.close === 'function') {
        await itemTab.close().catch(() => {});
      }
    } else {
      const currentUrl = typeof page.url === 'function' ? page.url() : '';
      const hasNavigatedAway = Boolean(
        (currentUrl && beforeUrl && currentUrl !== beforeUrl) ||
        (currentUrl && currentUrl.includes('adclick.html')) ||
        (currentUrl && (currentUrl.includes('/item/') || currentUrl.includes('/detail/'))) ||
        (feedUrl && currentUrl && currentUrl !== feedUrl)
      );

      if (hasNavigatedAway) {
        if (typeof page.waitForTimeout === 'function') {
          await page.waitForTimeout(1500).catch(() => {});
        }
        if (typeof page.goBack === 'function') {
          await page.goBack().catch(() => {});
          if (typeof page.waitForLoadState === 'function') {
            await page.waitForLoadState('domcontentloaded').catch(() => {});
          }
        }
        // Se ainda estiver na página de anúncio/redirecionamento após goBack(), força retorno à feedUrl
        const urlAfterBack = typeof page.url === 'function' ? page.url() : '';
        if (
          feedUrl &&
          urlAfterBack &&
          urlAfterBack.includes('adclick.html') &&
          typeof page.goto === 'function'
        ) {
          await page.goto(feedUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }
        if (typeof page.waitForSelector === 'function') {
          await page
            .waitForSelector(SELECTORS.tasks.productCard, { timeout: 5000 })
            .catch(() => {});
        }
      }
    }

    clickedCount++;
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(600).catch(() => {});
    }
  }

  if (typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(1000).catch(() => {});
  }
  return clickedCount;
}

module.exports = {
  executeSurpriseItems
};
