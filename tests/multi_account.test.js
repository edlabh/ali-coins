const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { maskUser, loadAccounts } = require('../config');
const { calculateAccountBackoff } = require('../time_utils');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('config.js - maskUser formata emails e identificadores com segurança', () => {
  assert.strictEqual(maskUser('usuario@example.com'), 'us***@example.com');
  assert.strictEqual(maskUser('joao.silva@empresa.com.br'), 'jo***@empresa.com.br');
  assert.strictEqual(maskUser('11999887766'), '11***66');
  assert.strictEqual(maskUser('abc'), '***');
  assert.strictEqual(maskUser(''), '***');
  assert.strictEqual(maskUser(null), '***');
  assert.strictEqual(maskUser(undefined), '***');
});

test('config.js - loadAccounts com conta única usa session.json e session_meta.json legados', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-acc-single-'));
    const env = {
      ALI_USER: 'primary@example.com',
      ALI_PASSWORD: 'primary_password'
    };

    const accounts = loadAccounts(env, tempDir);
    assert.strictEqual(accounts.length, 1);
    assert.strictEqual(accounts[0].user, 'primary@example.com');
    assert.strictEqual(accounts[0].password, 'primary_password');
    assert.strictEqual(accounts[0].maskedUser, 'pr***@example.com');
    assert.strictEqual(accounts[0].sessionPath, path.join(tempDir, 'session.json'));
    assert.strictEqual(accounts[0].sessionMetaPath, path.join(tempDir, 'session_meta.json'));

    fs.rmSync(tempDir, { recursive: true, force: true });
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('config.js - loadAccounts com variáveis ALI_USER_2 e ALI_USER_3 gera sessões isoladas por hash', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-acc-multi-'));
    const env = {
      ALI_USER: 'primary@example.com',
      ALI_PASSWORD: 'primary_password',
      ALI_USER_2: 'second@example.com',
      ALI_PASSWORD_2: 'second_password',
      ALI_USER_3: 'third@example.com',
      ALI_PASSWORD_3: 'third_password'
    };

    const accounts = loadAccounts(env, tempDir);
    assert.strictEqual(accounts.length, 3);

    // Conta 1 (primária)
    assert.strictEqual(accounts[0].user, 'primary@example.com');
    assert.strictEqual(accounts[0].sessionPath, path.join(tempDir, 'session.json'));
    assert.strictEqual(accounts[0].sessionMetaPath, path.join(tempDir, 'session_meta.json'));

    // Conta 2 (secundária)
    assert.strictEqual(accounts[1].user, 'second@example.com');
    assert.strictEqual(accounts[1].maskedUser, 'se***@example.com');
    assert.ok(accounts[1].sessionPath.includes('session_'));
    assert.notStrictEqual(accounts[1].sessionPath, path.join(tempDir, 'session.json'));
    assert.ok(accounts[1].lockPath.includes('ali-coins-'));

    // Conta 3 (secundária)
    assert.strictEqual(accounts[2].user, 'third@example.com');
    assert.strictEqual(accounts[2].maskedUser, 'th***@example.com');
    assert.notStrictEqual(accounts[2].sessionPath, accounts[1].sessionPath);

    fs.rmSync(tempDir, { recursive: true, force: true });
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('config.js - loadAccounts a partir de arquivo accounts.json isolado', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-acc-file-'));
    const accountsFilePath = path.join(tempDir, 'accounts.json');
    const mockAccounts = [
      { user: 'acc_json_1@example.com', password: 'pass1' },
      { user: 'acc_json_2@example.com', password: 'pass2' }
    ];
    fs.writeFileSync(accountsFilePath, JSON.stringify(mockAccounts), 'utf-8');

    const accounts = loadAccounts({}, tempDir);
    assert.strictEqual(accounts.length, 2);
    assert.strictEqual(accounts[0].user, 'acc_json_1@example.com');
    assert.strictEqual(accounts[1].user, 'acc_json_2@example.com');
    assert.strictEqual(accounts[0].sessionPath, path.join(tempDir, 'session.json'));
    assert.ok(accounts[1].sessionPath.includes('session_'));

    fs.rmSync(tempDir, { recursive: true, force: true });
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('config.js - loadAccounts mapeia telegramChatId via env (específico e fallback global)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-acc-tg-env-'));
    const env = {
      ALI_USER: 'acc1@example.com',
      ALI_PASSWORD: 'pass1',
      ALI_USER_2: 'acc2@example.com',
      ALI_PASSWORD_2: 'pass2',
      ALI_USER_3: 'acc3@example.com',
      ALI_PASSWORD_3: 'pass3',
      TELEGRAM_CHAT_ID: '100000',
      TELEGRAM_CHAT_ID_2: '200000'
    };

    const accounts = loadAccounts(env, tempDir);
    assert.strictEqual(accounts.length, 3);
    assert.strictEqual(accounts[0].telegramChatId, '100000', 'Conta 1 usa TELEGRAM_CHAT_ID');
    assert.strictEqual(accounts[1].telegramChatId, '200000', 'Conta 2 usa TELEGRAM_CHAT_ID_2');
    assert.strictEqual(
      accounts[2].telegramChatId,
      '100000',
      'Conta 3 herda fallback TELEGRAM_CHAT_ID'
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('config.js - loadAccounts preserva telegramChatId configurado em accounts.json', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-acc-tg-file-'));
    const accountsFilePath = path.join(tempDir, 'accounts.json');
    const mockAccounts = [
      {
        user: 'json_acc_1@example.com',
        password: 'pass1',
        telegramChatId: '300001'
      },
      {
        user: 'json_acc_2@example.com',
        password: 'pass2'
      }
    ];
    fs.writeFileSync(accountsFilePath, JSON.stringify(mockAccounts), 'utf-8');

    const accounts = loadAccounts({ TELEGRAM_CHAT_ID: '999999' }, tempDir);
    assert.strictEqual(accounts.length, 2);
    assert.strictEqual(
      accounts[0].telegramChatId,
      '300001',
      'Conta 1 deve preservar telegramChatId do JSON'
    );
    assert.strictEqual(
      accounts[1].telegramChatId,
      '999999',
      'Conta 2 sem chatId no JSON recebe fallback'
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('all.js - calculateAccountBackoff calcula progressão exponencial, jitter, teto e override por env', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const oldEnv = process.env.ACCOUNT_BACKOFF_BASE_MS;
  try {
    delete process.env.ACCOUNT_BACKOFF_BASE_MS;

    // attempt 0 (base 2000), jitterFactor 1.0 (jitterFraction=0.5)
    assert.strictEqual(calculateAccountBackoff(0, null, 30000, 0.5), 2000);
    // attempt 1 (base 4000), jitterFactor 1.0
    assert.strictEqual(calculateAccountBackoff(1, null, 30000, 0.5), 4000);
    // attempt 2 (base 8000), jitterFactor 1.0
    assert.strictEqual(calculateAccountBackoff(2, null, 30000, 0.5), 8000);
    // attempt 3 (base 16000), jitterFactor 1.0
    assert.strictEqual(calculateAccountBackoff(3, null, 30000, 0.5), 16000);
    // attempt 4 (base 32000), capped at maxMs 30000
    assert.strictEqual(calculateAccountBackoff(4, null, 30000, 0.5), 30000);

    // Jitter bounds (0.8x a 1.2x): base 2000
    // jitterFraction = 0.0 -> 0.8 * 2000 = 1600
    assert.strictEqual(calculateAccountBackoff(0, 2000, 30000, 0.0), 1600);
    // jitterFraction = 1.0 -> 1.2 * 2000 = 2400
    assert.strictEqual(calculateAccountBackoff(0, 2000, 30000, 1.0), 2400);

    // Override via process.env.ACCOUNT_BACKOFF_BASE_MS
    process.env.ACCOUNT_BACKOFF_BASE_MS = '5000';
    assert.strictEqual(calculateAccountBackoff(0, null, 30000, 0.5), 5000);
    assert.strictEqual(calculateAccountBackoff(1, null, 30000, 0.5), 10000);

    // Jitter aleatório default dentro dos limites válidos
    const dynamicBackoff = calculateAccountBackoff(0, 2000, 30000);
    assert.ok(dynamicBackoff >= 1600 && dynamicBackoff <= 2400);
  } finally {
    if (oldEnv !== undefined) {
      process.env.ACCOUNT_BACKOFF_BASE_MS = oldEnv;
    } else {
      delete process.env.ACCOUNT_BACKOFF_BASE_MS;
    }
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
