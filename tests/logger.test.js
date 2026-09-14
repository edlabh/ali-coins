const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('logger.js - em modo --json os logs são direcionados para stderr e preservam stdout limpo', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const script = `
      process.argv.push('--json');
      const logger = require('./logger');
      logger.info('Log de diagnóstico operacional');
      process.stdout.write(JSON.stringify({ success: true, count: 42 }) + '\\n');
    `;

    const res = spawnSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf-8'
    });

    assert.strictEqual(res.status, 0);

    // Stderr deve conter o log estruturado do pino
    assert.ok(res.stderr.includes('Log de diagnóstico operacional'));

    // Stdout deve conter estritamente o JSON válido e ser parseável
    const parsedStdout = JSON.parse(res.stdout.trim());
    assert.strictEqual(parsedStdout.success, true);
    assert.strictEqual(parsedStdout.count, 42);
    assert.strictEqual(res.stdout.includes('Log de diagnóstico operacional'), false);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('logger.js - sanitiza parâmetros de busca e tokens de bots sensíveis', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const script = `
      process.argv.push('--json');
      const logger = require('./logger');
      logger.info('Acessando URL: https://aliexpress.com?token=secret123&code=456789&user=john');
      logger.info('Chamando bot123456789:ABCdefGhIjkLmNoPqRsTuVwXyZ1234567890/sendMessage');
    `;

    const res = spawnSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf-8'
    });

    assert.strictEqual(res.status, 0);
    assert.ok(res.stderr.includes('[REDACTED]'));
    assert.ok(res.stderr.includes('bot[REDACTED_TOKEN]'));
    assert.strictEqual(res.stderr.includes('secret123'), false);
    assert.strictEqual(res.stderr.includes('456789'), false);
    assert.strictEqual(res.stderr.includes('ABCdefGhIjkLmNoPqRsTuVwXyZ1234567890'), false);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
