/**
 * Verificação e extração de elementos DOM da gaveta de tarefas do AliExpress
 */
const { SELECTORS } = require('../selectors');
const { closeModals } = require('../ui/navigation');
const defaultLogger = require('../../logger');

/**
 * Abre a gaveta de tarefas no msite com até 5 tentativas resilientes,
 * auto-cura de skeleton congelado (.login-pending-container) via reload único
 * e múltiplos fallbacks de seletores de botão.
 * @param {object|import('playwright').Page} optionsOrPage
 * @param {object} [maybeLogger]
 * @returns {Promise<boolean>}
 */
async function openTaskDrawer(optionsOrPage, maybeLogger) {
  const page = optionsOrPage && optionsOrPage.page ? optionsOrPage.page : optionsOrPage;
  const logger = (optionsOrPage && optionsOrPage.logger) || maybeLogger || defaultLogger;
  if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return false;

  let isDrawerOpen = false;
  try {
    isDrawerOpen = await page
      .$eval(SELECTORS.tasks.drawerContainer, (el) => {
        const box = el.getBoundingClientRect();
        return box.height > 100;
      })
      .catch(() => false);
  } catch {
    isDrawerOpen = false;
  }

  if (isDrawerOpen) return true;

  // Auto-cura: monitora se a página está presa no esqueleto de carregamento (skeleton)
  if (page.evaluate) {
    let reloaded = false;
    // Checagens a cada 350ms (até ~9s no total): o bot detecta o fim do skeleton e clica
    // no botão de tarefas assim que o DOM estabiliza, economizando 2-4s por conta em vez
    // de dormir 1s fixo por iteração.
    for (let wait = 0; wait < 25; wait++) {
      const isSkeleton = await page
        .evaluate(() => !!document.querySelector('.login-pending-container'))
        .catch(() => false);

      const hasBtn = await page.$(SELECTORS.tasks.openDrawerBtn).catch(() => null);

      if (hasBtn || (!isSkeleton && wait > 0)) break;

      // Se persistir no skeleton por ~6 segundos (17 × 350ms) e ainda não recarregou,
      // recarrega a página defensivamente
      if (wait === 17 && !reloaded && typeof page.reload === 'function') {
        logger.info('Página presa em skeleton de carregamento. Recarregando página (reload)...');
        reloaded = true;
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      }

      if (page.waitForTimeout) {
        await page.waitForTimeout(350).catch(() => {});
      }
    }
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    await closeModals(page);

    logger.info(`Tentativa ${attempt}/5 de abrir o painel "Ganhe mais moedas"...`);
    let taskBtn = await page.$(SELECTORS.tasks.openDrawerBtn).catch(() => null);

    // Fallback semântico se query CSS direta não encontrar
    if (!taskBtn && typeof page.getByRole === 'function') {
      try {
        const roleBtn = page.getByRole('button', { name: /earn more coins|ganhe mais moedas/i });
        if ((await roleBtn.count().catch(() => 0)) > 0) {
          taskBtn = roleBtn.first();
        }
      } catch {
        // Fallback ignorado se falhar
      }
    }

    if (taskBtn) {
      if (typeof taskBtn.click === 'function') {
        try {
          await taskBtn.click({ timeout: 2000 });
        } catch {
          if (typeof taskBtn.evaluate === 'function') {
            await taskBtn.evaluate((el) => el.click()).catch(() => {});
          } else if (page.evaluate) {
            await page.evaluate((el) => el.click(), taskBtn).catch(() => {});
          }
        }
      } else if (typeof taskBtn.evaluate === 'function') {
        await taskBtn.evaluate((el) => el.click()).catch(() => {});
      } else if (page.evaluate) {
        await page.evaluate((el) => el.click(), taskBtn).catch(() => {});
      }

      // Aguarda abertura da gaveta e renderização das tarefas
      try {
        if (page.waitForSelector) {
          await page.waitForSelector(SELECTORS.tasks.taskItem, { timeout: 6000 });
          isDrawerOpen = true;
          break;
        }
      } catch {
        // Fallback: verifica altura do container da gaveta
        isDrawerOpen = await page
          .$eval(SELECTORS.tasks.drawerContainer, (el) => el.getBoundingClientRect().height > 100)
          .catch(() => false);
        if (isDrawerOpen) break;
      }
    } else {
      // Se botão não foi encontrado, rola a página para renderizar elementos lazy
      if (page.evaluate) {
        await page.evaluate(() => window.scrollBy(0, 150)).catch(() => {});
      }
    }

    if (page.waitForTimeout) {
      await page.waitForTimeout(1500).catch(() => {});
    }
  }
  return isDrawerOpen;
}

