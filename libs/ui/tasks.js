const { SELECTORS } = require('../selectors');
const { closeModals } = require('./navigation');
const { waitWithScroll } = require('../../browser');
const logger = require('../../logger');

/**
 * Identifica se a tarefa exige interação direta no App nativo AliExpress
 * @param {object} task
 * @returns {boolean}
 */
function isInteractiveOrAppOnly(task) {
  const text = (task.title + ' ' + task.desc).toLowerCase();
  return (
    text.includes('prize land') ||
    text.includes('0.1') ||
    text.includes('water') ||
    text.includes('regar') ||
    text.includes('merge boss') ||
    text.includes('game') ||
    text.includes('jogo') ||
    text.includes('quiz')
  );
}

/**
 * Toca em 3 produtos na página de anúncios de ofertas/tarefas
 * @param {import('playwright').Page} targetPage
 * @param {import('playwright').BrowserContext} context
 * @param {number} [startIndex=0]
 * @returns {Promise<number>}
 */
async function executeSurpriseItems(targetPage, context, startIndex = 0) {
  logger.info(`Executando tarefa: tocar em 3 itens (a partir do card #${startIndex + 1})...`);
  await targetPage.waitForSelector(SELECTORS.tasks.productCard, { timeout: 4000 }).catch(() => {});
  let cards = await targetPage.$$(SELECTORS.tasks.productCard);

  if (startIndex + 3 > cards.length) {
    await targetPage.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
    await targetPage.waitForTimeout(1000);
    cards = await targetPage.$$(SELECTORS.tasks.productCard);
  }

  const start = startIndex < cards.length ? startIndex : 0;
  const countToClick = Math.min(3, Math.max(0, cards.length - start));
  let clickedCount = 0;

  for (let c = start; c < start + (countToClick || 3); c++) {
    if (c >= cards.length) break;
    logger.info(`Tocando item ${clickedCount + 1}/3 (card #${c + 1})...`);
    const card = cards[c];
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await targetPage.waitForTimeout(400);

    const tabPromise = context.waitForEvent('page', { timeout: 3500 }).catch(() => null);
    await card.click({ delay: 50, timeout: 4000 }).catch(async () => {
      await targetPage.evaluate((el) => el.click(), card).catch(() => {});
    });

    const itemTab = await tabPromise;
    if (itemTab) {
      await itemTab.waitForLoadState('domcontentloaded').catch(() => {});
      await itemTab.waitForTimeout(1500);
      await itemTab.close().catch(() => {});
    } else if (!targetPage.url().includes('adclick.html')) {
      await targetPage.waitForTimeout(1500);
      await targetPage.goBack().catch(() => {});
      await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
    }
    clickedCount++;
    await targetPage.waitForTimeout(500);
  }
  await targetPage.waitForTimeout(1000);
  return clickedCount;
}

/**
 * Abre a gaveta de tarefas no msite com até 5 tentativas resilientes
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function openTaskDrawer(page) {
  let isDrawerOpen = await page
    .$eval(SELECTORS.tasks.drawerContainer, (el) => {
      const box = el.getBoundingClientRect();
      return box.height > 100;
    })
    .catch(() => false);

  if (isDrawerOpen) return true;

  await page
    .waitForFunction(() => !document.querySelector('.login-pending-container'), { timeout: 8000 })
    .catch(() => {});

  for (let attempt = 1; attempt <= 5; attempt++) {
    await closeModals(page);

    logger.info(`Tentativa ${attempt}/5 de abrir o painel "Ganhe mais moedas"...`);
    const taskBtn = await page.$(SELECTORS.tasks.openDrawerBtn);
    if (taskBtn) {
      await page.evaluate((el) => el.click(), taskBtn);
    } else {
      await page.evaluate(() => window.scrollBy(0, 150)).catch(() => {});
    }

    try {
      await page.waitForSelector(SELECTORS.tasks.taskItem, { timeout: 4000 });
      isDrawerOpen = true;
      break;
    } catch {
      // Próxima tentativa
    }

    await page.waitForTimeout(1000);
  }
  return isDrawerOpen;
}

/**
 * Lê todas as tarefas presentes na gaveta do msite
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<object>>}
 */
