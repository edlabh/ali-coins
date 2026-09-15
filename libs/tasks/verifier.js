/**
 * Verificação e extração de elementos DOM da gaveta de tarefas do AliExpress
 */
const { SELECTORS } = require('../selectors');
const { closeModals } = require('../ui/navigation');
const defaultLogger = require('../../logger');

/**
 * Abre a gaveta de tarefas no msite com até 5 tentativas resilientes
 * @param {object} params
 * @param {import('playwright').Page} params.page
 * @param {object} [params.logger]
 * @returns {Promise<boolean>}
 */
async function openTaskDrawer({ page, logger = defaultLogger } = {}) {
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

  if (page.waitForFunction) {
    await page
      .waitForFunction(() => !document.querySelector('.login-pending-container'), { timeout: 8000 })
      .catch(() => {});
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    await closeModals(page);

    logger.info(`Tentativa ${attempt}/5 de abrir o painel "Ganhe mais moedas"...`);
    const taskBtn = await page.$(SELECTORS.tasks.openDrawerBtn).catch(() => null);
    if (taskBtn) {
      if (page.evaluate) {
        await page.evaluate((el) => el.click(), taskBtn).catch(() => {});
      } else if (taskBtn.click) {
        await taskBtn.click().catch(() => {});
      }
    } else if (page.evaluate) {
      await page.evaluate(() => window.scrollBy(0, 150)).catch(() => {});
    }

    try {
      if (page.waitForSelector) {
        await page.waitForSelector(SELECTORS.tasks.taskItem, { timeout: 4000 });
        isDrawerOpen = true;
        break;
      }
    } catch {
      // Próxima tentativa
    }

    if (page.waitForTimeout) {
      await page.waitForTimeout(1000).catch(() => {});
    }
  }
  return isDrawerOpen;
}

/**
 * Lê todas as tarefas presentes na gaveta do msite
 * @param {object} params
 * @param {import('playwright').Page} params.page
 * @returns {Promise<Array<object>>}
 */
async function extractTasksFromDrawer({ page } = {}) {
  if (!page || !page.$$eval) return [];
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
        const isDisabledStyle = btnStyle.includes('opacity: 0.5') || btnStyle.includes('cover');
        const isDoneText = Boolean(btnText.match(/^(DONE|CONCLU[IÍ]DO|COMPLETED)$/i));
        isDone = (isDisabledStyle || isDoneText || (!isActionable && !isClaimable)) && !isClaimable;
      }

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
        isActionable,
        isClaimable,
        groupId,
        coins,
        allText
      };
    })
  );
}

/**
 * Localiza o elemento de tarefa correspondente ao título no DOM atual
 * @param {import('playwright').Page} page
 * @param {string} targetTitle
 * @param {number} [fallbackIndex=0]
 * @returns {Promise<import('playwright').ElementHandle|null>}
 */
async function findTaskElement(page, targetTitle, fallbackIndex = 0) {
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
  }
  return currentTaskEl || null;
}

module.exports = {
  openTaskDrawer,
  extractTasksFromDrawer,
  findTaskElement
};
