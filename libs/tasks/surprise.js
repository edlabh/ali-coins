const { SELECTORS } = require('../selectors');
const defaultLogger = require('../../logger');

/**
 * Normaliza uma URL do AliExpress removendo parâmetros voláteis que não alteram a identidade da página.
 * Parâmetros como _immersiveMode, _hideProgress, aecmd, spm, timestamp etc. são ignorados.
 * @param {string} urlStr
 * @returns {string}
 */
function normalizeFeedUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  try {
    const u = new URL(urlStr);
    const volatileParams = new Set([
      '_immersivemode',
      '_hideprogress',
      'aecmd',
      '_target',
      'aeia-pg-hist',
      'spm',
      'from',
      'timestamp',
      'ts',
      'adpost'
    ]);
    const sortedParams = [];
    u.searchParams.forEach((value, key) => {
      const kLower = key.toLowerCase();
      if (!volatileParams.has(kLower) && !kLower.startsWith('spm')) {
        sortedParams.push(`${key}=${value}`);
      }
    });
    sortedParams.sort();
    const query = sortedParams.length > 0 ? `?${sortedParams.join('&')}` : '';
    return `${u.origin}${u.pathname}${query}`;
  } catch {
    return urlStr.split('#')[0];
  }
}

/**
 * Avalia se uma URL e estado do DOM correspondem à página de feed de surpresas.
 * Usa tanto igualdade de URL normalizada quanto presença real de cards no DOM.
 * @param {string} url
 * @param {string} feedUrl
 * @param {number|null} [cardCount=null]
 * @returns {boolean}
 */
function isFeedUrl(url, feedUrl, cardCount = null) {
  if (!url || !feedUrl) return false;
  // Se contagem de cards for informada e for 0, a página não é um feed de produtos
  if (cardCount !== null && cardCount === 0) return false;

  const normUrl = normalizeFeedUrl(url);
  const normFeed = normalizeFeedUrl(feedUrl);
  return normUrl === normFeed;
}

/**
 * Extrai assinatura única e estável de um card de produto para evitar re-toques na mesma rodada.
 * @param {import('playwright').ElementHandle|object} card
 * @param {number} [fallbackIndex=0]
 * @returns {Promise<string>}
 */
async function getCardSignature(card, fallbackIndex = 0) {
  if (!card) return `card-idx-${fallbackIndex}`;
  if (typeof card.evaluate === 'function') {
    const sig = await card
      .evaluate((el) => {
        const link = el.tagName === 'A' ? el : el.querySelector('a');
        const href = link?.getAttribute('href') || link?.href || '';
        const dataId =
          el.getAttribute('data-item-id') ||
          el.getAttribute('data-product-id') ||
          el.getAttribute('data-id') ||
          '';
        const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        const img = el.querySelector('img')?.getAttribute('src') || '';
        return dataId || href || text || img;
      })
      .catch(() => '');
    if (sig) return sig;
  }
  return (
    card.id ||
    card.href ||
    card.title ||
    (typeof card.innerText === 'string' ? card.innerText.trim() : '') ||
    `card-idx-${fallbackIndex}`
  );
}

/**
 * Toca em 3 produtos na página de anúncios de ofertas/tarefas
 * Re-consulta elementos dinamicamente a cada toque para evitar stale element reference
 * pós goBack() e suporta paginação por scroll em múltiplas rodadas sem repetir cards já tocados.
 * @param {object|import('playwright').Page} pageOrParams
 * @param {import('playwright').BrowserContext} [contextArg]
 * @param {number} [startIndexArg=0]
 * @param {object} [loggerArg]
 * @param {AbortSignal} [signalArg]
 * @param {Set<string>} [touchedCardsArg]
 * @returns {Promise<number>} Quantidade de itens clicados
 */
