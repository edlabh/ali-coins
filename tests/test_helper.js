const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');

const REAL_PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Lista dinamicamente TODOS os arquivos produtivos de segredos/sessão no diretório real
 * (primária e secundárias, tokens, accounts.json, credenciais e o lockfile).
 * A lista é derivada a cada chamada para que arquivos criados por engano também sejam detectados.
 * @returns {string[]}
 */
function listCriticalRealFiles() {
  const names = [];
  try {
    for (const name of fs.readdirSync(REAL_PROJECT_ROOT)) {
      if (
        /^(session|accounts|credentials|github_token)/i.test(name) &&
        !name.endsWith('.example')
      ) {
        names.push(name);
      }
    }
  } catch {
    // Diretório ilegível: nada a proteger
  }
  // Lockfiles (agora no diretório do projeto): qualquer ali-coins*.lock
  try {
    for (const name of fs.readdirSync(REAL_PROJECT_ROOT)) {
      if (/^ali-coins.*\.lock$/i.test(name)) {
        names.push(name);
      }
    }
  } catch {
    // Diretório ilegível: nada a proteger
  }
  return [...new Set(names)].sort();
}

/**
 * Registra o estado atual (existência e mtime) dos arquivos críticos em disco
 * @returns {Record<string, { exists: boolean, mtimeMs?: number, size?: number }>}
 */
function snapshotRealFiles() {
  const snapshot = {};
  for (const file of listCriticalRealFiles()) {
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
  const expectedFiles = Object.keys(snapshot);
  const currentFiles = listCriticalRealFiles();

  for (const file of currentFiles) {
    if (!(file in snapshot)) {
      assert.fail(`Arquivo produtivo "${file}" não existia e foi criado indevidamente pelo teste!`);
    }
  }

  for (const file of expectedFiles) {
    const fullPath = path.join(REAL_PROJECT_ROOT, file);
    const prev = snapshot[file];
    const existsNow = fs.existsSync(fullPath);
    assert.strictEqual(
      existsNow,
      true,
      `Arquivo produtivo "${file}" existia e foi apagado indevidamente pelo teste!`
    );
    assert.ok(prev.exists, `Arquivo produtivo "${file}" deveria existir no snapshot!`);
    const stat = fs.statSync(fullPath);
    assert.strictEqual(
      stat.mtimeMs,
      prev.mtimeMs,
      `Arquivo produtivo "${file}" teve seu mtime alterado indevidamente pelo teste!`
    );
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
  if (!tmpDir) return;
  // Allowlist: só remove diretórios sob o tmpdir do sistema (evita que um caminho
  // errado do projeto — session/, scratch/, raiz — seja apagado recursivamente).
  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(tmpDir));
  } catch {
    return; // já não existe
  }
  const tmpRoot = fs.realpathSync(os.tmpdir());
  const rel = path.relative(tmpRoot, resolved);
  const isUnderTmp = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (!isUnderTmp) {
    throw new Error(
      `cleanupIsolatedTestDir recusou remover "${resolved}": fora do diretório temporário (${tmpRoot}).`
    );
  }
  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

module.exports = {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
};
