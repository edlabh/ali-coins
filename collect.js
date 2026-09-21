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
  getCheckinCoinsFromStreak,
  shouldReuseDesktopContext,
  closeCachedDesktopContext
} = require('./libs/ui');
const { renderCheckinReport, resolveStreakDays } = require('./libs/report');
const { version: APP_VERSION } = require('./package.json');
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
  logger.info(`[Versão] ali-coins v${APP_VERSION}`);
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
          timeout: config.NAV_TIMEOUT_SHORT,
          reuseContext: shouldReuseDesktopContext()
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

      // Verificar se precisa autenticar.
      // Com sessão válida, indícios textuais ("Sign in"/"Entrar" em rodapé/menu) só contam
      // quando a URL confirma uma página de login/passport — evita re-login desnecessário.
      let loginInput = await page.$(SELECTORS.login.usernameInput);
      const bodyText = await page.innerText('body').catch(() => '');
      const loginUrl = /login|sign-?in|passport/i.test(page.url());
      const needsLogin =
        !hasValidSession ||
        loginInput !== null ||
        (loginUrl &&
          (bodyText.includes('Email or phone number') ||
            bodyText.includes('Sign in') ||
            bodyText.includes('Entrar')));

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

        // Aguardar o redirecionamento pós-login concluir e assegurar navegação para o coin-index.
        // 'networkidle' foi removido: no msite ele pode esperar até 30s por requisições de
        // telemetria e carrega bookkeeping pesado no Playwright; a estabilização do SPA é
        // garantida pelos waits explícitos de seletor/login-pending logo abaixo.
        await page.waitForURL(/coin-index/, { timeout: config.NAV_TIMEOUT_SHORT }).catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(1000).catch(() => {});

        if (!page.url().includes('coin-index')) {
          await gotoWithRetry(page, 'https://m.aliexpress.com/p/coin-index/index.html', {
            waitUntil: 'domcontentloaded',
            timeout: config.NAV_TIMEOUT
          }).catch(() => {});
          await page.waitForTimeout(1000).catch(() => {});
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
        timeout: config.NAV_TIMEOUT_SHORT,
        reuseContext: shouldReuseDesktopContext()
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

      // Resolve o streak final (incremento determinístico, preservação em re-execução,
      // proteção contra ciclo semanal espúrio e fallback para a leitura do desktop).
      const { streakDays } = resolveStreakDays({
        detectedStreak,
        previousStreakDays,
        earlyDesktopStreak:
          typeof earlyDesktopStreak === 'number'
            ? earlyDesktopStreak
            : parseInt(String(earlyDesktopStreak).replace(/[^0-9]/g, ''), 10) || null,
        justCollected,
        alreadyCollected: alreadyCollected || wasAlreadyCollectedToday
      });

      const isCollected = alreadyCollected || wasAlreadyCollectedToday || justCollected;
      const isAlreadyCollected = (isCheckedInitial || wasAlreadyCollectedToday) && !justCollected;

      // Determinação das moedas recebidas no check-in.
      // PRIORIDADE 1: valor REAL creditado no extrato desktop ("Bônus diário"), que pode
      // ser diferente do tier sugerido na tela (ex.: tier 40 mas creditado 1).
      // PRIORIDADE 2: valor lido no modal mobile. PRIORIDADE 3: estimativa pelo streak.
      let checkinCoinsNum = null;
      let checkinCoinsSource = null;
      const desktopBonusNum =
        desktopResult.todayBonusCoins !== null && desktopResult.todayBonusCoins !== undefined
          ? parseInt(String(desktopResult.todayBonusCoins).replace(/[^0-9]/g, ''), 10)
          : NaN;
      if (!isNaN(desktopBonusNum) && desktopBonusNum > 0) {
        checkinCoinsNum = desktopBonusNum;
        checkinCoinsSource = 'desktop-bonus';
      } else if (desktopResult.todayCheckinCoins) {
        const p = parseInt(String(desktopResult.todayCheckinCoins).replace(/[^0-9]/g, ''), 10);
        if (!isNaN(p) && p > 0) {
          checkinCoinsNum = p;
          checkinCoinsSource = 'desktop-checkin';
        }
      }
      if (checkinCoinsNum === null && mobileCheckinCoins) {
        checkinCoinsNum = mobileCheckinCoins;
        checkinCoinsSource = 'mobile-modal';
      }
      if (checkinCoinsNum === null && isCollected) {
        checkinCoinsNum = getCheckinCoinsFromStreak(streakDays);
        checkinCoinsSource = 'streak-estimate';
      }

      // Quando o extrato traz o valor real, loga a divergência em relação ao tier sugerido
      // pela UI — é o caso em que o site promete 40 e credita 1.
      const tierSuggested = getCheckinCoinsFromStreak(streakDays);
      if (
        checkinCoinsSource === 'desktop-bonus' &&
        typeof tierSuggested === 'number' &&
        checkinCoinsNum !== tierSuggested
      ) {
        logger.warn(
          {
            tierSuggested,
            credited: checkinCoinsNum,
            streakDays,
            source: checkinCoinsSource
          },
          'Valor do check-in creditado difere do tier sugerido pela UI; usando o valor real do extrato.'
        );
      }

      // Valor do check-in reportado no extrato do dia.
      // O extrato desktop é a fonte de verdade: se HOJE há crédito de check-in (mesmo que
      // o clique tenha sido feito pelo usuário no app), o valor é contabilizado. O flag
      // `alreadyCollected` continua servindo apenas para NÃO clicar de novo no check-in.
      const bonusFromLedgerToday =
        desktopResult.todayBonusCoins !== null && desktopResult.todayBonusCoins !== undefined
          ? parseInt(String(desktopResult.todayBonusCoins).replace(/[^0-9]/g, ''), 10)
          : NaN;
      const hasBonusFromLedger = !isNaN(bonusFromLedgerToday) && bonusFromLedgerToday > 0;

      const coinsGainedToday = hasBonusFromLedger
        ? String(bonusFromLedgerToday)
        : isAlreadyCollected
          ? '0'
          : checkinCoinsNum !== null
            ? String(checkinCoinsNum)
            : isCollected
              ? String(getCheckinCoinsFromStreak(streakDays))
              : '0';

      // Saldo base das tarefas.
      // Quando o check-in acabou de ser feito e o saldo lido do desktop ainda NÃO reflete
      // o crédito (ledger defasado), sincronizamos somando as moedas do check-in. Caso
      // contrário, o ganho do check-in vazaria para o extrato das tarefas (all.js usa este
      // valor como `initialBalance` e do_tasks mede final - inicial).
      // O valor do check-in continua reportado à parte em `coinsGainedToday`.
      let totalBalance = desktopResult.totalBalance;
      if (justCollected && checkinCoinsNum && totalBalance !== 'N/D') {
        const currentBalNum = parseInt(String(totalBalance).replace(/[^0-9]/g, ''), 10);
        const earlyBalNum =
          earlyTotalBalance !== null && earlyTotalBalance !== 'N/D'
            ? parseInt(String(earlyTotalBalance).replace(/[^0-9]/g, ''), 10)
            : NaN;

        const balanceAlreadyCredited =
          !isNaN(earlyBalNum) && currentBalNum >= earlyBalNum + checkinCoinsNum;

        if (!balanceAlreadyCredited && !isNaN(currentBalNum)) {
          const base = !isNaN(earlyBalNum) ? earlyBalNum : currentBalNum;
          totalBalance = String(base + checkinCoinsNum);
          logger.info(
            {
              baseBalance: base,
              checkinCoins: checkinCoinsNum,
              updatedBalance: totalBalance
            },
            'Saldo pós-checkin sincronizado com as moedas recebidas no check-in (ledger defasado).'
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
        // Verdadeiro quando o valor do check-in veio do extrato de HOJE (fonte de verdade).
        // Nesse caso o relatório contabiliza o valor mesmo com `alreadyCollected=true`,
        // pois o crédito ocorreu no dia (possivelmente via app/usuário).
        checkinCoinsFromLedger: hasBonusFromLedger,
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
    // No fluxo integrado (all.js) o contexto desktop cacheado é mantido vivo para o
    // runTasks seguinte reaproveitá-lo; o fechamento ocorre no fim da conta em all.js.
    // No modo standalone (collect.js sozinho) fechamos aqui para não reter RAM.
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
          '[Sessão Remota Expirada] Login falhou em servidor remoto. Sugestão: gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
        );
      }
      logger.error({ err: err.message }, 'Falha no check-in diário.');
      await sendTelegram({ config: cfg, event: 'failure', error: err }).catch(() => {});
      await flushAndExit(1);
    }
  })().catch(async (err) => {
    // Erros fora do try principal (ex: loadConfig inválido em --dry-run) não devem
    // escalar para o crash handler (exit 6); são falha crítica de execução (exit 1).
    logger.error({ err: err.message }, 'Falha inesperada na execução do check-in.');
    await flushAndExit(1);
  });
}

module.exports = { runCheckin };
