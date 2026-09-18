const { SELECTORS } = require('../selectors');
const defaultLogger = require('../../logger');

/**
 * Executa ação de coletar água na Fazenda Mágica / Prize Land
 * @param {object} params
 * @param {import('playwright').Page} params.page
 * @param {object} [params.logger]
 * @returns {Promise<boolean>} Retorna true se ação especial/app-only concluída
 */
async function executePrizeLandTask({ page, logger = defaultLogger, signal = null } = {}) {
  // Cancelamento cooperativo: se a tarefa estourou o tempo, não executa o clique tardio.
  if (signal && signal.aborted) return false;

  logger.info('Verificando botão de água da Fazenda Mágica / Prize Land...');
  const waterBtn = await page.$(SELECTORS.tasks.waterBtn).catch(() => null);
  if (signal && signal.aborted) return false;

  if (waterBtn) {
    if (page.evaluate) {
      await page.evaluate((el) => el.click(), waterBtn).catch(() => {});
    } else if (waterBtn.click) {
      await waterBtn.click().catch(() => {});
    }
    if (signal && signal.aborted) return false;
    if (page.waitForTimeout) {
      await page.waitForTimeout(1500).catch(() => {});
    }
  }
  return true;
}

module.exports = {
  executePrizeLandTask
};
