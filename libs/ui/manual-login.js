/**
 * Login manual opcional em janela visível (2.0.0).
 *
 * O modo padrão continua 100% headless. Este módulo só entra em ação quando o
 * chamador detecta que o login é necessário (sem sessão, reautenticação ou gate
 * anti-bot) e o operador está em um terminal com interface gráfica. O operador
 * resolve login/captcha manualmente; o módulo espera um cookie forte
 * (`login_aliyunid_ticket` ou `xman_us_t`), salva a sessão e devolve o storageState
 * para o fluxo headless continuar.
 *
 * Não há tentativa de burlar captcha: a janela é do próprio AliExpress e o
 * desafio é resolvido pelo operador.
 */
const readline = require('node:readline');
const { launchBrowser, newMobileContext, newDesktopContext } = require('../../browser');
const { SELECTORS } = require('../selectors');
const { saveSession } = require('../session');
const { gotoWithRetry } = require('./navigation');
const { maskUser } = require('../../config');
const logger = require('../../logger');

const CHOICE_HEADLESS = 1;
const CHOICE_MANUAL = 2;
const AUTH_TICKET_COOKIE = 'login_aliyunid_ticket';
// O login desktop grava `xman_us_t`; o mobile grava o ticket. `validateSession`
// aceita qualquer um dos dois, então a janela manual também precisa aceitar ambos.
const AUTH_USER_COOKIE = 'xman_us_t';
const AUTH_COOKIES = [AUTH_TICKET_COOKIE, AUTH_USER_COOKIE];
const MOBILE_COIN_URL = 'https://m.aliexpress.com/p/coin-index/index.html';
const DESKTOP_COIN_URL = SELECTORS.desktop.mycoinUrl;
const LOGIN_FORM_SELECTOR =
  'input[type="password"], #fm-login-password, #fm-login-id, input[name="loginId"]';
const DEFAULT_PROMPT_TIMEOUT_MS = 60000;
const DEFAULT_MANUAL_TIMEOUT_MS = 15 * 60 * 1000;

class ManualLoginError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManualLoginError';
    this.isManualLoginRequired = true;
  }
}

class ManualLoginTimeoutError extends ManualLoginError {
  constructor(message) {
    super(message);
    this.name = 'ManualLoginTimeoutError';
    this.isManualLoginTimeout = true;
  }
}

/**
 * Lê o valor de um cookie pelo nome.
 * @param {Array<{name: string, value: string}>} cookies
 * @param {string} name
 * @returns {string}
 */
function readCookie(cookies, name) {
  const found = (Array.isArray(cookies) ? cookies : []).find((c) => c && c.name === name);
  return found && found.value ? String(found.value) : '';
}

/**
 * Verifica se a URL é a página de moedas (e não a página de login, cujo
 * `return_url` na query também contém "coin"). Usa apenas o pathname.
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isCoinPageUrl(rawUrl) {
  try {
    const { pathname } = new URL(String(rawUrl || ''));
    return pathname.toLowerCase().includes('coin');
  } catch {
    return false;
  }
}

/**
 * Decide whether the manual-login menu/window can be offered in this environment.
 * Requires an interactive TTY and, on Linux, a graphical display. Windows/macOS
 * desktops are assumed to have a GUI. CI is always treated as non-interactive.
 * @param {{mode?: 'auto'|'never'|'always', platform?: string, env?: object, stdinIsTTY?: boolean, stdoutIsTTY?: boolean}} [params]
 * @returns {boolean}
 */
function isManualLoginAvailable({
  mode = 'auto',
  platform = process.platform,
  env = process.env,
  stdinIsTTY = Boolean(process.stdin && process.stdin.isTTY),
  stdoutIsTTY = Boolean(process.stdout && process.stdout.isTTY)
} = {}) {
  if (mode === 'never') return false;
  if (!stdinIsTTY || !stdoutIsTTY) return false;
  if (/^(1|true|yes)$/i.test(String(env.CI || '').trim())) return false;
  // Em Windows/macOS, uma sessão SSH normalmente não consegue abrir janela na sessão
  // gráfica do usuário. No Linux, DISPLAY/WAYLAND_DISPLAY abaixo cobre X11 forwarding.
  if (platform !== 'linux' && (env.SSH_CONNECTION || env.SSH_TTY)) return false;
  if (platform === 'linux') return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  return platform === 'win32' || platform === 'darwin';
}

/**
 * Decide se o menu manual deve ser oferecido no ponto pré-login.
 * @param {{hasValidLogin?: boolean, needsLogin?: boolean, passwordVisible?: boolean, cooldown?: object|null, mode?: string}} [params]
 * @returns {boolean}
 */
