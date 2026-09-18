const {
  loadConfig,
  sessionPath,
  handleDryRun,
  isForce,
  isJson,
  checkAndDisplayHelp,
  maskUser
} = require('./config');
const { formatDateTime, formatDuration } = require('./time_utils');
const { launchBrowser, newMobileContext, closeContextWithDiagnostics } = require('./browser');
const { acquireLock, LockActiveError } = require('./lockfile');
const { flushAndExit } = require('./libs/exit');
const { validateAndRefresh, saveSession, updateSessionStreak } = require('./libs/session');
const { SELECTORS } = require('./libs/selectors');
const {
  gotoWithRetry,
  closeModals,
  performMobileLogin,
  getStreakFromCoinPage,
  getBalanceDesktop,
  getCheckinCoinsFromStreak
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
    (account && account.sessionMetaPath) || options.sessionMetaPath || null;
  const sessionOpts = {
    sessionPath: currentSessionPath,
    sessionMetaPath: currentSessionMetaPath,
    account
  };

  logger.info('================ CHECK-IN DIÁRIO ================');
  logger.info(`[Dia e Hora]: ${formatDateTime(checkinStartTime)}`);
  logger.info(`[Login] Usuário: ${maskUser(userEmail)}`);

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
      sessionStatus.metaData?.lastStreakDays ??
      (sessionStatus.previousMeta?.user === userEmail
        ? sessionStatus.previousMeta?.lastStreakDays
        : null) ??
      null;

    // 2. Checagem prévia rápida no desktop se já foi coletado hoje
    let earlyDesktopStreak = null;
    let earlyTotalBalance = null;
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
        if (desktopCheck.totalBalance && desktopCheck.totalBalance !== 'N/D') {
          earlyTotalBalance = desktopCheck.totalBalance;
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

      let mobileCheckinCoins = null;
      if (justCollected) {
        try {
          mobileCheckinCoins = await page.evaluate(() => {
            const modalEls = document.querySelectorAll(
              '[class*="modal"], [class*="dialog"], [class*="popup"], [class*="toast"], [role="dialog"], [class*="aecoin-"]'
            );
            for (const el of modalEls) {
              const text = el.innerText || '';
              const m = text.match(/\+([0-9]+)\s*(?:moedas?|coins?)?/i);
              if (m) {
                const val = parseInt(m[1], 10);
                if (!isNaN(val) && val > 0) return val;
              }
            }
            return null;
          });
        } catch {
          // Ignorar
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

      let detectedStreak =
        mobileStreak !== null && mobileStreak !== 'N/D'
          ? mobileStreak
          : desktopResult.desktopStreak !== null && desktopResult.desktopStreak !== 'N/D'
            ? desktopResult.desktopStreak
            : earlyDesktopStreak !== null && earlyDesktopStreak !== 'N/D'
              ? earlyDesktopStreak
              : null;

      let streakDays = detectedStreak !== null ? detectedStreak : 'N/D';

      // Proteção contra regressão espúria de streak e garantia de incremento ao realizar check-in
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

        if (justCollected) {
          // Quando o check-in acabou de ser realizado hoje, o streak DEVE subir (+1).
          // Se a leitura da tela for espúria (<= 7), ausente, ou ainda não tiver sido atualizada pela UI (<= previousStreakDays),
          // incrementamos o streak anterior.
          if (
            detectedStreak === null ||
            isNaN(parsedDetected) ||
            isSpuriousWeeklyCycle ||
            parsedDetected <= previousStreakDays
          ) {
            logger.info(
              { detectedStreak, previousStreak: previousStreakDays },
              'Check-in realizado com sucesso hoje. Incrementando streak anterior (+1).'
            );
            streakDays = previousStreakDays + 1;
          } else {
            streakDays = parsedDetected;
          }
        } else if (alreadyCollected || wasAlreadyCollectedToday) {
          // Re-execução no mesmo dia: preservar streak já consolidado
          if (
            detectedStreak === null ||
            isNaN(parsedDetected) ||
            isSpuriousWeeklyCycle ||
            parsedDetected < previousStreakDays
          ) {
            logger.info(
              { detectedStreak, previousStreak: previousStreakDays },
              'Streak detectado na tela é espúrio (<= 7) ou ausente em re-execução. Preservando streak real da sessão.'
            );
            streakDays = previousStreakDays;
          } else {
            streakDays = parsedDetected;
          }
        } else {
          streakDays = !isNaN(parsedDetected) ? parsedDetected : previousStreakDays;
        }
      } else if (justCollected) {
        // Primeira execução sem histórico prévio de streak
        const parsedDetected =
          typeof detectedStreak === 'number'
            ? detectedStreak
            : parseInt(String(detectedStreak).replace(/[^0-9]/g, ''), 10);
        streakDays = !isNaN(parsedDetected) && parsedDetected >= 1 ? parsedDetected : 1;
      }

      const isCollected = alreadyCollected || wasAlreadyCollectedToday || justCollected;
      const isAlreadyCollected = (isCheckedInitial || wasAlreadyCollectedToday) && !justCollected;

      // Determinação das moedas recebidas no check-in
      let checkinCoinsNum = null;
      if (desktopResult.todayCheckinCoins) {
        const p = parseInt(String(desktopResult.todayCheckinCoins).replace(/[^0-9]/g, ''), 10);
        if (!isNaN(p) && p > 0) checkinCoinsNum = p;
      }
      if (checkinCoinsNum === null && mobileCheckinCoins) {
        checkinCoinsNum = mobileCheckinCoins;
      }
      if (checkinCoinsNum === null && isCollected) {
        checkinCoinsNum = getCheckinCoinsFromStreak(streakDays);
      }

      // Se o check-in já havia ocorrido hoje, não contabiliza nada nesta execução (+0 moedas)
      const coinsGainedToday = isAlreadyCollected
        ? '0'
        : checkinCoinsNum !== null
          ? String(checkinCoinsNum)
          : isCollected
            ? String(getCheckinCoinsFromStreak(streakDays))
            : '0';

      let totalBalance = desktopResult.totalBalance;
      // Se acabou de coletar o check-in e o saldo desktop não refletiu ainda a adição das moedas
      // (ex: desktopResult foi consultado antes do ledger registrar ou desktopCheck tinha o mesmo saldo)
      if (justCollected && checkinCoinsNum && totalBalance !== 'N/D') {
        const currentBalNum = parseInt(String(totalBalance).replace(/[^0-9]/g, ''), 10);
        const earlyBalNum =
          earlyTotalBalance !== null && earlyTotalBalance !== 'N/D'
            ? parseInt(String(earlyTotalBalance).replace(/[^0-9]/g, ''), 10)
            : NaN;
        if (
          (!isNaN(earlyBalNum) && currentBalNum <= earlyBalNum) ||
          (!desktopResult.hasAppCheckinToday && !isNaN(currentBalNum))
        ) {
          totalBalance = String(currentBalNum + checkinCoinsNum);
          logger.info(
            {
              baseBalance: currentBalNum,
              checkinCoins: checkinCoinsNum,
              updatedBalance: totalBalance
            },
            'Saldo pós-checkin sincronizado com as moedas recebidas no check-in.'
          );
        }
      }

      const hasStreak = streakDays !== 'N/D' && streakDays !== null;
      const hasTotalBalance = totalBalance !== 'N/D' && totalBalance !== null;
      const hasCheckinCoins =
        desktopResult.todayCheckinCoins !== null || isCollected || coinsGainedToday !== '0';

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
          { user: maskUser(userEmail), streakDays, totalBalance, coinsGainedToday },
          'Erro ao efetuar o login: não foi possível obter streak e saldo.'
        );
        // Sessão preservada intencionalmente: a falha pode ser apenas de parsing do DOM
        // (mudança de layout), não de autenticação. A limpeza ocorre em validateAndRefresh
        // somente quando há evidência de cookie de autenticação expirado.
        const loginErr = new Error(
          `Erro ao efetuar o login: não foi possível obter streak e saldo para a conta "${maskUser(userEmail)}".`
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
        alreadyCollected: isAlreadyCollected,
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
  const { setupGlobalCrashHandler } = require('./libs/crash');
  let cfg = null;
  setupGlobalCrashHandler(() => ({ config: cfg, scriptName: 'collect.js' }));

  if (checkAndDisplayHelp()) {
    void flushAndExit(0);
    return;
  }

  (async () => {
    if (await handleDryRun()) {
      await flushAndExit(0);
    }

    const { sendTelegram } = require('./libs/notify');
    let releaseLock = null;
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
        await flushAndExit(3);
      }
      logger.error({ err: err.message }, 'Falha ao obter lock.');
      await sendTelegram({ config: cfg, event: 'failure', error: err }).catch(() => {});
      await flushAndExit(1);
    }

    try {
      const result = await runCheckin();
      if (releaseLock) await releaseLock();
      const report = { type: 'checkin', ...result };
      const event = result && result.alreadyCollected ? 'already_collected' : 'success';
      await sendTelegram({ config: cfg, report, event }).catch(() => {});
      if (result && result.alreadyCollected) {
        await flushAndExit(2);
      }
      await flushAndExit(0);
    } catch (err) {
      if (releaseLock) await releaseLock();
      if (err.isImportedSessionExpired) {
        logger.error(
          '[Sessão Remota Expirada] Login falhou em servidor remoto. Sugestão: gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
        );
      }
      logger.error({ err: err.message }, 'Falha no check-in diário.');
      await sendTelegram({ config: cfg, event: 'failure', error: err }).catch(() => {});
      await flushAndExit(1);
    }
  })();
}

module.exports = { runCheckin };
