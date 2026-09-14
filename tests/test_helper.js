const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');

const REAL_PROJECT_ROOT = path.resolve(__dirname, '..');
const CRITICAL_REAL_FILES = [
  'session.json',
  'session_meta.json',
  'session_token.txt',
  'credentials.env',
  'ali-coins.lock'
];

/**
 * Registra o estado atual (existência e mtime) dos arquivos críticos em disco
 * @returns {Record<string, { exists: boolean, mtimeMs?: number, size?: number }>}
 */
function snapshotRealFiles() {
  const snapshot = {};
  for (const file of CRITICAL_REAL_FILES) {
    const fullPath = path.join(REAL_PROJECT_ROOT, file);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      snapshot[file] = { exists: true, mtimeMs: stat.mtimeMs, size: stat.size };
    } else {
      snapshot[file] = { exists: false };
    }
  }
  return snapshot;
}

/**
 * Garante que nenhum arquivo produtivo real foi criado, modificado ou removido
 * @param {Record<string, { exists: boolean, mtimeMs?: number, size?: number }>} snapshot
 */
function assertRealFilesUntouched(snapshot) {
  for (const file of CRITICAL_REAL_FILES) {
    const fullPath = path.join(REAL_PROJECT_ROOT, file);
    const prev = snapshot[file];
    const existsNow = fs.existsSync(fullPath);
    if (!prev.exists) {
      assert.strictEqual(
        existsNow,
        false,
        `Arquivo produtivo "${file}" não existia e foi criado indevidamente pelo teste!`
      );
    } else {
      assert.strictEqual(
        existsNow,
        true,
        `Arquivo produtivo "${file}" existia e foi apagado indevidamente pelo teste!`
      );
      const stat = fs.statSync(fullPath);
      assert.strictEqual(
        stat.mtimeMs,
        prev.mtimeMs,
        `Arquivo produtivo "${file}" teve seu mtime alterado indevidamente pelo teste!`
      );
    }
  }
}

/**
 * Cria diretório temporário isolado no os.tmpdir()
 * @param {string} [prefix='ali-coins-test-']
 * @returns {string} Caminho absoluto do diretório temporário
 */
function createIsolatedTestDir(prefix = 'ali-coins-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Remove com segurança o diretório temporário isolado
 * @param {string} tmpDir
 */
function cleanupIsolatedTestDir(tmpDir) {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
};
