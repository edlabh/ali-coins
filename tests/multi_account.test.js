const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { maskUser, loadAccounts, syncAccountSessions } = require('../config');
const { calculateAccountBackoff } = require('../time_utils');
const { resolveSessionPaths, validateAndRefresh, saveSession } = require('../libs/session');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

test('config.js - maskUser formata emails e identificadores com segurança', () => {
  assert.strictEqual(maskUser('usuario@example.com'), 'us***@example.com');
  assert.strictEqual(maskUser('joao.silva@empresa.com.br'), 'jo***@empresa.com.br');
  // Telefones/IDs não devem vazar os dígitos finais
  assert.strictEqual(maskUser('11999887766'), '11***');
  assert.strictEqual(maskUser('12345'), '12***');
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

test('libs/session.js - resolveSessionPaths deriva session_meta correspondente a partir de sessionPath', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const tmpDir = createIsolatedTestDir('ali-res-paths-');

    // 1. Caminho secundário com hash deriva session_meta_<hash>.json
    const customSession = path.join(tmpDir, 'session_abcdef12.json');
    const res1 = resolveSessionPaths({ sessionPath: customSession });
    assert.strictEqual(res1.sPath, customSession);
    assert.strictEqual(res1.encPath, `${customSession}.enc`);
    assert.strictEqual(res1.mPath, path.join(tmpDir, 'session_meta_abcdef12.json'));

    // 2. Caminho secundário com extensão .enc
    const customEnc = path.join(tmpDir, 'session_71b9e590.json.enc');
    const res2 = resolveSessionPaths({ sessionPath: customEnc });
    assert.strictEqual(res2.sPath, path.join(tmpDir, 'session_71b9e590.json'));
    assert.strictEqual(res2.encPath, customEnc);
    assert.strictEqual(res2.mPath, path.join(tmpDir, 'session_meta_71b9e590.json'));

    // 3. Fallback seguro quando sessionMetaPath é passado explicitamente como null
    const res3 = resolveSessionPaths({ sessionPath: customSession, sessionMetaPath: null });
    assert.strictEqual(res3.mPath, path.join(tmpDir, 'session_meta_abcdef12.json'));

    // 4. Override explícito de sessionMetaPath é respeitado
    const customMeta = path.join(tmpDir, 'my_custom_meta.json');
    const res4 = resolveSessionPaths({ sessionPath: customSession, sessionMetaPath: customMeta });
    assert.strictEqual(res4.mPath, customMeta);

    // 5. session.json padrão deriva session_meta.json
    const defaultJson = path.join(tmpDir, 'session.json');
    const res5 = resolveSessionPaths({ sessionPath: defaultJson });
    assert.strictEqual(res5.mPath, path.join(tmpDir, 'session_meta.json'));

    cleanupIsolatedTestDir(tmpDir);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('config.js - syncAccountSessions migra sessão legada de session.json para conta secundária sem perda de dados', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('ali-sync-acc-');

  try {
    const legacyMetaPath = path.join(tmpDir, 'session_meta.json');
    const legacyEncPath = path.join(tmpDir, 'session.json.enc');

    // Simula sessão prévia de second@example.com salva no formato legado mono-conta
    fs.writeFileSync(
      legacyMetaPath,
      JSON.stringify({ user: 'second@example.com', lastStreakDays: 42 }),
      'utf-8'
    );
    fs.writeFileSync(legacyEncPath, 'DUMMY_ENCRYPTED_DATA_V2', 'utf-8');

    const env = {
      ALI_USER: 'first@example.com',
      ALI_PASSWORD: 'first_password',
      ALI_USER_2: 'second@example.com',
      ALI_PASSWORD_2: 'second_password'
    };

    const accounts = loadAccounts(env, tmpDir);
    assert.strictEqual(accounts.length, 2);
    syncAccountSessions(accounts, tmpDir);

    // A sessão foi migrada automaticamente para os caminhos isolados da Conta 2
    const targetEnc = `${accounts[1].sessionPath}.enc`;
    const targetMeta = accounts[1].sessionMetaPath;

    assert.strictEqual(
      fs.existsSync(targetEnc),
      true,
      'Arquivo .enc deve ter sido migrado para Conta 2'
    );
    assert.strictEqual(
      fs.existsSync(targetMeta),
      true,
      'Arquivo meta deve ter sido migrado para Conta 2'
    );
    assert.strictEqual(fs.readFileSync(targetEnc, 'utf-8'), 'DUMMY_ENCRYPTED_DATA_V2');

    const metaContent = JSON.parse(fs.readFileSync(targetMeta, 'utf-8'));
    assert.strictEqual(metaContent.user, 'second@example.com');
    assert.strictEqual(metaContent.lastStreakDays, 42);

    // O arquivo legado session.json.enc e session_meta.json original foi liberado
    assert.strictEqual(
      fs.existsSync(legacyEncPath),
      false,
      'session.json.enc legado deve ter sido movido'
    );
    assert.strictEqual(
      fs.existsSync(legacyMetaPath),
      false,
      'session_meta.json legado deve ter sido movido'
    );

    cleanupIsolatedTestDir(tmpDir);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - isolamento multi-conta: validação de conta secundária não carrega nem corrompe metadados da primária', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('ali-multi-iso-');

  try {
    const env = {
      ALI_USER: 'first@example.com',
      ALI_PASSWORD: 'first_password',
      ALI_USER_2: 'second@example.com',
      ALI_PASSWORD_2: 'second_password'
    };
    const accounts = loadAccounts(env, tmpDir);

    const fakeCookie = (name) => ({
      name,
      value: 'valid_ticket_123',
      expires: Math.floor(Date.now() / 1000) + 7200
    });

    // 1. Salva sessão da Conta 1
    await saveSession({ cookies: [fakeCookie('xman_us_t')] }, accounts[0].user, {
      sessionPath: accounts[0].sessionPath,
      sessionMetaPath: accounts[0].sessionMetaPath,
      encryptLocalSession: false
    });

    // 2. Salva sessão da Conta 2
    await saveSession({ cookies: [fakeCookie('xman_us_t')] }, accounts[1].user, {
      sessionPath: accounts[1].sessionPath,
      sessionMetaPath: accounts[1].sessionMetaPath,
      encryptLocalSession: false
    });

    // 3. Validação da Conta 2 passando apenas sessionPath (simulando chamada por módulo sem passar sessionMetaPath)
    const refreshedAccount2 = await validateAndRefresh(accounts[1].user, null, {
      sessionPath: accounts[1].sessionPath,
      encryptLocalSession: false
    });

    assert.strictEqual(refreshedAccount2.valid, true, 'Conta 2 deve ser validada com sucesso');
    assert.strictEqual(refreshedAccount2.metaData.user, 'second@example.com');

    // 4. Metadados e sessão da Conta 1 permanecem intactos e inalterados
    const primaryMeta = JSON.parse(fs.readFileSync(accounts[0].sessionMetaPath, 'utf-8'));
    assert.strictEqual(primaryMeta.user, 'first@example.com');
    assert.strictEqual(fs.existsSync(accounts[0].sessionPath), true);

    cleanupIsolatedTestDir(tmpDir);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/session.js - validateAndRefresh preserva sessão de outra conta configurada sem invocar clearSession destrutivo', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('ali-preserve-foreign-');
  const oldEnvUser2 = process.env.ALI_USER_2;
  const oldEnvPass2 = process.env.ALI_PASSWORD_2;

  try {
    process.env.ALI_USER_2 = 'configured_second@example.com';
    process.env.ALI_PASSWORD_2 = 'pass2';

    // Salva sessão pertencente a configured_second@example.com em session.json legado
    const fakeCookie = {
      name: 'xman_us_t',
      value: 'token_second_123',
      expires: Math.floor(Date.now() / 1000) + 7200
    };
    await saveSession({ cookies: [fakeCookie] }, 'configured_second@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false
    });

    // Executa validateAndRefresh com usuário primário diferente ('primary_user@example.com')
    const res = await validateAndRefresh('primary_user@example.com', null, {
      baseDir: tmpDir,
      encryptLocalSession: false
    });

    // Deve reportar inválido para a conta primária
    assert.strictEqual(res.valid, false);
    assert.ok(res.reason.includes('não corresponde à conta configurada'));

    // MAS os arquivos de sessão de configured_second@example.com NÃO devem ter sido deletados
    assert.strictEqual(
      fs.existsSync(path.join(tmpDir, 'session.json')),
      true,
      'session.json de conta configurada não deve ser apagado'
    );
    assert.strictEqual(
      fs.existsSync(path.join(tmpDir, 'session_meta.json')),
      true,
      'session_meta.json de conta configurada não deve ser apagado'
    );

    cleanupIsolatedTestDir(tmpDir);
  } finally {
    if (oldEnvUser2 !== undefined) {
      process.env.ALI_USER_2 = oldEnvUser2;
    } else {
      delete process.env.ALI_USER_2;
    }
    if (oldEnvPass2 !== undefined) {
      process.env.ALI_PASSWORD_2 = oldEnvPass2;
    } else {
      delete process.env.ALI_PASSWORD_2;
    }
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('config.js - loadAccounts dedup case-insensitive (Foo@x + foo@x preserva original e telegramChatId)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('ali-dedup-case-');

  try {
    // Cenário 1: ALI_USER primário ("Foo@example.com") e ALI_USER_2 secundário ("foo@example.com")
    const env1 = {
      ALI_USER: 'Foo@example.com',
      ALI_PASSWORD: 'primary_password',
      ALI_USER_2: 'foo@example.com',
      ALI_PASSWORD_2: 'secondary_password',
      TELEGRAM_CHAT_ID_2: '998877'
    };

    const accounts1 = loadAccounts(env1, tmpDir);
    assert.strictEqual(accounts1.length, 1, 'Deve desduplicar contas com case diferente');
    assert.strictEqual(
      accounts1[0].user,
      'Foo@example.com',
      'Preserva o casing original do primeiro cadastro'
    );
    assert.strictEqual(
      accounts1[0].maskedUser,
      'Fo***@example.com',
      'Preserva o maskedUser original'
    );
    assert.strictEqual(accounts1[0].index, 1, 'Preserva índice 1');
    assert.strictEqual(accounts1[0].sessionPath, path.join(tmpDir, 'session.json'));
    assert.strictEqual(
      accounts1[0].telegramChatId,
      '998877',
      'Herda telegramChatId da segunda menção se ausente na primeira'
    );

    // Cenário 2: accounts.json com duplicata case-insensitive
    const accountsJsonPath = path.join(tmpDir, 'accounts.json');
    fs.writeFileSync(
      accountsJsonPath,
      JSON.stringify([
        { user: 'UserOne@domain.com', password: 'pwd1' },
        { user: 'userone@domain.com', password: 'pwd2', telegramChatId: '12345' },
        { user: 'OTHER@domain.com', password: 'pwd3' }
      ]),
      'utf-8'
    );

    const accounts2 = loadAccounts({}, tmpDir);
    assert.strictEqual(
      accounts2.length,
      2,
      'accounts.json deve conter apenas 2 contas desduplicadas'
    );
    assert.strictEqual(accounts2[0].user, 'UserOne@domain.com');
    assert.strictEqual(accounts2[0].maskedUser, 'Us***@domain.com');
    assert.strictEqual(
      accounts2[0].telegramChatId,
      '12345',
      'Herda telegramChatId se ausente na primeira'
    );
    assert.strictEqual(accounts2[1].user, 'OTHER@domain.com');

    // Cenário 3: accounts.json com "First@domain.com" e env ALI_USER com "first@domain.com"
    fs.writeFileSync(
      accountsJsonPath,
      JSON.stringify([{ user: 'First@domain.com', password: 'pwd1' }]),
      'utf-8'
    );
    const accounts3 = loadAccounts(
      {
        ALI_USER: 'first@domain.com',
        ALI_PASSWORD: 'pwd2',
        TELEGRAM_CHAT_ID: '777'
      },
      tmpDir
    );
    assert.strictEqual(accounts3.length, 1);
    assert.strictEqual(accounts3[0].user, 'First@domain.com');
    assert.strictEqual(accounts3[0].telegramChatId, '777');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('config.js - maskUser mascara e-mails com local part curto (não vaza PII)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    assert.strictEqual(maskUser('a@b.co'), '***@b.co');
    assert.strictEqual(maskUser('ab@c.co'), 'ab***@c.co');
    assert.strictEqual(maskUser('a'), '***');
    assert.strictEqual(maskUser('@dominio.com'), '***@dominio.com');
    assert.strictEqual(maskUser('agiler@gmail.com'), 'ag***@gmail.com');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
