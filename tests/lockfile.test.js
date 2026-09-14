const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireLock, LockActiveError } = require('../lockfile');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

test('lockfile.js - adquirir e liberar lock com sucesso em ambiente isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lockfile-test-');
  const tmpLockPath = path.join(tmpDir, 'test.lock');

  try {
    const release = await acquireLock(false, null, tmpLockPath);
    assert.ok(fs.existsSync(tmpLockPath), 'Arquivo de lock deve existir após aquisição');

    const content = JSON.parse(await fs.promises.readFile(tmpLockPath, 'utf-8'));
    assert.strictEqual(content.pid, process.pid);

    await release();
    assert.ok(!fs.existsSync(tmpLockPath), 'Arquivo de lock deve ser removido após liberação');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('lockfile.js - lock ativo impede segunda aquisição sem force isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lockfile-test-');
  const tmpLockPath = path.join(tmpDir, 'test.lock');

  try {
    const release = await acquireLock(false, null, tmpLockPath);

    await assert.rejects(
      async () => {
        await acquireLock(false, null, tmpLockPath);
      },
      (err) => {
        assert.ok(err instanceof LockActiveError);
        assert.strictEqual(err.code, 'LOCK_ACTIVE');
        return true;
      }
    );

    await release();
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('lockfile.js - flag force sobrescreve lock ativo isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lockfile-test-');
  const tmpLockPath = path.join(tmpDir, 'test.lock');

  try {
    const release1 = await acquireLock(false, null, tmpLockPath);

    // Com force = true deve adquirir novo lock sem erro
    const release2 = await acquireLock(true, null, tmpLockPath);
    assert.ok(fs.existsSync(tmpLockPath));

    await release2();
    await release1();
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('lockfile.js - lock órfão (stale timeout) é removido automaticamente isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lockfile-test-');
  const tmpLockPath = path.join(tmpDir, 'test.lock');

  try {
    // Criar lock simulando processo antigo de 2 horas atrás
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await fs.promises.writeFile(
      tmpLockPath,
      JSON.stringify({ pid: process.pid, createdAt: oldDate, host: os.hostname() }),
      'utf-8'
    );

    // Stale timeout de 1 segundo
    const release = await acquireLock(false, 1000, tmpLockPath);
    assert.ok(fs.existsSync(tmpLockPath));

    const content = JSON.parse(await fs.promises.readFile(tmpLockPath, 'utf-8'));
    assert.strictEqual(content.pid, process.pid);

    await release();
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
