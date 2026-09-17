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
  isPrunableArtifact,
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
    assert.ok(
      encRaw.startsWith('v2:') || encRaw.startsWith('v3:'),
      'Payload salvo deve ser token AES-256-GCM v2 ou v3'
    );
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
    assert.ok(
      bakContent.startsWith('v2:') || bakContent.startsWith('v3:'),
      'Backup deve estar devidamente criptografado'
    );
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
    assert(!fs.existsSync(fileAncient));
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - pruneSessionBackups e isPrunableArtifact removem traces e prints antigos e protegem session.json e cron.log', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('diagnostics-prune-test-');

  try {
    // 1. Testar isPrunableArtifact
    assert.strictEqual(
      isPrunableArtifact('session.json'),
      false,
      'session.json deve ser protegido'
    );
    assert.strictEqual(
      isPrunableArtifact('session.json.enc'),
      false,
      'session.json.enc deve ser protegido'
    );
    assert.strictEqual(
      isPrunableArtifact('session_meta.json'),
      false,
      'session_meta.json deve ser protegido'
    );
    assert.strictEqual(isPrunableArtifact('cron.log'), false, 'cron.log deve ser protegido');
    assert.strictEqual(
      isPrunableArtifact('credentials.env'),
      false,
      'credentials.env deve ser protegido'
    );

    assert.strictEqual(isPrunableArtifact('tasks-failed-trace-1789424968716.zip'), true);
    assert.strictEqual(isPrunableArtifact('tasks_drawer_failed.png'), true);
    assert.strictEqual(isPrunableArtifact('failure-123.png'), true);
    assert.strictEqual(isPrunableArtifact('dom-2026-09-14T22-29-28-592Z.hash.txt'), true);
    assert.strictEqual(isPrunableArtifact('mobile_body.html'), true);
    assert.strictEqual(isPrunableArtifact('session.bak-2026-09-01.json.enc'), true);

    // 2. Testar poda no diretório scratch
    const scratchDir = path.join(tmpDir, 'scratch');
    fs.mkdirSync(scratchDir, { recursive: true });

    const now = Date.now();
    const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    // Artefatos elegíveis antigos
    const traceOld = path.join(scratchDir, 'tasks-failed-trace-1789000000000.zip');
    const pngOld = path.join(scratchDir, 'tasks_drawer_failed.png');
    const hashOld = path.join(scratchDir, 'dom-2026-09-01T00-00-00-000Z.hash.txt');

    // Artefatos elegíveis recentes
    const traceRecent = path.join(scratchDir, 'tasks-failed-trace-1789999999999.zip');
    const pngRecent = path.join(scratchDir, 'failure-recent.png');

    // Arquivos protegidos (mesmo antigos)
    const sessionProtected = path.join(scratchDir, 'session.json');
    const sessionEncProtected = path.join(scratchDir, 'session.json.enc');
    const metaProtected = path.join(scratchDir, 'session_meta.json');
    const cronProtected = path.join(scratchDir, 'cron.log');

    fs.writeFileSync(traceOld, 'zip trace content');
    fs.writeFileSync(pngOld, 'png content');
    fs.writeFileSync(hashOld, 'hash content');
    fs.writeFileSync(traceRecent, 'recent trace');
    fs.writeFileSync(pngRecent, 'recent png');
    fs.writeFileSync(sessionProtected, '{"user":"test"}');
    fs.writeFileSync(sessionEncProtected, 'encrypted content');
    fs.writeFileSync(metaProtected, '{"meta":1}');
    fs.writeFileSync(cronProtected, 'log output');

    fs.utimesSync(traceOld, tenDaysAgo, tenDaysAgo);
    fs.utimesSync(pngOld, tenDaysAgo, tenDaysAgo);
    fs.utimesSync(hashOld, tenDaysAgo, tenDaysAgo);
    fs.utimesSync(traceRecent, oneDayAgo, oneDayAgo);
    fs.utimesSync(pngRecent, oneDayAgo, oneDayAgo);
    fs.utimesSync(sessionProtected, thirtyDaysAgo, thirtyDaysAgo);
    fs.utimesSync(sessionEncProtected, thirtyDaysAgo, thirtyDaysAgo);
    fs.utimesSync(metaProtected, thirtyDaysAgo, thirtyDaysAgo);
    fs.utimesSync(cronProtected, thirtyDaysAgo, thirtyDaysAgo);

    // Dry-run: identifica os 3 antigos mas não apaga
    const dryPruned = await pruneSessionBackups({
      scratchDir,
      retentionDays: 7,
      dryRun: true
    });
    assert.strictEqual(dryPruned.length, 3);
    assert.ok(fs.existsSync(traceOld));
    assert.ok(fs.existsSync(pngOld));
    assert.ok(fs.existsSync(hashOld));

    // Execução real: remove os 3 antigos elegíveis
    const actualPruned = await pruneSessionBackups({
      scratchDir,
      retentionDays: 7,
      dryRun: false
    });
    assert.strictEqual(actualPruned.length, 3);
    assert.ok(!fs.existsSync(traceOld), 'Trace antigo deve ser removido');
    assert.ok(!fs.existsSync(pngOld), 'PNG antigo deve ser removido');
    assert.ok(!fs.existsSync(hashOld), 'Hash antigo deve ser removido');

    // Recentes mantidos
    assert.ok(fs.existsSync(traceRecent), 'Trace recente deve ser mantido');
    assert.ok(fs.existsSync(pngRecent), 'PNG recente deve ser mantido');

    // Protegidos mantidos mesmo com 30 dias
    assert.ok(fs.existsSync(sessionProtected), 'session.json protegido nunca deve ser apagado');
    assert.ok(
      fs.existsSync(sessionEncProtected),
      'session.json.enc protegido nunca deve ser apagado'
    );
    assert.ok(fs.existsSync(metaProtected), 'session_meta.json protegido nunca deve ser apagado');
    assert.ok(fs.existsSync(cronProtected), 'cron.log protegido nunca deve ser apagado');
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

test(
  'libs/session.js - erro de I/O (EACCES) preserva session.json.enc e metadados sem exclusão',
  { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) },
  async () => {
    const realFilesSnapshot = snapshotRealFiles();
    const tmpDir = createIsolatedTestDir('session-eacces-');

    const encFile = path.join(tmpDir, 'session.json.enc');
    const metaFile = path.join(tmpDir, 'session_meta.json');

    try {
      const payload = JSON.stringify({
        session: {
          cookies: [{ name: 'xman_us_t', value: 'abc', expires: 0 }]
        },
        meta: { user: 'user@example.com' }
      });
      fs.writeFileSync(encFile, encryptSession(payload, TEST_SECRET_1), 'utf-8');
      fs.writeFileSync(metaFile, JSON.stringify({ user: 'user@example.com' }), 'utf-8');

      fs.chmodSync(encFile, 0o000);
      fs.chmodSync(metaFile, 0o000);

      const res = await loadSessionFiles({ baseDir: tmpDir, secret: TEST_SECRET_1 });

      assert.strictEqual(res.sessionData, null, 'Sem permissão de leitura, sessão não é carregada');
      assert.ok(
        fs.existsSync(encFile),
        'session.json.enc NUNCA deve ser removido por erro transitório de I/O'
      );
      assert.ok(
        fs.existsSync(metaFile),
        'session_meta.json NUNCA deve ser removido por erro transitório de I/O'
      );
    } finally {
      try {
        fs.chmodSync(encFile, 0o600);
        fs.chmodSync(metaFile, 0o600);
      } catch {}
      cleanupIsolatedTestDir(tmpDir);
      assertRealFilesUntouched(realFilesSnapshot);
    }
  }
);

