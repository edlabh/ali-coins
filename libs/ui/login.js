const { SELECTORS } = require('../selectors');
const { waitAndClick, trySolveSlider } = require('./navigation');
const { saveFailureScreenshot } = require('./diagnostics');
const { saveSession } = require('../session');
const { readMasked2FACode, TwoFactorRequiredNonInteractive } = require('../../security');
const { maskUser } = require('../../config');
const logger = require('../../logger');

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
  logger.info(`[Login] Autenticando com credenciais de "${maskUser(username)}"...`);

  let loginInput = await page
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

  if (!loginInput) {
    throw new Error(
      'Campo de identificador de usuário (e-mail/telefone) não encontrado na página.'
    );
  }

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

  let passwordInput = await page.$(SELECTORS.login.passwordInput);
  if (!passwordInput) {
    const continueClicked = await waitAndClick(page, SELECTORS.login.continueBtn, {
      timeout: 2000
    });
    if (continueClicked) {
      await page
        .waitForSelector('input[type="password"], #fm-login-password, #nc_1_n1z', { timeout: 2000 })
        .catch(() => {});
      await page.waitForTimeout(500);
      await trySolveSlider(page);
      passwordInput = await page.$(SELECTORS.login.passwordInput);
    }
  }

  if (passwordInput) {
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
  }

  // Desafio de código 2FA. Exige que o input esteja VISÍVEL: seletores por nome/classe
  // "code" casavam campos auxiliares/ocultos e disparavam falso 2FA (abortando login
  // válido em cron/CI). Sem visibilidade, não é o desafio de verificação.
  const codeInput = await page.$(SELECTORS.login.twoFactorInput).catch(() => null);
  const hasVisibleCodeInput =
    codeInput !== null && (await codeInput.isVisible().catch(() => false));
  if (hasVisibleCodeInput) {
    logger.warn('[Segurança AliExpress] Código de verificação 2FA solicitado pelo AliExpress.');
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

  // Validação de cookies
  let cookies = await context.cookies();
  let hasAuthCookie = cookies.some(
    (c) => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && Boolean(c.value)
  );

  if (!hasAuthCookie) {
    for (let waitSec = 0; waitSec < 5; waitSec++) {
      await page.waitForTimeout(1000);
      cookies = await context.cookies();
      hasAuthCookie = cookies.some(
        (c) => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && Boolean(c.value)
      );
      if (hasAuthCookie) break;
    }
  }

  if (!hasAuthCookie) {
    const errScreenshot = await saveFailureScreenshot(page, 'login_failed');
    logger.error(
      { user: maskUser(username), screenshot: errScreenshot },
      'Falha ao autenticar conta no AliExpress (desafio de segurança não superado).'
    );
    throw new Error('Falha de autenticação no AliExpress (desafio de segurança não superado).');
  }

  const rawStorage = await context.storageState();
  // Login resolvido neste host: a sessão deixa de ser "importada" (remove marcadores remotos)
  await saveSession(rawStorage, username, { ...options, freshLogin: true });
  logger.info('[Login] Nova sessão autenticada salva com sucesso.');
  return rawStorage;
}

module.exports = {
  performMobileLogin,
  TwoFactorRequiredNonInteractive
};
