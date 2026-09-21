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
  /coletou\s*por\s*([0-9]+)\s*d[ií]as?/i
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
 * Mapeia o dia da sequência (streak) para a quantidade esperada de moedas ganhas no check-in.
 * Ciclo oficial do AliExpress Coin Check-in:
 * Dia 1: +10 moedas
 * Dia 2: +15 moedas
 * Dia 3: +20 moedas
 * Dia 4: +25 moedas
 * Dia 5: +30 moedas
 * Dia 6: +35 moedas
 * Dia 7+: +40 moedas
 * @param {string|number|null} streak
 * @returns {number}
 */
function getCheckinCoinsFromStreak(streak) {
  if (streak === null || streak === undefined || streak === 'N/D') return 10;
  const num =
    typeof streak === 'number' ? streak : parseInt(String(streak).replace(/[^0-9]/g, ''), 10);
  if (isNaN(num) || num <= 1) return 10;
  switch (num) {
    case 2:
      return 15;
    case 3:
      return 20;
    case 4:
      return 25;
    case 5:
      return 30;
    case 6:
      return 35;
    default:
      return 40;
  }
}

// Rótulos de CHECK-IN no extrato desktop (mycoin), bilíngues:
// "App daily check-in" / "Check-in diário no app" / "Bônus diário" / "Daily bonus".
// Todo o RESTANTE dos créditos do dia (Coin page task, Widget coins, Missões de moedas,
// Coin missions, etc.) é contabilizado como ganho de tarefas — evita manter uma lista
// de rótulos que muda com o tempo (ex.: "Widget coins" não estava mapeado).
const CHECKIN_LABEL_PATTERN =
  '(?:App daily check-in|Check-in di[áa]rio no app|B[ôo]nus di[áa]rio|Daily bonus)';

/**
 * Extrai, da seção de HOJE do extrato desktop, o valor REAL do check-in e a soma dos
 * ganhos de TAREFAS. Fonte de verdade do que foi efetivamente creditado no dia,
 * independentemente do tier sugerido na tela.
 *
 * Estratégia: varre cada lançamento "<rótulo>\n+<valor>" do dia; lançamentos de check-in
 * somam em `bonusCoins`; todos os demais somam em `missionsCoins`.
 *
 * @param {string} todaySection Texto do extrato restrito ao dia de hoje (fuso PT)
 * @returns {{ bonusCoins: number|null, missionsCoins: number, bonusCount: number, missionsCount: number }}
 */
function extractTodayLedger(todaySection) {
  const text = typeof todaySection === 'string' ? todaySection : '';
  let bonusCoins = null;
  let bonusCount = 0;
  let missionsCoins = 0;
  let missionsCount = 0;

  // Cada lançamento é "<rótulo>\n+<valor>". Captura rótulo + valor de todos os créditos.
  // Aceita separadores de milhar (ex.: +1.000 / +1,000) e os remove antes do parse.
  const entryRe = /([^\n+][^\n]*)\n\s*\+([0-9][0-9.,]*)/g;
  for (const m of text.matchAll(entryRe)) {
    const label = (m[1] || '').trim();
    const value = parseInt(String(m[2]).replace(/[.,]/g, ''), 10);
    if (!label || isNaN(value)) continue;

    // Aceita o rótulo em qualquer posição da linha: o innerText pode renderizar
    // "21/09/2026 PT App daily check-in" (data + rótulo juntos), que o teste ancorado
    // classificava como missão — zerando o bônus do dia.
    if (new RegExp(CHECKIN_LABEL_PATTERN, 'i').test(label)) {
      bonusCount++;
      bonusCoins = (bonusCoins || 0) + value;
    } else {
      missionsCount++;
      missionsCoins += value;
    }
  }

  return { bonusCoins, missionsCoins, bonusCount, missionsCount };
}

/**
 * Extrai a sequência de check-ins consecutivos a partir do texto do histórico de moedas no desktop.
 * Analisa as transações com "App daily check-in" ou "Check-in diário no app" e conta dias consecutivos.
 * @param {string} desktopText
 * @returns {number|null}
 */
