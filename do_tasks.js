const {
  loadConfig,
  sessionPath,
  handleDryRun,
  isForce,
  isJson,
  checkAndDisplayHelp
} = require('./config');
const { formatDateTime, formatDuration } = require('./time_utils');
const { launchBrowser, newMobileContext, closeContextWithDiagnostics } = require('./browser');
const { acquireLock, LockActiveError } = require('./lockfile');
const { validateAndRefresh } = require('./libs/session');
const { SELECTORS } = require('./libs/selectors');
const {
  gotoWithRetry,
  closeModals,
  getBalanceDesktop,
  isInteractiveOrAppOnly,
  openTaskDrawer,
  extractTasksFromDrawer,
  executeTaskAction
} = require('./libs/ui');
const { renderTasksReport } = require('./libs/report');
const logger = require('./logger');

/**
 * Executa as tarefas diárias do painel "Ganhe mais moedas"
 * @param {object} [options={}]
 * @param {import('playwright').Browser} [options.browser] Navegador compartilhado
 * @param {object} [options.sessionData] Sessão em cache
 * @param {boolean} [options.skipAutoLogin=false] Se true, evita chamada recursiva a runCheckin
 * @returns {Promise<object>}
 */
async function runTasks(options = {}) {
  const tasksStartTime = new Date();
  const config = loadConfig(true);
  const userEmail = config.ALI_USER;

  logger.info('================ EXECUÇÃO DAS TAREFAS DIÁRIAS ================');
  logger.info(`[Dia e Hora]: ${formatDateTime(tasksStartTime)}`);

  let sessionData = options.sessionData || null;
  const sessionStatus = await validateAndRefresh(userEmail, sessionData);

  if (!sessionStatus.valid) {
    if (options.skipAutoLogin) {
      throw new Error(`Sessão inválida para tarefas: ${sessionStatus.reason}`);
    }

    logger.warn(`Sessão inválida (${sessionStatus.reason}). Autenticando via check-in...`);
    const { runCheckin } = require('./collect');
    const checkinRes = await runCheckin({ browser: options.browser });
    sessionData = checkinRes.sessionData;
  } else {
    sessionData = sessionStatus.sessionData;
  }

  logger.info(`[Login] Sessão validada para: ${userEmail}`);

  let browser = options.browser;
  const isInternalBrowser = !browser;

  if (isInternalBrowser) {
    browser = await launchBrowser({ headless: config.HEADLESS });
  }

  try {
    const context = await newMobileContext(browser, sessionPath, {
      allowMedia: config.ALLOW_MEDIA
    });

    let newPageOpened = null;
    context.on('page', (p) => {
      newPageOpened = p;
    });

    const page = await context.newPage();

    try {
      logger.info('Acessando central de moedas...');
      await gotoWithRetry(page, SELECTORS.desktop.mycoinUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.NAV_TIMEOUT_SHORT
      }).catch(() => {});
      await page.waitForLoadState('domcontentloaded');

      await gotoWithRetry(page, 'https://m.aliexpress.com/p/coin-index/index.html', {
        waitUntil: 'domcontentloaded',
        timeout: config.NAV_TIMEOUT
      });
      await page.waitForLoadState('domcontentloaded');

      if (page.url().includes('coin-pc-index')) {
        await page.setViewportSize({ width: 412, height: 915 });
        await gotoWithRetry(page, 'https://m.aliexpress.com/p/coin-index/index.html', {
          waitUntil: 'domcontentloaded',
          timeout: config.NAV_TIMEOUT_SHORT
        });
      }

      const loginInput = await page.$(SELECTORS.login.usernameInput);
      const bodyText = await page.innerText('body').catch(() => '');
      if (
        loginInput !== null ||
        bodyText.includes('Email or phone number') ||
        bodyText.includes('Sign in')
      ) {
        throw new Error('Sessão expirou ou exige login.');
      }

      // Check-in pendente se houver
      for (const sel of SELECTORS.checkin.collectButtonList) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            const text = (await btn.innerText().catch(() => '')).trim().toLowerCase();
            if (text === 'collect' || text === 'coletar') {
              logger.info('Check-in pendente encontrado. Coletando...');
              await page.evaluate((el) => el.click(), btn);
              await page.waitForTimeout(1500);
              break;
            }
          }
        } catch {
          // Ignorar
        }
      }

      await closeModals(page);

      const drawerOpened = await openTaskDrawer(page);
      if (!drawerOpened) {
        throw new Error('Painel "Ganhe mais moedas" inacessível.');
      }

      const taskAttempts = {};
      const maxAttemptsPerTask = config.TASK_MAX_ATTEMPTS;
      let totalActions = 0;
      const MAX_TOTAL_ACTIONS = config.TASK_MAX_ACTIONS;

      while (totalActions < MAX_TOTAL_ACTIONS) {
        await openTaskDrawer(page);
        const currentTasks = await extractTasksFromDrawer(page);
        if (!currentTasks || currentTasks.length === 0) break;

        const pendingTask = currentTasks.find((t) => {
          if (t.isDone) return false;
          if (t.btnText !== 'GO') return false;
          const attempts = taskAttempts[t.title] || 0;
          return attempts < maxAttemptsPerTask;
        });

        if (!pendingTask) {
          logger.info('Todas as tarefas disponíveis foram concluídas ou verificadas.');
          break;
        }

        taskAttempts[pendingTask.title] = (taskAttempts[pendingTask.title] || 0) + 1;
        totalActions++;

        const taskStartTime = new Date();
        logger.info(`\n--- Executando: "${pendingTask.title}" (${pendingTask.coins}) ---`);

        const currentTaskEls = await page.$$(SELECTORS.tasks.taskItem);
        let currentTaskEl = currentTaskEls[pendingTask.index];
        const actualTitle = await currentTaskEl
          ?.$eval(SELECTORS.tasks.taskTitle, (el) => el.innerText.trim())
          .catch(() => '');

        if (actualTitle !== pendingTask.title) {
          for (const el of currentTaskEls) {
            const t = await el
              ?.$eval(SELECTORS.tasks.taskTitle, (e) => e.innerText.trim())
              .catch(() => '');
            if (t === pendingTask.title) {
              currentTaskEl = el;
              break;
            }
          }
        }

        if (!currentTaskEl) continue;

        const goBtn = await currentTaskEl.$(SELECTORS.tasks.taskBtn);
        if (!goBtn) continue;

        newPageOpened = null;
        await page.evaluate((el) => el.click(), goBtn);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(1000);

        const activePage = newPageOpened || page;
        const isNewTab = newPageOpened !== null;

        try {
          const actionRes = await executeTaskAction(activePage, context, pendingTask, config);
          if (actionRes.isSpecialOrAppOnly) {
            taskAttempts[pendingTask.title] = 999;
          }
        } catch (taskErr) {
          logger.error({ err: taskErr.message }, `Erro ao executar "${pendingTask.title}".`);
        }

        if (isNewTab) {
          await activePage.close().catch(() => {});
        } else if (!page.url().includes('coin-index/index.html')) {
          await gotoWithRetry(page, 'https://m.aliexpress.com/p/coin-index/index.html', {
            waitUntil: 'domcontentloaded'
          });
        }
        await page.waitForTimeout(1000);

        const taskEndTime = new Date();
        logger.info(`Concluída tarefa em: ${formatDuration(taskEndTime - taskStartTime)}`);
      }

      await openTaskDrawer(page);
      const finalTasks = await extractTasksFromDrawer(page);
      const results = finalTasks.map((t) => {
        let status = 'Pendente';
        if (t.isDone) {
          status = t.totalRounds
            ? `Concluída (${t.totalRounds}/${t.totalRounds})`
            : t.statusText
              ? `Concluída (${t.statusText})`
              : 'Concluída';
        } else if (isInteractiveOrAppOnly(t)) {
          status =
            t.title.toLowerCase().includes('quiz') || t.title.toLowerCase().includes('merge boss')
              ? 'Requer interação direta no App AliExpress (minigame/quiz)'
              : 'Exclusiva do App AliExpress (requer rega no app móvel)';
        } else if (t.statusText) {
          status = `Executada parcialmente (${t.statusText})`;
        }
        return { title: t.title, status, coins: t.coins };
      });

      await closeContextWithDiagnostics(context, { failed: false, name: 'tasks-mobile' });

      let finalCoins = 'N/D';
      try {
        const desktopResult = await getBalanceDesktop(browser, sessionPath, {
          allowMedia: config.ALLOW_MEDIA,
          timeout: config.NAV_TIMEOUT_SHORT
        });
        if (desktopResult.totalBalance && desktopResult.totalBalance !== 'N/D') {
          finalCoins = `${desktopResult.totalBalance} moedas`;
        }
      } catch {
        // Ignorar
      }

      const tasksEndTime = new Date();
      const tasksDuration = formatDuration(tasksEndTime - tasksStartTime);

      const result = {
        results,
        finalCoins,
        totalActions,
        startTime: tasksStartTime,
        endTime: tasksEndTime,
        duration: tasksDuration
      };

      renderTasksReport(result, { json: isJson() });
      return result;
    } catch (flowErr) {
      await closeContextWithDiagnostics(context, { failed: true, name: 'tasks-failed' });
      throw flowErr;
    }
  } finally {
    if (isInternalBrowser && browser) {
      await browser.close().catch(() => {});
    }
  }
}

if (require.main === module) {
  if (checkAndDisplayHelp()) {
    process.exit(0);
  }
  if (handleDryRun()) {
    process.exit(0);
  }

  (async () => {
    let releaseLock = null;
    try {
      releaseLock = await acquireLock(isForce());
    } catch (err) {
      if (err instanceof LockActiveError) {
        process.exit(3);
      }
      logger.error({ err: err.message }, 'Falha ao obter lock.');
      process.exit(1);
    }

    try {
      const result = await runTasks();
      if (releaseLock) await releaseLock();
      if (result && result.totalActions === 0) {
        process.exit(2);
      }
      process.exit(0);
    } catch (err) {
      if (releaseLock) await releaseLock();
      logger.error({ err: err.message }, 'Falha na execução de tarefas.');
      process.exit(1);
    }
  })();
}

module.exports = { runTasks };
