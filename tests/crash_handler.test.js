const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { setupGlobalCrashHandler } = require('../libs/crash');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('libs/crash.js - setupGlobalCrashHandler registra e limpa listeners com cleanup', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const prevUncaughtCount = process.listenerCount('uncaughtException');
    const prevRejectionCount = process.listenerCount('unhandledRejection');

    const cleanup = setupGlobalCrashHandler();

    assert.strictEqual(process.listenerCount('uncaughtException'), prevUncaughtCount + 1);
    assert.strictEqual(process.listenerCount('unhandledRejection'), prevRejectionCount + 1);

    cleanup();

    assert.strictEqual(process.listenerCount('uncaughtException'), prevUncaughtCount);
    assert.strictEqual(process.listenerCount('unhandledRejection'), prevRejectionCount);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/crash.js - unhandledRejection em subprocesso encerra com exit code 6 e log fatal', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const rootDir = path.resolve(__dirname, '..');
    const script = `
      const { setupGlobalCrashHandler } = require('./libs/crash');
      setupGlobalCrashHandler(() => ({ scriptName: 'test-child' }));
      Promise.reject(new Error('simulated_orphan_promise_rejection'));
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: rootDir,
      encoding: 'utf-8',
      timeout: 15000
    });

    assert.strictEqual(result.status, 6, 'Processo deve finalizar com exit code 6');
    const combinedOutput = (result.stdout || '') + (result.stderr || '');
    assert.ok(
      combinedOutput.includes('simulated_orphan_promise_rejection') ||
        combinedOutput.includes('Falha global não tratada detectada'),
      'Saída de log deve reportar o erro fatal e tipo unhandledRejection'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/crash.js - uncaughtException em subprocesso encerra com exit code 6 e log fatal', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const rootDir = path.resolve(__dirname, '..');
    const script = `
      const { setupGlobalCrashHandler } = require('./libs/crash');
      setupGlobalCrashHandler(() => ({ scriptName: 'test-child-uncaught' }));
      setTimeout(() => {
        throw new Error('simulated_uncaught_sync_exception');
      }, 10);
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: rootDir,
      encoding: 'utf-8',
      timeout: 15000
    });

    assert.strictEqual(result.status, 6, 'Processo deve finalizar com exit code 6');
    const combinedOutput = (result.stdout || '') + (result.stderr || '');
    assert.ok(
      combinedOutput.includes('simulated_uncaught_sync_exception') ||
        combinedOutput.includes('Falha global não tratada detectada'),
      'Saída de log deve reportar o erro fatal e tipo uncaughtException'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/crash.js - timer de emergência não usa unref (garante exit code 6)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'libs', 'crash.js'), 'utf-8');
  assert.strictEqual(
    /emergencyTimer\.unref|setTimeout\([^)]*\)\.unref/.test(src),
    false,
    'o timer que garante o exit 6 não pode ser unref (sairia com código 0)'
  );
});
