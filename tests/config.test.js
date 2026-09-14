const test = require('node:test');
const assert = require('node:assert/strict');
const { configSchema, ConfigValidationError, loadConfig } = require('../config');

test('config.js - defaults schema Zod', () => {
  const minimalData = {
    ALI_USER: 'test@example.com',
    ALI_PASSWORD: 'password123'
  };

  const parsed = configSchema.parse(minimalData);
  assert.strictEqual(parsed.ALLOW_MEDIA, false, 'ALLOW_MEDIA default deve ser false');
  assert.strictEqual(parsed.HEADLESS, true, 'HEADLESS default deve ser true');
  assert.strictEqual(parsed.LOG_LEVEL, 'info', 'LOG_LEVEL default deve ser info');
  assert.strictEqual(parsed.NO_SANDBOX, false, 'NO_SANDBOX default deve ser false');
  assert.strictEqual(parsed.NAV_TIMEOUT, 35000, 'NAV_TIMEOUT default deve ser 35000');
  assert.strictEqual(parsed.TASK_MAX_ACTIONS, 25, 'TASK_MAX_ACTIONS default deve ser 25');
  assert.strictEqual(parsed.TASK_MAX_ATTEMPTS, 4, 'TASK_MAX_ATTEMPTS default deve ser 4');
  assert.strictEqual(parsed.PW_TRACE, 'retain-on-failure');
  assert.strictEqual(parsed.PW_SCREENSHOT, 'only-on-failure');
  assert.strictEqual(parsed.PW_VIDEO, 'off');
});

test('config.js - preprocessing de strings para boolean e números', () => {
  const dataWithStrings = {
    ALI_USER: 'test@example.com',
    ALI_PASSWORD: 'password123',
    ALLOW_MEDIA: 'true',
    HEADLESS: 'false',
    NAV_TIMEOUT: '45000',
    TASK_MAX_ACTIONS: '30'
  };

  const parsed = configSchema.parse(dataWithStrings);
  assert.strictEqual(parsed.ALLOW_MEDIA, true);
  assert.strictEqual(parsed.HEADLESS, false);
  assert.strictEqual(parsed.NAV_TIMEOUT, 45000);
  assert.strictEqual(parsed.TASK_MAX_ACTIONS, 30);
});

test('config.js - validação com credenciais ausentes deve falhar', () => {
  const invalidData = {
    ALI_USER: '',
    ALI_PASSWORD: ''
  };

  const result = configSchema.safeParse(invalidData);
  assert.strictEqual(result.success, false);
  assert.ok(result.error.issues.length >= 2);
});

test('config.js - SESSION_SECRET menor que 32 caracteres deve falhar', () => {
  const data = {
    ALI_USER: 'user',
    ALI_PASSWORD: 'pass',
    SESSION_SECRET: 'short'
  };

  const result = configSchema.safeParse(data);
  assert.strictEqual(result.success, false);
  assert.match(result.error.issues[0].message, /no mínimo 32 caracteres/);
});

test('config.js - loadConfig lança ConfigValidationError com env inválido', () => {
  const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');
  const realFilesSnapshot = snapshotRealFiles();
  const originalUser = process.env.ALI_USER;
  delete process.env.ALI_USER;

  try {
    assert.throws(
      () => loadConfig(true),
      (err) => err instanceof ConfigValidationError
    );
  } finally {
    if (originalUser) {
      process.env.ALI_USER = originalUser;
    }
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('config.js - isNotify e parseCliOptions com Commander 15', () => {
  const { isNotify, parseCliOptions, createCliProgram } = require('../config');

  // Commander 15 options
  const program = createCliProgram();
  assert.ok(program, 'Program deve ser instanciado');

  assert.strictEqual(isNotify(['node', 'all.js']), null);
  assert.strictEqual(isNotify(['node', 'all.js', '--notify']), true);
  assert.strictEqual(isNotify(['node', 'all.js', '--no-notify']), false);

  const opts1 = parseCliOptions(['node', 'all.js', '-d', '--json']);
  assert.strictEqual(opts1.dryRun, true);
  assert.strictEqual(opts1.json, true);

  const optsNotify = parseCliOptions(['node', 'all.js', '--notify']);
  assert.strictEqual(optsNotify.notify, true);

  const optsNoNotify = parseCliOptions(['node', 'all.js', '--no-notify']);
  assert.strictEqual(optsNoNotify.notify, false);
});
