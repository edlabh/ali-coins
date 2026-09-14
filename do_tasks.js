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
  openTaskDrawer,
  extractTasksFromDrawer,
  executeTaskAction,
  findNextPendingTask,
  recordTaskAttempt,
  markSpecialOrAppOnly,
  classifyTaskStatus,
  findTaskElement,
  captureDomHashAndArtifacts
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
  const config = options.config || loadConfig(true);
  const account = options.account || null;
  const userEmail = (account && account.user) || options.userEmail || config.ALI_USER;
  const currentSessionPath = (account && account.sessionPath) || options.sessionPath || sessionPath;
  const currentSessionMetaPath =
    (account && account.sessionMetaPath) || options.sessionMetaPath || null;
  const sessionOpts = {
    sessionPath: currentSessionPath,
    sessionMetaPath: currentSessionMetaPath,
    account
  };

  logger.info('================ EXECUÇÃO DAS TAREFAS DIÁRIAS ================');
  logger.info(`[Dia e Hora]: ${formatDateTime(tasksStartTime)}`);
  logger.info(`[Login] Usuário: ${userEmail}`);

  let sessionData = options.sessionData || null;
  const sessionStatus = await validateAndRefresh(userEmail, sessionData, sessionOpts);
  const isImported = Boolean(sessionStatus.isImported);

  if (!sessionStatus.valid) {
    if (isImported) {
      logger.error(
        '[Sessão Remota Expirada] A sessão importada expirou ou é inválida. É necessário gerar nova sessão executando "node export_session.js" no servidor de origem e importá-la com "node import_session.js".'
      );
    }
    if (options.skipAutoLogin) {
      const err = new Error(`Sessão inválida para tarefas: ${sessionStatus.reason}`);
      if (isImported) err.isImportedSessionExpired = true;
      throw err;
    }

    logger.warn(`Sessão inválida (${sessionStatus.reason}). Autenticando via check-in...`);
    const { runCheckin } = require('./collect');
    const checkinRes = await runCheckin({
      browser: options.browser,
      account,
      config,
      sessionOpts
    });
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
    const context = await newMobileContext(browser, sessionData || currentSessionPath, {
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
        if (isImported) {
          logger.error(
            '[Sessão Remota Expirada] A sessão importada expirou ou foi invalidada pelo AliExpress. É necessário gerar nova sessão com "node export_session.js" no servidor de origem e importá-la com "node import_session.js".'
          );
        }
        const err = new Error('Sessão expirou ou exige login.');
        if (isImported) err.isImportedSessionExpired = true;
        throw err;
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
        await captureDomHashAndArtifacts(page, 'tasks_drawer');
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

        const pendingTask = findNextPendingTask(currentTasks, taskAttempts, maxAttemptsPerTask);

        if (!pendingTask) {
          logger.info('Todas as tarefas disponíveis foram concluídas ou verificadas.');
          break;
        }

        recordTaskAttempt(taskAttempts, pendingTask.title);
        totalActions++;

        const taskStartTime = new Date();
        logger.info(`\n--- Executando: "${pendingTask.title}" (${pendingTask.coins}) ---`);

        const currentTaskEl = await findTaskElement(page, pendingTask.title, pendingTask.index);
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
            markSpecialOrAppOnly(taskAttempts, pendingTask.title);
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
      const results = finalTasks.map((t) => ({
        title: t.title,
        status: classifyTaskStatus(t),
        coins: t.coins
      }));

      await closeContextWithDiagnostics(context, { failed: false, name: 'tasks-mobile' });

      let finalCoins = 'N/D';
      try {
        const desktopResult = await getBalanceDesktop(browser, sessionData || currentSessionPath, {
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
        userEmail,
        results,
        finalCoins,
        totalActions,
        startTime: tasksStartTime,
        endTime: tasksEndTime,
        duration: tasksDuration
      };

      if (!options.skipReport) {
        renderTasksReport(result, { json: isJson() });
      }
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

  (async () => {
    if (await handleDryRun()) {
      process.exit(0);
    }

    const { sendTelegram } = require('./libs/notify');
    let releaseLock = null;
    let cfg = null;
    try {
      cfg = loadConfig(true);
    } catch {
      // Ignorar se falhar antes do lock
    }

    try {
      releaseLock = await acquireLock(isForce());
    } catch (err) {
      if (err instanceof LockActiveError) {
        await sendTelegram({ config: cfg, event: 'lock_active', error: err }).catch(() => {});
        process.exit(3);
      }
      logger.error({ err: err.message }, 'Falha ao obter lock.');
      await sendTelegram({ config: cfg, event: 'failure', error: err }).catch(() => {});
      process.exit(1);
    }

    try {
      const result = await runTasks();
      if (releaseLock) await releaseLock();
      const report = { type: 'tasks', ...result };
      const event = result && result.totalActions === 0 ? 'already_collected' : 'success';
      await sendTelegram({ config: cfg, report, event }).catch(() => {});
      if (result && result.totalActions === 0) {
        process.exit(2);
      }
      process.exit(0);
    } catch (err) {
      if (releaseLock) await releaseLock();
      if (err.isImportedSessionExpired) {
        logger.error(
          '[Sessão Remota Expirada] Falha na execução de tarefas: a sessão importada expirou. Sugestão: gere uma nova sessão com "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
        );
      }
      logger.error({ err: err.message }, 'Falha na execução de tarefas.');
      await sendTelegram({ config: cfg, event: 'failure', error: err }).catch(() => {});
      process.exit(1);
    }
  })();
}

module.exports = { runTasks };