function shouldOfferManualLogin({
  hasValidLogin = false,
  needsLogin = false,
  passwordVisible = false,
  cooldown = null,
  mode = 'auto'
} = {}) {
  if (mode === 'never') return false;
  // `needsLogin` cobre sessão local válida que o site rejeitou (expirada/invalidada
  // no servidor) e reaproveita a mesma decisão que já acionaria o login automático.
  if (needsLogin === true) return true;
  if (hasValidLogin !== true) return true;
  if (passwordVisible === true) return true;
  return Boolean(cooldown && (cooldown.active === true || cooldown.requireManualLogin === true));
}

/**
 * Texto curto do motivo exibido no menu (sem dados sensíveis).
 * @param {{hasValidLogin?: boolean, passwordVisible?: boolean, cooldown?: object|null}} [params]
 * @returns {string}
 */
function manualLoginReason({
  hasValidLogin = false,
  passwordVisible = false,
  cooldown = null
} = {}) {
  if (cooldown && cooldown.requireManualLogin === true) {
    return 'login remoto suspenso após bloqueio anti-bot (RGV587)';
  }
  if (cooldown && cooldown.active === true) {
    return cooldown.riskControl === true
      ? 'bloqueio anti-bot (RGV587) ativo'
      : 'cooldown pós-captcha ativo';
  }
  if (hasValidLogin !== true) return 'sem sessão válida';
  if (passwordVisible === true) return 'reautenticação solicitada pela página';
  return 'login necessário';
}

/**
 * Monta o menu de duas opções. A opção 1 (headless) é o padrão.
 * @param {{account?: object, reason?: string, timeoutMs?: number}} [params]
 * @returns {string}
 */
function buildLoginChoiceMenu({
  account = null,
  reason = '',
  timeoutMs = DEFAULT_PROMPT_TIMEOUT_MS
} = {}) {
  const user = account && (account.maskedUser || (account.user ? maskUser(account.user) : null));
  const seconds = Math.max(0, Math.round(Number(timeoutMs || 0) / 1000));
  const riskLike = /RGV587|anti-bot/i.test(reason);
  return [
    '',
    '──────────────────────────────────────────────',
    '🔐 Login manual opcional',
    user ? `Conta: ${user}` : null,
    reason ? `Motivo: ${reason}` : null,
    riskLike
      ? '⚠️ O bloqueio anti-bot pode impedir o login mesmo na janela; respeite o cooldown de 48h.'
      : null,
    '',
    '  1) Continuar 100% headless (padrão)',
    '  2) Abrir janela para login manual e salvar a sessão',
    '',
    `Escolha [1/2] (Enter = 1, timeout ${seconds}s): `
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Interpreta a escolha do operador. Qualquer valor inesperado cai no modo headless.
 * @param {string} input
 * @param {{defaultValue?: number}} [options]
 * @returns {number} 1=headless, 2=manual
 */
function parseLoginChoice(input, { defaultValue = CHOICE_HEADLESS } = {}) {
  const value = String(input === undefined || input === null ? '' : input)
    .trim()
    .toLowerCase();
  if (!value) return defaultValue;
  if (['1', 'h', 'headless'].includes(value)) return CHOICE_HEADLESS;
  if (['2', 'm', 'manual'].includes(value)) return CHOICE_MANUAL;
  return defaultValue;
}

/**
 * Mostra o menu e aguarda a escolha, com timeout (padrão = headless).
 * Retorna `nonInteractive: true` sem bloquear quando não há TTY.
 * @param {object} [params]
 * @returns {Promise<{choice: number, timedOut?: boolean, aborted?: boolean, nonInteractive?: boolean}>}
 */
function askLoginChoice({
  account = null,
  reason = '',
  timeoutMs = DEFAULT_PROMPT_TIMEOUT_MS,
  stdin = process.stdin,
  stdout = process.stdout,
  createInterface = readline.createInterface
} = {}) {
  if (!stdin || !stdout || !stdin.isTTY || !stdout.isTTY) {
    return Promise.resolve({ choice: CHOICE_HEADLESS, nonInteractive: true });
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let rl = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        rl?.close();
      } catch {}
      resolve(result);
    };

    try {
      rl = createInterface({ input: stdin, output: stdout });
    } catch {
      finish({ choice: CHOICE_HEADLESS, nonInteractive: true });
      return;
    }

    rl.once('close', () => {
      if (!settled) finish({ choice: CHOICE_HEADLESS, aborted: true });
    });

    timer = setTimeout(
      () => finish({ choice: CHOICE_HEADLESS, timedOut: true }),
      Math.max(1, Number(timeoutMs) || DEFAULT_PROMPT_TIMEOUT_MS)
    );

    try {
      rl.question(buildLoginChoiceMenu({ account, reason, timeoutMs }), (answer) => {
        finish({ choice: parseLoginChoice(answer), timedOut: false });
      });
    } catch {
      finish({ choice: CHOICE_HEADLESS, nonInteractive: true });
    }
  });
}