/**
 * Lê todas as tarefas presentes na gaveta do msite
 * Suporta assinatura por objeto ({ page, logger, throwOnError }) ou posicional (page, maybeLogger)
 * Retorna Array de tarefas. Em caso de falha, anexa a propriedade .error no array retornado
 * (ou lança o erro se throwOnError for true), prevenindo encerramentos silenciosos.
 * @param {object|import('playwright').Page} optionsOrPage
 * @param {object} [maybeLogger]
 * @returns {Promise<Array<object>>}
 */
async function extractTasksFromDrawer(optionsOrPage, maybeLogger) {
  let page, logger, throwOnError;
  if (
    optionsOrPage &&
    typeof optionsOrPage === 'object' &&
    ('page' in optionsOrPage || 'throwOnError' in optionsOrPage)
  ) {
    ({ page = null, logger = defaultLogger, throwOnError = false } = optionsOrPage);
  } else {
    page = optionsOrPage;
    logger = maybeLogger || defaultLogger;
    throwOnError = false;
  }

  if (!page || !page.$$eval || (typeof page.isClosed === 'function' && page.isClosed())) {
    const err = new Error('Página indisponível ou fechada para extração de tarefas.');
    err.code = 'PAGE_CLOSED';
    if (throwOnError) throw err;
    const res = [];
    Object.defineProperty(res, 'error', {
      value: err,
      enumerable: false,
      writable: true,
      configurable: true
    });
    return res;
  }

  try {
    const tasks = await page.$$eval(SELECTORS.tasks.taskItem, (els) =>
      els.map((e, idx) => {
        const title = e.querySelector('.e2e_normal_task_content_title')?.innerText?.trim() || '';
        const desc =
          e.querySelector('.e2e_normal_task_content_secondTitle')?.innerText?.trim() || '';
        const btn = e.querySelector('.e2e_normal_task_right_btn');
        const btnText = btn?.innerText?.trim() || '';
        const btnStyle = btn?.getAttribute('style') || '';
        const statusText = e.querySelector('.statusText')?.innerText?.trim() || '';

        let completedRounds = null;
        let currentRound = null;
        let totalRounds = null;
        if (statusText) {
          const sm = statusText.match(/^([0-9]+)\/([0-9]+)$/);
          if (sm) {
            completedRounds = parseInt(sm[1], 10);
            totalRounds = parseInt(sm[2], 10);
            currentRound = Math.min(completedRounds + 1, totalRounds);
          }
        }

        const isActionable = Boolean(btnText.match(/^(GO|IR)$/i));
        const isClaimable = Boolean(
          btnText.match(/^(COLLECT|COLETAR|GET|RECEBER|CLAIM|RESGATAR|\+[0-9]+)/i)
        );

        // Uma tarefa é considerada totalmente concluída quando:
        // 1. O número de rodadas concluídas atinge o total (ex: 2/2, 3/3) e não há botão de resgate pendente
        // 2. Ou quando não há contagem de rodadas, mas o botão está desabilitado/concluído e não é nem executável nem resgatável
        let isDone = false;
        if (totalRounds !== null && completedRounds !== null) {
          isDone = completedRounds >= totalRounds && !isClaimable;
        } else {
          // Apenas 'opacity: 0.5' como sinal visual de desabilitado. A heurística textual
          // 'cover' foi removida por poder marcar como concluída uma tarefa ativa
          // (ex: botão com background-size: cover).
          const isDisabledStyle = btnStyle.includes('opacity: 0.5');
          const isDoneText = Boolean(btnText.match(/^(DONE|CONCLU[IÍ]DO|COMPLETED)$/i));
          // Somente sinais POSITIVOS de conclusão: a ausência de rótulos conhecidos não
          // marca mais a tarefa como concluída (evita pular tarefas com botões novos/A-B).
          isDone = !isClaimable && (isDisabledStyle || isDoneText);
        }

        const groupId =
          e.querySelector('.e2e_normal_task_right')?.getAttribute('data-groupid') || '';
        const allText = e.innerText?.replace(/\n+/g, ' ') || '';
        const coinMatch = allText.match(/\+([0-9]+(?:～[0-9]+)?)/);
        // Nota: o rótulo de vitrine exibido no card (+X moedas) é meramente informativo/estimado.
        // O cálculo contábil real de moedas ganhas é feito determinísticamente via saldo no desktop (getBalanceDesktop).
        const estimatedCoins = coinMatch ? `+${coinMatch[1]} moedas` : '+5 moedas';
        const coins = estimatedCoins;
        return {
          index: idx,
          title,
          desc,
          btnText,
          btnStyle,
          statusText,
          completedRounds,
          currentRound,
          totalRounds,
          isDone,
          isActionable,
          isClaimable,
          groupId,
          coins,
          estimatedCoins,
          allText
        };
      })
    );
    Object.defineProperty(tasks, 'error', {
      value: null,
      enumerable: false,
      writable: true,
      configurable: true
    });
    return tasks;
  } catch (err) {
    logger.warn({ err: err.message }, 'Erro ao extrair tarefas da gaveta.');
    if (throwOnError) throw err;
    const res = [];
    Object.defineProperty(res, 'error', {
      value: err,
      enumerable: false,
      writable: true,
      configurable: true
    });
    return res;
  }
}

