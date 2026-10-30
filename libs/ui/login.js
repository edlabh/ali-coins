const { SELECTORS } = require('../selectors');
const { waitAndClick, trySolveSlider } = require('./navigation');
const { saveFailureScreenshot } = require('./diagnostics');
const { saveSession } = require('../session');
const { readMasked2FACode, TwoFactorRequiredNonInteractive } = require('../core/security');
const { maskUser } = require('../core/config');
const logger = require('../core/logger');

// Endpoint do login por senha (o /report e o /punish do anti-bot ficam de fora).
const LOGIN_RESPONSE_URL_RE = /\/user\/buyer\/login\/loginByPwd(?:$|\?)/i;

// Códigos de rejeição por controle de risco do AliExpress (RGV587/TMD).
const RISK_RET_RE = /RGV587|FAIL_SYS_USER_VALIDATE|FAIL_SYS_TRAFFIC_LIMIT|FAIL_SYS_ILLEGAL_ACCESS/i;

// Bloqueio de risco (RGV587): cooldown longo (48h) para o flag do AliExpress expirar.
const RISK_CONTROL_COOLDOWN_HOURS = 48;

/**
 * Lê o valor de um cookie pelo nome (string vazia quando ausente).
 * @param {Array<{name: string, value: string}>} cookies
 * @param {string} name
 * @returns {string}
 */
function readCookie(cookies, name) {
  const found = (Array.isArray(cookies) ? cookies : []).find((c) => c && c.name === name);
  return found && found.value ? String(found.value) : '';
}

/**
 * Classifica o campo `ret` da resposta do loginByPwd.
 * @param {string|string[]|null|undefined} ret
 * @returns {{risk: boolean, success: boolean, items: string[]}}
 */
function classifyLoginRet(ret) {
  const items = (Array.isArray(ret) ? ret : ret === undefined || ret === null ? [] : [ret]).map(
    (x) => String(x)
  );
  const joined = items.join(' ');
  const risk = RISK_RET_RE.test(joined);
  const success = !risk && items.some((s) => /^SUCCESS::/i.test(s.trim()));
  return { risk, success, items };
}

/**
 * Decide se o login pode ser considerado autenticado.
 * Sinais fortes: ticket `login_aliyunid_ticket`, rotação do `xman_us_t` ou `SUCCESS` na
 * resposta. O `xman_us_t` antigo e inalterado NÃO conta (falso positivo histórico).
 * @param {{hasTicket?: boolean, xmanRotated?: boolean, responseSuccess?: boolean, responseRisk?: boolean}} [params]
 * @returns {boolean}
 */
function decideLoginSuccess({
  hasTicket = false,
  xmanRotated = false,
  responseSuccess = false,
  responseRisk = false
} = {}) {
  if (responseRisk === true) return false;
  return hasTicket === true || xmanRotated === true || responseSuccess === true;
}

/**
 * Captura a resposta do endpoint de login por senha durante a submissão.
 * @param {import('playwright').Page} page
 * @returns {{response: object|null, detach: () => void}}
 */
function attachLoginResponseCapture(page) {
  const state = { response: null };
  const handler = async (response) => {
    try {
      if (!response || typeof response.url !== 'function') return;
      if (!LOGIN_RESPONSE_URL_RE.test(String(response.url()))) return;
      const headers = typeof response.headers === 'function' ? response.headers() : {};
      if (headers && headers['content-type'] && !/json/i.test(String(headers['content-type']))) {
        return;
      }
      const body = await response.json();
      if (body && typeof body === 'object') state.response = body;
    } catch {
      // Resposta ilegível: mantém o último estado capturado.
    }
  };
  if (page && typeof page.on === 'function') page.on('response', handler);
  return {
    get response() {
      return state.response;
    },
    detach() {
      if (page && typeof page.off === 'function') page.off('response', handler);
    }
  };
}

/**
 * Retorna o ElementHandle de um seletor quando ele está VISÍVEL dentro do timeout.
 * Nunca lança: ausência/erro → null.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {number} [timeout=1200]
 * @returns {Promise<import('playwright').ElementHandle|null>}
 */
async function visibleElement(page, selector, timeout = 1200) {
  try {
    const el = await page.waitForSelector(selector, { state: 'visible', timeout });
    return el || null;
  } catch {
    return null;
  }
}

/**
 * Executa o fluxo completo de autenticação e superação de desafios no contexto mobile
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {object} config
 * @returns {Promise<object>} Nova sessão autenticada (storageState)
 */
