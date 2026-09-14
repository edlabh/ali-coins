const { newDesktopContext } = require('../../browser');
const { SELECTORS } = require('../selectors');
const { gotoWithRetry } = require('./navigation');
const { saveFailureScreenshot } = require('./diagnostics');
const logger = require('../../logger');

/**
 * Captura o número de dias em sequência diretamente da tela de moedas
 * @param {import('playwright').Page} page
 * @returns {Promise<number|null>}
 */
async function getStreakFromCoinPage(page) {
  return await page.evaluate(() => {
    const dayEl = document.querySelector('[class*="dayNumber"], [class*="checkedDay"]');
    if (dayEl && dayEl.innerText.trim()) {
      const val = parseInt(dayEl.innerText.trim(), 10);
      if (!isNaN(val) && val >= 0) return val;
    }

    const titleEl = document.querySelector('[class*="titleContainer"], [class*="signTitle"]');
    if (titleEl) {
      const containerText = titleEl.parentElement?.innerText || titleEl.innerText || '';
      const m =
        containerText.match(/([0-9]+)\s*(?:day|dia|dias|days)?\s*streak/i) ||
        containerText.match(/([0-9]+)/);
      if (m) {
        const val = parseInt(m[1], 10);
        if (!isNaN(val) && val >= 0) return val;
      }
    }

    const bodyText = document.body.innerText || '';
    const m =
      bodyText.match(/([0-9]+)\s*(?:day|dia|dias|days)?\s*streak/i) ||
      bodyText.match(/([0-9]+)\s*\n?\s*day streak/i);
    return m ? parseInt(m[1], 10) : null;
  });
}

/**
 * Consulta saldo total e histórico de check-in no desktop via AliExpress My Coin
 * @param {import('playwright').Browser} browser
 * @param {string} sessionPath
 * @param {object} [options={}]
 * @returns {Promise<{ totalBalance: string, todayCheckinCoins: string|null, hasAppCheckinToday: boolean, rawText: string }>}
 */
async function getBalanceDesktop(browser, sessionPath, options = {}) {
  const timeout = options.timeout || 20000;
  const allowMedia = Boolean(options.allowMedia);

  const desktopCtx = await newDesktopContext(browser, sessionPath, { allowMedia });
  try {
    const desktopPage = await desktopCtx.newPage();
    await gotoWithRetry(desktopPage, SELECTORS.desktop.mycoinUrl, {
      waitUntil: 'domcontentloaded',
      timeout
    }).catch(() => {});

    await desktopPage
      .waitForSelector(SELECTORS.desktop.mycoinCheckin, { timeout: 6000 })
      .catch(() => {});

    const desktopText = await desktopPage.innerText('body').catch(() => '');

    // Saldo total bilíngue ("My coins" ou "Minhas moedas")
    const balMatch =
      desktopText.match(/(?:My coins|Minhas moedas)\s*\n\s*([0-9]+)/i) ||
      desktopText.match(/([0-9]+)\s*\n\s*saves/i);
    const totalBalance = balMatch ? balMatch[1] : 'N/D';

    // Histórico de check-in do dia em Pacific Time (suporta pt-BR "DD/MM/AAAA" e en-US "M/D/YYYY")
    const ptDateBr =
      new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Los_Angeles' }) + ' PT';
    const ptDateUs =
      new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }) + ' PT';

    let todaySec = '';
    if (desktopText.includes(ptDateBr)) {
      todaySec = desktopText.split(ptDateBr)[1]?.split(/[0-9]+\/[0-9]+\/[0-9]+ PT/)[0] || '';
    } else if (desktopText.includes(ptDateUs)) {
      todaySec = desktopText.split(ptDateUs)[1]?.split(/[0-9]+\/[0-9]+\/[0-9]+ PT/)[0] || '';
    } else {
      const matchDate = desktopText.match(/([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}\s*PT)/i);
      if (matchDate) {
        todaySec = desktopText.split(matchDate[1])[1]?.split(/[0-9]+\/[0-9]+\/[0-9]+ PT/)[0] || '';
      }
    }

    const todayCheckinMatch =
      todaySec.match(/(?:App daily check-in|Check-in diário no app)\s*\n\s*\+([0-9]+)/i) ||
      todaySec.match(/App daily check-in\s*\n\s*\+([0-9]+)/i);

    const hasAppCheckinToday =
      todaySec.includes('App daily check-in') || todaySec.includes('Check-in diário no app');
    const todayCheckinCoins = todayCheckinMatch ? todayCheckinMatch[1] : null;

    if (totalBalance === 'N/D') {
      logger.warn('Saldo desktop não detectado diretamente. Salvando screenshot de diagnóstico...');
      await saveFailureScreenshot(desktopPage, 'balance-not-found');
    }

    return {
      totalBalance,
      todayCheckinCoins,
      hasAppCheckinToday,
      rawText: desktopText
    };
  } finally {
    await desktopCtx.close().catch(() => {});
  }
}

module.exports = {
  getStreakFromCoinPage,
  getBalanceDesktop
};