async function extractTasksFromDrawer(page) {
  return await page.$$eval(SELECTORS.tasks.taskItem, (els) =>
    els.map((e, idx) => {
      const title = e.querySelector('.e2e_normal_task_content_title')?.innerText?.trim() || '';
      const desc = e.querySelector('.e2e_normal_task_content_secondTitle')?.innerText?.trim() || '';
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

      const isDone =
        btnStyle.includes('opacity: 0.5') ||
        btnStyle.includes('cover') ||
        btnText !== 'GO' ||
        (totalRounds !== null && completedRounds !== null && completedRounds >= totalRounds);

      const groupId = e.querySelector('.e2e_normal_task_right')?.getAttribute('data-groupid') || '';
      const allText = e.innerText?.replace(/\n+/g, ' ') || '';
      const coinMatch = allText.match(/\+([0-9]+(?:～[0-9]+)?)/);
      const coins = coinMatch ? `+${coinMatch[1]} moedas` : '+5 moedas';
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
        groupId,
        coins,
        allText
      };
    })
  );
}

/**
 * Executa uma ação de tarefa individual com base no título e descrição
 * @param {import('playwright').Page} activePage
 * @param {import('playwright').BrowserContext} context
 * @param {object} pendingTask
 * @param {object} config
 * @returns {Promise<{ isSpecialOrAppOnly?: boolean }>}
 */
async function executeTaskAction(activePage, context, pendingTask, config) {
  const titleLower = pendingTask.title.toLowerCase();
  const descLower = pendingTask.desc.toLowerCase();

  if (
    titleLower.includes('surprise') ||
    titleLower.includes('surpresa') ||
    descLower.includes('tap 3') ||
    descLower.includes('toque em 3')
  ) {
    const startCardIdx =
      pendingTask.completedRounds && pendingTask.completedRounds > 0
        ? pendingTask.completedRounds * 3
        : 0;
    await executeSurpriseItems(activePage, context, startCardIdx);
  } else if (
    titleLower.includes('search') ||
    titleLower.includes('pesquisa') ||
    titleLower.includes('buscar') ||
    descLower.includes('keywords') ||
    descLower.includes('palavra')
  ) {
    logger.info('Executando busca por produto...');
    const searchInput = await activePage.$('input');
    if (searchInput) {
      await searchInput.fill('fone bluetooth');
      await searchInput.press('Enter');
    }
    await waitWithScroll(activePage, config.SCROLL_WAIT_SECONDS);
  } else if (
    titleLower.includes('prize land') ||
    descLower.includes('prize land') ||
    descLower.includes('water') ||
    descLower.includes('regar') ||
    titleLower.includes('0.1') ||
    descLower.includes('0.1')
  ) {
    const waterBtn = await activePage.$(SELECTORS.tasks.waterBtn);
    if (waterBtn) {
      await activePage.evaluate((el) => el.click(), waterBtn);
      await activePage.waitForTimeout(1500);
    }
    return { isSpecialOrAppOnly: true };
  } else if (
    titleLower.includes('merge boss') ||
    titleLower.includes('game') ||
    titleLower.includes('jogo') ||
    titleLower.includes('quiz')
  ) {
    return { isSpecialOrAppOnly: true };
  } else {
    logger.info(`Executando navegação com scroll: "${pendingTask.title}"...`);
    await waitWithScroll(activePage, config.SCROLL_WAIT_SECONDS);
  }
  return {};
}

module.exports = {
  isInteractiveOrAppOnly,
  executeSurpriseItems,
  openTaskDrawer,
  extractTasksFromDrawer,
  executeTaskAction
};
