const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

function ignoredPatterns() {
  const content = fs.readFileSync(path.join(__dirname, '..', '.dockerignore'), 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

test('.dockerignore - mantém TODOS os padrões de segurança de sessão/credenciais', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const patterns = ignoredPatterns();

    const requiredSecurityPatterns = [
      'credentials.env',
      'credentials.env*',
      'session.json',
      'session.json.enc',
      'session*.json',
      'session*.enc',
      '*.enc',
      'session_meta.json',
      'session_meta*.json',
      'session_token.txt',
      'session_token*.txt',
      'accounts.json',
      'github_token.env',
      'sbom.json'
    ];

    for (const pattern of requiredSecurityPatterns) {
      assert.ok(
        patterns.includes(pattern),
        `Padrão de segurança ausente no .dockerignore: ${pattern}`
      );
    }
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('.dockerignore - exclui libs/extracted (libs locais não devem ir para a imagem)', () => {
  const patterns = ignoredPatterns();
  assert.ok(
    patterns.includes('libs/extracted/') || patterns.includes('libs/extracted'),
    'libs/extracted deve ser excluído para não sobrepor as libs do apt no container'
  );
});

test('.dockerignore - não exclui arquivos necessários em runtime', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const patterns = ignoredPatterns();
    const forbidden = [
      'browser.js',
      'config.js',
      'all.js',
      'collect.js',
      'do_tasks.js',
      'security.js',
      'lockfile.js',
      'logger.js',
      'libs/',
      'libs',
      'package.json',
      'package-lock.json'
    ];

    for (const entry of forbidden) {
      assert.strictEqual(
        patterns.includes(entry),
        false,
        `Runtime não pode ser excluído da imagem: ${entry}`
      );
    }

    // Artefatos de desenvolvimento/testes devem continuar fora da imagem
    for (const excluded of ['tests/', '.github/', '.husky/', 'eslint.config.js']) {
      assert.ok(patterns.includes(excluded), `${excluded} deveria estar excluído da imagem`);
    }
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