/**
 * Verifica se o formulário de login (usuário ou senha) ainda está visível. Usado para
 * evitar aceitar um `login_aliyunid_ticket` antigo como se o login manual tivesse sido
 * concluído — inclusive em fluxos que pedem só o usuário primeiro.
 * @param {object} page
 * @returns {Promise<boolean>}
 */
async function isLoginPromptVisible(page) {
  if (!page) return false;
  try {
    // `$$` é importante: num fluxo que pede primeiro o usuário, pode existir um input
    // de senha oculto antes do campo de usuário visível. Checar só o primeiro match
    // (`$`) concluiria o login manual cedo demais.
    if (typeof page.$$ === 'function') {
      const inputs = await page.$$(LOGIN_FORM_SELECTOR);
      for (const input of inputs) {
        if (await input.isVisible()) return true;
      }
      return false;
    }
    if (typeof page.$ === 'function') {
      const input = await page.$(LOGIN_FORM_SELECTOR);
      return input ? await input.isVisible() : false;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Aguarda o operador concluir o login na janela. Só considera concluído quando um
 * cookie forte novo/diferente (`login_aliyunid_ticket` ou `xman_us_t`) existe e o
 * formulário de login não está mais visível.
 * @param {object} params
 * @returns {Promise<{ok: true, hasTicket: true}>}
 */
async function waitForManualLogin({
  context,
  page,
  timeoutMs = DEFAULT_MANUAL_TIMEOUT_MS,
  pollMs = 2000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now()
} = {}) {
  if (!context || typeof context.cookies !== 'function') {
    throw new ManualLoginError('Contexto do navegador inválido para o login manual.');
  }

  const maxTimeout = Math.max(0, Number(timeoutMs) || 0);
  const deadline = now() + maxTimeout;
  const interval = Math.max(1, Number(pollMs) || 2000);

  // Cookies de autenticação presentes ANTES do login manual (sessão antiga/rejeitada).
  // Se já existiam, só aceitamos um valor DIFERENTE: o mesmo valor pode ser cookie
  // velho que sobreviveu à invalidação server-side — salvá-lo repetiria o falso
  // positivo da 1.7.4. Sem valor inicial, o primeiro cookie forte já vale.
  const initialAuth = {};
  try {
    const initialCookies = await context.cookies();
    for (const name of AUTH_COOKIES) {
      initialAuth[name] = readCookie(initialCookies, name);
    }
  } catch (err) {
    throw new ManualLoginError(
      `Não foi possível ler os cookies da janela de login: ${err.message}`
    );
  }

  let warnedPostLogin = false;

  for (;;) {
    if (page && typeof page.isClosed === 'function' && page.isClosed()) {
      throw new ManualLoginError('A janela de login foi fechada antes de concluir a autenticação.');
    }

    let cookies = [];
    try {
      cookies = await context.cookies();
    } catch (err) {
      throw new ManualLoginError(
        `Não foi possível ler os cookies da janela de login: ${err.message}`
      );
    }

    const authCookie = AUTH_COOKIES.find((name) => {
      const value = readCookie(cookies, name);
      return Boolean(value) && (!initialAuth[name] || value !== initialAuth[name]);
    });
    const openPages = typeof context.pages === 'function' ? context.pages() : [];
    const coinPageOpen = openPages.some(
      (p) => p && typeof p.url === 'function' && isCoinPageUrl(p.url())
    );
    if (authCookie && (coinPageOpen || !(await isLoginPromptVisible(page)))) {
      // `hasTicket` é mantido por compatibilidade; `authCookie` diz qual sinal veio.
      return { ok: true, hasTicket: true, authCookie };
    }

    // Diagnóstico sem valores: se a página de moedas já abriu mas nenhum cookie forte
    // novo apareceu, registra os nomes dos cookies de autenticação presentes uma vez.
    if (coinPageOpen && !authCookie && !warnedPostLogin) {
      warnedPostLogin = true;
      const authCookieNames = (Array.isArray(cookies) ? cookies : [])
        .map((c) => c && c.name)
        .filter((name) => name && /ticket|xman|login_aliyunid|sso/i.test(name));
      logger.warn(
        {
          url: page && typeof page.url === 'function' ? page.url() : '',
          cookies: authCookieNames
        },
        'Janela manual: página de moedas aberta, mas nenhum cookie forte novo detectado; continuando a aguardar.'
      );
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new ManualLoginTimeoutError(
        `Tempo esgotado aguardando o login manual (${Math.round(maxTimeout / 1000)}s).`
      );
    }
    await sleep(Math.min(interval, remaining));
  }
}

/**
 * Abre (ou reaproveita) uma janela visível, aguarda o login manual, salva a sessão
 * com `freshLogin` e fecha a janela temporária. O chamador retoma em headless.
 *
 * Por padrão a janela usa um contexto desktop (sem emulação de toque), porque o
 * slider/captcha do AliExpress responde ao mouse. `MANUAL_LOGIN_CONTEXT=mobile`
 * reativa a emulação Pixel 7 usada pelo fluxo mobile.
 *
 * Quando `existingPage`/`existingContext` são passados (HEADLESS=false), a janela
 * já aberta é reaproveitada e NÃO é fechada ao final.
 *
 * @param {object} params
 * @returns {Promise<{storageState: object, sessionData: object, metaData: object|null, reusedContext: boolean}>}
 */
async function performManualLogin({
  config = {},
  sessionOpts = {},
  account = null,
  storageState = null,
  existingPage = null,
  existingContext = null,
  deps = {}
} = {}) {
  const {
    launch = launchBrowser,
    createMobileContext = newMobileContext,
    createDesktopContext = newDesktopContext,
    save = saveSession,
    goto = gotoWithRetry,
    waitForLogin = waitForManualLogin,
    writeLog = logger
  } = deps;

  const user = (account && account.user) || config.ALI_USER;
  if (!user) {
    throw new ManualLoginError('Conta não identificada para o login manual.');
  }

  const reuse = Boolean(existingPage && existingContext);
  const timeoutMs =
    Number(config.MANUAL_LOGIN_TIMEOUT_MS) > 0
      ? Number(config.MANUAL_LOGIN_TIMEOUT_MS)
      : DEFAULT_MANUAL_TIMEOUT_MS;
  let browser = null;
  let context = existingContext || null;
  let page = existingPage || null;
  let ownsBrowser = false;

  // Desktop por padrão: sem hasTouch/isMobile, o captcha de slider aceita o mouse.
  const manualContext = config.MANUAL_LOGIN_CONTEXT === 'mobile' ? 'mobile' : 'desktop';
  const createContext = manualContext === 'mobile' ? createMobileContext : createDesktopContext;
  const targetUrl = manualContext === 'mobile' ? MOBILE_COIN_URL : DESKTOP_COIN_URL;

  try {
    if (!reuse) {
      writeLog.info(
        { user: maskUser(user), context: manualContext },
        config.HEADLESS
          ? 'Abrindo janela visível para login manual (o fluxo headless será retomado depois)...'
          : 'Abrindo janela para login manual e salvamento da sessão...'
      );
      browser = await launch({ headless: false });
      ownsBrowser = true;
      context = await createContext(browser, storageState, { allowMedia: true });
      if (manualContext === 'desktop') {
        // Mesmo disfarce do contexto mobile: reduz o sinal de automação sem
        // interferir no captcha, que continua sendo resolvido pelo operador.
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          window.chrome = { runtime: {} };
        });
      }
      page = await context.newPage();
      try {
        await goto(page, targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.NAV_TIMEOUT || 35000
        });
      } catch (navErr) {
        // A navegação inicial pode falhar (rede/anti-bot), mas a janela continua útil:
        // o operador pode navegar manualmente até o login. Não aborta o fluxo manual.
        writeLog.warn(
          { err: navErr.message },
          'Falha ao abrir a central de moedas na janela manual; o operador pode navegar manualmente.'
        );
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    if (page && typeof page.bringToFront === 'function') {
      await page.bringToFront().catch(() => {});
    }

    writeLog.info(
      { user: maskUser(user) },
      'Resolva o login/captcha/2FA na janela aberta. O bot aguarda o cookie de autenticação...'
    );

    const loginResult = await waitForLogin({ context, page, timeoutMs });

    const storage = await context.storageState();
    const saved = await save(storage, user, { ...sessionOpts, freshLogin: true });
    if (!saved || !saved.sessionData) {
      throw new ManualLoginError(
        'Login detectado, mas a sessão não pôde ser salva. Verifique SESSION_SECRET e as permissões do diretório.'
      );
    }

    writeLog.info(
      { user: maskUser(user), authCookie: loginResult && loginResult.authCookie },
      'Login manual concluído e sessão salva. Retomando a execução.'
    );

    return {
      storageState: saved.sessionData,
      sessionData: saved.sessionData,
      metaData: saved.metaData || null,
      reusedContext: reuse
    };
  } finally {
    // A janela temporária é sempre fechada; no modo HEADLESS=false ela é a janela
    // principal e deve continuar aberta.
    if (ownsBrowser && browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = {
  CHOICE_HEADLESS,
  CHOICE_MANUAL,
  AUTH_TICKET_COOKIE,
  ManualLoginError,
  ManualLoginTimeoutError,
  isManualLoginAvailable,
  shouldOfferManualLogin,
  manualLoginReason,
  buildLoginChoiceMenu,
  parseLoginChoice,
  askLoginChoice,
  waitForManualLogin,
  performManualLogin
};
