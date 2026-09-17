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
  resetTaskAttempt,
  markSpecialOrAppOnly,
  classifyTaskStatus,
  findTaskElement,
  captureDomHashAndArtifacts,
  getRoundKey,
  recordRoundAttempt,
  withTimeout
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

  // Captura do saldo inicial antes das tarefas (se não recebido por parâmetro do check-in)
  let initialBalance = options.initialBalance !== undefined ? options.initialBalance : null;
  if (initialBalance === null && browser) {
    try {
      const earlyDesktop = await getBalanceDesktop(browser, sessionData || currentSessionPath, {
        allowMedia: config.ALLOW_MEDIA,
        timeout: config.NAV_TIMEOUT_SHORT
      });
      if (earlyDesktop.totalBalance && earlyDesktop.totalBalance !== 'N/D') {
        initialBalance = earlyDesktop.totalBalance;
      }
    } catch {
      // Ignorar falha na checagem inicial
    }
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
      const mobileCoinUrl =
        'https://m.aliexpress.com/p/coin-index/index.html?_immersiveMode=true&from=pc302';
      await gotoWithRetry(page, mobileCoinUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.NAV_TIMEOUT
      });
      await page.waitForLoadState('domcontentloaded');

      if (page.url().includes('coin-pc-index')) {
        await page.setViewportSize({ width: 412, height: 915 });
        await gotoWithRetry(page, mobileCoinUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.NAV_TIMEOUT_SHORT
        });
      }

      // Pré-aguardo de estabilização do DOM mobile
      await page
        .waitForSelector(
          'button[class*="aecoin-signButton"], [class*="signButtonWrapper"], #signButton, [class*="today-checked"], [class*="task"]',
          { timeout: 8000 }
        )
        .catch(() => {});

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
      const roundAttemptsMap = {};
      const failedTasks = {};
      const taskProgressMap = {};
      const taskStatusMap = {};
      const maxAttemptsPerTask = config.TASK_MAX_ATTEMPTS;
      const maxRoundAttempts = config.TASK_ROUND_MAX_ATTEMPTS || 3;
      const taskMaxDurationMs = config.TASK_MAX_DURATION_MS || 3 * 60 * 1000;
      let totalActions = 0;
      const MAX_TOTAL_ACTIONS = config.TASK_MAX_ACTIONS;

      while (totalActions < MAX_TOTAL_ACTIONS) {
        await openTaskDrawer(page);
        const currentTasks = await extractTasksFromDrawer(page);
        if (!currentTasks || currentTasks.length === 0) break;

        // Se uma tarefa progrediu de rodada ou status, reseta suas tentativas consecutivas
        for (const t of currentTasks) {
          if (t.completedRounds !== null && t.completedRounds !== undefined) {
            const prevRounds =
              taskProgressMap[t.title] !== undefined ? taskProgressMap[t.title] : -1;
            if (t.completedRounds > prevRounds) {
              if (prevRounds >= 0) {
                logger.info(
                  `Tarefa "${t.title}" avançou de rodada (${t.completedRounds}/${t.totalRounds}). Resetando tentativas.`
                );
                resetTaskAttempt(taskAttempts, t.title);
              }
              taskProgressMap[t.title] = t.completedRounds;
            }
          }
          if (t.statusText) {
            const prevStatus = taskStatusMap[t.title];
            if (prevStatus !== undefined && prevStatus !== t.statusText) {
              resetTaskAttempt(taskAttempts, t.title);
            }
            taskStatusMap[t.title] = t.statusText;
          }
        }

        const pendingTask = findNextPendingTask(currentTasks, taskAttempts, maxAttemptsPerTask, {
          roundAttemptsMap,
          maxRoundAttempts,
          failedTasks
        });

        if (!pendingTask) {
          logger.info('Todas as tarefas disponíveis foram concluídas ou verificadas.');
          break;
        }

        const roundKey = getRoundKey(pendingTask);
        recordTaskAttempt(taskAttempts, pendingTask.title);
        recordRoundAttempt(roundAttemptsMap, roundKey);
        totalActions++;

        const taskStartTime = new Date();
        const roundInfo = pendingTask.totalRounds
          ? ` [Rodada ${(pendingTask.completedRounds || 0) + 1}/${pendingTask.totalRounds}]`
          : '';
        logger.info(
          `\n--- Executando: "${pendingTask.title}" (${pendingTask.coins})${roundInfo} ---`
        );

        const currentTaskEl = await findTaskElement(page, pendingTask.title, pendingTask.index);
        if (!currentTaskEl) continue;

        const actionBtn = await currentTaskEl.$(SELECTORS.tasks.taskBtn);
        if (!actionBtn) continue;

        // Caso 1: Botão é de Resgate / Coleta (Claim / Collect / +moedas)
        if (pendingTask.isClaimable) {
          logger.info(
            `Resgatando recompensa da tarefa "${pendingTask.title}" (botão "${pendingTask.btnText}")...`
          );
          await page.evaluate((el) => el.click(), actionBtn).catch(() => {});
          await page.waitForTimeout(2000).catch(() => {});
          await closeModals(page).catch(() => {});
          resetTaskAttempt(taskAttempts, pendingTask.title);
          continue;
        }

        // Caso 2: Ação executável (GO / IR)
        newPageOpened = null;
        await page.evaluate((el) => el.click(), actionBtn).catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(1500).catch(() => {});

        const activePage = newPageOpened || page;
        const isNewTab = newPageOpened !== null;

        let actionTimedOut = false;
        try {
          await withTimeout(
            async () => {
              const actionRes = await executeTaskAction(activePage, context, pendingTask, config);
              if (actionRes && actionRes.isSpecialOrAppOnly) {
                markSpecialOrAppOnly(taskAttempts, pendingTask.title);
              }
            },
            taskMaxDurationMs,
            `Tempo limite da tarefa "${pendingTask.title}" excedido (${taskMaxDurationMs}ms)`
          );
        } catch (taskErr) {
          if (taskErr.code === 'TASK_TIMEOUT' || taskErr.message?.includes('Tempo limite')) {
            actionTimedOut = true;
            logger.warn(
              { task: pendingTask.title, timeoutMs: taskMaxDurationMs },
              `Tempo limite de execução atingido para "${pendingTask.title}". Abortando tentativa.`
            );
          } else {
            logger.error({ err: taskErr.message }, `Erro ao executar "${pendingTask.title}".`);
          }
        }

        if (actionTimedOut) {
          if (isNewTab) {
            await activePage.close().catch(() => {});
          } else if (page.goto) {
            // Cancela navegações órfãs/penduradas imediatamente e restaura coin-index
            await page
              .goto('https://m.aliexpress.com/p/coin-index/index.html', {
                waitUntil: 'commit',
                timeout: 10000
              })
              .catch(() => {});
          }
          await page.waitForTimeout(1000).catch(() => {});
          const taskEndTime = new Date();
          logger.info(
            `Ação abortada por timeout em: ${formatDuration(taskEndTime - taskStartTime)}`
          );
          continue;
        }

        if (isNewTab) {
          await activePage.close().catch(() => {});
        } else if (page.url && !page.url().includes('coin-index/index.html')) {
          await gotoWithRetry(page, 'https://m.aliexpress.com/p/coin-index/index.html', {
            waitUntil: 'domcontentloaded'
          }).catch(() => {});
        }
        // Aguarda sincronização do AliExpress e atualização do status da tarefa
        await page.waitForTimeout(2500).catch(() => {});

        const taskEndTime = new Date();
        logger.info(`Concluída ação em: ${formatDuration(taskEndTime - taskStartTime)}`);
      }

      await openTaskDrawer(page);
      const finalTasks = await extractTasksFromDrawer(page);
      const results = finalTasks.map((t) => ({
        title: t.title,
        status: failedTasks[t.title] || classifyTaskStatus(t, { failedTasks }),
        coins: t.coins,
        estimatedCoins: t.estimatedCoins || t.coins
      }));

      // Garante que tarefas que desistiram/falharam constem no relatório mesmo se ausentes da gaveta
      for (const [failedTitle, reason] of Object.entries(failedTasks)) {
        if (!results.some((r) => r.title === failedTitle)) {
          results.push({
            title: failedTitle,
            status: reason,
            coins: '+0 moedas',
            estimatedCoins: '+0 moedas'
          });
        }
      }

      await closeContextWithDiagnostics(context, { failed: false, name: 'tasks-mobile' });

      let finalBalance = 'N/D';
      let finalCoins = 'N/D';
      try {
        const desktopResult = await getBalanceDesktop(browser, sessionData || currentSessionPath, {
          allowMedia: config.ALLOW_MEDIA,
          timeout: config.NAV_TIMEOUT_SHORT
        });
        if (desktopResult.totalBalance && desktopResult.totalBalance !== 'N/D') {
          finalBalance = desktopResult.totalBalance;
          finalCoins = `${desktopResult.totalBalance} moedas`;
        }
      } catch {
        // Ignorar
      }

      // Cálculo determinístico do ganho real pelas tarefas por diferença de saldo
      const initNum =
        initialBalance !== null && initialBalance !== 'N/D'
          ? parseInt(String(initialBalance).replace(/[^0-9]/g, ''), 10)
          : NaN;
      const finalNum =
        finalBalance !== 'N/D' ? parseInt(String(finalBalance).replace(/[^0-9]/g, ''), 10) : NaN;

      let coinsGained = 0;
      if (!isNaN(initNum) && !isNaN(finalNum)) {
        coinsGained = Math.max(0, finalNum - initNum);
      }

      const tasksEndTime = new Date();
      const tasksDuration = formatDuration(tasksEndTime - tasksStartTime);

      const result = {
        userEmail,
        results,
        initialBalance: !isNaN(initNum) ? initNum : initialBalance || 'N/D',
        finalBalance: !isNaN(finalNum) ? finalNum : finalBalance,
        finalCoins,
        coinsGained,
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
