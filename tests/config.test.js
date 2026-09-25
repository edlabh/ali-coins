const test = require('node:test');
const assert = require('node:assert/strict');
const {
  configSchema,
  ConfigValidationError,
  loadConfig,
  maskChatId,
  isNoDelay,
  shouldApplyStartDelay
} = require('../config');
const { createIsolatedTestDir, cleanupIsolatedTestDir } = require('./test_helper');

test('config.js - defaults schema Zod', () => {
  const minimalData = {
    ALI_USER: 'test@example.com',
    ALI_PASSWORD: 'password123',
    SESSION_SECRET: '12345678901234567890123456789012'
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
  assert.strictEqual(
    parsed.SKIP_APP_ONLY_TASKS,
    true,
    'SKIP_APP_ONLY_TASKS default deve ser true (desligar tarefas que exigem o app)'
  );
});

test('config.js - SKIP_APP_ONLY_TASKS aceita variações de string para desligar', () => {
  const base = {
    ALI_USER: 'test@example.com',
    ALI_PASSWORD: 'password123',
    SESSION_SECRET: '12345678901234567890123456789012'
  };
  for (const off of ['false', 'FALSE', '0', 'off', 'no']) {
    assert.strictEqual(
      configSchema.parse({ ...base, SKIP_APP_ONLY_TASKS: off }).SKIP_APP_ONLY_TASKS,
      false,
      `SKIP_APP_ONLY_TASKS=${off} deve desativar a flag`
    );
  }
  for (const on of ['true', '1', 'on', 'yes']) {
    assert.strictEqual(
      configSchema.parse({ ...base, SKIP_APP_ONLY_TASKS: on }).SKIP_APP_ONLY_TASKS,
      true,
      `SKIP_APP_ONLY_TASKS=${on} deve manter as tarefas desligadas`
    );
  }
});

test('config.js - maskChatId mascara o Chat ID do Telegram', () => {
  assert.strictEqual(maskChatId('123456789'), '1234***');
  assert.strictEqual(maskChatId(123456789), '1234***');
  assert.strictEqual(maskChatId('123'), '***');
  assert.strictEqual(maskChatId(''), '');
  assert.strictEqual(maskChatId(null), '');
  assert.strictEqual(maskChatId(undefined), '');
});

test('config.js - preprocessing de strings para boolean e números', () => {
  const dataWithStrings = {
    ALI_USER: 'test@example.com',
    ALI_PASSWORD: 'password123',
    SESSION_SECRET: '12345678901234567890123456789012',
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

    const accounts = loadAccounts(process.env, process.cwd());
    assert.strictEqual(accounts.length, 2, 'Duas contas devem ser carregadas');

    for (const acc of accounts) {
      assert.strictEqual(
        path.dirname(acc.lockPath),
        process.cwd(),
        `Lock deve ficar no baseDir informado: ${acc.lockPath}`
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

    // Lock secundário segue o baseDir customizado (não o diretório do módulo).
    // A conta primária mantém o lock global do projeto (lockFilePath).
    const tmpDir = createIsolatedTestDir('ali-locks-basedir-');
    try {
      const custom = loadAccounts(process.env, tmpDir);
      assert.strictEqual(
        path.dirname(custom[1].lockPath),
        tmpDir,
        `Lock secundário deve seguir o baseDir: ${custom[1].lockPath}`
      );
    } finally {
      cleanupIsolatedTestDir(tmpDir);
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value !== undefined) process.env[key] = value;
      else delete process.env[key];
    }
  }
});

test('config.js - M3: ENCRYPT_LOCAL_SESSION=true sem SESSION_SECRET falha no startup', () => {
  const semSecret = configSchema.safeParse({ ALI_USER: 'a@b.co', ALI_PASSWORD: 'p' });
  assert.strictEqual(semSecret.success, false);
  assert.ok(
    semSecret.error.issues.some((i) => i.path.join('.') === 'SESSION_SECRET'),
    'deve acusar SESSION_SECRET ausente'
  );
  // Opt-out explícito de criptografia passa e aceita off/no/0/false
  for (const off of ['false', '0', 'off', 'no']) {
    const parsed = configSchema.safeParse({
      ALI_USER: 'a@b.co',
      ALI_PASSWORD: 'p',
      ENCRYPT_LOCAL_SESSION: off
    });
    assert.strictEqual(parsed.success, true, `ENCRYPT_LOCAL_SESSION=${off} deve passar`);
    assert.strictEqual(parsed.data.ENCRYPT_LOCAL_SESSION, false);
  }
});

test('config.js - positiveInt rejeita valores não numéricos e aceita strings numéricas', () => {
  const ok = configSchema.safeParse({
    ALI_USER: 'u@example.com',
    ALI_PASSWORD: 'pwd',
    SESSION_SECRET: '12345678901234567890123456789012',
    NAV_TIMEOUT: '25000'
  });
  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.data.NAV_TIMEOUT, 25000);

  const garbage = configSchema.safeParse({
    ALI_USER: 'u@example.com',
    ALI_PASSWORD: 'pwd',
    SESSION_SECRET: '12345678901234567890123456789012',
    NAV_TIMEOUT: '10abc'
  });
  assert.strictEqual(garbage.success, true);
  assert.strictEqual(garbage.data.NAV_TIMEOUT, 35000, "'10abc' deve cair no default");

  const zero = configSchema.safeParse({
    ALI_USER: 'u@example.com',
    ALI_PASSWORD: 'pwd',
    SESSION_SECRET: '12345678901234567890123456789012',
    TASK_MAX_ACTIONS: '0'
  });
  assert.strictEqual(zero.success, true);
  assert.strictEqual(zero.data.TASK_MAX_ACTIONS, 25, 'Zero deve cair no default');
});

test('config.js - passwordEnv não resolve propriedades herdadas de Object.prototype', () => {
  const fs = require('fs');
  const path = require('path');
  const { loadAccounts } = require('../config');
  const tmpDir = createIsolatedTestDir('ali-pwenv-proto-');
  const originalUser = process.env.ALI_USER;
  const originalPass = process.env.ALI_PASSWORD;
  delete process.env.ALI_USER;
  delete process.env.ALI_PASSWORD;

  try {
    fs.writeFileSync(
      path.join(tmpDir, 'accounts.json'),
      JSON.stringify([{ user: 'proto@example.com', passwordEnv: 'constructor' }]),
      'utf-8'
    );
    // env controlado e vazio: isola de ALI_USER/ALI_PASSWORD do ambiente real
    const accounts = loadAccounts({}, tmpDir);
    assert.strictEqual(accounts.length, 0, 'passwordEnv herdado não deve virar senha');
  } finally {
    if (originalUser !== undefined) process.env.ALI_USER = originalUser;
    if (originalPass !== undefined) process.env.ALI_PASSWORD = originalPass;
    cleanupIsolatedTestDir(tmpDir);
  }
});

test('config.js - passwordFile não permite path traversal fora do diretório do accounts.json', () => {
  const fs = require('fs');
  const path = require('path');
  const { loadAccounts } = require('../config');
  const tmpDir = createIsolatedTestDir('ali-pwfile-trav-');
  const originalUser = process.env.ALI_USER;
  const originalPass = process.env.ALI_PASSWORD;
  delete process.env.ALI_USER;
  delete process.env.ALI_PASSWORD;

  try {
    const baseDir = path.join(tmpDir, 'cfg');
    fs.mkdirSync(baseDir, { recursive: true });
    // Arquivo fora do baseDir que NÃO pode ser lido como senha
    fs.writeFileSync(path.join(tmpDir, 'segredo-fora.txt'), 'nao-deveria-ser-senha', 'utf-8');
    fs.writeFileSync(
      path.join(baseDir, 'accounts.json'),
      JSON.stringify([{ user: 'trav@example.com', passwordFile: '../segredo-fora.txt' }]),
      'utf-8'
    );
    const accounts = loadAccounts({}, baseDir);
    assert.strictEqual(accounts.length, 0, 'path traversal deve ser recusado');

    // Sem traversal: aceita normalmente
    fs.writeFileSync(path.join(baseDir, 'conta.pw'), 'senha-local-de-teste', 'utf-8');
    fs.writeFileSync(
      path.join(baseDir, 'accounts.json'),
      JSON.stringify([{ user: 'ok@example.com', passwordFile: 'conta.pw' }]),
      'utf-8'
    );
    const ok = loadAccounts({}, baseDir);
    assert.strictEqual(ok.length, 1, 'arquivo dentro do diretório é aceito');
    assert.strictEqual(ok[0].password, 'senha-local-de-teste'); //gitleaks:allow valor fictício de teste
  } finally {
    if (originalUser !== undefined) process.env.ALI_USER = originalUser;
    if (originalPass !== undefined) process.env.ALI_PASSWORD = originalPass;
    cleanupIsolatedTestDir(tmpDir);
  }
});

test('config.js - TASK_PAUSE_MIN_MS/MAX_MS: padrão desligado, aceita faixa válida e rejeita max < min', () => {
  const base = {
    ALI_USER: 'test@example.com',
    ALI_PASSWORD: 'password123',
    SESSION_SECRET: '12345678901234567890123456789012'
  };

  // Padrão: 0/0 (pausa desligada, comportamento anterior preservado)
  const padrao = configSchema.parse(base);
  assert.strictEqual(padrao.TASK_PAUSE_MIN_MS, 0);
  assert.strictEqual(padrao.TASK_PAUSE_MAX_MS, 0);

  // Faixa válida vinda de string de ambiente
  const ok = configSchema.parse({
    ...base,
    TASK_PAUSE_MIN_MS: '15000',
    TASK_PAUSE_MAX_MS: '60000'
  });
  assert.strictEqual(ok.TASK_PAUSE_MIN_MS, 15000);
  assert.strictEqual(ok.TASK_PAUSE_MAX_MS, 60000);

  // Só MAX (min padrão 0) é válido; valor inválido cai no padrão 0
  assert.strictEqual(
    configSchema.parse({ ...base, TASK_PAUSE_MAX_MS: '30000' }).TASK_PAUSE_MAX_MS,
    30000
  );
  assert.strictEqual(
    configSchema.parse({ ...base, TASK_PAUSE_MAX_MS: 'abc' }).TASK_PAUSE_MAX_MS,
    0
  );

  // max < min é erro de configuração acionável
  assert.throws(
    () => configSchema.parse({ ...base, TASK_PAUSE_MIN_MS: '60000', TASK_PAUSE_MAX_MS: '15000' }),
    /TASK_PAUSE_MAX_MS deve ser >= TASK_PAUSE_MIN_MS/
  );
});

test('config.js - ACCOUNT_DELAY_MIN_MS/MAX_MS: padrão desligado, faixa válida e rejeita max < min', () => {
  const base = {
    ALI_USER: 'test@example.com',
    ALI_PASSWORD: 'password123',
    SESSION_SECRET: '12345678901234567890123456789012'
  };

  // Padrão: 0/0 (pausa entre contas desligada, comportamento anterior preservado)
  const padrao = configSchema.parse(base);
  assert.strictEqual(padrao.ACCOUNT_DELAY_MIN_MS, 0);
  assert.strictEqual(padrao.ACCOUNT_DELAY_MAX_MS, 0);

  // Faixa válida vinda de string de ambiente
  const ok = configSchema.parse({
    ...base,
    ACCOUNT_DELAY_MIN_MS: '60000',
    ACCOUNT_DELAY_MAX_MS: '180000'
  });
  assert.strictEqual(ok.ACCOUNT_DELAY_MIN_MS, 60000);
  assert.strictEqual(ok.ACCOUNT_DELAY_MAX_MS, 180000);

  // Valor inválido cai no padrão 0
  assert.strictEqual(
    configSchema.parse({ ...base, ACCOUNT_DELAY_MAX_MS: 'abc' }).ACCOUNT_DELAY_MAX_MS,
    0
  );

  // max < min é erro de configuração acionável
  assert.throws(
    () =>
      configSchema.parse({
        ...base,
        ACCOUNT_DELAY_MIN_MS: '180000',
        ACCOUNT_DELAY_MAX_MS: '60000'
      }),
    /ACCOUNT_DELAY_MAX_MS deve ser >= ACCOUNT_DELAY_MIN_MS/
  );
});

test('config.js - START_DELAY_MIN_MS/MAX_MS: padrão desligado, faixa válida e rejeita max < min', () => {
  const base = {
    ALI_USER: 'test@example.com',
    ALI_PASSWORD: 'password123',
    SESSION_SECRET: '12345678901234567890123456789012'
  };

  // Padrão: 0/0 (sem atraso inicial, comportamento anterior preservado)
  const padrao = configSchema.parse(base);
  assert.strictEqual(padrao.START_DELAY_MIN_MS, 0);
  assert.strictEqual(padrao.START_DELAY_MAX_MS, 0);

  // Faixa válida vinda de string de ambiente (ex.: até ~59 min)
  const ok = configSchema.parse({
    ...base,
    START_DELAY_MIN_MS: '60000',
    START_DELAY_MAX_MS: '3540000'
  });
  assert.strictEqual(ok.START_DELAY_MIN_MS, 60000);
  assert.strictEqual(ok.START_DELAY_MAX_MS, 3540000);

  // Valor inválido cai no padrão 0
  assert.strictEqual(
    configSchema.parse({ ...base, START_DELAY_MAX_MS: 'abc' }).START_DELAY_MAX_MS,
    0
  );

  // max < min é erro de configuração acionável
  assert.throws(
    () =>
      configSchema.parse({
        ...base,
        START_DELAY_MIN_MS: '3540000',
        START_DELAY_MAX_MS: '60000'
      }),
    /START_DELAY_MAX_MS deve ser >= START_DELAY_MIN_MS/
  );
});

test('config.js - shouldApplyStartDelay: dry-run e --no-delay nunca atrasam; teto 0 desliga', () => {
  assert.strictEqual(
    shouldApplyStartDelay({ dryRun: false, noDelay: false, maxMs: 3540000 }),
    true,
    'faixa ativa deve aplicar o atraso'
  );
  assert.strictEqual(
    shouldApplyStartDelay({ dryRun: true, noDelay: false, maxMs: 3540000 }),
    false,
    '--dry-run (HEALTHCHECK do Docker) nunca pode atrasar'
  );
  assert.strictEqual(
    shouldApplyStartDelay({ dryRun: false, noDelay: true, maxMs: 3540000 }),
    false,
    '--no-delay pula o atraso (retentativas/manuais)'
  );
  assert.strictEqual(shouldApplyStartDelay({ dryRun: false, noDelay: false, maxMs: 0 }), false);
  assert.strictEqual(shouldApplyStartDelay({}), false);
});

test('config.js - isNoDelay detecta a flag sem depender do parse do commander', () => {
  assert.strictEqual(isNoDelay(['node', 'all.js', '--no-delay']), true);
  assert.strictEqual(isNoDelay(['node', 'all.js']), false);
});
