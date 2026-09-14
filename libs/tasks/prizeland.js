const { SELECTORS } = require('../selectors');
const defaultLogger = require('../../logger');

/**
 * Executa ação de coletar água na Fazenda Mágica / Prize Land
 * @param {object} params
 * @param {import('playwright').Page} params.page
 * @param {object} [params.logger]
 * @returns {Promise<boolean>} Retorna true se ação especial/app-only concluída
 */
async function executePrizeLandTask({ page, logger = defaultLogger } = {}) {
  logger.info('Verificando botão de água da Fazenda Mágica / Prize Land...');
  const waterBtn = await page.$(SELECTORS.tasks.waterBtn).catch(() => null);
  if (waterBtn) {
    if (page.evaluate) {
      await page.evaluate((el) => el.click(), waterBtn).catch(() => {});
    } else if (waterBtn.click) {
      await waterBtn.click().catch(() => {});
    }
    if (page.waitForTimeout) {
      await page.waitForTimeout(1500).catch(() => {});
    }
  }
  return true;
}

module.exports = {
  executePrizeLandTask
};
