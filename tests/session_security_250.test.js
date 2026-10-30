'use strict';

// Reduz ruído dos fluxos de importação; os testes validam arquivos/estado, não stdout.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { importSession, importAllSessions } = require('../import_session');
const { exportSession } = require('../export_session');
const { saveSession } = require('../libs/session');
const { validateSession } = require('../security');
const { checkSessionReadOnly } = require('../libs/session-check');
const { createCoinCenterPage, createBrowserForPage } = require('./helpers/playwright-harness');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

const TEST_SECRET = 'secret_key_with_at_least_32_characters_long_12345'; //gitleaks:allow valor fictício de teste
const ENV_KEYS = [
  'ALI_USER',
  'ALI_PASSWORD',
  'ALI_USER_2',
  'ALI_PASSWORD_2',
  'PW_OUTPUT_DIR',
  'ENCRYPT_LOCAL_SESSION'
];

function withEnv(values) {
  const previous = {};
  for (const key of ENV_KEYS) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

function writeSessionFixture(dir, user, cookieValue = 'cookie_de_teste') {
  fs.writeFileSync(
    path.join(dir, 'session.json'),
    JSON.stringify({
      cookies: [
        {
          name: 'xman_us_t',
          value: cookieValue,
          expires: Math.floor(Date.now() / 1000) + 3600
        }
      ],
      origins: []
    }),
    { mode: 0o600 }
  );
  fs.writeFileSync(
    path.join(dir, 'session_meta.json'),
    JSON.stringify({
      user,
      exportedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
    }),
    { mode: 0o600 }
  );
}

async function exportTokenFor(user, cookieValue = 'cookie_de_teste') {
  const sourceDir = createIsolatedTestDir('sec-token-source-');
  writeSessionFixture(sourceDir, user, cookieValue);
  const exported = await exportSession({ secret: TEST_SECRET, baseDir: sourceDir });
  cleanupIsolatedTestDir(sourceDir);
  return exported;
}

test('security 2.5 - expiresAt estimado é aviso; validade real é a dos cookies', () => {
  const futureCookie = {
    name: 'xman_us_t',
    value: 'cookie_vivo',
    expires: Math.floor(Date.now() / 1000) + 3600
  };
  const meta = {
    user: 'user@example.com',
    expiresAt: new Date(Date.now() - 86400 * 1000).toISOString()
  };

  const advisory = validateSession({ cookies: [futureCookie] }, meta, 'user@example.com');
  assert.strictEqual(advisory.valid, true, 'cookies válidos vencem a estimativa de expiração');
  assert.deepStrictEqual(advisory.warnings, [
    { code: 'estimated_expiry_passed', expiresAt: meta.expiresAt }
  ]);

  const expiredCookie = {
    name: 'xman_us_t',
    value: 'cookie_morto',
    expires: Math.floor(Date.now() / 1000) - 60
  };
  const expired = validateSession({ cookies: [expiredCookie] }, meta, 'user@example.com');
  assert.strictEqual(expired.valid, false);
  assert.match(expired.reason, /cookies de autenticação.*expirados/i);
});

test('security 2.5 - --check-session expõe warning de expiresAt sem falhar a sessão', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('sec-check-expiry-');
  const restoreEnv = withEnv({
    PW_OUTPUT_DIR: path.join(tmpDir, 'scratch'),
    ENCRYPT_LOCAL_SESSION: 'false'
  });

  try {
    const user = 'user@example.com';
    const sessionPath = path.join(tmpDir, 'session.json');
    fs.writeFileSync(
      sessionPath,
      JSON.stringify({
        cookies: [
          {
            name: 'xman_us_t',
            value: 'cookie_vivo',
            expires: Math.floor(Date.now() / 1000) + 3600
          }
        ]
      }),
      { mode: 0o600 }
    );
    const expiresAt = new Date(Date.now() - 86400 * 1000).toISOString();
    fs.writeFileSync(
      path.join(tmpDir, 'session_meta.json'),
      JSON.stringify({
        user,
        expiresAt
      }),
      { mode: 0o600 }
    );

    const { browser } = createBrowserForPage(createCoinCenterPage({ balance: '5,245' }));
    const result = await checkSessionReadOnly({
      browser,
      account: { user, sessionPath },
      config: { NAV_TIMEOUT_SHORT: 2000 }
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.balance, '5245');
    assert.deepStrictEqual(result.warnings, [{ code: 'estimated_expiry_passed', expiresAt }]);
  } finally {
    restoreEnv();
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('security 2.5 - importação via --from-file remove token só após sucesso', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('sec-from-file-');
  const restoreEnv = withEnv({
    ALI_USER: 'fromfile@example.com',
    ALI_PASSWORD: 'senha_ficticia',
    ALI_USER_2: undefined,
    ALI_PASSWORD_2: undefined,
    PW_OUTPUT_DIR: path.join(tmpDir, 'scratch')
  });

  try {
    const exported = await exportTokenFor('fromfile@example.com');
    const tokenFile = path.join(tmpDir, 'session_token.txt');
    fs.writeFileSync(tokenFile, exported.token, { mode: 0o600 });

    const result = await importSession({
      secret: TEST_SECRET,
      fromFile: tokenFile,
      baseDir: tmpDir
    });

    assert.strictEqual(result.user, 'fromfile@example.com');
    assert.strictEqual(fs.existsSync(tokenFile), false, 'token de uso único deve ser removido');
    assert.ok(fs.existsSync(path.join(tmpDir, 'session.json.enc')));
  } finally {
    restoreEnv();
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('security 2.5 - falha de importação preserva o token para retry', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('sec-from-file-fail-');
  const restoreEnv = withEnv({
    ALI_USER: 'failfile@example.com',
    ALI_PASSWORD: 'senha_ficticia',
    ALI_USER_2: undefined,
    ALI_PASSWORD_2: undefined,
    PW_OUTPUT_DIR: path.join(tmpDir, 'scratch')
  });

  try {
    const tokenFile = path.join(tmpDir, 'session_token.txt');
    fs.writeFileSync(tokenFile, 'token_invalido_sem_formato', { mode: 0o600 });

    await assert.rejects(
      importSession({ secret: TEST_SECRET, fromFile: tokenFile, baseDir: tmpDir }),
      /Formato|token|inválid/i
    );
    assert.strictEqual(fs.existsSync(tokenFile), true, 'falha não pode consumir o token');
  } finally {
    restoreEnv();
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('security 2.5 - --keep-tokens preserva arquivo com permissão 0o600', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('sec-keep-token-');
  const restoreEnv = withEnv({
    ALI_USER: 'keepfile@example.com',
    ALI_PASSWORD: 'senha_ficticia',
    ALI_USER_2: undefined,
    ALI_PASSWORD_2: undefined,
    PW_OUTPUT_DIR: path.join(tmpDir, 'scratch')
  });

  try {
    const exported = await exportTokenFor('keepfile@example.com');
    const tokenFile = path.join(tmpDir, 'session_token.txt');
    fs.writeFileSync(tokenFile, exported.token, { mode: 0o600 });

    await importSession({
      secret: TEST_SECRET,
      fromFile: tokenFile,
      keepTokens: true,
      baseDir: tmpDir
    });

    assert.strictEqual(fs.existsSync(tokenFile), true);
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(tokenFile).mode & 0o777, 0o600);
    }
  } finally {
    restoreEnv();
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('security 2.5 - STDIN/token em memória nunca remove arquivo sentinela', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('sec-stdin-token-');
  const restoreEnv = withEnv({
    ALI_USER: 'stdin@example.com',
    ALI_PASSWORD: 'senha_ficticia',
    ALI_USER_2: undefined,
    ALI_PASSWORD_2: undefined,
    PW_OUTPUT_DIR: path.join(tmpDir, 'scratch')
  });

  try {
    const sentinel = path.join(tmpDir, 'session_token.txt');
    fs.writeFileSync(sentinel, 'token_que_nao_veio_de_arquivo', { mode: 0o600 });
    const exported = await exportTokenFor('stdin@example.com');

    await importSession({ secret: TEST_SECRET, tokenString: exported.token, baseDir: tmpDir });

    assert.strictEqual(fs.existsSync(sentinel), true, 'sem --from-file não há path para remover');
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'token_que_nao_veio_de_arquivo');
  } finally {
    restoreEnv();
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('security 2.5 - lote remove tokens importados e preserva o token que falhou', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('sec-batch-token-');
  const restoreEnv = withEnv({
    ALI_USER: 'batch1@example.com',
    ALI_PASSWORD: 'senha1_ficticia',
    ALI_USER_2: 'batch2@example.com',
    ALI_PASSWORD_2: 'senha2_ficticia',
    PW_OUTPUT_DIR: path.join(tmpDir, 'scratch')
  });

  try {
    const exported = await exportTokenFor('batch1@example.com');
    const token1 = path.join(tmpDir, 'session_token.txt');
    const token2 = path.join(tmpDir, 'session_token_2.txt');
    fs.writeFileSync(token1, exported.token, { mode: 0o600 });
    fs.writeFileSync(token2, 'token_invalido_sem_formato', { mode: 0o600 });

    const result = await importAllSessions({ secret: TEST_SECRET, baseDir: tmpDir });

    assert.strictEqual(result.imported.length, 1);
    assert.strictEqual(result.failed.length, 1);
    assert.strictEqual(fs.existsSync(token1), false, 'token importado deve ser removido');
    assert.strictEqual(fs.existsSync(token2), true, 'token com falha deve ser preservado');
  } finally {
    restoreEnv();
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('security 2.5 - sessão em texto plano e metadados também usam 0o600', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('sec-plain-perm-');

  try {
    await saveSession(
      {
        cookies: [
          {
            name: 'xman_us_t',
            value: 'token_plain',
            expires: Math.floor(Date.now() / 1000) + 3600
          }
        ]
      },
      'plain@example.com',
      { baseDir: tmpDir, encryptLocalSession: false }
    );

    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(path.join(tmpDir, 'session.json')).mode & 0o777, 0o600);
      assert.strictEqual(fs.statSync(path.join(tmpDir, 'session_meta.json')).mode & 0o777, 0o600);
    }
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