async function executeSurpriseItems(
  pageOrParams,
  contextArg = null,
  startIndexArg = 0,
  loggerArg = defaultLogger,
  signalArg = null,
  touchedCardsArg = null
) {
  let page, context, startIndex, logger, signal, touchedCards;
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
      signal = null,
      touchedCards = null
    } = pageOrParams);
  } else {
    page = pageOrParams;
    context = contextArg || null;
    startIndex = typeof startIndexArg === 'number' ? startIndexArg : 0;
    logger = loggerArg || defaultLogger;
    signal = signalArg || null;
    touchedCards = touchedCardsArg || null;
  }

  if (!page) {
    logger.warn('executeSurpriseItems chamado sem instância válida de page.');
    return 0;
  }

  // Conjunto de cards já tocados nesta execução/rodada para evitar repetição
  const touchedCardsSet = touchedCards instanceof Set ? touchedCards : new Set();

  let feedUrl = typeof page.url === 'function' ? page.url() : '';
  logger.info(`Executando tarefa: tocar em 3 itens (a partir do card #${startIndex + 1})...`);
  if (typeof page.waitForSelector === 'function') {
    await page.waitForSelector(SELECTORS.tasks.productCard, { timeout: 12000 }).catch(() => {});
  }
  // Revalida feedUrl após espera inicial caso tenha ocorrido redirect de entrada
  if (typeof page.url === 'function') {
    const stabilizedUrl = page.url();
    if (stabilizedUrl) feedUrl = stabilizedUrl;
  }

  let clickedCount = 0;
  const targetClicks = 3;

  for (let i = 0; i < targetClicks; i++) {
    if (signal && signal.aborted) {
      logger.warn('Execução de itens surpresa cancelada por timeout.');
      break;
    }
    const targetIdx = startIndex + i;

    // Obtém cards disponíveis no DOM com tentativa de scroll caso faltem cards
    let currentCards =
      typeof page.$$ === 'function' ? await page.$$(SELECTORS.tasks.productCard) : [];

    for (let scrollAttempt = 0; scrollAttempt < 2; scrollAttempt++) {
      if (currentCards.length <= targetIdx || currentCards.length <= touchedCardsSet.size) {
        if (typeof page.evaluate === 'function') {
          await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
        }
        if (typeof page.waitForTimeout === 'function') {
          await page.waitForTimeout(600).catch(() => {});
        }
        currentCards =
          typeof page.$$ === 'function' ? await page.$$(SELECTORS.tasks.productCard) : [];
      } else {
        break;
      }
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

    // Seleção de card sem wrap: encontra um card novo (não tocado ainda)
    let card = null;
    let cardIndex = -1;
    let cardSig = '';

    // 1. Tenta pegar a partir de targetIdx se ainda não tocado
    if (targetIdx < currentCards.length) {
      const cand = currentCards[targetIdx];
      const sig = await getCardSignature(cand, targetIdx);
      if (!touchedCardsSet.has(sig)) {
        card = cand;
        cardIndex = targetIdx;
        cardSig = sig;
      }
    }

    // 2. Se não disponível ou já tocado, busca o primeiro card livre na lista
    if (!card) {
      for (let cIdx = 0; cIdx < currentCards.length; cIdx++) {
        const cand = currentCards[cIdx];
        const sig = await getCardSignature(cand, cIdx);
        if (!touchedCardsSet.has(sig)) {
          card = cand;
          cardIndex = cIdx;
          cardSig = sig;
          break;
        }
      }
    }

    // 3. Se todos os cards já foram tocados, tenta mais um scroll para novos itens
    if (!card && typeof page.evaluate === 'function') {
      await page.evaluate(() => window.scrollBy(0, 1000)).catch(() => {});
      if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(800).catch(() => {});
      }
      currentCards =
        typeof page.$$ === 'function' ? await page.$$(SELECTORS.tasks.productCard) : [];
      for (let cIdx = 0; cIdx < currentCards.length; cIdx++) {
        const cand = currentCards[cIdx];
        const sig = await getCardSignature(cand, cIdx);
        if (!touchedCardsSet.has(sig)) {
          card = cand;
          cardIndex = cIdx;
          cardSig = sig;
          break;
        }
      }
    }

    // 4. Se ainda assim não houver card novo, ENCERRA para evitar repetição (sem wrap)
    if (!card) {
      logger.warn(
        `Todos os ${currentCards.length} cards disponíveis já foram tocados nesta rodada. Encerrando toques para evitar repetição de itens.`
      );
      break;
    }

    touchedCardsSet.add(cardSig);
    logger.info(`Tocando item ${i + 1}/3 (card #${cardIndex + 1})...`);

    if (card && card.scrollIntoViewIfNeeded) {
      await card.scrollIntoViewIfNeeded().catch(() => {});
    }
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(200).catch(() => {});
    }

    const beforeUrl = typeof page.url === 'function' ? page.url() : '';
    let itemTab = null;

    // Snapshot das páginas abertas ANTES do clique — protege mainPage e activePage de fechamento
    const pagesBeforeClick = new Set(
      context && typeof context.pages === 'function' ? context.pages() : []
    );

    if (context && typeof context.waitForEvent === 'function') {
      const tabPromise = context.waitForEvent('page', { timeout: 2500 }).catch(() => null);
      if (card && card.click) {
        await card.click({ delay: 50, timeout: 3000 }).catch(async () => {
          if (typeof page.evaluate === 'function') {
            await page.evaluate((el) => el.click(), card).catch(() => {});
          }
        });
      }
      itemTab = await tabPromise;
    } else if (card && card.click) {
      await card.click({ delay: 50, timeout: 3000 }).catch(async () => {
        if (typeof page.evaluate === 'function') {
          await page.evaluate((el) => el.click(), card).catch(() => {});
        }
      });
    }

    // Fallback estrito: busca APENAS entre páginas criadas APÓS o clique
    // Impede categoricamente o fechamento acidental da página principal ou da activePage
    if (!itemTab && context && typeof context.pages === 'function') {
      const allPages = context.pages();
      itemTab =
        allPages.find(
          (p) =>
            !pagesBeforeClick.has(p) &&
            p !== page &&
            (typeof p.isClosed === 'function' ? !p.isClosed() : true)
        ) || null;
    }

    if (itemTab) {
      if (typeof itemTab.waitForLoadState === 'function') {
        // Teto de 3s para domcontentloaded — suficiente para disparo dos beacons de tracking
        await itemTab.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
      }
      if (typeof itemTab.waitForTimeout === 'function') {
        await itemTab.waitForTimeout(1000).catch(() => {});
      }
      if (typeof itemTab.close === 'function') {
        await itemTab.close().catch(() => {});
      }
    } else {
      const currentUrl = typeof page.url === 'function' ? page.url() : '';
      const currentCardsAfter =
        typeof page.$$ === 'function' ? await page.$$(SELECTORS.tasks.productCard) : [];
      const currentCardCount = currentCardsAfter.length;

      logger.info(
        { beforeUrl, currentUrl, cardCount: currentCardCount },
        'Verificação de navegação do card de produto...'
      );

      const isStillOnFeed = isFeedUrl(currentUrl, feedUrl, currentCardCount);
      const hasNavigatedAway = Boolean(
        !isStillOnFeed &&
        ((currentUrl && beforeUrl && currentUrl !== beforeUrl) ||
          currentCardCount === 0 ||
          (currentUrl && (currentUrl.includes('/item/') || currentUrl.includes('/detail/'))) ||
          (currentUrl && currentUrl.includes('adclick.html')) ||
          (feedUrl && currentUrl && currentUrl !== feedUrl))
      );

      if (hasNavigatedAway) {
        if (typeof page.waitForTimeout === 'function') {
          await page.waitForTimeout(1000).catch(() => {});
        }
        if (typeof page.goBack === 'function') {
          await page.goBack().catch(() => {});
          if (typeof page.waitForLoadState === 'function') {
            await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
          }
        }
        // Se após goBack() ainda não tiver retornado à página da feed, força goto(feedUrl)
        const urlAfterBack = typeof page.url === 'function' ? page.url() : '';
        const cardsAfterBack =
          typeof page.$$ === 'function' ? await page.$$(SELECTORS.tasks.productCard) : [];
        const returnedToFeed = isFeedUrl(urlAfterBack, feedUrl, cardsAfterBack.length);
        if (feedUrl && !returnedToFeed && typeof page.goto === 'function') {
          await page
            .goto(feedUrl, { waitUntil: 'domcontentloaded', timeout: 10000 })
            .catch(() => {});
        }
        if (typeof page.waitForSelector === 'function') {
          await page
            .waitForSelector(SELECTORS.tasks.productCard, { timeout: 6000 })
            .catch(() => {});
        }
      }
    }

    clickedCount++;
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(400).catch(() => {});
    }
  }

  if (typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(600).catch(() => {});
  }
  return clickedCount;
}

module.exports = {
  executeSurpriseItems,
  normalizeFeedUrl,
  isFeedUrl,
  getCardSignature
};
