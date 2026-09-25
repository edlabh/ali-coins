const {
  loadConfig,
  sessionPath,
  handleDryRun,
  isForce,
  isJson,
  checkAndDisplayHelp,
  maskUser
} = require('./config');
const { formatDateTime, formatDuration, pickPauseMs } = require('./time_utils');
const { launchBrowser, newMobileContext, closeContextWithDiagnostics } = require('./browser');
const { acquireLock, LockActiveError } = require('./lockfile');
const { flushAndExit } = require('./libs/exit');
const { validateAndRefresh } = require('./libs/session');
const { SELECTORS } = require('./libs/selectors');
const {
  gotoWithRetry,
  closeModals,
  getBalanceDesktop,
  closeCachedDesktopContext,
  shouldReuseDesktopContext,
  openTaskDrawer,
  executeTaskAction,
  isInteractiveOrAppOnly,
  APP_ONLY_DISABLED_STATUS,
  selectReopenableTasks,
  findNextPendingTask,
  recordTaskAttempt,
  resetTaskAttempt,
  markSpecialOrAppOnly,
  classifyTaskStatus,
  findTaskElement,
  captureDomHashAndArtifacts,
  getRoundKey,
  recordRoundAttempt,
  withTimeout,
  ensureMainPage: ensureMainPageFn,
  getDrawerTasksWithRetry: getDrawerTasksWithRetryFn
} = require('./libs/ui');
const { renderTasksReport } = require('./libs/report');
const { version: APP_VERSION } = require('./package.json');
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
  logger.info(`[Versão] ali-coins v${APP_VERSION}`);
  logger.info(`[Login] Usuário: ${maskUser(userEmail)}`);

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

  logger.info(`[Login] Sessão validada para: ${maskUser(userEmail)}`);

  let browser = options.browser;
  const isInternalBrowser = !browser;

  if (isInternalBrowser) {
    browser = await launchBrowser({ headless: config.HEADLESS });
    if (typeof options.onBrowserLaunch === 'function') {
      try {
        options.onBrowserLaunch(browser);
      } catch {}
    }
  }

  // Captura do saldo inicial antes das tarefas (se não recebido por parâmetro do check-in)
  let initialBalance = options.initialBalance !== undefined ? options.initialBalance : null;
  if (initialBalance === null && browser) {
    try {
      const earlyDesktop = await getBalanceDesktop(browser, sessionData || currentSessionPath, {
        allowMedia: config.ALLOW_MEDIA,
        timeout: config.NAV_TIMEOUT_SHORT,
        reuseContext: shouldReuseDesktopContext()
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

    const mobileCoinUrl =
      'https://m.aliexpress.com/p/coin-index/index.html?_immersiveMode=true&from=pc302';

    let page = await context.newPage();
    let newPageOpened = null;
    let isRecreatingPage = false;
    const openedPages = new Set();
    const onNewPage = (p) => {
      if (!isRecreatingPage && p !== page) {
        openedPages.add(p);
        newPageOpened = p;
      }
    };
    context.on('page', onNewPage);

    // Fecha abas/popups abertos por tarefas (evita acúmulo de RAM/timers durante o run).
    const closeOrphanPages = async () => {
      for (const p of openedPages) {
        if (p !== page && p.isClosed && !p.isClosed()) {
          await p.close().catch(() => {});
        }
      }
      openedPages.clear();
    };

    async function ensureMainPage(currentPage) {
      isRecreatingPage = true;
      try {
        const checkedPage = await ensureMainPageFn({
          page: currentPage,
          context,
          mobileCoinUrl,
          config,
          logger,
          gotoFn: (p, url, opts) => gotoWithRetry(p, url, opts)
        });
        page = checkedPage;
        return page;
      } finally {
        isRecreatingPage = false;
      }
    }

    try {
      logger.info('Acessando central de moedas...');
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

      const loginInput = await page.$(SELECTORS.login.usernameInput).catch(() => null);
      const bodyText = await page.innerText('body').catch(() => '');
      const loginUrl = /login|sign-?in|passport/i.test(page.url());
      // Tanto o campo de login quanto os indícios textuais só contam em página de
      // login/passport: um input da própria página de moedas com sessão válida não
      // deve derrubar a etapa de tarefas.
      if (
        (loginUrl && loginInput !== null) ||
        (loginUrl &&
          (bodyText.includes('Email or phone number') ||
            bodyText.includes('Sign in') ||
            bodyText.includes('Entrar')))
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
      const touchedCards = new Set();
      const maxAttemptsPerTask = config.TASK_MAX_ATTEMPTS;
      const maxRoundAttempts = config.TASK_ROUND_MAX_ATTEMPTS || 3;
      const taskMaxDurationMs = config.TASK_MAX_DURATION_MS || 3 * 60 * 1000;
      const skipAppOnlyTasks = config.SKIP_APP_ONLY_TASKS !== false;
      const disabledAppOnlyLogged = new Set();
      let totalActions = 0;
      const MAX_TOTAL_ACTIONS = config.TASK_MAX_ACTIONS;

      // Segunda passada (opt-in): passadas extras focadas APENAS em tarefas que não
      // concluíram nenhuma rodada ou concluíram parcialmente.
      const retryUnfinished = config.TASK_RETRY_UNFINISHED === true;
      const maxRetryPasses = retryUnfinished ? Math.max(0, config.TASK_RETRY_PASSES ?? 1) : 0;
      const retryDelayMs = config.TASK_RETRY_DELAY_MS ?? 5000;
      const pauseMinMs = config.TASK_PAUSE_MIN_MS ?? 0;
      const pauseMaxMs = config.TASK_PAUSE_MAX_MS ?? 0;
      // Títulos que esgotaram as rodadas/tentativas anteriormente; só estes podem ser
      // "reabertos" na passada extra (evita reprocessar tarefas já concluídas).
      const exhaustedTitles = new Set();

      if (skipAppOnlyTasks) {
        logger.warn(
          'Verificação das tarefas exclusivas do app DESLIGADA (SKIP_APP_ONLY_TASKS=true): Prize Land/regar, minigames, quizzes e avaliações serão ignorados.'
        );
      }
      if (retryUnfinished) {
        logger.warn(
          `Segunda passada ATIVADA (TASK_RETRY_UNFINISHED=true): até ${maxRetryPasses} passada(s) extra(s) apenas para tarefas incompletas.`
        );
      }

      // Fonte única em libs/tasks/verifier.js (via fachada libs/ui) — sem duplicação local
      const getDrawerTasksWithRetry = (currentPage, { maxRetries = 2, label = 'execução' } = {}) =>
        getDrawerTasksWithRetryFn({
          page: currentPage,
          context,
          maxRetries,
          label,
          config,
          logger,
          ensureMainPageFn: ensureMainPage
        });

      for (let pass = 0; pass <= maxRetryPasses; pass++) {
        if (pass > 0) {
          // Reabre SOMENTE as tarefas que ficaram incompletas/falharam na passada anterior.
          // Concluídas (isDone) e tarefas do app desativadas nunca são reabertas.
          const reopened = [];
          for (const title of exhaustedTitles) {
            if (failedTasks[title] === APP_ONLY_DISABLED_STATUS) continue;
            delete failedTasks[title];
            taskAttempts[title] = 0;
            const roundKey = getRoundKey({ title, statusText: taskStatusMap[title] });
            if (roundKey) roundAttemptsMap[roundKey] = 0;
            reopened.push(title);
          }
          exhaustedTitles.clear();

          if (reopened.length === 0) {
            logger.info('Segunda passada: nenhuma tarefa incompleta para reabrir. Encerrando.');
            break;
          }
          logger.info(
            `Segunda passada ${pass}/${maxRetryPasses}: reabrindo ${reopened.length} tarefa(s) incompleta(s): ${reopened.join(' | ')}`
          );
          if (retryDelayMs > 0) {
            logger.info(`Aguardando ${retryDelayMs}ms antes da passada extra...`);
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }

        // Mantém a última extração de tarefas no escopo externo ao `while` para a
        // reabertura de passada (o destructuring declara `currentTasks` dentro do laço).
        let lastExtractedTasks = [];

        while (totalActions < MAX_TOTAL_ACTIONS) {
          const {
            page: refreshedPage,
            tasks: currentTasks,
            error: extractErr
          } = await getDrawerTasksWithRetry(page, {
            maxRetries: 2,
            label: pass > 0 ? `segunda passada ${pass}` : 'loop de tarefas'
          });
          page = refreshedPage;
          lastExtractedTasks = currentTasks || [];

          if (extractErr) {
            logger.error(
              { err: extractErr.message },
              'Falha persistente ao ler painel de tarefas no loop. Encerrando etapa para evitar loop infinito.'
            );
            break;
          }

          if (!currentTasks || currentTasks.length === 0) {
            logger.info(
              'Nenhuma tarefa pendente encontrada no painel. Etapa concluída com sucesso.'
            );
            break;
          }

          if (skipAppOnlyTasks) {
            for (const t of currentTasks) {
              if (
                t &&
                !t.isDone &&
                !disabledAppOnlyLogged.has(t.title) &&
                isInteractiveOrAppOnly(t)
              ) {
                disabledAppOnlyLogged.add(t.title);
                logger.warn(
                  `Tarefa "${t.title}" exige o app e está desativada (SKIP_APP_ONLY_TASKS=true). Ignorando.`
                );
              }
            }
          }

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
            failedTasks,
            skipAppOnlyTasks
          });

          if (!pendingTask) {
            logger.info('Todas as tarefas disponíveis foram concluídas ou verificadas.');
            break;
          }

          // Pausa aleatória ANTES da tarefa (padrão desligada). Ocorre só quando há tarefa a executar,
          // então não há pausa "sobrando" no fim; cobre também o intervalo check-in -> 1ª tarefa.
          const pauseMs = pickPauseMs(pauseMinMs, pauseMaxMs);
          if (pauseMs > 0) {
            logger.info(`Pausa de ${Math.round(pauseMs / 1000)}s antes da próxima tarefa.`);
            await new Promise((resolve) => setTimeout(resolve, pauseMs));
          }

          const roundKey = getRoundKey(pendingTask);
          // Tentativa/rodada são contadas AQUI (garantem a terminação do loop: a tarefa
          // é excluída após maxAttempts mesmo se o elemento nunca for encontrado).
          recordTaskAttempt(taskAttempts, pendingTask.title);
          recordRoundAttempt(roundAttemptsMap, roundKey);

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

          // Só conta "ação executada" com elemento E botão localizados: antes, itens sem
          // elemento consumiam o teto global de 25 e inflavam a métrica de tarefas.
          totalActions++;

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
          // Timeout explícito: o default do Playwright (30s) ficava FORA do teto por
          // tentativa (TASK_MAX_DURATION_MS) e podia estourar o orçamento global.
          await page
            .waitForLoadState('domcontentloaded', { timeout: config.NAV_TIMEOUT_SHORT })
            .catch(() => {});
          await page.waitForTimeout(1500).catch(() => {});

          const activePage =
            newPageOpened &&
            typeof newPageOpened.isClosed === 'function' &&
            !newPageOpened.isClosed()
              ? newPageOpened
              : page;
          const isNewTab = activePage !== page;

          let actionTimedOut = false;
          try {
            await withTimeout(
              async (signal) => {
                const actionRes = await executeTaskAction({
                  page: activePage,
                  context,
                  task: {
                    ...pendingTask,
                    attempt: taskAttempts[pendingTask.title] || 1
                  },
                  config,
                  signal,
                  touchedCards
                });
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
            if (isNewTab && activePage && typeof activePage.close === 'function') {
              await activePage.close().catch(() => {});
            }
            await closeOrphanPages();
            page = await ensureMainPage(page);
            if (typeof page.waitForTimeout === 'function') {
              await page.waitForTimeout(1000).catch(() => {});
            }
            const taskEndTime = new Date();
            logger.info(
              `Ação abortada por timeout em: ${formatDuration(taskEndTime - taskStartTime)}`
            );
            continue;
          }

          if (isNewTab && activePage && typeof activePage.close === 'function') {
            await activePage.close().catch(() => {});
          }
          await closeOrphanPages();
          page = await ensureMainPage(page);
          // Aguarda sincronização do AliExpress e atualização do status da tarefa
          if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(2500).catch(() => {});
          }

          const taskEndTime = new Date();
          logger.info(`Concluída ação em: ${formatDuration(taskEndTime - taskStartTime)}`);
        }

        // Fim do loop interno. Registra as tarefas esgotadas nesta passada para eventual
        // reabertura na passada extra (apenas incompletas/falhas, nunca concluídas/app-only).
        if (retryUnfinished && pass < maxRetryPasses) {
          for (const title of selectReopenableTasks({ failedTasks, tasks: lastExtractedTasks })) {
            exhaustedTitles.add(title);
          }
        }

        const loopStalled = totalActions >= MAX_TOTAL_ACTIONS;
        if (loopStalled) {
          logger.warn(
            'Teto global de ações atingido; encerrando novas passadas para não estourar o tempo.'
          );
          break;
        }
      }

      const {
        page: finalPage,
        tasks: finalTasks,
        error: finalExtractErr
      } = await getDrawerTasksWithRetry(page, {
        maxRetries: 2,
        label: 'relatório final'
      });
      page = finalPage;

      if (finalExtractErr) {
        logger.error(
          { err: finalExtractErr.message },
          'Aviso: falha na extração final de tarefas para o relatório.'
        );
      }
      const results = finalTasks.map((t) => ({
        title: t.title,
        status: failedTasks[t.title] || classifyTaskStatus(t, { failedTasks, skipAppOnlyTasks }),
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

      if (typeof context.off === 'function') context.off('page', onNewPage);
      await closeContextWithDiagnostics(context, { failed: false, name: 'tasks-mobile' });

      let finalBalance = 'N/D';
      let finalCoins = 'N/D';
      let missionsCoinsFromLedger = null;
      try {
        const desktopResult = await getBalanceDesktop(browser, sessionData || currentSessionPath, {
          allowMedia: config.ALLOW_MEDIA,
          timeout: config.NAV_TIMEOUT_SHORT,
          reuseContext: shouldReuseDesktopContext()
        });
        if (desktopResult.totalBalance && desktopResult.totalBalance !== 'N/D') {
          finalBalance = desktopResult.totalBalance;
          finalCoins = `${desktopResult.totalBalance} moedas`;
        }
        // Fonte de verdade do ganho das tarefas: soma dos lançamentos "Missões de moedas"
        // de hoje no extrato. Evita que o bônus do check-in (crédito separado) contamine o
        // ganho das tarefas medido por diferença de saldo.
        if (
          typeof desktopResult.todayMissionsCoins === 'number' &&
          desktopResult.todayMissionsCount > 0
        ) {
          missionsCoinsFromLedger = desktopResult.todayMissionsCoins;
        }
      } catch (err) {
        // Leitura do extrato falhou: o ganho das tarefas cai no fallback por diferença de
        // saldo; registra para o operador saber que o valor não veio da fonte de verdade.
        logger.warn(
          { err: err.message },
          'Falha ao ler o extrato desktop no fim das tarefas; usando fallback de saldo.'
        );
      }
      // diferença de saldo apenas quando o extrato não trouxer lançamentos de tarefas.
      const initNum =
        initialBalance !== null && initialBalance !== 'N/D'
          ? parseInt(String(initialBalance).replace(/[^0-9]/g, ''), 10)
          : NaN;
      const finalNum =
        finalBalance !== 'N/D' ? parseInt(String(finalBalance).replace(/[^0-9]/g, ''), 10) : NaN;

      let coinsGained = 0;
      if (missionsCoinsFromLedger !== null) {
        coinsGained = missionsCoinsFromLedger;
      } else if (!isNaN(initNum) && !isNaN(finalNum)) {
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
        // Indica que `coinsGained` veio do extrato ("Missões de moedas") e já está isolado
        // do check-in; nesse caso o relatório não deve descontar nada.
        coinsFromLedger: missionsCoinsFromLedger !== null,
        totalActions,
        // Motivos de falha por tarefa (usado pelo CLI standalone para não reportar
        // "sem ação" quando houve falhas reais).
        failedTasks,
        startTime: tasksStartTime,
        endTime: tasksEndTime,
        duration: tasksDuration
      };

      if (!options.skipReport) {
        renderTasksReport(result, { json: isJson() });
      }
      return result;
    } catch (flowErr) {
      if (context && typeof context.off === 'function') context.off('page', onNewPage);
      await closeContextWithDiagnostics(context, { failed: true, name: 'tasks-failed' });
      throw flowErr;
    }
  } finally {
    // No fluxo integrado o contexto desktop é mantido vivo através das etapas da conta;
    // all.js fecha ao terminar cada conta. No standalone, fechamos aqui.
    if (isInternalBrowser) {
      await closeCachedDesktopContext().catch(() => {});
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}

if (require.main === module) {
  const { setupGlobalCrashHandler } = require('./libs/crash');
  let cfg = null;
  setupGlobalCrashHandler(() => ({ config: cfg, scriptName: 'do_tasks.js' }));

  if (checkAndDisplayHelp()) {
    void flushAndExit(0);
    return;
  }

  let activeBrowser = null;
  let releaseLock = null;
  let gracefulExitRef = null;

  // Encerramento por sinal em modo standalone: fecha o browser antes de liberar o lock,
  // prevenindo processos Chromium órfãos na memória se interrompido via SIGINT/SIGTERM.
  const handleShutdownSignal = (signal) => {
    logger.warn({ signal }, 'Sinal recebido em do_tasks.js; fechando browser e liberando lock...');
    if (typeof gracefulExitRef === 'function') {
      void gracefulExitRef(1);
      return;
    }
    try {
      process.kill(process.pid, signal);
    } catch {
      process.exit(1);
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => handleShutdownSignal(signal));
  }

  (async () => {
    if (await handleDryRun()) {
      await flushAndExit(0);
    }

    const { sendTelegram } = require('./libs/notify');
    try {
      cfg = loadConfig(true);
    } catch {
      // Ignorar se falhar antes do lock
    }

    gracefulExitRef = async (exitCode = 1) => {
      gracefulExitRef = null;
      if (activeBrowser) {
        await Promise.race([
          activeBrowser.close().catch(() => {}),
          new Promise((resolve) => {
            const timer = setTimeout(resolve, 3000);
            if (timer.unref) timer.unref();
          })
        ]);
        activeBrowser = null;
      }
      if (releaseLock) {
        await releaseLock().catch(() => {});
        releaseLock = null;
      }
      await flushAndExit(exitCode);
    };

    try {
      releaseLock = await acquireLock(isForce());
    } catch (err) {
      gracefulExitRef = null;
      if (err instanceof LockActiveError) {
        await sendTelegram({ config: cfg, event: 'lock_active', error: err }).catch(() => {});
        await flushAndExit(3);
      }
      logger.error({ err: err.message }, 'Falha ao obter lock.');
      await sendTelegram({ config: cfg, event: 'failure', error: err }).catch(() => {});
      await flushAndExit(1);
    }

    try {
      const result = await runTasks({
        onBrowserLaunch: (b) => {
          activeBrowser = b;
        }
      });
      activeBrowser = null;
      gracefulExitRef = null;
      if (releaseLock) await releaseLock();
      const report = { type: 'tasks', ...result };
      const failedCount = Object.values(result?.failedTasks || {}).filter(
        (reason) => reason !== APP_ONLY_DISABLED_STATUS
      ).length;
      const hadActions = Boolean(result && result.totalActions > 0);
      // Sem ações pode significar "nada pendente" (exit 2) ou falhas reais (exit 1, para
      // o run_all.sh retentar e o dead man's switch enxergar).
      const event = !hadActions ? (failedCount > 0 ? 'failure' : 'already_collected') : 'success';
      await sendTelegram({ config: cfg, report, event }).catch(() => {});
      if (!hadActions) {
        await flushAndExit(failedCount > 0 ? 1 : 2);
      }
      await flushAndExit(0);
    } catch (err) {
      activeBrowser = null;
      gracefulExitRef = null;
      if (releaseLock) await releaseLock();
      if (err.name === 'TwoFactorRequiredNonInteractive' || err.is2FARequired) {
        logger.error(
          '[2FA Não-Interativo] O AliExpress exigiu verificação de código 2FA durante execução sem terminal interativo (cron/CI). ' +
            'Solução: execute localmente com "./run_all.sh", resolva o 2FA e use "node export_session.js" / "node import_session.js".'
        );
        await sendTelegram({ config: cfg, event: '2fa_required', error: err }).catch(() => {});
        await flushAndExit(5);
      }
      if (err.isImportedSessionExpired) {
        logger.error(
          '[Sessão Remota Expirada] Falha na execução de tarefas: a sessão importada expirou. Sugestão: gere uma nova sessão com "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
        );
      }
      logger.error({ err: err.message }, 'Falha na execução de tarefas.');
      await sendTelegram({ config: cfg, event: 'failure', error: err }).catch(() => {});
      await flushAndExit(1);
    }
  })().catch(async (err) => {
    // Erros fora do try principal (ex: loadConfig inválido em --dry-run) não devem
    // escalar para o crash handler (exit 6); são falha crítica de execução (exit 1).
    logger.error({ err: err.message }, 'Falha inesperada na execução de tarefas.');
    await flushAndExit(1);
  });
}

module.exports = {
  runTasks,
  ensureMainPage: ensureMainPageFn,
  getDrawerTasksWithRetry: getDrawerTasksWithRetryFn
};
