const { newDesktopContext } = require('../../browser');
const { SELECTORS } = require('../selectors');
const { gotoWithRetry } = require('./navigation');
const { saveFailureScreenshot } = require('./diagnostics');
const logger = require('../../logger');

/**
 * Padrões de expressão regular multilíngues (pt, en, es) para detecção de streak/sequência
 */
const STREAK_PATTERNS = [
  /se[cq]u[eê]ncia(?:\s*de|:)?\s*([0-9]+)\s*d[ií]as?/i,
  /([0-9]+)\s*d[ií]as?\s*(?:de\s*se[cq]u[eê]ncia|seguidos?|consecutivos?)/i,
  /([0-9]+)\s*-?\s*(?:day|dia|dias|days|días)?\s*-?\s*streak/i,
  /streak(?:\s*de|:)?\s*([0-9]+)/i,
  /([0-9]+)\s*(?:days?|dias?|días?)\s*(?:in\s*a\s*row|consecutivos?)/i,
  /check-?in(?:\s*(?:de|por|di[aá]rio:?))?\s*([0-9]+)\s*d[ií]as?/i,
  /([0-9]+)\s*d[ií]as?\s*de\s*check-?in/i,
  /completou\s*([0-9]+)\s*d[ií]as?/i,
  /coletou\s*por\s*([0-9]+)\s*d[ií]as?/i,
  /(?:dia|day|d[ií]a)\s*([0-9]+)\s*(?:\/|\s*de\s*|\s*of\s*)\s*7/i
];

/**
 * Extrai número de dias de sequência a partir de uma string de texto qualquer
 * @param {string} text
 * @returns {number|null}
 */
function extractStreakFromText(text) {
  if (!text || typeof text !== 'string') return null;
  for (const regex of STREAK_PATTERNS) {
    const m = text.match(regex);
    if (m) {
      const val = parseInt(m[1], 10);
      if (!isNaN(val) && val >= 1) return val;
    }
  }
  return null;
}

/**
 * Mapeia a quantidade de moedas ganhas no check-in para o dia correspondente da sequência.
 * Ciclo oficial do AliExpress Coin Check-in:
 * Dia 1: +10 moedas
 * Dia 2: +15 moedas
 * Dia 3: +20 moedas
 * Dia 4: +25 moedas
 * Dia 5: +30 moedas
 * Dia 6: +35 moedas
 * Dia 7+: +40 moedas
 * @param {string|number|null} coins
 * @returns {number|null}
 */
function getStreakFromCheckinCoins(coins) {
  if (coins === null || coins === undefined) return null;
  const num =
    typeof coins === 'number' ? coins : parseInt(String(coins).replace(/[^0-9]/g, ''), 10);
  if (isNaN(num)) return null;

  switch (num) {
    case 10:
      return 1;
    case 15:
      return 2;
    case 20:
      return 3;
    case 25:
      return 4;
    case 30:
      return 5;
    case 35:
      return 6;
    case 40:
      return 7;
    default:
      return null;
  }
}

/**
 * Extrai a sequência de check-ins consecutivos a partir do texto do histórico de moedas no desktop.
 * Analisa as transações com "App daily check-in" ou "Check-in diário no app" e conta dias consecutivos.
 * @param {string} desktopText
 * @returns {number|null}
 */
