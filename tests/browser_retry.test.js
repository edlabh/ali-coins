const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { retry, resolveStorageState } = require('../browser');
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

test('browser.js - CHROMIUM_LOW_MEMORY adiciona flags de baixa memória (opt-in)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const {
    getChromiumArgs,
    isLowMemoryModeEnabled,
    LOW_MEMORY_CHROMIUM_ARGS
  } = require('../browser');
  const original = process.env.CHROMIUM_LOW_MEMORY;

  try {
    delete process.env.CHROMIUM_LOW_MEMORY;
    assert.strictEqual(isLowMemoryModeEnabled(), false);
    const defaultArgs = getChromiumArgs();
    assert.strictEqual(
      defaultArgs.some((a) => a.startsWith('--renderer-process-limit')),
      false,
      'Sem opt-in não deve incluir flags de baixa memória'
    );

    process.env.CHROMIUM_LOW_MEMORY = 'true';
    assert.strictEqual(isLowMemoryModeEnabled(), true);
    const tunedArgs = getChromiumArgs();
    for (const flag of LOW_MEMORY_CHROMIUM_ARGS) {
      assert.ok(tunedArgs.includes(flag), `Flag esperada ausente: ${flag}`);
    }
    assert.ok(tunedArgs.includes('--disable-dev-shm-usage'), 'Flags base devem ser preservadas');
  } finally {
    if (original !== undefined) process.env.CHROMIUM_LOW_MEMORY = original;
    else delete process.env.CHROMIUM_LOW_MEMORY;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
