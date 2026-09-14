const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadSessionFiles, saveSession, validateAndRefresh, clearSession } = require('../libs/session');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

test('libs/session.js - salvar e carregar sessão em ambiente isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-test-');

  try {
    const fakeState = {
      cookies: [
        { name: 'xman_us_t', value: 'token123', expires: Math.floor(Date.now() / 1000) + 3600 }
      ]
    };

    await saveSession(fakeState, 'user@example.com', { baseDir: tmpDir });
    assert.ok(
      fs.existsSync(path.join(tmpDir, 'session.json')),
      'session.json deve existir no diretório temporário isolado'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, 'session_meta.json')),
      'session_meta.json deve existir no diretório temporário isolado'
    );

    const loaded = await loadSessionFiles({ baseDir: tmpDir });
    assert.strictEqual(loaded.sessionData.cookies[0].name, 'xman_us_t');
    assert.strictEqual(loaded.metaData.user, 'user@example.com');

    await clearSession({ baseDir: tmpDir });
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

test('libs/session.js - validateAndRefresh invalida sessão divergente isolada', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('session-test-');

  try {
    const fakeState = {
      cookies: [
        { name: 'xman_us_t', value: 'token123', expires: Math.floor(Date.now() / 1000) + 3600 }
      ]
    };
    await saveSession(fakeState, 'usuario1@example.com', { baseDir: tmpDir });

    const refreshed = await validateAndRefresh('usuario2@example.com', null, { baseDir: tmpDir });
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
    await saveSession(fakeState, 'user_ok@example.com', { baseDir: tmpDir });

    const refreshed = await validateAndRefresh('user_ok@example.com', null, { baseDir: tmpDir });
    assert.strictEqual(refreshed.valid, true);
    assert.strictEqual(refreshed.metaData.user, 'user_ok@example.com');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
