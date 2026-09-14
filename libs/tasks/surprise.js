const { SELECTORS } = require('../selectors');
const defaultLogger = require('../../logger');

/**
 * Toca em 3 produtos na página de anúncios de ofertas/tarefas
 * @param {object} params
 * @param {import('playwright').Page} params.page
 * @param {import('playwright').BrowserContext} params.context
 * @param {number} [params.startIndex=0]
 * @param {object} [params.logger]
 * @returns {Promise<number>} Quantidade de itens clicados
 */
async function executeSurpriseItems({
  page,
  context,
  startIndex = 0,
  logger = defaultLogger
} = {}) {
  logger.info(`Executando tarefa: tocar em 3 itens (a partir do card #${startIndex + 1})...`);
  await page.waitForSelector(SELECTORS.tasks.productCard, { timeout: 4000 }).catch(() => {});
  let cards = await page.$$(SELECTORS.tasks.productCard);

  if (startIndex + 3 > cards.length) {
    await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
    await page.waitForTimeout(1000).catch(() => {});
    cards = await page.$$(SELECTORS.tasks.productCard);
  }

  const start = startIndex < cards.length ? startIndex : 0;
  const countToClick = Math.min(3, Math.max(0, cards.length - start));
  let clickedCount = 0;

  for (let c = start; c < start + (countToClick || 3); c++) {
    if (c >= cards.length) break;
    logger.info(`Tocando item ${clickedCount + 1}/3 (card #${c + 1})...`);
    const card = cards[c];
    if (card.scrollIntoViewIfNeeded) {
      await card.scrollIntoViewIfNeeded().catch(() => {});
    }
    await page.waitForTimeout(400).catch(() => {});

    let itemTab = null;
    if (context && typeof context.waitForEvent === 'function') {
      const tabPromise = context.waitForEvent('page', { timeout: 3500 }).catch(() => null);
      await card.click({ delay: 50, timeout: 4000 }).catch(async () => {
        await page.evaluate((el) => el.click(), card).catch(() => {});
      });
      itemTab = await tabPromise;
    } else {
      await card.click({ delay: 50, timeout: 4000 }).catch(async () => {
        await page.evaluate((el) => el.click(), card).catch(() => {});
      });
    }

    if (itemTab) {
      await itemTab.waitForLoadState('domcontentloaded').catch(() => {});
      await itemTab.waitForTimeout(1500).catch(() => {});
      await itemTab.close().catch(() => {});
    } else if (typeof page.url === 'function' && !page.url().includes('adclick.html')) {
      await page.waitForTimeout(1500).catch(() => {});
      if (typeof page.goBack === 'function') {
        await page.goBack().catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      }
    }
    clickedCount++;
    await page.waitForTimeout(500).catch(() => {});
  }
  await page.waitForTimeout(1000).catch(() => {});
  return clickedCount;
}

module.exports = {
  executeSurpriseItems
};
