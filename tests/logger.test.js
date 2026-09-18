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

test('logger.js - mascara chaves sensíveis por prefixo/sufixo e em objetos aninhados', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const script = `
      process.argv.push('--json');
      const logger = require('./logger');
      logger.info({
        my_secret_field: 'VALOR_TOPSECRET',
        userToken: 'VALOR_USERTOKEN',
        nested: { apiKey: 'VALOR_APIKEY', cookie: 'VALOR_COOKIE', safeField: 'VALOR_SEGURO' },
        password: 'VALOR_PASSWORD'
      }, 'teste de scrub');
    `;

    const res = spawnSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf-8'
    });

    assert.strictEqual(res.status, 0);
    for (const value of [
      'VALOR_TOPSECRET',
      'VALOR_USERTOKEN',
      'VALOR_APIKEY',
      'VALOR_COOKIE',
      'VALOR_PASSWORD'
    ]) {
      assert.strictEqual(
        res.stderr.includes(value),
        false,
        `Valor sensível "${value}" não deve aparecer no log`
      );
    }
    assert.ok(res.stderr.includes('VALOR_SEGURO'), 'Campos não sensíveis devem ser preservados');
    assert.ok(res.stderr.includes('[REDACTED]'), 'Valores sensíveis devem ser mascarados');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('logger.js - erro em registro plano tem a mensagem sanitizada (fast-path)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const script = `
      process.argv.push('--json');
      const logger = require('./logger');
      const fakeToken = ['TOKEN', 'FALSO', 'DE', 'TESTE'].join('_') + '_1234567890';
      logger.warn({ err: new Error('falha ao acessar https://x/y?token=' + fakeToken) }, 'erro plano');
    `;

    const res = spawnSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf-8'
    });

    assert.strictEqual(res.status, 0);
    assert.strictEqual(
      res.stderr.includes('TOKEN_FALSO_DE_TESTE_1234567890'),
      false,
      'token no err.message não deve vazar'
    );
    assert.ok(res.stderr.includes('token=[REDACTED]'), 'token no err.message deve ser mascarado');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('logger.js - sanitiza query strings sensíveis em campos estruturados (ex: url)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    // Valores montados em runtime (nunca literais no fonte, que são varridos pelo Gitleaks)
    const script = `
      process.argv.push('--json');
      const logger = require('./logger');
      const fakeToken = ['TOKEN', 'FALSO', 'DE', 'TESTE'].join('_') + '_1234567890';
      const fakeKey = ['APIKEY', 'FALSA', 'DE', 'TESTE'].join('_') + '_9876543210';
      logger.info({ url: 'https://example.com/api/ping?token=' + fakeToken + '&ok=1', nested: { link: 'https://x/y?apikey=' + fakeKey } }, 'teste de url');
    `;

    const res = spawnSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf-8'
    });

    assert.strictEqual(res.status, 0);
    assert.strictEqual(
      res.stderr.includes('TOKEN_FALSO_DE_TESTE_1234567890'),
      false,
      'token não deve vazar'
    );
    assert.strictEqual(
      res.stderr.includes('APIKEY_FALSA_DE_TESTE_9876543210'),
      false,
      'apikey não deve vazar'
    );
    assert.ok(res.stderr.includes('token=[REDACTED]'), 'token deve ser mascarado');
    assert.ok(res.stderr.includes('apikey=[REDACTED]'), 'apikey deve ser mascarado');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('logger.js - sem TTY usa JSON estruturado (sem pino-pretty/worker) mesmo fora de CI/produção', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const script = `
      const logger = require('./logger');
      logger.info({ marker: 'sem-tty' }, 'registro estruturado');
    `;
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_ENV;
    delete env.CI;

    const res = spawnSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env
    });

    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('"level":'), 'saída deve ser JSON do pino');
    assert.ok(res.stdout.includes('"marker":"sem-tty"'), 'campos devem estar em JSON estruturado');
    // pino-pretty adiciona cores ANSI; JSON puro não deve conter escapes
    assert.strictEqual(res.stdout.includes('\u001b['), false, 'não deve haver colorização ANSI');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
