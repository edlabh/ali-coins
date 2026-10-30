const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REPORT_SCHEMA_VERSION,
  buildUnifiedReportPayload,
  isStreakBreak,
  resolveDailyCheckinCoins
} = require('../libs/report');
const { nextLongestStreak } = require('../libs/session');
const {
  isCoinSearchResultUrl,
  isAllowedAliExpressHost,
  closePopupWithTimeout
} = require('../libs/tasks/search');
const { classifySessionCheck } = require('../libs/session-check');
const { importSession, isSessionTokenExpired, ImportSessionError } = require('../import_session');
const { isLoginGateVisible } = require('../libs/ui/balance');
const { encryptSession } = require('../libs/core/security');
const fs = require('fs');
const path = require('path');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

const TEST_SECRET = 'test_secret_2_4_0_with_at_least_32_characters'; //gitleaks:allow valor fictício

test('2.4.0 - daily check-in usa o valor real creditado em vez do tier estimado', () => {
  assert.deepStrictEqual(resolveDailyCheckinCoins({ coinsGainedToday: '1', streakDays: 254 }), {
    coins: 1,
    source: 'real'
  });
  assert.deepStrictEqual(resolveDailyCheckinCoins({ coinsGainedToday: '40', streakDays: 6 }), {
    coins: 40,
    source: 'real'
  });
  assert.deepStrictEqual(resolveDailyCheckinCoins({ coinsGainedToday: 'N/D', streakDays: 6 }), {
    coins: 35,
    source: 'estimated'
  });
  assert.deepStrictEqual(resolveDailyCheckinCoins({ coinsGainedToday: '0', streakDays: 6 }), {
    coins: 35,
    source: 'estimated'
  });
  assert.strictEqual(resolveDailyCheckinCoins(null).coins, 'N/D');
});

test('2.4.0 - isStreakBreak aceita queda confiável, mas preserva a proteção do ciclo semanal', () => {
  // Sem confiança, 15 -> 6 continua sendo ciclo semanal.
  assert.strictEqual(isStreakBreak(6, 15, false), false);
  // Com leitura real do calendário, a mesma queda é uma quebra verdadeira.
  assert.strictEqual(isStreakBreak(6, 15, false, { trustDetected: true }), true);
  assert.strictEqual(isStreakBreak(1, 200, false, { trustDetected: true }), true);
  // Re-execução no mesmo dia nunca alerta.
  assert.strictEqual(isStreakBreak(6, 15, true, { trustDetected: true }), false);
  // Progressão normal não alerta.
  assert.strictEqual(isStreakBreak(16, 15, false, { trustDetected: true }), false);
});

test('2.4.0 - nextLongestStreak recalibra recorde legado apenas com leitura confiável', () => {
  assert.strictEqual(nextLongestStreak(200, 27), 200);
  assert.strictEqual(nextLongestStreak(200, 27, { trusted: true, previousSource: 'estimate' }), 27);
  assert.strictEqual(nextLongestStreak(200, 27, { trusted: true, previousSource: 'trusted' }), 200);
  assert.strictEqual(nextLongestStreak(undefined, 27, { trusted: true }), 27);
  assert.strictEqual(nextLongestStreak(10, 11, { trusted: true }), 11);
});