/**
 * Localiza o elemento de tarefa correspondente ao título no DOM atual
 * @param {import('playwright').Page} page
 * @param {string} targetTitle
 * @param {number} [fallbackIndex=0]
 * @returns {Promise<import('playwright').ElementHandle|null>}
 */
async function findTaskElement(page, targetTitle, fallbackIndex = 0) {
  // Caminho otimizado: resolve o índice em um único round-trip CDP ($$eval), em vez de
  // N+1 $eval (um por card). Fallback para o caminho antigo em mocks/ambientes sem $$eval.
  if (typeof page.$$eval === 'function' && typeof page.$$ === 'function') {
    const index = await page
      .$$eval(
        SELECTORS.tasks.taskItem,
        (els, { title, titleSelector, fallback }) => {
          const found = els.findIndex((el) => {
            const node = el.querySelector(titleSelector);
            return Boolean(node) && node.innerText.trim() === title;
          });
          return found >= 0 ? found : fallback;
        },
        { title: targetTitle, titleSelector: SELECTORS.tasks.taskTitle, fallback: fallbackIndex }
      )
      .catch(() => fallbackIndex);

    const currentTaskEls = await page.$$(SELECTORS.tasks.taskItem);
    const candidate = currentTaskEls[index] || currentTaskEls[fallbackIndex] || null;

    // Revalida o título: a lista pode ter re-renderizado entre o $$eval e o $$,
    // deslocando o índice. Sem $eval (mocks), devolve o candidato direto.
    if (!candidate || typeof candidate.$eval !== 'function') {
      return candidate;
    }
    const candidateTitle = await candidate
      .$eval(SELECTORS.tasks.taskTitle, (el) => el.innerText.trim())
      .catch(() => '');
    if (candidateTitle === targetTitle) {
      return candidate;
    }
    for (const el of currentTaskEls) {
      if (typeof el.$eval !== 'function') continue;
      const t = await el
        .$eval(SELECTORS.tasks.taskTitle, (e) => e.innerText.trim())
        .catch(() => '');
      if (t === targetTitle) return el;
    }
    // Nenhum título casou: NÃO devolver um elemento de outra tarefa (a ação seria
    // executada na tarefa errada, enquanto o progresso era contado para a pretendida).
    return null;
  }

  const currentTaskEls = await page.$$(SELECTORS.tasks.taskItem);
  let currentTaskEl = currentTaskEls[fallbackIndex];
  const actualTitle = await currentTaskEl
    ?.$eval(SELECTORS.tasks.taskTitle, (el) => el.innerText.trim())
    .catch(() => '');

  if (actualTitle !== targetTitle) {
    for (const el of currentTaskEls) {
      const t = await el
        ?.$eval(SELECTORS.tasks.taskTitle, (e) => e.innerText.trim())
        .catch(() => '');
      if (t === targetTitle) {
        return el;
      }
    }
    // Sem correspondência de título: não devolver elemento de outra tarefa.
    return null;
  }
  return currentTaskEl || null;
}

