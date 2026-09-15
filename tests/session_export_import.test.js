const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { exportSession, isAllowedStorageKey } = require('../export_session');
const { importSession, migrateLegacySession, ImportSessionError } = require('../import_session');
const { loadSessionFiles } = require('../libs/session');
const { safeWriteFile } = require('../security');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

const TEST_SECRET = 'secret_key_with_at_least_32_characters_long_12345';

test('export_session.js - allowlist de localStorage', () => {
  assert.strictEqual(isAllowedStorageKey('login_token'), true);
  assert.strictEqual(isAllowedStorageKey('user_id'), true);
  assert.strictEqual(isAllowedStorageKey('_m_h5_tk'), true);
  assert.strictEqual(isAllowedStorageKey('account_pref'), true);

  // Chaves de telemetria indesejadas devem ser rejeitadas
  assert.strictEqual(isAllowedStorageKey('APLUS_S_CORE'), false);
  assert.strictEqual(isAllowedStorageKey('batman_cache'), false);
  assert.strictEqual(isAllowedStorageKey('goldlog_beacon'), false);
});

test('export_session & import_session - roundtrip completo criptografado (.enc) at-rest por padrão', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('export-import-enc-');

  try {
    const sPath = path.join(tmpDir, 'session.json');
    const encPath = path.join(tmpDir, 'session.json.enc');
    const mPath = path.join(tmpDir, 'session_meta.json');
    const tPath = path.join(tmpDir, 'session_token.txt');

    const fakeSession = {
      cookies: [
        {
          name: 'xman_us_t',
          value: 'authenticated_cookie',
          expires: Math.floor(Date.now() / 1000) + 7200
        }
      ],
      origins: [
        {
          origin: 'https://www.aliexpress.com',
          localStorage: [
            { name: 'user_session_token', value: '123' },
            { name: 'APLUS_S_CORE_LOG', value: 'heavy_telemetry_garbage' }
          ]
        }
      ]
    };

    const fakeMeta = {
      user: 'export_test_user@example.com'
    };

    await safeWriteFile(sPath, JSON.stringify(fakeSession, null, 2));
    await safeWriteFile(mPath, JSON.stringify(fakeMeta, null, 2));

    // Exportar sessão isolada
    const exportRes = await exportSession({
      secret: TEST_SECRET,
      showToken: false,
      baseDir: tmpDir
    });
    assert.ok(exportRes.token.startsWith('v2:'));
    assert.strictEqual(exportRes.user, 'export_test_user@example.com');
    assert.ok(fs.existsSync(tPath));

    // Apagar session.json e session_meta.json do tmpDir para simular máquina remota
    await fs.promises.unlink(sPath);
    await fs.promises.unlink(mPath);

    // Importar sessão no tmpDir (padrão ENCRYPT_LOCAL_SESSION: grava session.json.enc)
    const importRes = await importSession({
      secret: TEST_SECRET,
      tokenString: exportRes.token,
      baseDir: tmpDir
    });
    assert.strictEqual(importRes.user, 'export_test_user@example.com');
    assert.strictEqual(importRes.cookiesCount, 1);
    assert.strictEqual(importRes.encrypted, true);

    // 1. Verificar que session.json.enc foi criado e session.json em texto plano NÃO existe
    assert.ok(fs.existsSync(encPath), 'Deve criar session.json.enc criptografado');
    assert.strictEqual(
      fs.existsSync(sPath),
      false,
      'Não deve criar session.json em texto plano por padrão'
    );

    // 2. Verificar que o conteúdo de session.json.enc é um token criptografado válido
    const encContent = await fs.promises.readFile(encPath, 'utf-8');
    assert.ok(encContent.startsWith('v2:'), 'Conteúdo gravado deve iniciar com v2:');

    // 3. Verificar que o loader nativo (loadSessionFiles) carrega e descriptografa transparentemente
    const loaded = await loadSessionFiles({ baseDir: tmpDir, secret: TEST_SECRET });
    assert.ok(loaded.sessionData, 'loadSessionFiles deve carregar a sessão descriptografada');
    assert.strictEqual(loaded.sessionData.cookies[0].name, 'xman_us_t');
    assert.strictEqual(loaded.sessionData.origins[0].localStorage[0].name, 'user_session_token');

    // 4. Telemetria indesejada foi filtrada durante exportação
    assert.strictEqual(loaded.sessionData.origins[0].localStorage.length, 1);

    // 5. Verificar metadados
    assert.ok(fs.existsSync(mPath));
    const restoredMeta = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
    assert.strictEqual(restoredMeta.isImported, true);
    assert.strictEqual(restoredMeta.encrypted, true);
    assert.ok(restoredMeta.importedAt);
    assert.strictEqual(restoredMeta.user, 'export_test_user@example.com');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('import_session.js - opt-out com flag plaintext grava session.json sem criptografia', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-plaintext-');

  try {
    const sPath = path.join(tmpDir, 'session.json');
    const encPath = path.join(tmpDir, 'session.json.enc');
    const mPath = path.join(tmpDir, 'session_meta.json');

    const fakeSession = {
      cookies: [{ name: 'xman_us_t', value: 'opt_out_token', expires: 9999999999 }],
      origins: []
    };
    await safeWriteFile(sPath, JSON.stringify(fakeSession, null, 2));

    const exportRes = await exportSession({
      secret: TEST_SECRET,
      showToken: false,
      baseDir: tmpDir
    });
    await fs.promises.unlink(sPath);

    // Importar explicitamente em plaintext
    const importRes = await importSession({
      secret: TEST_SECRET,
      tokenString: exportRes.token,
      baseDir: tmpDir,
      plaintext: true
    });

    assert.strictEqual(importRes.encrypted, false);
    assert.ok(fs.existsSync(sPath), 'Deve criar session.json em texto claro');
    assert.strictEqual(fs.existsSync(encPath), false, 'Não deve criar session.json.enc');

    const restoredSession = JSON.parse(await fs.promises.readFile(sPath, 'utf-8'));
    assert.strictEqual(restoredSession.cookies[0].value, 'opt_out_token');

    const restoredMeta = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
    assert.strictEqual(restoredMeta.encrypted, false);
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('import_session.js - migração de session.json legado para session.json.enc', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-migration-');

  try {
    const sPath = path.join(tmpDir, 'session.json');
    const encPath = path.join(tmpDir, 'session.json.enc');
    const mPath = path.join(tmpDir, 'session_meta.json');

    const legacySession = {
      cookies: [{ name: 'xman_us_t', value: 'legacy_cookie_val' }],
      origins: []
    };
    const legacyMeta = { user: 'legacy_user@example.com' };

    await safeWriteFile(sPath, JSON.stringify(legacySession, null, 2));
    await safeWriteFile(mPath, JSON.stringify(legacyMeta, null, 2));

    // Executar migração
    const migResult = await migrateLegacySession({
      baseDir: tmpDir,
      secret: TEST_SECRET
    });

    assert.strictEqual(migResult.migrated, true);
    assert.strictEqual(migResult.user, 'legacy_user@example.com');
    assert.ok(fs.existsSync(encPath), 'Arquivo session.json.enc deve existir após migração');
    assert.strictEqual(fs.existsSync(sPath), false, 'session.json legado deve ter sido removido');

    // Loader consegue carregar a sessão migrada
    const loaded = await loadSessionFiles({ baseDir: tmpDir, secret: TEST_SECRET });
    assert.ok(loaded.sessionData);
    assert.strictEqual(loaded.sessionData.cookies[0].value, 'legacy_cookie_val');

    const meta = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
    assert.strictEqual(meta.encrypted, true);
    assert.ok(meta.migratedAt);
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('import_session.js - remoção de session.json legado ao importar nova sessão criptografada', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-cleanup-legacy-');

  try {
    const sPath = path.join(tmpDir, 'session.json');
    const encPath = path.join(tmpDir, 'session.json.enc');
    const mPath = path.join(tmpDir, 'session_meta.json');

    // 1. Simula um session.json legado existente no host
    await safeWriteFile(
      sPath,
      JSON.stringify({ cookies: [{ name: 'xman_us_t', value: 'old_val' }] })
    );

    // 2. Exporta uma nova sessão
    const newSession = {
      cookies: [{ name: 'xman_us_t', value: 'new_fresh_val' }],
      origins: []
    };
    const newDir = createIsolatedTestDir('import-helper-');
    try {
      await safeWriteFile(path.join(newDir, 'session.json'), JSON.stringify(newSession));
      await safeWriteFile(
        path.join(newDir, 'session_meta.json'),
        JSON.stringify({ user: 'new@example.com' })
      );
      const exported = await exportSession({ secret: TEST_SECRET, baseDir: newDir });

      // 3. Importa no diretório que continha o session.json legado
      await importSession({
        secret: TEST_SECRET,
        tokenString: exported.token,
        baseDir: tmpDir
      });

      assert.ok(fs.existsSync(encPath), 'Novo session.json.enc gravado');
      assert.ok(fs.existsSync(mPath), 'Novo session_meta.json gravado');
      assert.strictEqual(
        fs.existsSync(sPath),
        false,
        'session.json legado deve ter sido limpo após novo .enc'
      );

      const loaded = await loadSessionFiles({ baseDir: tmpDir, secret: TEST_SECRET });
      assert.strictEqual(loaded.sessionData.cookies[0].value, 'new_fresh_val');
    } finally {
      cleanupIsolatedTestDir(newDir);
    }
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('import_session.js - erro seguro quando SESSION_SECRET está ausente ou inválida (< 32 chars)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-secret-err-');

  try {
    // 1. Sem secret
    await assert.rejects(
      async () => {
        await importSession({
          secret: '',
          tokenString: 'v2:test',
          baseDir: tmpDir
        });
      },
      (err) => {
        assert.ok(err instanceof ImportSessionError);
        assert.ok(err.message.includes('SESSION_SECRET é obrigatório'));
        assert.ok(!err.stack.includes('crypto.js'), 'Não deve vazar stack interna de crypto');
        return true;
      }
    );

    // 2. Secret curta (< 32 caracteres)
    await assert.rejects(
      async () => {
        await importSession({
          secret: 'curta',
          tokenString: 'v2:test',
          baseDir: tmpDir
        });
      },
      (err) => {
        assert.ok(err instanceof ImportSessionError);
        assert.ok(err.message.includes('mínimo 32 caracteres'));
        return true;
      }
    );
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