function getStreakFromDesktopHistory(desktopText) {
  if (!desktopText || typeof desktopText !== 'string') return null;

  // Reconhece todos os rótulos de check-in (inclui "Bônus diário"/"Daily bonus"),
  // alinhado ao CHECKIN_LABEL_PATTERN usado no extrato do dia.
  // IMPORTANTE: processa por BLOCO de data (split), para que o segmento entre a data e o
  // rótulo NUNCA cruze outra data — antes, `[\s\S]{0,120}?` associava o valor do dia
  // seguinte à data atual, criando check-in falso e mascarando quebra de streak.
  const blockRe = /([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})\s*PT/g;
  const blocks = [];
  let m;
  while ((m = blockRe.exec(desktopText)) !== null) {
    blocks.push({ day: m[1], month: m[2], year: m[3], start: blockRe.lastIndex });
  }
  const rawMatches = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const end = i + 1 < blocks.length ? blocks[i + 1].start : desktopText.length;
    const section = desktopText.slice(b.start, end);
    const labelRe = new RegExp(`${CHECKIN_LABEL_PATTERN}\\s*\\n\\s*\\+([0-9]+)`, 'i');
    const lm = section.match(labelRe);
    if (lm) rawMatches.push([null, b.day, b.month, b.year, lm[1]]);
  }

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
    // Sinais de LOCALE (não rótulos de check-in, que são em inglês mesmo na UI pt-BR):
    // "Minhas moedas" (pt) vs "My coins" (en) e a data de hoje no formato en-US.
    const ptDateUs =
      new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }) + ' PT';
    const hasPtHeader = /Minhas moedas|B[ôo]nus di[áa]rio|Miss[õo]es de moedas/i.test(desktopText);
    const hasEnHeader = /My coins/i.test(desktopText);
    if (hasPtHeader && !hasEnHeader) {
      isUsFormat = false;
    } else if (hasEnHeader && !hasPtHeader) {
      isUsFormat = true;
    } else {
      isUsFormat = desktopText.includes(ptDateUs);
    }
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

  // Exige que o registro mais recente seja de hoje ou de ontem no fuso do histórico (PT).
  // Sem isso, uma sequência antiga (ex: 10 dias de semanas atrás) seria reportada como streak
  // atual e poderia mascarar uma quebra real quando a leitura mobile retorna N/D.
  const todayParts = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    .split('-')
    .map(Number);
  const todayKey = Math.round(Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]) / 86400000);
  if (uniqueDays[0].dayKey < todayKey - 1) return null;

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
            /coletou\s*por\s*([0-9]+)\s*d[ií]as?/i
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

        // 2. Contêineres de título / streak explícito
        const titleSelector =
          streakSelectors.streakTitleContainer ||
          '[class*="titleContainer"], [class*="signTitle"], [class*="streak"]';
        const titleEls = document.querySelectorAll(titleSelector);
        for (const el of titleEls) {
          const containerText = el.parentElement?.innerText || el.innerText || '';
          const val = extractStreak(containerText);
          if (val !== null) return val;
        }

        // 3. Varredura do texto completo do body por padrões explícitos de sequência
        const bodyText = document.body ? document.body.innerText || '' : '';
        return extractStreak(bodyText);
      },
      {
        streakSelectors: {
          streakTitleContainer: SELECTORS.checkin?.streakTitleContainer
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
// Cache opcional de contexto/página desktop (opt-in via options.reuseContext) para
// evitar recriar contexto a cada leitura de saldo. Fica desligado por padrão para não
// manter um contexto vivo (e elevar o pico de RAM) enquanto o fluxo mobile executa.
let cachedDesktopContext = null;
let cachedDesktopPage = null;

/**
 * Decide se o contexto desktop deve ser reutilizado entre leituras de saldo do mesmo run.
 *
 * Padrão: DESLIGADO. Medições na VM mostraram que manter o contexto desktop vivo durante
 * o fluxo mobile eleva o pico de RAM/PIDs (contextos mobile e desktop concorrentes), o que
 * é pior em host restrito. Reutilizar só compensa em cenários sem mobilização concorrente;
 * habilite com DESKTOP_REUSE_CONTEXT=true se o host tiver folga e quiser priorizar tempo.
 * @returns {boolean}
 */
function shouldReuseDesktopContext() {
  const value = process.env.DESKTOP_REUSE_CONTEXT;
  if (value === undefined || value === null || value === '') return false;
  return /^(1|true|on|yes)$/i.test(String(value).trim());
}

/**
 * Fecha o contexto desktop eventualmente cacheado (chamar ao fim da conta/processo).
 * @returns {Promise<void>}
 */
async function closeCachedDesktopContext() {
  cachedDesktopPage = null;
  if (cachedDesktopContext) {
    const ctx = cachedDesktopContext;
    cachedDesktopContext = null;
    await ctx.close().catch(() => {});
  }
}

async function getBalanceDesktop(browser, sessionPathOrData, options = {}) {
  const timeout = options.timeout || 20000;
  const allowMedia = Boolean(options.allowMedia);

  const providedContext = options.context || null;
  const reuseRequested = options.reuseContext === true;
  let desktopCtx = providedContext;
  let cachedForReuse = false;
  let desktopPage = null;

  if (!desktopCtx && reuseRequested && cachedDesktopContext) {
    const ctxClosed =
      typeof cachedDesktopContext.isClosed === 'function' && cachedDesktopContext.isClosed();
    if (!ctxClosed) {
      desktopCtx = cachedDesktopContext;
      // Valida também a PÁGINA: se ela caiu (crash/fechada) enquanto o contexto segue
      // aberto, reutilizá-la fazia todas as leituras retornarem 'N/D' silenciosamente.
      const pageClosed =
        cachedDesktopPage &&
        typeof cachedDesktopPage.isClosed === 'function' &&
        cachedDesktopPage.isClosed();
      if (cachedDesktopPage && !pageClosed) {
        desktopPage = cachedDesktopPage;
      } else {
        cachedDesktopPage = null;
      }
      cachedForReuse = true;
    } else {
      cachedDesktopContext = null;
      cachedDesktopPage = null;
    }
  }
  if (!desktopCtx) {
    desktopCtx = await newDesktopContext(browser, sessionPathOrData, { allowMedia });
    if (reuseRequested) {
      cachedDesktopContext = desktopCtx;
      cachedForReuse = true;
    }
  }

  try {
    if (!desktopPage) {
      desktopPage = await desktopCtx.newPage();
      if (cachedForReuse) cachedDesktopPage = desktopPage;
    }
    await gotoWithRetry(desktopPage, SELECTORS.desktop.mycoinUrl, {
      waitUntil: 'domcontentloaded',
      timeout
    }).catch(() => {});

    await desktopPage
      .waitForSelector(SELECTORS.desktop.mycoinCheckin, { timeout: 6000 })
      .catch(() => {});

    const desktopText = await desktopPage.innerText('body').catch(() => '');

    // Saldo total bilíngue ("My coins" ou "Minhas moedas"), com separador de milhar
    // (ex.: "1,234" / "2.917"). Capturar só [0-9]+ truncava para "1"/"2".
    const balMatch =
      desktopText.match(/(?:My coins|Minhas moedas)\s*\n\s*([0-9][0-9.,]*)/i) ||
      desktopText.match(/([0-9][0-9.,]*)\s*\n\s*saves/i);
    const totalBalance = balMatch ? String(balMatch[1]).replace(/[.,]/g, '') : 'N/D';

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
      // Fallback: só aceita a data se ela corresponder a HOJE (nas duas grafias,
      // tolerando zero à esquerda). Antes, a PRIMEIRA data do documento era tratada
      // como hoje — usando a seção de outro dia e creditando moedas erradas.
      const allDates = [...desktopText.matchAll(/([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})\s*PT/gi)];
      const normalizeDate = (raw) => {
        const [d, mo, y] = String(raw)
          .replace(/\s*PT$/i, '')
          .trim()
          .split('/');
        return `${String(parseInt(d, 10)).padStart(2, '0')}/${String(parseInt(mo, 10)).padStart(2, '0')}/${y}`;
      };
      const todayNormalized = normalizeDate(ptDateBr);
      const todayEntry = allDates.find((entry) => normalizeDate(entry[1]) === todayNormalized);
      if (todayEntry) {
        todaySec = desktopText.split(todayEntry[0])[1]?.split(/[0-9]+\/[0-9]+\/[0-9]+ PT/)[0] || '';
      }
    }

    const todayCheckinMatch =
      todaySec.match(/(?:App daily check-in|Check-in diário no app)\s*\n\s*\+([0-9]+)/i) ||
      todaySec.match(/App daily check-in\s*\n\s*\+([0-9]+)/i);

    const hasAppCheckinToday =
      todaySec.includes('App daily check-in') || todaySec.includes('Check-in diário no app');
    // Valor efetivamente creditado no dia: "Bônus diário" (check-in) e "Missões de moedas"
    // (tarefas). Fonte de verdade do extrato, independente do tier sugerido na tela.
    const todayLedger = extractTodayLedger(todaySec);
    const todayCheckinCoins =
      todayLedger.bonusCoins !== null
        ? String(todayLedger.bonusCoins)
        : todayCheckinMatch
          ? todayCheckinMatch[1]
          : null;
    const hasBonusToday = todayLedger.bonusCoins !== null;
    const todayMissionsCoins = todayLedger.missionsCoins;
    // "Já coletado hoje" quando houver QUALQUER crédito de check-in no extrato de hoje
    // (rótulo novo "Bônus diário" ou o legado "App daily check-in").
    const hasCheckinToday = hasAppCheckinToday || hasBonusToday;

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
      hasAppCheckinToday: hasCheckinToday,
      // Campos adicionais (fonte de verdade do extrato):
      todayBonusCoins: todayLedger.bonusCoins, // check-in real do dia (ex.: +1, +40)
      todayMissionsCoins, // soma dos ganhos de tarefas do dia
      todayMissionsCount: todayLedger.missionsCount,
      desktopStreak,
      rawText: desktopText
    };
  } finally {
    if (!providedContext && !cachedForReuse) {
      await desktopCtx.close().catch(() => {});
    }
  }
}

module.exports = {
  getStreakFromCoinPage,
  getBalanceDesktop,
  closeCachedDesktopContext,
  shouldReuseDesktopContext,
  extractStreakFromText,
  extractTodayLedger,
  getStreakFromCheckinCoins,
  getCheckinCoinsFromStreak,
  getStreakFromDesktopHistory
};