test('2.4.0 - relatórios expõem schemaVersion estável', () => {
  const payload = buildUnifiedReportPayload(
    {
      userEmail: 'u@example.com',
      alreadyCollected: false,
      coinsGainedToday: '40',
      streakDays: 10,
      totalBalance: '100',
      duration: '1s'
    },
    null,
    { mainStartTime: new Date(), mainEndTime: new Date(), totalDuration: '1s' }
  );
  assert.strictEqual(payload.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.strictEqual(payload.schemaVersion, 1);
});

test('2.4.0 - URL de resultado da busca exige HTTPS e host AliExpress', () => {
  assert.strictEqual(
    isCoinSearchResultUrl('https://m.aliexpress.com/p/coin-search/result.html?q=x'),
    true
  );
  assert.strictEqual(
    isCoinSearchResultUrl('http://m.aliexpress.com/p/coin-search/result.html'),
    false,
    'HTTP não deve ser aceito'
  );
  assert.strictEqual(
    isCoinSearchResultUrl('https://aliexpress.com.evil.example/p/coin-search/result.html'),
    false,
    'host externo com sufixo falso não deve ser aceito'
  );
  assert.strictEqual(
    isCoinSearchResultUrl('https://evil-aliexpress.com/p/coin-search/result.html'),
    false
  );
  assert.strictEqual(isAllowedAliExpressHost('www.aliexpress.com'), true);
  assert.strictEqual(isAllowedAliExpressHost('aliexpress.com'), true);
  assert.strictEqual(isAllowedAliExpressHost('not-aliexpress.com.evil'), false);
});

test('2.4.0 - closePopupWithTimeout não prende quando o renderer não fecha', async () => {
  const start = Date.now();
  await closePopupWithTimeout(
    {
      close: () => new Promise(() => {})
    },
    25
  );
  assert.ok(Date.now() - start < 1000, 'o timeout deve liberar a execução');
  await closePopupWithTimeout(null);
});

test('2.4.0 - classifySessionCheck distingue sessão expirada de falha de layout', () => {
  assert.strictEqual(
    classifySessionCheck({
      desktop: { totalBalance: '5245', desktopStreak: 254 }
    }).ok,
    true
  );
  const gate = classifySessionCheck({
    desktop: { totalBalance: 'N/D', desktopStreak: null, loginPromptDetected: true }
  });
  assert.strictEqual(gate.ok, false);
  assert.match(gate.reason, /login/i);

  const layout = classifySessionCheck({
    desktop: { totalBalance: 'N/D', desktopStreak: null, loginPromptDetected: false }
  });
  assert.strictEqual(layout.ok, false);
  assert.match(layout.reason, /Saldo/);

  const local = classifySessionCheck({ sessionValid: false, sessionReason: 'cookie expirado' });
  assert.strictEqual(local.ok, false);
  assert.strictEqual(local.reason, 'cookie expirado');
});

test('2.4.0 - isSessionTokenExpired rejeita somente datas válidas no passado', () => {
  assert.strictEqual(isSessionTokenExpired({ expiresAt: '2020-01-01T00:00:00.000Z' }), true);
  assert.strictEqual(isSessionTokenExpired({ expiresAt: '2999-01-01T00:00:00.000Z' }), false);
  assert.strictEqual(isSessionTokenExpired({}), false);
  assert.strictEqual(isSessionTokenExpired(null), false);
  assert.strictEqual(isSessionTokenExpired({ expiresAt: 'not-a-date' }), false);
});

test('2.4.0 - isLoginGateVisible prioriza DOM e ignora link de rodapé em página autenticada', async () => {
  const gatePage = {
    url: () => 'https://m.aliexpress.com/p/coin-index/index.html',
    $: async (_selector) => (String(_selector).includes('Log in') ? {} : null)
  };
  assert.strictEqual(await isLoginGateVisible(gatePage), true);

  const authenticatedPage = {
    url: () => 'https://m.aliexpress.com/p/coin-index/index.html',
    $: async () => ({})
  };
  assert.strictEqual(await isLoginGateVisible(authenticatedPage), false);

  const footerPage = {
    url: () => 'https://m.aliexpress.com/p/coin-pc-index/mycoin.html',
    $: async () => null
  };
  assert.strictEqual(await isLoginGateVisible(footerPage), false);
});

test('2.4.0 - import_session rejeita token expirado por padrão e aceita com --allow-expired', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-expired-');

  const makeToken = (expiresAt) =>
    encryptSession(
      JSON.stringify({
        session: {
          cookies: [{ name: 'xman_us_t', value: 'expired_cookie', expires: 9999999999 }],
          origins: []
        },
        meta: { user: 'expired_user@example.com', expiresAt }
      }),
      TEST_SECRET
    );

  try {
    const expiredToken = makeToken('2020-01-01T00:00:00.000Z');
    await assert.rejects(
      importSession({
        secret: TEST_SECRET,
        tokenString: expiredToken,
        baseDir: tmpDir,
        plaintext: true
      }),
      (err) => {
        assert.ok(err instanceof ImportSessionError);
        assert.match(err.message, /expirou/i);
        return true;
      }
    );

    // Opt-out explícito: o token antigo é aceito (o usuário assume o risco).
    const accepted = await importSession({
      secret: TEST_SECRET,
      tokenString: expiredToken,
      baseDir: tmpDir,
      plaintext: true,
      allowExpired: true
    });
    assert.strictEqual(accepted.user, 'expired_user@example.com');
    assert.strictEqual(accepted.encrypted, false);
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('2.4.0 - import_session remove o arquivo de token após sucesso e respeita --keep-tokens', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-token-cleanup-');

  const buildTokenFile = async (fileName) => {
    const tokenPath = path.join(tmpDir, fileName);
    const token = encryptSession(
      JSON.stringify({
        session: {
          cookies: [{ name: 'xman_us_t', value: 'cleanup_cookie', expires: 9999999999 }],
          origins: []
        },
        meta: { user: 'cleanup_user@example.com', expiresAt: '2999-01-01T00:00:00.000Z' }
      }),
      TEST_SECRET
    );
    await fs.promises.writeFile(tokenPath, token, 'utf-8');
    return tokenPath;
  };

  try {
    const removable = await buildTokenFile('session_token.txt');
    await importSession({
      secret: TEST_SECRET,
      fromFile: removable,
      baseDir: tmpDir,
      plaintext: true
    });
    assert.strictEqual(
      fs.existsSync(removable),
      false,
      'o token de uso único deve ser removido após importação bem-sucedida'
    );

    const preserved = await buildTokenFile('session_token_keep.txt');
    await importSession({
      secret: TEST_SECRET,
      fromFile: preserved,
      baseDir: tmpDir,
      plaintext: true,
      keepTokens: true
    });
    assert.strictEqual(
      fs.existsSync(preserved),
      true,
      '--keep-tokens deve preservar o arquivo de token'
    );
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
