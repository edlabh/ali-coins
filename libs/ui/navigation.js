const { retry } = require('../../browser');
const { SELECTORS } = require('../selectors');
const logger = require('../../logger');

/**
 * Navega para uma URL com retentativas automáticas e backoff exponencial
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {object} [options={}]
 * @returns {Promise<import('playwright').Response|null>}
 */
async function gotoWithRetry(page, url, options = {}) {
  const timeout = options.timeout || 35000;
  const waitUntil = options.waitUntil || 'domcontentloaded';

  return await retry(
    async (attempt) => {
      if (attempt > 1) {
        logger.info({ url, attempt }, 'Tentando carregar URL novamente...');
      }
      return await page.goto(url, { waitUntil, timeout });
    },
    { retries: options.retries || 3, minTimeout: 2000, maxTimeout: 8000 }
  );
}

/**
 * Aguarda por um seletor e executa clique com fallback em JavaScript evaluate
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {object} [options={}]
 * @returns {Promise<boolean>}
 */
async function waitAndClick(page, selector, options = {}) {
  const timeout = options.timeout || 4000;
  try {
    const element = await page.waitForSelector(selector, { state: 'visible', timeout });
    if (!element) return false;

    try {
      await element.click({ timeout: 2000 });
      return true;
    } catch {
      // Fallback via DOM evaluate caso haja sobreposição de modal
      await page.evaluate((el) => el.click(), element);
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Procura por modais e popups indesejados e fecha se estiverem presentes
 * @param {import('playwright').Page} page
 * @param {string[]} [customSelectors]
 * @returns {Promise<boolean>}
 */
async function closeModals(page, customSelectors = null) {
  const selectors = customSelectors || SELECTORS.modals.closeButtons;
  let closedAny = false;

  for (const sel of selectors) {
    try {
      const modalBtn = await page.$(sel);
      if (modalBtn) {
        await page.evaluate((el) => el.click(), modalBtn).catch(() => {});
        await page.waitForTimeout(300);
        closedAny = true;
      }
    } catch {
      // Continua checando próximos seletores
    }
  }

  return closedAny;
}

/**
 * Tenta resolver o slide captcha em qualquer iframe ou na página principal
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function trySolveSlider(page) {
  const targets = [page, ...page.frames()];
  for (const target of targets) {
    try {
      const sliderHandle = await target.$(SELECTORS.login.sliderHandle);
      if (sliderHandle) {
        logger.info('Verificação de segurança (slide captcha) detectada. Tentando deslizar...');
        const box = await sliderHandle.boundingBox();
        if (box) {
          const trackBox = await target
            .$eval(SELECTORS.login.sliderTrack, (el) => {
              const b = el.getBoundingClientRect();
              return { width: b.width };
            })
            .catch(() => ({ width: 320 }));

          const distance =
            trackBox && trackBox.width > 150 ? trackBox.width - box.width + 10 : 300;

          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          const steps = 25;
          for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            const ease =
              progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
            const currentX = box.x + box.width / 2 + distance * ease;
            const jitterY = box.y + box.height / 2 + (Math.random() * 2 - 1);
            await page.mouse.move(currentX, jitterY);
            await page.waitForTimeout(10 + Math.floor(Math.random() * 10));
          }
          await page.waitForTimeout(50);
          await page.mouse.up();
          await page
            .waitForSelector(SELECTORS.login.sliderTrack, { state: 'detached', timeout: 2000 })
            .catch(() => {});
          await page.waitForTimeout(1000);
          return true;
        }
      }
    } catch {
      // Continua checando próximos alvos
    }
  }
  return false;
}

module.exports = {
  gotoWithRetry,
  waitAndClick,
  closeModals,
  trySolveSlider
};
