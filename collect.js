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
const { validateAndRefresh, saveSession, clearSession } = require('./libs/session');
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
  const config = loadConfig(true);
  const userEmail = config.ALI_USER;

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
    const sessionStatus = await validateAndRefresh(userEmail, sessionData);
    const hasValidSession = sessionStatus.valid;
    sessionData = sessionStatus.sessionData;

    // 2. Checagem prévia rápida no desktop se já foi coletado hoje
    if (hasValidSession) {
      try {
        const desktopCheck = await getBalanceDesktop(browser, sessionPath, {
          allowMedia: config.ALLOW_MEDIA,
          timeout: config.NAV_TIMEOUT_SHORT
        });
        if (desktopCheck.hasAppCheckinToday) {
          wasAlreadyCollectedToday = true;
        }
      } catch (checkErr) {
        logger.debug({ err: checkErr.message }, 'Checagem prévia de desktop ignorada.');
      }
    }

    // 3. Inicializar contexto mobile
    const context = await newMobileContext(browser, hasValidSession ? sessionPath : null, {
      allowMedia: config.ALLOW_MEDIA
    });
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
        sessionData = await performMobileLogin(page, context, config);
      }

      await page
        .waitForFunction(() => !document.querySelector('.login-pending-container'), {
          timeout: config.NAV_TIMEOUT_SHORT
        })
        .catch(() => {});

      // 4. Checagem e coleta do check-in
      const isCheckedInitial = await page.evaluate(() => {
        const text = document.body.innerText || '';
        return (
          Boolean(
            document.querySelector('[class*="today-checked"], [class*="aecoin-today-checked"]')
          ) || /Today[\s\S]{0,15}✓/i.test(text)
        );
      });

      let alreadyCollected = isCheckedInitial;

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
              alreadyCollected = true;
              break;
            }
          } catch {
            // Próximo seletor
          }
        }
      }

      await closeModals(page);

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

      const mobileStreak = await getStreakFromCoinPage(page);

      try {
        const updatedStorage = await context.storageState();
        sessionData = updatedStorage;
        await saveSession(updatedStorage, userEmail);
      } catch {
        // Ignorar
      }

      await closeContextWithDiagnostics(context, { failed: false, name: 'checkin-mobile' });

      // 5. Confirmar resultado e saldo no desktop
      const desktopResult = await getBalanceDesktop(browser, sessionPath, {
        allowMedia: config.ALLOW_MEDIA,
        timeout: config.NAV_TIMEOUT_SHORT
      });

      if (desktopResult.hasAppCheckinToday) {
        wasAlreadyCollectedToday = true;
      }

      const totalBalance = desktopResult.totalBalance;
      const isCollected = alreadyCollected || wasAlreadyCollectedToday;
      const coinsGainedToday = desktopResult.todayCheckinCoins
        ? desktopResult.todayCheckinCoins
        : isCollected
          ? '10'
          : '0';
      const streakDays = mobileStreak !== null ? mobileStreak : 'N/D';

      const hasStreak = streakDays !== 'N/D' && streakDays !== null;
      const hasTotalBalance = totalBalance !== 'N/D' && totalBalance !== null;
      const hasCheckinCoins =
        desktopResult.todayCheckinCoins !== null || (isCollected && coinsGainedToday !== '0');

      if (
        (!hasStreak && !hasTotalBalance && !hasCheckinCoins) ||
        (attemptedLogin && !hasStreak && !hasTotalBalance)
      ) {
        logger.error(
          { user: userEmail, streakDays, totalBalance, coinsGainedToday },
          'Erro ao efetuar o login: não foi possível obter streak e saldo.'
        );
        await clearSession();
        throw new Error(
          `Erro ao efetuar o login: não foi possível obter streak e saldo para a conta "${userEmail}".`
        );
      }

      const checkinEndTime = new Date();
      const checkinDuration = formatDuration(checkinEndTime - checkinStartTime);

      const result = {
        userEmail,
        alreadyCollected: alreadyCollected || wasAlreadyCollectedToday,
        coinsGainedToday,
        totalBalance,
        streakDays,
        startTime: checkinStartTime,
        endTime: checkinEndTime,
        duration: checkinDuration,
        sessionData
      };

      renderCheckinReport(result, { json: isJson() });
      return result;
    } catch (flowErr) {
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
      const result = await runCheckin();
      if (releaseLock) await releaseLock();
      if (result && result.alreadyCollected) {
        process.exit(2);
      }
      process.exit(0);
    } catch (err) {
      if (releaseLock) await releaseLock();
      logger.error({ err: err.message }, 'Falha no check-in diário.');
      process.exit(1);
    }
  })();
}

module.exports = { runCheckin };
