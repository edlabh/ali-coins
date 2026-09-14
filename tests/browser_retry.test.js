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