/**
 * Garante que a página principal esteja aberta e na URL da central de moedas.
 * Se a página foi fechada ou travou, cria uma nova página a partir do context
 * e navega até a central de moedas.
 * @param {object} params
 * @param {import('playwright').Page} params.page
 * @param {import('playwright').BrowserContext} params.context
 * @param {string} [params.mobileCoinUrl]
 * @param {object} [params.config]
 * @param {object} [params.logger]
 * @param {Function} [params.gotoFn]
 * @returns {Promise<import('playwright').Page>}
 */
async function ensureMainPage({
  page,
  context,
  mobileCoinUrl = 'https://m.aliexpress.com/p/coin-index/index.html?_immersiveMode=true&from=pc302',
  config = {},
  logger = defaultLogger,
  gotoFn = null
} = {}) {
  const isPageClosed = !page || (typeof page.isClosed === 'function' && page.isClosed());
  if (isPageClosed) {
    logger.warn('Página principal fechada ou indisponível. Recriando página principal...');
    if (!context || typeof context.newPage !== 'function') {
      return page;
    }
    const freshPage = await context.newPage();
    if (gotoFn) {
      await gotoFn(freshPage, mobileCoinUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.NAV_TIMEOUT || 15000
      }).catch(() => {});
    } else if (typeof freshPage.goto === 'function') {
      await freshPage
        .goto(mobileCoinUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.NAV_TIMEOUT || 15000
        })
        .catch(() => {});
    }
    return freshPage;
  }

  if (typeof page.url === 'function' && !page.url().includes('coin-index/index.html')) {
    if (gotoFn) {
      await gotoFn(page, mobileCoinUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.NAV_TIMEOUT_SHORT || 8000
      }).catch(() => {});
    } else if (typeof page.goto === 'function') {
      await page
        .goto(mobileCoinUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.NAV_TIMEOUT_SHORT || 8000
        })
        .catch(() => {});
    }
  }
  return page;
}

/**
 * Abre a gaveta e extrai tarefas com retentativas e auto-recuperação da página via ensureMainPage.
 * Retorna { page, tasks, error }
 * @param {object} params
 * @param {import('playwright').Page} params.page
 * @param {import('playwright').BrowserContext} [params.context]
 * @param {number} [params.maxRetries=2]
 * @param {string} [params.label='execução']
 * @param {object} [params.config]
 * @param {object} [params.logger]
 * @param {Function} [params.ensureMainPageFn]
 * @returns {Promise<{ page: import('playwright').Page, tasks: Array<object>, error: Error|null }>}
 */
async function getDrawerTasksWithRetry({
  page,
  context = null,
  maxRetries = 2,
  label = 'execução',
  config = {},
  logger = defaultLogger,
  ensureMainPageFn = null
} = {}) {
  let activePage = page;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (ensureMainPageFn) {
      activePage = await ensureMainPageFn(activePage);
    } else {
      activePage = await ensureMainPage({
        page: activePage,
        context,
        config,
        logger
      });
    }

    const drawerOpened = await openTaskDrawer(activePage, logger);
    if (!drawerOpened) {
      logger.warn(
        `[${label}] Tentativa ${attempt}/${maxRetries + 1}: painel de tarefas fechado ou não detectado.`
      );
      if (attempt <= maxRetries) {
        if (typeof activePage.waitForTimeout === 'function') {
          await activePage.waitForTimeout(1000).catch(() => {});
        }
        continue;
      }
      return {
        page: activePage,
        tasks: [],
        error: new Error('Painel "Ganhe mais moedas" inacessível após tentativas.')
      };
    }

    const tasks = await extractTasksFromDrawer({ page: activePage, logger });
    if (tasks.error) {
      logger.warn(
        { err: tasks.error.message },
        `[${label}] Tentativa ${attempt}/${maxRetries + 1}: falha na leitura dos elementos de tarefas.`
      );
      if (attempt <= maxRetries) {
        if (typeof activePage.waitForTimeout === 'function') {
          await activePage.waitForTimeout(1000).catch(() => {});
        }
        continue;
      }
      return { page: activePage, tasks: [], error: tasks.error };
    }

    return { page: activePage, tasks, error: null };
  }

  return {
    page: activePage,
    tasks: [],
    error: new Error('Tentativas esgotadas ao abrir gaveta de tarefas.')
  };
}

module.exports = {
  openTaskDrawer,
  extractTasksFromDrawer,
  findTaskElement,
  ensureMainPage,
  getDrawerTasksWithRetry
};
