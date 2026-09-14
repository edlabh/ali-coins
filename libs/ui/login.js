const { SELECTORS } = require('../selectors');
const { waitAndClick, trySolveSlider } = require('./navigation');
const { saveFailureScreenshot } = require('./diagnostics');
const { saveSession } = require('../session');
const { readMasked2FACode, TwoFactorRequiredNonInteractive } = require('../../security');
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
  logger.info(`[Login] Autenticando com credenciais de "${username}"...`);

  let loginInput = await page
    .waitForSelector(SELECTORS.login.usernameInput, { timeout: config.SELECTOR_TIMEOUT })
    .catch(() => null);

  if (!loginInput) {
    loginInput = await page.$(SELECTORS.login.usernameInput);
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

  // Desafio de código 2FA
  const codeInput = await page.$(SELECTORS.login.twoFactorInput).catch(() => null);
  if (codeInput) {
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
      { user: username, screenshot: errScreenshot },
      'Falha ao autenticar conta no AliExpress (desafio de segurança não superado).'
    );
    throw new Error('Falha de autenticação no AliExpress (desafio de segurança não superado).');
  }

  const rawStorage = await context.storageState();
  await saveSession(rawStorage, username, options);
  logger.info('[Login] Nova sessão autenticada salva com sucesso.');
  return rawStorage;
}

module.exports = {
  performMobileLogin,
  TwoFactorRequiredNonInteractive
};
