const test = require('node:test');
const assert = require('node:assert/strict');
const { readMasked2FACode, TwoFactorRequiredNonInteractive } = require('../security');
const { performMobileLogin } = require('../libs/ui/login');
const { buildMessage } = require('../libs/notify');
const { SELECTORS } = require('../libs/selectors');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('security.js - readMasked2FACode falha imediatamente quando process.stdin.isTTY for falso', async () => {
  const originalIsTTY = process.stdin.isTTY;
  const realFilesSnapshot = snapshotRealFiles();

  try {
    process.stdin.isTTY = false;
    const startTime = Date.now();

    await assert.rejects(
      async () => {
        await readMasked2FACode('Prompt: ', 120000);
      },
      (err) => {
        assert.ok(err instanceof TwoFactorRequiredNonInteractive);
        assert.strictEqual(err.name, 'TwoFactorRequiredNonInteractive');
        assert.strictEqual(err.code, 'TWO_FACTOR_REQUIRED_NON_INTERACTIVE');
        return true;
      }
    );

    const elapsed = Date.now() - startTime;
    assert.ok(
      elapsed < 1000,
      `Rejeição do 2FA não-interativo deve ser instantânea (<1000ms), levou ${elapsed}ms`
    );
  } finally {
    process.stdin.isTTY = originalIsTTY;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/login.js - performMobileLogin falha imediatamente em ambiente não-interativo com 2FA', async () => {
  const originalIsTTY = process.stdin.isTTY;
  const realFilesSnapshot = snapshotRealFiles();

  try {
    process.stdin.isTTY = false;

    // Mock do locator de input
    const mockElement = {
      fill: async () => {},
      press: async () => {},
      click: async () => {}
    };

    const mockPage = {
      waitForSelector: async () => mockElement,
      $: async (selector) => {
        if (selector === SELECTORS.login.usernameInput) return mockElement;
        if (selector === SELECTORS.login.passwordInput) return mockElement;
        if (selector === SELECTORS.login.signInBtn) return mockElement;
        if (selector === SELECTORS.login.twoFactorInput) return mockElement;
        return null;
      },
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      evaluate: async (fn, el) => fn(el),
      frames: () => []
    };

    const mockContext = {
      cookies: async () => []
    };

    const config = {
      ALI_USER: 'test@example.com',
      ALI_PASSWORD: 'secretpassword',
      SELECTOR_TIMEOUT: 1000
    };

    const startTime = Date.now();
    await assert.rejects(
      async () => {
        await performMobileLogin(mockPage, mockContext, config);
      },
      (err) => {
        assert.ok(err instanceof TwoFactorRequiredNonInteractive);
        assert.strictEqual(err.code, 'TWO_FACTOR_REQUIRED_NON_INTERACTIVE');
        return true;
      }
    );

    const elapsed = Date.now() - startTime;
    assert.ok(elapsed < 2000, `Interrupção do 2FA deve ser rápida (<2000ms), levou ${elapsed}ms`);
  } finally {
    process.stdin.isTTY = originalIsTTY;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/notify.js - formatação do evento 2fa_required no Telegram', () => {
  const hostname = 'cron-vps-production';
  const report = {
    user: 'us***@example.com'
  };

  const message = buildMessage({
    event: '2fa_required',
    report,
    hostname
  });

  assert.ok(message.includes('Verificação 2FA Solicitada'));
  assert.ok(message.includes('Guia de Resolução (2FA no Cron)'));
  assert.ok(message.includes('export_session.js'));
  assert.ok(message.includes('import_session.js'));
  assert.ok(message.includes('cron-vps-production'));
  assert.ok(message.includes('us***@example.com'));
});