test('libs/session.js - session.json com JSON malformado é preservado sem exclusão automática', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-malformed-');

  const plainFile = path.join(tmpDir, 'session.json');

  try {
    fs.writeFileSync(plainFile, '{ isto nao e um json valido', 'utf-8');

    const res = await loadSessionFiles({ baseDir: tmpDir, encryptLocalSession: false });

    assert.strictEqual(res.sessionData, null);
    assert.ok(
      fs.existsSync(plainFile),
      'Arquivo malformado deve ser preservado (política não-destrutiva)'
    );
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - falha na migração preserva o session.json em texto claro', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-migrate-fail-');

  const plainFile = path.join(tmpDir, 'session.json');

  try {
    const fakeState = {
      cookies: [{ name: 'xman_us_t', value: 'token123', expires: 0 }]
    };
    fs.writeFileSync(plainFile, JSON.stringify(fakeState), 'utf-8');

    // Diretório no lugar do .enc força a falha do rename atômico durante a migração
    fs.mkdirSync(path.join(tmpDir, 'session.json.enc'));

    const res = await loadSessionFiles({ baseDir: tmpDir, secret: TEST_SECRET_1 });

    assert.ok(fs.existsSync(plainFile), 'session.json deve sobreviver à falha de migração');
    assert.strictEqual(res.sessionData.cookies[0].name, 'xman_us_t');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - freshLogin limpa marcadores de sessão importada e preserva nos demais casos', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-fresh-login-');

  const fakeState = {
    cookies: [{ name: 'xman_us_t', value: 'token_fresh', expires: 0 }],
    origins: []
  };

  try {
    const metaPath = path.join(tmpDir, 'session_meta.json');
    await saveSession(fakeState, 'fresh@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false,
      freshLogin: true
    });
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ user: 'fresh@example.com', isImported: true, importedAt: '2026-01-01' })
    );

    await saveSession(fakeState, 'fresh@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false,
      freshLogin: true
    });
    const freshMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    assert.strictEqual(
      freshMeta.isImported,
      undefined,
      'isImported deve ser removido em login novo'
    );
    assert.strictEqual(
      freshMeta.importedAt,
      undefined,
      'importedAt deve ser removido em login novo'
    );

    await saveSession(fakeState, 'fresh@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false
    });
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ user: 'fresh@example.com', isImported: true, importedAt: '2026-01-01' })
    );
    await saveSession(fakeState, 'fresh@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false
    });
    const preservedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    assert.strictEqual(preservedMeta.isImported, true, 'Sem freshLogin o marcador é preservado');
    assert.strictEqual(preservedMeta.importedAt, '2026-01-01');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
