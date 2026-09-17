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
  assert.strictEqual(
    parsed.TASK_ROUND_MAX_ATTEMPTS,
    3,
    'TASK_ROUND_MAX_ATTEMPTS default deve ser 3'
  );
  assert.strictEqual(
    parsed.TASK_MAX_DURATION_MS,
    180000,
    'TASK_MAX_DURATION_MS default deve ser 180000 (3min)'
  );
  assert.strictEqual(parsed.TASK_SCROLL_MAX_MS, 30000, 'TASK_SCROLL_MAX_MS default deve ser 30000');
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

test('config.js - mensagens PT-BR de validação são preservadas no Zod 4 (opção error)', () => {
  const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const missing = configSchema.safeParse({});
    assert.strictEqual(missing.success, false);
    const missingMessages = missing.error.issues.map((i) => i.message).join(' | ');
    assert.ok(
      missingMessages.includes('ALI_USER é obrigatória'),
      `Mensagem de ALI_USER ausente: ${missingMessages}`
    );
    assert.ok(
      missingMessages.includes('ALI_PASSWORD é obrigatória'),
      `Mensagem de ALI_PASSWORD ausente: ${missingMessages}`
    );

    const wrongType = configSchema.safeParse({ ALI_USER: 12345, ALI_PASSWORD: 'pwd' });
    assert.strictEqual(wrongType.success, false);
    assert.ok(
      wrongType.error.issues.some((i) => i.message.includes('deve ser uma string de texto')),
      'Mensagem de tipo inválido deve ser PT-BR'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('config.js - lockFilePath fica no diretório privado do projeto (não em /tmp)', () => {
  const os = require('os');
  const path = require('path');
  const { lockFilePath } = require('../config');

  assert.strictEqual(
    path.dirname(lockFilePath),
    path.resolve(__dirname, '..'),
    `Lock deve ficar no diretório do projeto, obtido: ${lockFilePath}`
  );
  assert.notStrictEqual(
    path.dirname(lockFilePath),
    os.tmpdir(),
    'Lock não deve usar diretório compartilhado /tmp'
  );
  assert.ok(
    path.basename(lockFilePath).startsWith('ali-coins-'),
    `Lock deve ter sufixo de usuário, obtido: ${path.basename(lockFilePath)}`
  );
  if (typeof process.getuid === 'function') {
    assert.ok(
      lockFilePath.includes(`u${process.getuid()}`),
      `Lock deve conter o uid do usuário, obtido: ${lockFilePath}`
    );
  }
});

test('config.js - locks de contas secundárias também ficam no diretório do projeto', () => {
  const os = require('os');
  const path = require('path');
  const { loadAccounts } = require('../config');
  const original = {
    ALI_USER: process.env.ALI_USER,
    ALI_PASSWORD: process.env.ALI_PASSWORD,
    ALI_USER_2: process.env.ALI_USER_2,
    ALI_PASSWORD_2: process.env.ALI_PASSWORD_2
  };

  try {
    process.env.ALI_USER = 'lock_a@example.com';
    process.env.ALI_PASSWORD = 'pwd_a';
    process.env.ALI_USER_2 = 'lock_b@example.com';
    process.env.ALI_PASSWORD_2 = 'pwd_b';

    const accounts = loadAccounts(process.env, __dirname);
    assert.strictEqual(accounts.length, 2, 'Duas contas devem ser carregadas');

    for (const acc of accounts) {
      assert.strictEqual(
        path.dirname(acc.lockPath),
        path.resolve(__dirname, '..'),
        `Lock deve ficar no diretório do projeto: ${acc.lockPath}`
      );
      assert.notStrictEqual(
        path.dirname(acc.lockPath),
        os.tmpdir(),
        `Lock não deve usar /tmp: ${acc.lockPath}`
      );
      if (typeof process.getuid === 'function') {
        assert.ok(
          acc.lockPath.includes(`u${process.getuid()}`),
          `Lock deve conter o uid: ${acc.lockPath}`
        );
      }
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value !== undefined) process.env[key] = value;
      else delete process.env[key];
    }
  }
});
