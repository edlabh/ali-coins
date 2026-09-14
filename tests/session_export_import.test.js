const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { exportSession, isAllowedStorageKey } = require('../export_session');
const { importSession } = require('../import_session');
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

test('export_session & import_session - roundtrip completo em ambiente isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('export-import-test-');

  try {
    const sPath = path.join(tmpDir, 'session.json');
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

    // Importar sessão no tmpDir
    const importRes = await importSession({
      secret: TEST_SECRET,
      tokenString: exportRes.token,
      baseDir: tmpDir
    });
    assert.strictEqual(importRes.user, 'export_test_user@example.com');
    assert.strictEqual(importRes.cookiesCount, 1);

    // Verificar que session.json foi restaurado e telemetry filtrada dentro do tmpDir
    assert.ok(fs.existsSync(sPath));
    const restoredSession = JSON.parse(await fs.promises.readFile(sPath, 'utf-8'));
    assert.strictEqual(restoredSession.cookies[0].name, 'xman_us_t');

    const lsItems = restoredSession.origins[0].localStorage;
    assert.strictEqual(lsItems.length, 1);
    assert.strictEqual(lsItems[0].name, 'user_session_token');

    // Verificar que session_meta.json registra que a sessão é importada de outro host
    assert.ok(fs.existsSync(mPath));
    const restoredMeta = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
    assert.strictEqual(restoredMeta.isImported, true);
    assert.ok(restoredMeta.importedAt);
    assert.strictEqual(restoredMeta.user, 'export_test_user@example.com');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