async function performMobileLogin(page, context, config, options = {}) {
  const username = (options.account && options.account.user) || config.ALI_USER;
  const password = (options.account && options.account.password) || config.ALI_PASSWORD;
  logger.info(
    { msgId: 'login.credentials', msgParams: [maskUser(username)] },
    `[Login] Autenticando com credenciais de "${maskUser(username)}"...`
  );

  // Prompt de reautenticação in-page (SPA): o AliExpress reconhece a conta e pede
  // APENAS a senha, na mesma URL do coin-index. Nesse caso não existe campo de usuário —
  // detectamos a senha visível primeiro para não esperar (nem falhar) pelo e-mail.
  let passwordInput = await visibleElement(page, SELECTORS.login.passwordInput, 1200);
  const passwordOnly = passwordInput !== null;
  if (passwordOnly) {
    logger.info(
      { msgId: 'login.password_prompt' },
      '[Login] Prompt de reautenticação in-page detectado (somente senha).'
    );
  }

  let loginInput = null;
  if (!passwordOnly) {
    loginInput = await page
      .waitForSelector(SELECTORS.login.usernameInput, { timeout: config.SELECTOR_TIMEOUT })
      .catch(() => null);

    if (!loginInput) {
      // Fallback: `waitForSelector` já filtra por visibilidade; o `$` direto não.
      // Um input oculto matching causaria "element is not visible" cru no fill.
      const fallback = await page.$(SELECTORS.login.usernameInput);
      const visible =
        fallback && typeof fallback.isVisible === 'function'
          ? await fallback.isVisible().catch(() => false)
          : Boolean(fallback);
      loginInput = visible ? fallback : null;
    }
  }

  if (loginInput) {
    await loginInput.fill(username);
    await loginInput.press('Enter');
    await page
      .waitForSelector(
        'input[type="password"], #fm-login-password, button.cosmos-btn-primary, #nc_1_n1z',
        { timeout: 2000 }
      )
      .catch(() => {});
    await page.waitForTimeout(500);

    await trySolveSlider(page);

    passwordInput = await page.$(SELECTORS.login.passwordInput);
    if (!passwordInput) {
      const continueClicked = await waitAndClick(page, SELECTORS.login.continueBtn, {
        timeout: 2000
      });
      if (continueClicked) {
        await page
          .waitForSelector('input[type="password"], #fm-login-password, #nc_1_n1z', {
            timeout: 2000
          })
          .catch(() => {});
        await page.waitForTimeout(500);
        await trySolveSlider(page);
        passwordInput = await page.$(SELECTORS.login.passwordInput);
      }
    }
  }

  if (!loginInput && !passwordInput) {
    throw new Error(
      'Campo de identificador de usuário (e-mail/telefone) não encontrado na página.'
    );
  }

  let capture = null;
  let xmanBefore = '';

  const loginVerdictFromCapture = () => {
    if (!capture || !capture.response) return null;
    const resp = capture.response;
    return classifyLoginRet(resp.ret !== undefined ? resp.ret : resp.data && resp.data.ret);
  };

  const throwRiskRejection = async (verdict) => {
    if (capture) capture.detach();
    const errScreenshot = await saveFailureScreenshot(page, 'login_risco');
    logger.error(
      {
        user: maskUser(username),
        ret: verdict.items.join(' ').slice(0, 200),
        screenshot: errScreenshot,
        msgId: 'login.risk_rejected'
      },
      'Login rejeitado pelo controle de risco do AliExpress (RGV587/FAIL_SYS_USER_VALIDATE).'
    );
    const riskErr = new Error(
      'Login rejeitado pelo controle de risco do AliExpress (verificação anti-bot RGV587).'
    );
    riskErr.isCaptchaChallenge = true;
    riskErr.isRiskControl = true;
    riskErr.captchaCooldownHours = RISK_CONTROL_COOLDOWN_HOURS;
    throw riskErr;
  };

  if (passwordInput) {
    // Captura a resposta do loginByPwd e o xman_us_t anterior para validar a autenticação
    // por sinais fortes (evita aceitar cookie antigo como sessão autenticada).
    capture = attachLoginResponseCapture(page);
    try {
      xmanBefore = readCookie(await context.cookies(), 'xman_us_t');
    } catch {
      xmanBefore = '';
    }

    // No modo somente-senha o captcha pode estar visível junto do prompt antes do envio.
    if (!loginInput) await trySolveSlider(page);
    await passwordInput.fill(password);
    const signInBtn = await page.$(SELECTORS.login.signInBtn);
    if (signInBtn) {
      await page.evaluate((el) => el.click(), signInBtn);
    } else {
      await passwordInput.press('Enter');
    }

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page
      .waitForSelector(
        'input[placeholder*="code" i], input[type="tel"], [class*="dayNumber"], [class*="aecoin"], #nc_1_n1z',
        { timeout: 2000 }
      )
      .catch(() => {});
    await page.waitForTimeout(1000);

    await trySolveSlider(page);

    // Rejeição por controle de risco: o loginByPwd respondeu 200 com FAIL_SYS_USER_VALIDATE
    // e nenhum cookie novo será emitido — aborta antes de qualquer validação de cookie.
    const verdictNow = loginVerdictFromCapture();
    if (verdictNow && verdictNow.risk) {
      await throwRiskRejection(verdictNow);
    }
  }

  // Desafio de código 2FA. Exige que o input esteja VISÍVEL: seletores por nome/classe
  // "code" casavam campos auxiliares/ocultos e disparavam falso 2FA (abortando login
  // válido em cron/CI). Sem visibilidade, não é o desafio de verificação.
  const codeInput = await page.$(SELECTORS.login.twoFactorInput).catch(() => null);
  const hasVisibleCodeInput =
    codeInput !== null && (await codeInput.isVisible().catch(() => false));
  if (hasVisibleCodeInput) {
    logger.warn(
      { msgId: 'login.2fa_requested' },
      '[Segurança AliExpress] Código de verificação 2FA solicitado pelo AliExpress.'
    );
    if (!process.stdin.isTTY) {
      throw new TwoFactorRequiredNonInteractive();
    }
    const code = await readMasked2FACode(
      '>> Digite o código de 6 dígitos enviado para seu e-mail/SMS: ',
      120000
    );
    if (code) {
      await codeInput.fill(code);
      const submitCodeBtn = await page.$(SELECTORS.login.twoFactorSubmitBtn);
      if (submitCodeBtn) {
        await page.evaluate((el) => el.click(), submitCodeBtn);
      } else {
        await codeInput.press('Enter');
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1000);
    }
  }

  // Validação de autenticação por sinais fortes: ticket `login_aliyunid_ticket`, rotação
  // do `xman_us_t` ou resposta SUCCESS do loginByPwd. O `xman_us_t` antigo e inalterado
  // (que sobrevive à expiração da sessão) NÃO conta sozinho — antes gerava falso positivo.
  let authenticated = false;
  let verdict = loginVerdictFromCapture();
  for (let waitSec = 0; waitSec < 6; waitSec++) {
    if (verdict && verdict.risk) {
      await throwRiskRejection(verdict);
    }
    let cookies = [];
    try {
      cookies = await context.cookies();
    } catch {
      cookies = [];
    }
    const hasTicket = Boolean(readCookie(cookies, 'login_aliyunid_ticket'));
    const xmanAfter = readCookie(cookies, 'xman_us_t');
    authenticated = decideLoginSuccess({
      hasTicket,
      xmanRotated: Boolean(xmanAfter) && xmanAfter !== xmanBefore,
      responseSuccess: Boolean(verdict && verdict.success)
    });
    if (authenticated) break;
    if (waitSec < 5) await page.waitForTimeout(1000);
    verdict = loginVerdictFromCapture();
  }
  if (capture) capture.detach();

  if (!authenticated) {
    const errScreenshot = await saveFailureScreenshot(page, 'login_failed');
    logger.error(
      { user: maskUser(username), screenshot: errScreenshot, msgId: 'login.failed' },
      'Falha ao autenticar conta no AliExpress (desafio de segurança não superado).'
    );
    const authErr = new Error(
      'Falha de autenticação no AliExpress (desafio de segurança não superado).'
    );
    // Marca o desafio anti-bot (captcha) para o chamador registrar o cooldown e
    // notificar com o evento `captcha_required` em vez de uma falha genérica.
    authErr.isCaptchaChallenge = true;
    throw authErr;
  }

  const rawStorage = await context.storageState();
  // Login resolvido neste host: a sessão deixa de ser "importada" (remove marcadores remotos)
  await saveSession(rawStorage, username, { ...options, freshLogin: true });
  logger.info(
    { msgId: 'login.session_saved' },
    '[Login] Nova sessão autenticada salva com sucesso.'
  );
  return rawStorage;
}

module.exports = {
  performMobileLogin,
  visibleElement,
  classifyLoginRet,
  decideLoginSuccess,
  TwoFactorRequiredNonInteractive
};
