const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { retry, resolveStorageState, launchBrowser, buildChromiumArgs } = require('../browser');
const { encryptSession } = require('../security');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('browser.js:retry - executa função com sucesso na 1ª tentativa', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let attempts = 0;
    const result = await retry(async (attempt) => {
      attempts++;
      return `ok-${attempt}`;
    });

    assert.strictEqual(result, 'ok-1');
    assert.strictEqual(attempts, 1);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js:retry - recupera após falhas transitórias com backoff', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let attempts = 0;
    const result = await retry(
      async (attempt) => {
        attempts++;
        if (attempt < 3) {
          throw new Error(`Falha transitória ${attempt}`);
        }
        return 'sucesso';
      },
      { retries: 3, minTimeout: 5, maxTimeout: 20, jitter: false }
    );

    assert.strictEqual(result, 'sucesso');
    assert.strictEqual(attempts, 3);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js:retry - esgota tentativas e lança o último erro', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let attempts = 0;
    await assert.rejects(
      async () => {
        await retry(
          async (attempt) => {
            attempts++;
            throw new Error(`Erro fatal na tentativa ${attempt}`);
          },
          { retries: 3, minTimeout: 5, maxTimeout: 20, jitter: false }
        );
      },
      (err) => {
        assert.strictEqual(err.message, 'Erro fatal na tentativa 3');
        return true;
      }
    );
    assert.strictEqual(attempts, 3);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js:resolveStorageState - normaliza objeto, path json, path enc e arquivo inexistente', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-storage-state-'));
  const testSecret = 'test_secret_for_storage_state_32_chars!';
  const oldSecret = process.env.SESSION_SECRET;

  try {
    process.env.SESSION_SECRET = testSecret;

    // 1. null / undefined -> null
    assert.strictEqual(await resolveStorageState(null), null);
    assert.strictEqual(await resolveStorageState(undefined), null);

    // 2. Objeto em memória -> preservado
    const mockStorage = { cookies: [{ name: 'xman_us_t', value: 'token123' }] };
    assert.deepStrictEqual(await resolveStorageState(mockStorage), mockStorage);

    // 3. Caminho que não existe -> null (evita crash ENOENT no Playwright)
    const nonExistent = path.join(tempDir, 'does_not_exist.json');
    assert.strictEqual(await resolveStorageState(nonExistent), null);

    // 4. Arquivo .json existente -> retorna o próprio caminho
    const plainPath = path.join(tempDir, 'session.json');
    fs.writeFileSync(plainPath, JSON.stringify(mockStorage), 'utf-8');
    assert.strictEqual(await resolveStorageState(plainPath), plainPath);

    // 5. Arquivo .json foi migrado para .enc (ou seja, session.json não existe, mas session.json.enc existe)
    fs.unlinkSync(plainPath);
    const encPath = `${plainPath}.enc`;
    const encrypted = encryptSession(JSON.stringify(mockStorage), testSecret);
    fs.writeFileSync(encPath, encrypted, 'utf-8');

    // Ao consultar plainPath (session.json), deve encontrar session.json.enc e descriptografar
    const resolvedFromPlain = await resolveStorageState(plainPath);
    assert.ok(resolvedFromPlain !== null);
    assert.strictEqual(typeof resolvedFromPlain, 'object');
    assert.strictEqual(resolvedFromPlain.cookies[0].value, 'token123');

    // 6. Passando diretamente o caminho .enc
    const resolvedFromEnc = await resolveStorageState(encPath);
    assert.ok(resolvedFromEnc !== null);
    assert.strictEqual(typeof resolvedFromEnc, 'object');
    assert.strictEqual(resolvedFromEnc.cookies[0].value, 'token123');

    fs.rmSync(tempDir, { recursive: true, force: true });
  } finally {
    if (oldSecret !== undefined) {
      process.env.SESSION_SECRET = oldSecret;
    } else {
      delete process.env.SESSION_SECRET;
    }
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js - getChromiumEnv não propaga segredos da aplicação ao Chromium', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const { getChromiumEnv } = require('../browser');
  const original = {
    ALI_PASSWORD: process.env.ALI_PASSWORD,
    SESSION_SECRET: process.env.SESSION_SECRET,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    MY_CUSTOM_SECRET: process.env.MY_CUSTOM_SECRET
  };

  try {
    process.env.ALI_PASSWORD = 'senha-super-secreta';
    process.env.SESSION_SECRET = 'chave-secreta-de-teste-com-32-caracteres!!';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:TOKEN_FALSO_DE_TESTE_abcdefghijklmnop';
    process.env.GITHUB_TOKEN = 'ghp_token_falso_de_teste_1234567890';
    process.env.MY_CUSTOM_SECRET = 'valor-secreto-generico';

    const env = getChromiumEnv();

    for (const key of Object.keys(env)) {
      assert.strictEqual(
        /(SECRET|PASSWORD|TOKEN|CREDENTIAL)/i.test(key),
        false,
        `Variável sensível "${key}" não deve ser propagada ao Chromium`
      );
    }
    assert.strictEqual(env.ALI_PASSWORD, undefined);
    assert.strictEqual(env.SESSION_SECRET, undefined);
    assert.strictEqual(env.TELEGRAM_BOT_TOKEN, undefined);
    assert.strictEqual(env.GITHUB_TOKEN, undefined);
    assert.strictEqual(env.MY_CUSTOM_SECRET, undefined);
    assert.strictEqual(JSON.stringify(env).includes('senha-super-secreta'), false);
    assert.strictEqual(JSON.stringify(env).includes('valor-secreto-generico'), false);

    // Windows preserva a caixa original da variável (Path), então buscamos sem diferenciar maiúsculas
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path');
    if (process.env.PATH !== undefined || process.env.Path !== undefined) {
      assert.ok(pathKey, 'PATH deve ser mantido no ambiente do Chromium');
      assert.strictEqual(
        env[pathKey],
        process.env.PATH !== undefined ? process.env.PATH : process.env.Path,
        'Variáveis não sensíveis devem ser mantidas'
      );
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value !== undefined) process.env[key] = value;
      else delete process.env[key];
    }
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js - flags de baixo consumo são aplicadas por padrão (opt-out via CHROMIUM_LOW_MEMORY=false)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const {
    getChromiumArgs,
    isLowMemoryModeEnabled,
    LOW_MEMORY_CHROMIUM_ARGS
  } = require('../browser');
  const original = process.env.CHROMIUM_LOW_MEMORY;

  const EXPECTED_LOW_MEMORY_FLAGS = [
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--renderer-process-limit=1',
    '--js-flags=--max-old-space-size=128',
    '--disk-cache-size=10485760'
  ];

  try {
    // 1. Padrão (sem env): flags aplicadas
    delete process.env.CHROMIUM_LOW_MEMORY;
    assert.strictEqual(isLowMemoryModeEnabled(), true);
    const defaultArgs = getChromiumArgs();
    for (const flag of EXPECTED_LOW_MEMORY_FLAGS) {
      assert.ok(defaultArgs.includes(flag), `Flag de baixo consumo ausente por padrão: ${flag}`);
    }
    assert.deepStrictEqual(
      LOW_MEMORY_CHROMIUM_ARGS,
      EXPECTED_LOW_MEMORY_FLAGS,
      'Conjunto de flags de baixo consumo deve ser exatamente o documentado'
    );
    assert.ok(defaultArgs.includes('--disable-dev-shm-usage'), 'Flags base devem ser preservadas');
    assert.ok(
      defaultArgs.includes('--disable-blink-features=AutomationControlled'),
      'Flags base devem ser preservadas'
    );
    // --no-zygote é exigido pelo Chromium apenas quando o sandbox está desabilitado
    assert.strictEqual(
      defaultArgs.includes('--no-zygote'),
      defaultArgs.includes('--no-sandbox'),
      '--no-zygote só pode ser usado junto com --no-sandbox'
    );

    // 2. Opt-out explícito: flags omitidas
    for (const offValue of ['false', '0', 'off']) {
      process.env.CHROMIUM_LOW_MEMORY = offValue;
      assert.strictEqual(isLowMemoryModeEnabled(), false, `Valor ${offValue} deve desativar`);
      const args = getChromiumArgs();
      assert.strictEqual(
        args.some((a) => EXPECTED_LOW_MEMORY_FLAGS.includes(a)),
        false,
        `Nenhuma flag de baixo consumo deve permanecer com CHROMIUM_LOW_MEMORY=${offValue}`
      );
      assert.ok(args.includes('--disable-dev-shm-usage'), 'Flags base permanecem no opt-out');
    }

    // 3. Opt-in explícito continua funcionando
    process.env.CHROMIUM_LOW_MEMORY = 'true';
    const tunedArgs = getChromiumArgs();
    for (const flag of EXPECTED_LOW_MEMORY_FLAGS) {
      assert.ok(tunedArgs.includes(flag), `Flag esperada ausente: ${flag}`);
    }

    // 4. Com sandbox desabilitado (NO_SANDBOX=true), --no-zygote é aplicado junto de --no-sandbox
    const originalNoSandbox = process.env.NO_SANDBOX;
    const originalCI = process.env.CI;
    try {
      process.env.NO_SANDBOX = 'true';
      delete process.env.CI;
      const noSandboxArgs = getChromiumArgs();
      assert.ok(noSandboxArgs.includes('--no-sandbox'), '--no-sandbox deve ser aplicado');
      assert.ok(
        noSandboxArgs.includes('--no-zygote'),
        '--no-zygote deve acompanhar --no-sandbox no modo de baixo consumo'
      );
    } finally {
      if (originalNoSandbox !== undefined) process.env.NO_SANDBOX = originalNoSandbox;
      else delete process.env.NO_SANDBOX;
      if (originalCI !== undefined) process.env.CI = originalCI;
      else delete process.env.CI;
    }
  } finally {
    if (original !== undefined) process.env.CHROMIUM_LOW_MEMORY = original;
    else delete process.env.CHROMIUM_LOW_MEMORY;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js - buildChromiumArgs suporta overrides de fallback (no-sandbox e low-memory)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const originalNoSandbox = process.env.NO_SANDBOX;
  const originalCI = process.env.CI;

  try {
    delete process.env.NO_SANDBOX;
    delete process.env.CI;

    // lowMemory: false remove as flags de baixo consumo
    const noLowMemory = buildChromiumArgs({ lowMemory: false });
    for (const flag of ['--disable-gpu', '--renderer-process-limit=1', '--no-zygote']) {
      assert.strictEqual(noLowMemory.includes(flag), false, `Não deveria conter ${flag}`);
    }

    // forceNoSandbox: true aplica --no-sandbox e, com low-memory, --no-zygote
    const forced = buildChromiumArgs({ forceNoSandbox: true, lowMemory: true });
    assert.ok(forced.includes('--no-sandbox'), 'forceNoSandbox deve aplicar --no-sandbox');
    assert.ok(forced.includes('--disable-setuid-sandbox'));
    assert.ok(forced.includes('--no-zygote'), '--no-zygote acompanha --no-sandbox');
    assert.ok(forced.includes('--renderer-process-limit=1'));
  } finally {
    if (originalNoSandbox !== undefined) process.env.NO_SANDBOX = originalNoSandbox;
    else delete process.env.NO_SANDBOX;
    if (originalCI !== undefined) process.env.CI = originalCI;
    else delete process.env.CI;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test(
  'browser.js - launchBrowser faz fallback de sandbox quando o kernel/container não o suporta',
  { skip: typeof process.getuid === 'function' && process.getuid() === 0 },
  async () => {
    const realFilesSnapshot = snapshotRealFiles();
    const playwright = require('playwright');
    const originalLaunch = playwright.chromium.launch;
    const originalCI = process.env.CI;
    const originalNoSandbox = process.env.NO_SANDBOX;
    const originalLowMemory = process.env.CHROMIUM_LOW_MEMORY;
    const calls = [];

    try {
      // Cenário determinístico: sandbox habilitado por padrão e low-memory desligado
      delete process.env.CI;
      delete process.env.NO_SANDBOX;
      process.env.CHROMIUM_LOW_MEMORY = 'false';

      playwright.chromium.launch = async (opts) => {
        calls.push(opts);
        if (calls.length === 1) {
          throw new Error('browserType.launch: No usable sandbox! ...');
        }
        return { close: async () => {}, __fake: true };
      };

      const browser = await launchBrowser({ headless: true });
      assert.strictEqual(browser.__fake, true);
      assert.strictEqual(calls.length, 2, 'Deve tentar exatamente duas configurações');
      assert.strictEqual(
        calls[0].args.includes('--no-sandbox'),
        false,
        'Primeira tentativa mantém o sandbox'
      );
      assert.ok(
        calls[1].args.includes('--no-sandbox'),
        'Fallback deve desabilitar o sandbox após a falha'
      );
    } finally {
      playwright.chromium.launch = originalLaunch;
      if (originalCI !== undefined) process.env.CI = originalCI;
      else delete process.env.CI;
      if (originalNoSandbox !== undefined) process.env.NO_SANDBOX = originalNoSandbox;
      else delete process.env.NO_SANDBOX;
      if (originalLowMemory !== undefined) process.env.CHROMIUM_LOW_MEMORY = originalLowMemory;
      else delete process.env.CHROMIUM_LOW_MEMORY;
      assertRealFilesUntouched(realFilesSnapshot);
    }
  }
);

test('browser.js - launchBrowser faz fallback removendo as flags de baixo consumo', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const playwright = require('playwright');
  const originalLaunch = playwright.chromium.launch;
  const originalCI = process.env.CI;
  const originalNoSandbox = process.env.NO_SANDBOX;
  const originalLowMemory = process.env.CHROMIUM_LOW_MEMORY;
  const calls = [];

  try {
    // Sandbox já desabilitado: as tentativas variam apenas o low-memory
    delete process.env.CI;
    process.env.NO_SANDBOX = 'true';
    process.env.CHROMIUM_LOW_MEMORY = 'true';

    playwright.chromium.launch = async (opts) => {
      calls.push(opts);
      if (calls.length === 1) {
        throw new Error('browserType.launch: Target page, context or browser has been closed');
      }
      return { close: async () => {}, __fake: true };
    };

    const browser = await launchBrowser({ headless: true });
    assert.strictEqual(browser.__fake, true);
    assert.strictEqual(calls.length, 2, 'Deve tentar exatamente duas configurações');
    assert.ok(calls[0].args.includes('--disable-gpu'), 'Primeira tentativa usa low-memory');
    assert.ok(calls[0].args.includes('--no-sandbox'), 'Sandbox forçado desabilitado');
    assert.strictEqual(
      calls[1].args.includes('--disable-gpu'),
      false,
      'Fallback deve remover as flags de baixo consumo'
    );
    assert.ok(calls[1].args.includes('--no-sandbox'), 'Fallback mantém o --no-sandbox');
  } finally {
    playwright.chromium.launch = originalLaunch;
    if (originalCI !== undefined) process.env.CI = originalCI;
    else delete process.env.CI;
    if (originalNoSandbox !== undefined) process.env.NO_SANDBOX = originalNoSandbox;
    else delete process.env.NO_SANDBOX;
    if (originalLowMemory !== undefined) process.env.CHROMIUM_LOW_MEMORY = originalLowMemory;
    else delete process.env.CHROMIUM_LOW_MEMORY;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