function getStreakFromDesktopHistory(desktopText) {
  if (!desktopText || typeof desktopText !== 'string') return null;

  const dateRegex =
    /([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})\s*PT[\s\S]{0,120}?(?:App daily check-in|Check-in diário no app)\s*\n\s*\+([0-9]+)/gi;

  const rawMatches = [...desktopText.matchAll(dateRegex)];
  if (rawMatches.length === 0) return null;

  let hasP1GreaterThan12 = false;
  let hasP2GreaterThan12 = false;
  for (const m of rawMatches) {
    const p1 = parseInt(m[1], 10);
    const p2 = parseInt(m[2], 10);
    if (p1 > 12) hasP1GreaterThan12 = true;
    if (p2 > 12) hasP2GreaterThan12 = true;
  }

  let isUsFormat = false;
  if (hasP2GreaterThan12) {
    isUsFormat = true;
  } else if (hasP1GreaterThan12) {
    isUsFormat = false;
  } else {
    const hasEnKeywords = /App daily check-in|My coins/i.test(desktopText);
    const ptDateUs =
      new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }) + ' PT';
    isUsFormat = hasEnKeywords || desktopText.includes(ptDateUs);
  }

  const entries = [];
  for (const match of rawMatches) {
    const p1 = parseInt(match[1], 10);
    const p2 = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    const coins = parseInt(match[4], 10);

    let day;
    let month;
    if (isUsFormat) {
      day = p2;
      month = p1;
    } else {
      day = p1;
      month = p2;
    }

    const dateUtc = Date.UTC(year, month - 1, day);
    entries.push({ dateUtc, coins });
  }

  const uniqueDays = [];
  const seen = new Set();
  for (const entry of entries) {
    const dayKey = Math.round(entry.dateUtc / 86400000);
    if (!seen.has(dayKey)) {
      seen.add(dayKey);
      uniqueDays.push({ dayKey, coins: entry.coins });
    }
  }

  uniqueDays.sort((a, b) => b.dayKey - a.dayKey);

  let streak = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    if (uniqueDays[i].dayKey === uniqueDays[i - 1].dayKey - 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Captura o número de dias em sequência diretamente da tela de moedas
 * @param {import('playwright').Page} page
 * @returns {Promise<number|null>}
 */
async function getStreakFromCoinPage(page) {
  try {
    return await page.evaluate(
      ({ streakSelectors }) => {
        function extractStreak(text) {
          if (!text || typeof text !== 'string') return null;
          const patterns = [
            /se[cq]u[eê]ncia(?:\s*de|:)?\s*([0-9]+)\s*d[ií]as?/i,
            /([0-9]+)\s*d[ií]as?\s*(?:de\s*se[cq]u[eê]ncia|seguidos?|consecutivos?)/i,
            /([0-9]+)\s*-?\s*(?:day|dia|dias|days|días)?\s*-?\s*streak/i,
            /streak(?:\s*de|:)?\s*([0-9]+)/i,
            /([0-9]+)\s*(?:days?|dias?|días?)\s*(?:in\s*a\s*row|consecutivos?)/i,
            /check-?in(?:\s*(?:de|por|di[aá]rio:?))?\s*([0-9]+)\s*d[ií]as?/i,
            /([0-9]+)\s*d[ií]as?\s*de\s*check-?in/i,
            /completou\s*([0-9]+)\s*d[ií]as?/i,
            /coletou\s*por\s*([0-9]+)\s*d[ií]as?/i,
            /(?:dia|day|d[ií]a)\s*([0-9]+)\s*(?:\/|\s*de\s*|\s*of\s*)\s*7/i
          ];
          for (const regex of patterns) {
            const m = text.match(regex);
            if (m) {
              const val = parseInt(m[1], 10);
              if (!isNaN(val) && val >= 1) return val;
            }
          }
          return null;
        }

        // 1. Modais, toasts e diálogos de confirmação pós-checkin
        const modalEls = document.querySelectorAll(
          '[class*="modal"], [class*="dialog"], [class*="popup"], [class*="toast"], [role="dialog"], [class*="aecoin-"]'
        );
        for (const el of modalEls) {
          const val = extractStreak(el.innerText || '');
          if (val !== null) return val;
        }

        // 2. Contêineres de título / streak
        const titleSelector =
          streakSelectors.streakTitleContainer ||
          '[class*="titleContainer"], [class*="signTitle"], [class*="streak"]';
        const titleEls = document.querySelectorAll(titleSelector);
        for (const el of titleEls) {
          const containerText = el.parentElement?.innerText || el.innerText || '';
          const val = extractStreak(containerText);
          if (val !== null) return val;
        }

        // 3. Seletor de dia ativo / checado
        const daySelector =
          streakSelectors.streakDayNumber ||
          '[class*="dayNumber"], [class*="checkedDay"], [class*="currentDay"]';
        const dayEls = document.querySelectorAll(daySelector);
        for (const dayEl of dayEls) {
          if (dayEl && dayEl.innerText && dayEl.innerText.trim()) {
            const val = parseInt(dayEl.innerText.trim(), 10);
            if (!isNaN(val) && val >= 1 && val <= 365) return val;
          }
        }

        // 4. Varredura do texto completo do body
        const bodyText = document.body ? document.body.innerText || '' : '';
        return extractStreak(bodyText);
      },
      {
        streakSelectors: {
          streakTitleContainer: SELECTORS.checkin?.streakTitleContainer,
          streakDayNumber: SELECTORS.checkin?.streakDayNumber
        }
      }
    );
  } catch {
    return null;
  }
}

/**
 * Consulta saldo total e histórico de check-in no desktop via AliExpress My Coin
 * @param {import('playwright').Browser} browser
 * @param {string|object} sessionPathOrData Caminho para session.json ou objeto de storageState
 * @param {object} [options={}]
 * @returns {Promise<{ totalBalance: string, todayCheckinCoins: string|null, hasAppCheckinToday: boolean, desktopStreak: number|null, rawText: string }>}
 */
async function getBalanceDesktop(browser, sessionPathOrData, options = {}) {
  const timeout = options.timeout || 20000;
  const allowMedia = Boolean(options.allowMedia);

  const desktopCtx = await newDesktopContext(browser, sessionPathOrData, { allowMedia });
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

    // Cálculo do streak no desktop (fallback quando mobile não identifica)
    const textStreak = extractStreakFromText(desktopText);
    const historyStreak = getStreakFromDesktopHistory(desktopText);
    const tierStreak = getStreakFromCheckinCoins(todayCheckinCoins);
    const calculatedStreak = Math.max(historyStreak || 0, tierStreak || 0) || null;
    const desktopStreak = textStreak !== null ? textStreak : calculatedStreak;

    return {
      totalBalance,
      todayCheckinCoins,
      hasAppCheckinToday,
      desktopStreak,
      rawText: desktopText
    };
  } finally {
    await desktopCtx.close().catch(() => {});
  }
}

module.exports = {
  getStreakFromCoinPage,
  getBalanceDesktop,
  extractStreakFromText,
  getStreakFromCheckinCoins,
  getStreakFromDesktopHistory
};
