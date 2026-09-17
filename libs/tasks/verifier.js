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
  if (!page) return false;

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
    for (let wait = 0; wait < 12; wait++) {
      const isSkeleton = await page
        .evaluate(() => !!document.querySelector('.login-pending-container'))
        .catch(() => false);

      const hasBtn = await page.$(SELECTORS.tasks.openDrawerBtn).catch(() => null);

      if (hasBtn || (!isSkeleton && wait > 0)) break;

      // Se persistir no skeleton por 6 segundos e ainda não recarregou, recarrega a página defensivamente
      if (wait === 6 && !reloaded && typeof page.reload === 'function') {
        logger.info('Página presa em skeleton de carregamento. Recarregando página (reload)...');
        reloaded = true;
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      }

      if (page.waitForTimeout) {
        await page.waitForTimeout(1000).catch(() => {});
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
          if (page.evaluate) {
            await page.evaluate((el) => el.click(), taskBtn).catch(() => {});
          }
        }
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
 * @param {object|import('playwright').Page} optionsOrPage
 * @returns {Promise<Array<object>>}
 */
async function extractTasksFromDrawer(optionsOrPage) {
  const page = optionsOrPage && optionsOrPage.page ? optionsOrPage.page : optionsOrPage;
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
        // Apenas 'opacity: 0.5' como sinal visual de desabilitado. A heurística textual
        // 'cover' foi removida por poder marcar como concluída uma tarefa ativa
        // (ex: botão com background-size: cover).
        const isDisabledStyle = btnStyle.includes('opacity: 0.5');
        const isDoneText = Boolean(btnText.match(/^(DONE|CONCLU[IÍ]DO|COMPLETED)$/i));
        // Somente sinais POSITIVOS de conclusão: a ausência de rótulos conhecidos não
        // marca mais a tarefa como concluída (evita pular tarefas com botões novos/A-B).
        isDone = !isClaimable && (isDisabledStyle || isDoneText);
      }

      const groupId = e.querySelector('.e2e_normal_task_right')?.getAttribute('data-groupid') || '';
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
