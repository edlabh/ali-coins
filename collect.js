const {
  loadConfig,
  sessionPath,
  sessionMetaPath,
  handleDryRun,
  isForce,
  isJson,
  checkAndDisplayHelp
} = require('./config');
const { formatDateTime, formatDuration } = require('./time_utils');
const { launchBrowser, newMobileContext, closeContextWithDiagnostics } = require('./browser');
const { acquireLock, LockActiveError } = require('./lockfile');
const {
  validateAndRefresh,
  saveSession,
  clearSession,
  updateSessionStreak
} = require('./libs/session');
const { SELECTORS } = require('./libs/selectors');
const {
  gotoWithRetry,
  closeModals,
  performMobileLogin,
  getStreakFromCoinPage,
  getBalanceDesktop
} = require('./libs/ui');
const { renderCheckinReport } = require('./libs/report');
const logger = require('./logger');

/**
 * Executa o fluxo completo de check-in diário de moedas do AliExpress
 * @param {object} [options={}]
 * @param {import('playwright').Browser} [options.browser] Instância compartilhada de navegador
 * @param {object} [options.sessionData] Dados de sessão em cache
 * @returns {Promise<object>}
 */
async function runCheckin(options = {}) {
  const checkinStartTime = new Date();
  const config = options.config || loadConfig(true);
  const account = options.account || null;
  const userEmail = (account && account.user) || options.userEmail || config.ALI_USER;
  const currentSessionPath = (account && account.sessionPath) || options.sessionPath || sessionPath;
  const currentSessionMetaPath =
    (account && account.sessionMetaPath) || options.sessionMetaPath || sessionMetaPath;
  const sessionOpts = {
    sessionPath: currentSessionPath,
    sessionMetaPath: currentSessionMetaPath,
    account
  };

  logger.info('================ CHECK-IN DIÁRIO ================');
  logger.info(`[Dia e Hora]: ${formatDateTime(checkinStartTime)}`);
  logger.info(`[Login] Usuário: ${userEmail}`);

  let browser = options.browser;
  const isInternalBrowser = !browser;

  if (isInternalBrowser) {
    browser = await launchBrowser({ headless: config.HEADLESS });
  }

  let wasAlreadyCollectedToday = false;
  let sessionData = options.sessionData || null;

  try {
    // 1. Carregar e validar sessão existente
    const sessionStatus = await validateAndRefresh(userEmail, sessionData, sessionOpts);
    const hasValidSession = sessionStatus.valid;
    const isImportedSession = Boolean(sessionStatus.isImported);
    sessionData = sessionStatus.sessionData;
    const previousStreakDays =
      sessionStatus.metaData?.lastStreakDays ?? sessionStatus.previousMeta?.lastStreakDays ?? null;

    // 2. Checagem prévia rápida no desktop se já foi coletado hoje
    let earlyDesktopStreak = null;
    if (hasValidSession) {
      try {
        const desktopCheck = await getBalanceDesktop(browser, sessionData || currentSessionPath, {
          allowMedia: config.ALLOW_MEDIA,
          timeout: config.NAV_TIMEOUT_SHORT
        });
        if (desktopCheck.hasAppCheckinToday) {
          wasAlreadyCollectedToday = true;
        }
        if (desktopCheck.desktopStreak !== null && desktopCheck.desktopStreak !== undefined) {
          earlyDesktopStreak = desktopCheck.desktopStreak;
        }
      } catch (checkErr) {
        logger.debug({ err: checkErr.message }, 'Checagem prévia de desktop ignorada.');
      }
    }

    // 3. Inicializar contexto mobile
    const context = await newMobileContext(
      browser,
      hasValidSession ? sessionData || currentSessionPath : null,
      {
        allowMedia: config.ALLOW_MEDIA
      }
    );
    const page = await context.newPage();
    let attemptedLogin = false;

    try {
      if (hasValidSession) {
        await gotoWithRetry(page, SELECTORS.desktop.mycoinUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.NAV_TIMEOUT_SHORT
        }).catch(() => {});
        await page.waitForLoadState('domcontentloaded');
      }

      await gotoWithRetry(page, 'https://m.aliexpress.com/p/coin-index/index.html', {
        waitUntil: 'domcontentloaded',
        timeout: config.NAV_TIMEOUT
      });

      if (!hasValidSession) {
        // Se não possui sessão prévia válida, aguarda pelo formulário de login
        await page
          .waitForSelector(SELECTORS.login.usernameInput, { timeout: config.SELECTOR_TIMEOUT })
          .catch(() => {});
      } else {
        await page
          .waitForSelector(
            'input.cosmos-input, input[type="text"], input[type="email"], #signButton, [class*="today-checked"], [class*="dayNumber"], button:has-text("Collect"), button:has-text("Coletar")',
            { timeout: config.SELECTOR_TIMEOUT }
          )
          .catch(() => {});
      }

      if (page.url().includes('coin-pc-index')) {
        await page.setViewportSize({ width: 412, height: 915 });
        await gotoWithRetry(page, 'https://m.aliexpress.com/p/coin-index/index.html', {
          waitUntil: 'domcontentloaded',
          timeout: config.NAV_TIMEOUT_SHORT
        });
      }

      // Verificar se precisa autenticar
      let loginInput = await page.$(SELECTORS.login.usernameInput);
      const bodyText = await page.innerText('body').catch(() => '');
      const needsLogin =
        !hasValidSession ||
        loginInput !== null ||
        bodyText.includes('Email or phone number') ||
        bodyText.includes('Sign in') ||
        bodyText.includes('Entrar');

      if (needsLogin) {
        attemptedLogin = true;
        if (isImportedSession) {
          logger.warn(
            '[Sessão Remota] Autenticação necessária com sessão importada. Em servidores remotos (VPS/nuvem), desafios de segurança anti-bot podem impedir o login automático.'
          );
        }
        try {
          sessionData = await performMobileLogin(page, context, config, sessionOpts);
        } catch (loginErr) {
          if (isImportedSession) {
            logger.error(
              '[Sessão Remota Expirada] Falha ao autenticar no AliExpress. A sessão importada de outro host expirou ou foi invalidada. ' +
                'Gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
            );
            loginErr.isImportedSessionExpired = true;
          }
          throw loginErr;
        }

        // Aguardar o redirecionamento pós-login concluir e assegurar navegação para o coin-index
        await page.waitForURL(/coin-index/, { timeout: config.NAV_TIMEOUT_SHORT }).catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});

        if (!page.url().includes('coin-index')) {
          await gotoWithRetry(page, 'https://m.aliexpress.com/p/coin-index/index.html', {
            waitUntil: 'domcontentloaded',
            timeout: config.NAV_TIMEOUT
          }).catch(() => {});
          await page.waitForLoadState('networkidle').catch(() => {});
        }
      }

      await page
        .waitForFunction(() => !document.querySelector('.login-pending-container'), {
          timeout: config.NAV_TIMEOUT_SHORT
        })
        .catch(() => {});

      // 4. Checagem e coleta do check-in
      const isCheckedInitial = await page
        .evaluate(() => {
          const text = (document.body && document.body.innerText) || '';
          return (
            Boolean(
              document.querySelector('[class*="today-checked"], [class*="aecoin-today-checked"]')
            ) || /Today[\s\S]{0,15}✓/i.test(text)
          );
        })
        .catch(() => false);

      let alreadyCollected = isCheckedInitial || wasAlreadyCollectedToday;
      let justCollected = false;
      let mobileStreak = null;

      if (!alreadyCollected) {
        for (const sel of SELECTORS.checkin.collectButtonList) {
          try {
            const el = await page.$(sel);
            if (el) {
              logger.info('Realizando check-in diário...');
              await page.evaluate((target) => target.click(), el);
              await page
                .waitForSelector(
                  '[class*="today-checked"], [class*="aecoin-today-checked"], .e2e_normal_task_right_btn',
                  { timeout: 2000 }
                )
                .catch(() => {});
              await page.waitForTimeout(800);
              justCollected = true;
              break;
            }
          } catch {
            // Próximo seletor
          }
        }
      }

      // Tentar capturar o streak imediatamente (modal de sucesso ainda visível se houve clique)
      mobileStreak = await getStreakFromCoinPage(page);

      await closeModals(page);

      // Se ainda não capturou, tenta novamente após fechar os modais
      if (mobileStreak === null) {
        mobileStreak = await getStreakFromCoinPage(page);
      }

      // Coletar água da Fazenda Mágica se visível
      try {
        const waterBtn = await page.$(SELECTORS.checkin.waterBtn);
        if (waterBtn) {
          logger.info('Coletando água da Fazenda Mágica...');
          await page.evaluate((el) => el.click(), waterBtn);
          await page.waitForTimeout(1000);
        }
      } catch {
        // Ignorar
      }

      // Se ainda não capturou, faz tentativa final antes de fechar o contexto mobile
      if (mobileStreak === null) {
        mobileStreak = await getStreakFromCoinPage(page);
      }

      try {
        const updatedStorage = await context.storageState();
        sessionData = updatedStorage;
        await saveSession(updatedStorage, userEmail, sessionOpts);
      } catch {
        // Ignorar
      }

      await closeContextWithDiagnostics(context, { failed: false, name: 'checkin-mobile' });

      // 5. Confirmar resultado e saldo no desktop
      const desktopResult = await getBalanceDesktop(browser, sessionData || currentSessionPath, {
        allowMedia: config.ALLOW_MEDIA,
        timeout: config.NAV_TIMEOUT_SHORT
      });

      if (desktopResult.hasAppCheckinToday) {
        wasAlreadyCollectedToday = true;
      }

      const totalBalance = desktopResult.totalBalance;
      const isCollected = alreadyCollected || wasAlreadyCollectedToday || justCollected;
      const coinsGainedToday = desktopResult.todayCheckinCoins
        ? desktopResult.todayCheckinCoins
        : isCollected
          ? 'N/D'
          : '0';

      let detectedStreak =
        mobileStreak !== null && mobileStreak !== 'N/D'
          ? mobileStreak
          : desktopResult.desktopStreak !== null && desktopResult.desktopStreak !== 'N/D'
            ? desktopResult.desktopStreak
            : earlyDesktopStreak !== null && earlyDesktopStreak !== 'N/D'
              ? earlyDesktopStreak
              : null;

      let streakDays = detectedStreak !== null ? detectedStreak : 'N/D';

      // Proteção contra regressão espúria de streak (ex: leitura 7 do ciclo semanal quando previousStreakDays é 212)
      if (typeof previousStreakDays === 'number' && previousStreakDays > 0) {
        const parsedDetected =
          typeof detectedStreak === 'number'
            ? detectedStreak
            : parseInt(String(detectedStreak).replace(/[^0-9]/g, ''), 10);

        const isSpuriousWeeklyCycle =
          !isNaN(parsedDetected) &&
          previousStreakDays > 7 &&
          parsedDetected <= 7 &&
          parsedDetected > 1;

        if (detectedStreak === null || isNaN(parsedDetected) || isSpuriousWeeklyCycle) {
          if (alreadyCollected || wasAlreadyCollectedToday) {
            logger.info(
              { detectedStreak, previousStreak: previousStreakDays },
              'Streak detectado na tela é espúrio (<= 7) ou ausente em re-execução. Preservando streak real da sessão.'
            );
            streakDays = previousStreakDays;
          } else if (justCollected) {
            logger.info(
              { detectedStreak, previousStreak: previousStreakDays },
              'Check-in realizado com sucesso hoje, mas o streak lido na tela é espúrio (<= 7). Incrementando streak anterior.'
            );
            streakDays = previousStreakDays + 1;
          } else {
            streakDays = previousStreakDays;
          }
        } else if (
          (alreadyCollected || wasAlreadyCollectedToday) &&
          parsedDetected < previousStreakDays
        ) {
          logger.info(
            { detectedStreak, previousStreak: previousStreakDays },
            'Re-execução com streak detectado menor que o da sessão. Preservando streak anterior.'
          );
          streakDays = previousStreakDays;
        }
      }

      const hasStreak = streakDays !== 'N/D' && streakDays !== null;
      const hasTotalBalance = totalBalance !== 'N/D' && totalBalance !== null;
      const hasCheckinCoins =
        desktopResult.todayCheckinCoins !== null || (isCollected && coinsGainedToday !== '0');

      if (
        (!hasStreak && !hasTotalBalance && !hasCheckinCoins) ||
        (attemptedLogin && !hasStreak && !hasTotalBalance)
      ) {
        if (isImportedSession) {
          logger.error(
            '[Sessão Remota Expirada] Não foi possível obter streak e saldo. A sessão importada de outro host expirou ou foi invalidada pelo AliExpress. ' +
              'Gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
          );
        }
        logger.error(
          { user: userEmail, streakDays, totalBalance, coinsGainedToday },
          'Erro ao efetuar o login: não foi possível obter streak e saldo.'
        );
        await clearSession(sessionOpts);
        const loginErr = new Error(
          `Erro ao efetuar o login: não foi possível obter streak e saldo para a conta "${userEmail}".`
        );
        if (isImportedSession) {
          loginErr.isImportedSessionExpired = true;
        }
        throw loginErr;
      }

      if (streakDays !== 'N/D' && streakDays !== null) {
        const numStreak =
          typeof streakDays === 'number'
            ? streakDays
            : parseInt(String(streakDays).replace(/[^0-9]/g, ''), 10);
        if (
          typeof previousStreakDays !== 'number' ||
          previousStreakDays <= 7 ||
          numStreak > 7 ||
          numStreak === 1
        ) {
          await updateSessionStreak(streakDays, sessionOpts);
        }
      }

      const checkinEndTime = new Date();
      const checkinDuration = formatDuration(checkinEndTime - checkinStartTime);

      const result = {
        userEmail,
        alreadyCollected: (isCheckedInitial || wasAlreadyCollectedToday) && !justCollected,
        coinsGainedToday,
        totalBalance,
        streakDays,
        previousStreakDays,
        startTime: checkinStartTime,
        endTime: checkinEndTime,
        duration: checkinDuration,
        sessionData
      };

      if (!options.skipReport) {
        renderCheckinReport(result, { json: isJson() });
      }
      return result;
    } catch (flowErr) {
      if (isImportedSession && !flowErr.isImportedSessionExpired) {
        const msg = flowErr && flowErr.message ? flowErr.message : '';
        if (/login|autentic|sess[aã]o|streak|saldo|desafio|challenge|cookie|navigat/i.test(msg)) {
          flowErr.isImportedSessionExpired = true;
          logger.error(
            '[Sessão Remota Expirada] A execução falhou e a sessão ativa foi importada de outro host. ' +
              'Gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
          );
        }
      }
      await closeContextWithDiagnostics(context, { failed: true, name: 'checkin-failed' });
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
      const result = await runCheckin();
      if (releaseLock) await releaseLock();
      const report = { type: 'checkin', ...result };
      const event = result && result.alreadyCollected ? 'already_collected' : 'success';
      await sendTelegram({ config: cfg, report, event }).catch(() => {});
      if (result && result.alreadyCollected) {
        process.exit(2);
      }
      process.exit(0);
    } catch (err) {
      if (releaseLock) await releaseLock();
      if (err.isImportedSessionExpired) {
        logger.error(
          '[Sessão Remota Expirada] Login falhou em servidor remoto. Sugestão: gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
        );
      }
      logger.error({ err: err.message }, 'Falha no check-in diário.');
      await sendTelegram({ config: cfg, event: 'failure', error: err }).catch(() => {});
      process.exit(1);
    }
  })();
}

module.exports = { runCheckin };
