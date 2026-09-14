const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  loadSessionFiles,
  saveSession,
  validateAndRefresh,
  clearSession,
  isImportedSession,
  rotateSessionSecret,
  pruneSessionBackups,
  getEncryptionConfig
} = require('../libs/session');
const { encryptSession } = require('../security');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

const TEST_SECRET_1 = 'chave-secreta-de-teste-com-mais-de-32-caracteres-1!';
const TEST_SECRET_2 = 'segunda-chave-secreta-para-rotacao-com-mais-32-chars-2!';

test('libs/session.js - salvar e carregar sessão em ambiente isolado (sem criptografia)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-test-');

  try {
    const fakeState = {
      cookies: [
        { name: 'xman_us_t', value: 'token123', expires: Math.floor(Date.now() / 1000) + 3600 }
      ]
    };

    await saveSession(fakeState, 'user@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false
    });
    assert.ok(
      fs.existsSync(path.join(tmpDir, 'session.json')),
      'session.json deve existir no diretório temporário isolado'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, 'session_meta.json')),
      'session_meta.json deve existir no diretório temporário isolado'
    );

    const loaded = await loadSessionFiles({ baseDir: tmpDir, encryptLocalSession: false });
    assert.strictEqual(loaded.sessionData.cookies[0].name, 'xman_us_t');
    assert.strictEqual(loaded.metaData.user, 'user@example.com');

    await clearSession({ baseDir: tmpDir, encryptLocalSession: false });
    assert.ok(
      !fs.existsSync(path.join(tmpDir, 'session.json')),
      'session.json temporário deve ser removido após clearSession'
    );
    assert.ok(
      !fs.existsSync(path.join(tmpDir, 'session_meta.json')),
      'session_meta.json temporário deve ser removido após clearSession'
    );
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - criptografia at-rest (.enc) roundtrip completo em ambiente isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-enc-test-');

  try {
    const fakeState = {
      cookies: [
        {
          name: 'xman_us_t',
          value: 'secret_token_val',
          expires: Math.floor(Date.now() / 1000) + 3600
        }
      ],
      origins: [
        { origin: 'https://aliexpress.com', localStorage: [{ name: 'theme', value: 'dark' }] }
      ]
    };

    // Salvar com criptografia
    await saveSession(fakeState, 'crypto_user@example.com', {
      baseDir: tmpDir,
      secret: TEST_SECRET_1
    });

    const encFile = path.join(tmpDir, 'session.json.enc');
    const plainFile = path.join(tmpDir, 'session.json');

    assert.ok(fs.existsSync(encFile), 'session.json.enc deve existir');
    assert.ok(!fs.existsSync(plainFile), 'session.json puro NÃO deve existir');

    const encRaw = fs.readFileSync(encFile, 'utf-8');
    assert.ok(encRaw.startsWith('v2:'), 'Payload salvo deve ser token AES-256-GCM v2');
    assert.ok(
      !encRaw.includes('secret_token_val'),
      'Token bruto não deve conter segredos em claro'
    );

    // Carregar sessão descriptografando
    const loaded = await loadSessionFiles({
      baseDir: tmpDir,
      secret: TEST_SECRET_1
    });

    assert.ok(loaded.sessionData !== null);
    assert.strictEqual(loaded.sessionData.cookies[0].value, 'secret_token_val');
    assert.strictEqual(loaded.metaData.user, 'crypto_user@example.com');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - migração transparente de sessão legada .json para .json.enc', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-migration-test-');

  try {
    const plainFile = path.join(tmpDir, 'session.json');
    const encFile = path.join(tmpDir, 'session.json.enc');

    const legacyPayload = {
      cookies: [
        {
          name: 'login_aliyunid_ticket',
          value: 'ticket_legacy_999',
          expires: Math.floor(Date.now() / 1000) + 7200
        }
      ]
    };
    fs.writeFileSync(plainFile, JSON.stringify(legacyPayload, null, 2), 'utf-8');

    // Ao carregar com secret configurado, deve ler o legado e migrar para .enc
    const loaded = await loadSessionFiles({
      baseDir: tmpDir,
      secret: TEST_SECRET_1
    });

    assert.ok(loaded.sessionData !== null);
    assert.strictEqual(loaded.sessionData.cookies[0].value, 'ticket_legacy_999');

    // session.json deve ter sido migrado e removido
    assert.ok(fs.existsSync(encFile), 'session.json.enc deve ter sido criado na migração');
    assert.ok(!fs.existsSync(plainFile), 'session.json legado em claro deve ter sido removido');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - rotação de chaves criptográficas com SESSION_SECRET_OLD', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-rotation-test-');

  try {
    const encFile = path.join(tmpDir, 'session.json.enc');
    const payload = {
      cookies: [
        { name: 'xman_us_t', value: 'token_rotated', expires: Math.floor(Date.now() / 1000) + 3600 }
      ]
    };

    // Criptografado com CHAVE 1 (chave antiga)
    const encryptedWithOldSecret = encryptSession(JSON.stringify(payload), TEST_SECRET_1);
    fs.writeFileSync(encFile, encryptedWithOldSecret, 'utf-8');

    // Tentativa de carregar com CHAVE 2 como nova e CHAVE 1 como oldSecret
    const loaded = await loadSessionFiles({
      baseDir: tmpDir,
      secret: TEST_SECRET_2,
      oldSecret: TEST_SECRET_1
    });

    assert.ok(loaded.sessionData !== null);
    assert.strictEqual(loaded.sessionData.cookies[0].value, 'token_rotated');

    // O arquivo .enc deve ter sido re-criptografado com a nova CHAVE 2
    const reloadedWithNewSecretOnly = await loadSessionFiles({
      baseDir: tmpDir,
      secret: TEST_SECRET_2
    });
    assert.ok(reloadedWithNewSecretOnly.sessionData !== null);
    assert.strictEqual(reloadedWithNewSecretOnly.sessionData.cookies[0].value, 'token_rotated');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - clearSession gera backup versionado em scratch/ antes de remover', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-backup-test-');

  try {
    const fakeState = {
      cookies: [
        {
          name: 'xman_us_t',
          value: 'token_to_clear',
          expires: Math.floor(Date.now() / 1000) + 3600
        }
      ]
    };

    await saveSession(fakeState, 'clear_user@example.com', {
      baseDir: tmpDir,
      secret: TEST_SECRET_1
    });

    const encFile = path.join(tmpDir, 'session.json.enc');
    assert.ok(fs.existsSync(encFile));

    // Executar limpeza da sessão
    await clearSession({
      baseDir: tmpDir,
      secret: TEST_SECRET_1
    });

    assert.ok(!fs.existsSync(encFile), 'session.json.enc deve ter sido removido');

    // Verificar se backup versionado foi gerado em scratch/
    const scratchPath = path.join(tmpDir, 'scratch');
    assert.ok(fs.existsSync(scratchPath), 'scratch/ deve ter sido criado');
    const backups = fs
      .readdirSync(scratchPath)
      .filter((f) => f.startsWith('session.bak-') && f.endsWith('.json.enc'));
    assert.strictEqual(backups.length, 1, 'Deve existir exatamente 1 arquivo de backup');
    const bakContent = fs.readFileSync(path.join(scratchPath, backups[0]), 'utf-8');
    assert.ok(bakContent.startsWith('v2:'), 'Backup deve estar devidamente criptografado');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - validateAndRefresh invalida sessão divergente isolada', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-test-');

  try {
    const fakeState = {
      cookies: [
        { name: 'xman_us_t', value: 'token123', expires: Math.floor(Date.now() / 1000) + 3600 }
      ]
    };
    await saveSession(fakeState, 'usuario1@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false
    });

    const refreshed = await validateAndRefresh('usuario2@example.com', null, {
      baseDir: tmpDir,
      encryptLocalSession: false
    });
    assert.strictEqual(refreshed.valid, false);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'session.json')), false);
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - validateAndRefresh aceita sessão válida correspondente isolada', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-test-');

  try {
    const fakeState = {
      cookies: [
        { name: 'xman_us_t', value: 'token123', expires: Math.floor(Date.now() / 1000) + 3600 }
      ]
    };
    await saveSession(fakeState, 'user_ok@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false
    });

    const refreshed = await validateAndRefresh('user_ok@example.com', null, {
      baseDir: tmpDir,
      encryptLocalSession: false
    });
    assert.strictEqual(refreshed.valid, true);
    assert.strictEqual(refreshed.metaData.user, 'user_ok@example.com');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - isImportedSession e rastreamento de sessão remota importada em validateAndRefresh', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('imported-session-test-');

  try {
    // 1. isImportedSession helper
    assert.strictEqual(isImportedSession(null), false);
    assert.strictEqual(isImportedSession({ user: 'local' }), false);
    assert.strictEqual(isImportedSession({ user: 'remote', isImported: true }), true);
    assert.strictEqual(
      isImportedSession({ user: 'remote', importedAt: '2026-09-14T00:00:00Z' }),
      true
    );

    // 2. validateAndRefresh preserva isImported: true em sessão importada válida
    const sPath = path.join(tmpDir, 'session.json');
    const mPath = path.join(tmpDir, 'session_meta.json');

    const validSession = {
      cookies: [
        { name: 'xman_us_t', value: 'token123', expires: Math.floor(Date.now() / 1000) + 3600 }
      ]
    };
    const importedMeta = {
      user: 'remote_user@example.com',
      isImported: true,
      importedAt: new Date().toISOString()
    };

    fs.writeFileSync(sPath, JSON.stringify(validSession, null, 2), 'utf-8');
    fs.writeFileSync(mPath, JSON.stringify(importedMeta, null, 2), 'utf-8');

    const resValid = await validateAndRefresh('remote_user@example.com', null, {
      baseDir: tmpDir,
      encryptLocalSession: false
    });
    assert.strictEqual(resValid.valid, true);
    assert.strictEqual(resValid.isImported, true);

    // 3. validateAndRefresh preserva isImported: true mesmo quando a sessão expirou
    const expiredSession = {
      cookies: [
        { name: 'xman_us_t', value: 'token123', expires: Math.floor(Date.now() / 1000) - 3600 }
      ]
    };
    fs.writeFileSync(sPath, JSON.stringify(expiredSession, null, 2), 'utf-8');
    fs.writeFileSync(mPath, JSON.stringify(importedMeta, null, 2), 'utf-8');

    const resExpired = await validateAndRefresh('remote_user@example.com', null, {
      baseDir: tmpDir,
      encryptLocalSession: false
    });
    assert.strictEqual(resExpired.valid, false);
    assert.strictEqual(resExpired.isImported, true);
    assert.ok(resExpired.previousMeta);
    assert.strictEqual(resExpired.previousMeta.user, 'remote_user@example.com');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - rotateSessionSecret re-criptografa at-rest e cria backup em scratch/', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-rotate-func-');

  try {
    const fakeState = {
      cookies: [
        {
          name: 'xman_us_t',
          value: 'token_to_rotate',
          expires: Math.floor(Date.now() / 1000) + 3600
        }
      ]
    };

    await saveSession(fakeState, 'rotation_user@example.com', {
      baseDir: tmpDir,
      secret: TEST_SECRET_1
    });

    const encFile = path.join(tmpDir, 'session.json.enc');
    assert.ok(fs.existsSync(encFile));

    // Executa rotateSessionSecret
    const res = await rotateSessionSecret({
      baseDir: tmpDir,
      oldSecret: TEST_SECRET_1,
      newSecret: TEST_SECRET_2
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.user, 'rotation_user@example.com');
    assert.ok(res.backupPath && fs.existsSync(res.backupPath));

    // Verifica que agora carrega com a nova chave TEST_SECRET_2
    const loaded = await loadSessionFiles({
      baseDir: tmpDir,
      secret: TEST_SECRET_2
    });
    assert.ok(loaded.sessionData !== null);
    assert.strictEqual(loaded.sessionData.cookies[0].value, 'token_to_rotate');

    // Validações de erro
    await assert.rejects(
      () =>
        rotateSessionSecret({
          baseDir: tmpDir,
          oldSecret: TEST_SECRET_2,
          newSecret: TEST_SECRET_2
        }),
      /A nova chave de sessão deve ser diferente/
    );

    await assert.rejects(
      () =>
        rotateSessionSecret({
          baseDir: tmpDir,
          oldSecret: 'short',
          newSecret: TEST_SECRET_2
        }),
      /SESSION_SECRET_OLD é obrigatório/
    );
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - pruneSessionBackups limpa backups antigos segundo retentionDays', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-prune-test-');

  try {
    const scratchDir = path.join(tmpDir, 'scratch');
    fs.mkdirSync(scratchDir, { recursive: true });

    const now = Date.now();
    const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
    const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000);

    const fileOld = path.join(scratchDir, 'session.bak-2026-09-01T00-00-00.json.enc');
    const fileRecent = path.join(scratchDir, 'session.bak-2026-09-12T00-00-00.json.enc');
    const fileAncient = path.join(scratchDir, 'session.bak-2026-08-20T00-00-00.json');

    fs.writeFileSync(fileOld, 'old content', 'utf-8');
    fs.writeFileSync(fileRecent, 'recent content', 'utf-8');
    fs.writeFileSync(fileAncient, 'ancient content', 'utf-8');

    fs.utimesSync(fileOld, tenDaysAgo, tenDaysAgo);
    fs.utimesSync(fileRecent, twoDaysAgo, twoDaysAgo);
    fs.utimesSync(fileAncient, twentyDaysAgo, twentyDaysAgo);

    // Teste 1: dry-run não deve remover
    const dryPruned = await pruneSessionBackups({
      scratchDir,
      retentionDays: 7,
      dryRun: true
    });
    assert.strictEqual(dryPruned.length, 2);
    assert.ok(fs.existsSync(fileOld));
    assert.ok(fs.existsSync(fileRecent));
    assert.ok(fs.existsSync(fileAncient));

    // Teste 2: execução real remove os 2 mais antigos
    const actualPruned = await pruneSessionBackups({
      scratchDir,
      retentionDays: 7,
      dryRun: false
    });
    assert.strictEqual(actualPruned.length, 2);
    assert.ok(!fs.existsSync(fileOld));
    assert.ok(fs.existsSync(fileRecent));
    assert.ok(!fs.existsSync(fileAncient));
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - getEncryptionConfig e tratamento de erros em loadSessionFiles', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-err-branch-');

  try {
    // 1. getEncryptionConfig com env ENCRYPT_LOCAL_SESSION
    const prevEnv = process.env.ENCRYPT_LOCAL_SESSION;
    process.env.ENCRYPT_LOCAL_SESSION = 'false';
    const cfgFalse = getEncryptionConfig({ secret: TEST_SECRET_1 });
    assert.strictEqual(cfgFalse.shouldEncrypt, false);

    process.env.ENCRYPT_LOCAL_SESSION = '0';
    const cfgZero = getEncryptionConfig({ secret: TEST_SECRET_1 });
    assert.strictEqual(cfgZero.shouldEncrypt, false);

    if (prevEnv !== undefined) process.env.ENCRYPT_LOCAL_SESSION = prevEnv;
    else delete process.env.ENCRYPT_LOCAL_SESSION;

    // 2. loadSessionFiles com session.json.enc existente mas secret ausente
    const encFile = path.join(tmpDir, 'session.json.enc');
    fs.writeFileSync(encFile, 'corrupted_or_valid_encrypted', 'utf-8');

    const resNoSecret = await loadSessionFiles({
      baseDir: tmpDir,
      secret: null
    });
    assert.strictEqual(resNoSecret.sessionData, null);

    // 3. loadSessionFiles com chave incorreta e sem oldSecret
    const resBadSecret = await loadSessionFiles({
      baseDir: tmpDir,
      secret: TEST_SECRET_1
    });
    assert.strictEqual(resBadSecret.sessionData, null);

    // 4. loadSessionFiles com chave incorreta e oldSecret também incorreto
    const resBothBad = await loadSessionFiles({
      baseDir: tmpDir,
      secret: TEST_SECRET_1,
      oldSecret: TEST_SECRET_2
    });
    assert.strictEqual(resBothBad.sessionData, null);
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
