const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  retry,
  resolveStorageState,
  launchBrowser,
  buildChromiumArgs,
  getLowMemoryChromiumArgs
} = require('../browser');
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
    getLowMemoryChromiumArgs,
    shouldDisableDevShmUsage
  } = require('../browser');
  const original = process.env.CHROMIUM_LOW_MEMORY;
  const originalHeap = process.env.CHROMIUM_JS_HEAP_MB;

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
      getLowMemoryChromiumArgs(),
      EXPECTED_LOW_MEMORY_FLAGS,
      'Conjunto de flags de baixo consumo deve ser exatamente o documentado'
    );
    assert.strictEqual(
      defaultArgs.includes('--disable-dev-shm-usage'),
      shouldDisableDevShmUsage(),
      'A flag --disable-dev-shm-usage deve seguir a detecção de /dev/shm'
    );
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
      assert.strictEqual(
        args.includes('--disable-dev-shm-usage'),
        shouldDisableDevShmUsage(),
        'A flag --disable-dev-shm-usage deve permanecer consistente no opt-out'
      );
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

    // 5. CHROMIUM_JS_HEAP_MB ajusta o heap do V8 do Chromium
    process.env.CHROMIUM_JS_HEAP_MB = '256';
    assert.ok(
      getLowMemoryChromiumArgs().includes('--js-flags=--max-old-space-size=256'),
      'Heap configurável via CHROMIUM_JS_HEAP_MB'
    );
    process.env.CHROMIUM_JS_HEAP_MB = 'invalido';
    assert.ok(
      getLowMemoryChromiumArgs().includes('--js-flags=--max-old-space-size=128'),
      'Valor inválido deve voltar ao padrão de 128MB'
    );
  } finally {
    if (original !== undefined) process.env.CHROMIUM_LOW_MEMORY = original;
    else delete process.env.CHROMIUM_LOW_MEMORY;
    if (originalHeap !== undefined) process.env.CHROMIUM_JS_HEAP_MB = originalHeap;
    else delete process.env.CHROMIUM_JS_HEAP_MB;
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

test(
  'browser.js - falha genérica NÃO desabilita o sandbox (só erro de sandbox o faz)',
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
      delete process.env.CI;
      delete process.env.NO_SANDBOX;
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

      // O fallback por falha genérica apenas remove o low-memory; sandbox permanece ativo
      assert.strictEqual(
        calls[1].args.includes('--no-sandbox'),
        false,
        'Falha genérica não pode desabilitar o sandbox'
      );
      assert.strictEqual(
        calls[1].args.includes('--disable-gpu'),
        false,
        'Fallback remove as flags de baixo consumo'
      );
      assert.strictEqual(calls[1].chromiumSandbox, true, 'Sandbox deve seguir habilitado');
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

test('browser.js - heap do Chromium é limitado a [64, 2048] MB e erro final preserva a causa', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const originalHeap = process.env.CHROMIUM_JS_HEAP_MB;
  const playwright = require('playwright');
  const originalLaunch = playwright.chromium.launch;
  const originalCI = process.env.CI;
  const originalNoSandbox = process.env.NO_SANDBOX;
  const originalLowMemory = process.env.CHROMIUM_LOW_MEMORY;

  try {
    // Clamp superior e inferior
    process.env.CHROMIUM_JS_HEAP_MB = '999999';
    assert.ok(
      getLowMemoryChromiumArgs().includes('--js-flags=--max-old-space-size=2048'),
      'Valor absurdo deve ser limitado a 2048MB'
    );
    process.env.CHROMIUM_JS_HEAP_MB = '1';
    assert.ok(
      getLowMemoryChromiumArgs().includes('--js-flags=--max-old-space-size=64'),
      'Valor muito baixo deve ser elevado ao mínimo de 64MB'
    );

    // Erro final do launch carrega a causa (1ª tentativa) quando há mais de uma
    delete process.env.CI;
    delete process.env.NO_SANDBOX;
    process.env.CHROMIUM_LOW_MEMORY = 'false';
    const firstError = new Error('browserType.launch: No usable sandbox! ...');
    let calls = 0;
    playwright.chromium.launch = async () => {
      calls++;
      if (calls === 1) throw firstError;
      throw new Error('browserType.launch: segundo erro');
    };

    await assert.rejects(
      () => launchBrowser({ headless: true }),
      (err) => {
        assert.ok(/segundo erro/.test(err.message), `Erro final inesperado: ${err.message}`);
        assert.strictEqual(err.cause, firstError, 'A causa original deve ser preservada');
        return true;
      }
    );
  } finally {
    playwright.chromium.launch = originalLaunch;
    if (originalHeap !== undefined) process.env.CHROMIUM_JS_HEAP_MB = originalHeap;
    else delete process.env.CHROMIUM_JS_HEAP_MB;
    if (originalCI !== undefined) process.env.CI = originalCI;
    else delete process.env.CI;
    if (originalNoSandbox !== undefined) process.env.NO_SANDBOX = originalNoSandbox;
    else delete process.env.NO_SANDBOX;
    if (originalLowMemory !== undefined) process.env.CHROMIUM_LOW_MEMORY = originalLowMemory;
    else delete process.env.CHROMIUM_LOW_MEMORY;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js - flags de economia de CPU e bloqueio de service workers (padrão e opt-out)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const {
    getChromiumArgs,
    BACKGROUND_CPU_SAVING_ARGS,
    isServiceWorkerBlockingEnabled
  } = require('../browser');
  const originalLowMemory = process.env.CHROMIUM_LOW_MEMORY;
  const originalSw = process.env.PW_BLOCK_SERVICE_WORKERS;

  try {
    delete process.env.CHROMIUM_LOW_MEMORY;

    const args = getChromiumArgs();
    for (const flag of BACKGROUND_CPU_SAVING_ARGS) {
      assert.ok(args.includes(flag), `Flag de economia de CPU ausente: ${flag}`);
    }
    // BackForwardCache deve permanecer habilitado para não alterar o goBack() das surpresas
    assert.strictEqual(
      BACKGROUND_CPU_SAVING_ARGS.join(' ').includes('BackForwardCache'),
      false,
      'BackForwardCache não deve ser desabilitado'
    );

    // Bloqueio de service workers: habilitado por padrão
    delete process.env.PW_BLOCK_SERVICE_WORKERS;
    assert.strictEqual(isServiceWorkerBlockingEnabled(), true);
    for (const offValue of ['false', '0', 'off', 'no']) {
      process.env.PW_BLOCK_SERVICE_WORKERS = offValue;
      assert.strictEqual(
        isServiceWorkerBlockingEnabled(),
        false,
        `PW_BLOCK_SERVICE_WORKERS=${offValue} deve desativar o bloqueio`
      );
    }
  } finally {
    if (originalLowMemory !== undefined) process.env.CHROMIUM_LOW_MEMORY = originalLowMemory;
    else delete process.env.CHROMIUM_LOW_MEMORY;
    if (originalSw !== undefined) process.env.PW_BLOCK_SERVICE_WORKERS = originalSw;
    else delete process.env.PW_BLOCK_SERVICE_WORKERS;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js - env do caller é mesclado sem remover a sanitização de segredos', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const playwright = require('playwright');
  const { launchBrowser } = require('../browser');
  const originalLaunch = playwright.chromium.launch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  let captured = null;

  try {
    delete process.env.CI;
    delete process.env.NO_SANDBOX;
    process.env.TELEGRAM_BOT_TOKEN = '123456:AA-secret-token-value-000000000000';

    playwright.chromium.launch = async (opts) => {
      captured = opts;
      return { close: async () => {}, __fake: true };
    };

    await launchBrowser({ headless: true, env: { EXTRA_FLAG: 'yes' } });

    assert.ok(captured, 'launch deve ter sido chamado');
    assert.strictEqual(captured.env.EXTRA_FLAG, 'yes', 'env do caller deve ser mesclado');
    assert.strictEqual(
      captured.env.TELEGRAM_BOT_TOKEN,
      undefined,
      'segredos não devem ser repassados ao Chromium'
    );
  } finally {
    playwright.chromium.launch = originalLaunch;
    if (originalToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = originalToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js - fecha o BrowserContext se o setup falhar após newContext', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const { newMobileContext } = require('../browser');
  let closed = false;

  try {
    const context = {
      addInitScript: async () => {},
      route: async () => {
        throw new Error('falha ao registrar rota');
      },
      close: async () => {
        closed = true;
      }
    };
    const browser = { newContext: async () => context };

    await assert.rejects(() => newMobileContext(browser, null, {}), /falha ao registrar rota/);
    assert.strictEqual(closed, true, 'contexto deve ser fechado quando o setup falha');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js - getChromiumEnv remove credenciais de proxy e chaves sensíveis extras', () => {
  const { getChromiumEnv } = require('../browser');
  const orig = { ...process.env };
  const savedProxy = process.env.HTTPS_PROXY;
  const savedPw = process.env.ALI_ACC_PASS;
  try {
    process.env.HTTPS_PROXY = 'http://user:senha@proxy.local:8080';
    process.env.ALI_ACC_PASS = 'super-secreta';
    const env = getChromiumEnv();
    assert.strictEqual(env.HTTPS_PROXY, 'http://proxy.local:8080', 'userinfo do proxy removido');
    assert.strictEqual(env.ALI_ACC_PASS, undefined, 'chave com PASS não deve ir ao Chromium');
  } finally {
    if (savedProxy !== undefined) process.env.HTTPS_PROXY = savedProxy;
    else delete process.env.HTTPS_PROXY;
    if (savedPw !== undefined) process.env.ALI_ACC_PASS = savedPw;
    else delete process.env.ALI_ACC_PASS;
    for (const k of Object.keys(process.env)) if (!(k in orig)) delete process.env[k];
  }
});

test('browser.js - shouldDisableDevShmUsage decide por plataforma e espaço em /dev/shm', () => {
  const { shouldDisableDevShmUsage } = require('../browser');
  const realFilesSnapshot = snapshotRealFiles();
  const MB = 1024 * 1024;
  try {
    // Windows/macOS não têm /dev/shm: a flag não se aplica
    assert.strictEqual(shouldDisableDevShmUsage({ platform: 'win32' }), false);
    assert.strictEqual(shouldDisableDevShmUsage({ platform: 'darwin' }), false);

    // Linux com /dev/shm pequeno (64 MB): aplica a flag
    const small = () => ({ bsize: 4096, bfree: (64 * MB) / 4096 });
    assert.strictEqual(
      shouldDisableDevShmUsage({ platform: 'linux', statfs: small }),
      true,
      '/dev/shm pequeno deve desabilitar o uso'
    );

    // Linux com /dev/shm grande (256 MB): não aplica (tmpfs em RAM)
    const big = () => ({ bsize: 4096, bfree: (256 * MB) / 4096 });
    assert.strictEqual(
      shouldDisableDevShmUsage({ platform: 'linux', statfs: big }),
      false,
      '/dev/shm grande deve permitir o uso de RAM'
    );

    // Exceção no statfs: fallback defensivo
    const boom = () => {
      throw new Error('EACCES');
    };
    assert.strictEqual(
      shouldDisableDevShmUsage({ platform: 'linux', statfs: boom }),
      true,
      'exceção deve cair no fallback defensivo'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js - setupResourceBlocking intercepta assets e trata erros de abort/continue', async () => {
  const { setupResourceBlocking } = require('../browser');
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let registeredPattern = null;
    let routeHandler = null;
    const mockContext = {
      route: async (pattern, handler) => {
        registeredPattern = pattern;
        routeHandler = handler;
      }
    };

    await setupResourceBlocking(mockContext);
    assert.strictEqual(registeredPattern, '**/*');
    assert.strictEqual(typeof routeHandler, 'function');

    // 1: abort de imagem com erro de target closed (não deve lançar exceção)
    let abortCalled = false;
    const mockRouteImage = {
      request: () => ({
        resourceType: () => 'image',
        url: () => 'https://example.com/logo.png'
      }),
      abort: async () => {
        abortCalled = true;
        throw new Error('Target closed');
      },
      continue: async () => {}
    };
    await routeHandler(mockRouteImage);
    assert.strictEqual(abortCalled, true);

    // 2: abort de telemetria
    let telemetryAborted = false;
    const mockRouteTelemetry = {
      request: () => ({
        resourceType: () => 'script',
        url: () => 'https://www.google-analytics.com/analytics.js'
      }),
      abort: async () => {
        telemetryAborted = true;
      },
      continue: async () => {}
    };
    await routeHandler(mockRouteTelemetry);
    assert.strictEqual(telemetryAborted, true);

    // 3: continue para script legítimo com erro de target closed (não deve lançar exceção)
    let continueCalled = false;
    const mockRouteScript = {
      request: () => ({
        resourceType: () => 'script',
        url: () => 'https://ae01.alicdn.com/app.js'
      }),
      abort: async () => {},
      continue: async () => {
        continueCalled = true;
        throw new Error('Route is already handled');
      }
    };
    await routeHandler(mockRouteScript);
    assert.strictEqual(continueCalled, true);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js - setupResourceBlocking bloqueia trackers de anúncios de terceiros', async () => {
  const { setupResourceBlocking } = require('../browser');
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let routeHandler = null;
    const mockContext = {
      route: async (_pattern, handler) => {
        routeHandler = handler;
      }
    };
    await setupResourceBlocking(mockContext, false);

    const aborted = [];
    const continued = [];
    const makeRoute = (url, type = 'script') => ({
      request: () => ({ resourceType: () => type, url: () => url }),
      abort: async () => {
        aborted.push(url);
      },
      continue: async () => {
        continued.push(url);
      }
    });

    const adUrls = [
      'https://connect.facebook.net/en_US/sdk.js',
      'https://analytics.tiktok.com/i18n/pixel/events.js',
      'https://static.criteo.net/js/ld/publishertag.js',
      'https://bat.bing.com/bat.js'
    ];
    for (const url of adUrls) {
      await routeHandler(makeRoute(url));
    }
    await routeHandler(makeRoute('https://ae01.alicdn.com/app.js'));
    await routeHandler(makeRoute('https://m.aliexpress.com/p/coin-index/index.js'));

    assert.deepStrictEqual(aborted, adUrls, 'trackers de anúncios devem ser abortados');
    assert.deepStrictEqual(
      continued,
      ['https://ae01.alicdn.com/app.js', 'https://m.aliexpress.com/p/coin-index/index.js'],
      'scripts legítimos da AliExpress continuam carregando'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js - flags de eficiência incluem no-pings, extensões, notificações e prerender', () => {
  const args = buildChromiumArgs({ lowMemory: false });
  for (const flag of [
    '--no-pings',
    '--disable-extensions',
    '--disable-notifications',
    '--prerender=disabled'
  ]) {
    assert.ok(args.includes(flag), `flag de eficiência ausente: ${flag}`);
  }
});
