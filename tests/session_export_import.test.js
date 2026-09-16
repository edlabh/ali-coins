const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { exportSession, exportAllSessions, isAllowedStorageKey } = require('../export_session');
const {
  importSession,
  importAllSessions,
  migrateLegacySession,
  ImportSessionError
} = require('../import_session');
const { loadSessionFiles } = require('../libs/session');
const { safeWriteFile } = require('../security');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

const TEST_SECRET = 'secret_key_with_at_least_32_characters_long_12345';

test('export_session.js - allowlist de localStorage', () => {
  assert.strictEqual(isAllowedStorageKey('login_token'), true);
  assert.strictEqual(isAllowedStorageKey('user_id'), true);
  assert.strictEqual(isAllowedStorageKey('_m_h5_tk'), true);
  assert.strictEqual(isAllowedStorageKey('account_pref'), true);

  // Chaves de telemetria indesejadas devem ser rejeitadas
  assert.strictEqual(isAllowedStorageKey('APLUS_S_CORE'), false);
  assert.strictEqual(isAllowedStorageKey('batman_cache'), false);
  assert.strictEqual(isAllowedStorageKey('goldlog_beacon'), false);
});

test('export_session & import_session - roundtrip completo criptografado (.enc) at-rest por padrão', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('export-import-enc-');
  const originalEnvUser2 = process.env.ALI_USER_2;
  const originalEnvPass2 = process.env.ALI_PASSWORD_2;
  delete process.env.ALI_USER_2;
  delete process.env.ALI_PASSWORD_2;

  try {
    const sPath = path.join(tmpDir, 'session.json');
    const encPath = path.join(tmpDir, 'session.json.enc');
    const mPath = path.join(tmpDir, 'session_meta.json');
    const tPath = path.join(tmpDir, 'session_token.txt');

    const fakeSession = {
      cookies: [
        {
          name: 'xman_us_t',
          value: 'authenticated_cookie',
          expires: Math.floor(Date.now() / 1000) + 7200
        }
      ],
      origins: [
        {
          origin: 'https://www.aliexpress.com',
          localStorage: [
            { name: 'user_session_token', value: '123' },
            { name: 'APLUS_S_CORE_LOG', value: 'heavy_telemetry_garbage' }
          ]
        }
      ]
    };

    const fakeMeta = {
      user: 'export_test_user@example.com'
    };

    await safeWriteFile(sPath, JSON.stringify(fakeSession, null, 2));
    await safeWriteFile(mPath, JSON.stringify(fakeMeta, null, 2));

    // Exportar sessão isolada
    const exportRes = await exportSession({
      secret: TEST_SECRET,
      showToken: false,
      baseDir: tmpDir
    });
    assert.ok(exportRes.token.startsWith('v2:'));
    assert.strictEqual(exportRes.user, 'export_test_user@example.com');
    assert.ok(fs.existsSync(tPath));

    // Apagar session.json e session_meta.json do tmpDir para simular máquina remota
    await fs.promises.unlink(sPath);
    await fs.promises.unlink(mPath);

    // Importar sessão no tmpDir (padrão ENCRYPT_LOCAL_SESSION: grava session.json.enc)
    const importRes = await importSession({
      secret: TEST_SECRET,
      tokenString: exportRes.token,
      baseDir: tmpDir
    });
    assert.strictEqual(importRes.user, 'export_test_user@example.com');
    assert.strictEqual(importRes.cookiesCount, 1);
    assert.strictEqual(importRes.encrypted, true);

    // 1. Verificar que session.json.enc foi criado e session.json em texto plano NÃO existe
    assert.ok(fs.existsSync(encPath), 'Deve criar session.json.enc criptografado');
    assert.strictEqual(
      fs.existsSync(sPath),
      false,
      'Não deve criar session.json em texto plano por padrão'
    );

    // 2. Verificar que o conteúdo de session.json.enc é um token criptografado válido
    const encContent = await fs.promises.readFile(encPath, 'utf-8');
    assert.ok(encContent.startsWith('v2:'), 'Conteúdo gravado deve iniciar com v2:');

    // 3. Verificar que o loader nativo (loadSessionFiles) carrega e descriptografa transparentemente
    const loaded = await loadSessionFiles({ baseDir: tmpDir, secret: TEST_SECRET });
    assert.ok(loaded.sessionData, 'loadSessionFiles deve carregar a sessão descriptografada');
    assert.strictEqual(loaded.sessionData.cookies[0].name, 'xman_us_t');
    assert.strictEqual(loaded.sessionData.origins[0].localStorage[0].name, 'user_session_token');

    // 4. Telemetria indesejada foi filtrada durante exportação
    assert.strictEqual(loaded.sessionData.origins[0].localStorage.length, 1);

    // 5. Verificar metadados
    assert.ok(fs.existsSync(mPath));
    const restoredMeta = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
    assert.strictEqual(restoredMeta.isImported, true);
    assert.strictEqual(restoredMeta.encrypted, true);
    assert.ok(restoredMeta.importedAt);
    assert.strictEqual(restoredMeta.user, 'export_test_user@example.com');
  } finally {
    if (originalEnvUser2 !== undefined) process.env.ALI_USER_2 = originalEnvUser2;
    if (originalEnvPass2 !== undefined) process.env.ALI_PASSWORD_2 = originalEnvPass2;
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('import_session.js - opt-out com flag plaintext grava session.json sem criptografia', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-plaintext-');

  try {
    const sPath = path.join(tmpDir, 'session.json');
    const encPath = path.join(tmpDir, 'session.json.enc');
    const mPath = path.join(tmpDir, 'session_meta.json');

    const fakeSession = {
      cookies: [{ name: 'xman_us_t', value: 'opt_out_token', expires: 9999999999 }],
      origins: []
    };
    await safeWriteFile(sPath, JSON.stringify(fakeSession, null, 2));

    const exportRes = await exportSession({
      secret: TEST_SECRET,
      showToken: false,
      baseDir: tmpDir
    });
    await fs.promises.unlink(sPath);

    // Importar explicitamente em plaintext
    const importRes = await importSession({
      secret: TEST_SECRET,
      tokenString: exportRes.token,
      baseDir: tmpDir,
      plaintext: true
    });

    assert.strictEqual(importRes.encrypted, false);
    assert.ok(fs.existsSync(sPath), 'Deve criar session.json em texto claro');
    assert.strictEqual(fs.existsSync(encPath), false, 'Não deve criar session.json.enc');

    const restoredSession = JSON.parse(await fs.promises.readFile(sPath, 'utf-8'));
    assert.strictEqual(restoredSession.cookies[0].value, 'opt_out_token');

    const restoredMeta = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
    assert.strictEqual(restoredMeta.encrypted, false);
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('import_session.js - migração de session.json legado para session.json.enc', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-migration-');

  try {
    const sPath = path.join(tmpDir, 'session.json');
    const encPath = path.join(tmpDir, 'session.json.enc');
    const mPath = path.join(tmpDir, 'session_meta.json');

    const legacySession = {
      cookies: [{ name: 'xman_us_t', value: 'legacy_cookie_val' }],
      origins: []
    };
    const legacyMeta = { user: 'legacy_user@example.com' };

    await safeWriteFile(sPath, JSON.stringify(legacySession, null, 2));
    await safeWriteFile(mPath, JSON.stringify(legacyMeta, null, 2));

    // Executar migração
    const migResult = await migrateLegacySession({
      baseDir: tmpDir,
      secret: TEST_SECRET
    });

    assert.strictEqual(migResult.migrated, true);
    assert.strictEqual(migResult.user, 'legacy_user@example.com');
    assert.ok(fs.existsSync(encPath), 'Arquivo session.json.enc deve existir após migração');
    assert.strictEqual(fs.existsSync(sPath), false, 'session.json legado deve ter sido removido');

    // Loader consegue carregar a sessão migrada
    const loaded = await loadSessionFiles({ baseDir: tmpDir, secret: TEST_SECRET });
    assert.ok(loaded.sessionData);
    assert.strictEqual(loaded.sessionData.cookies[0].value, 'legacy_cookie_val');

    const meta = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
    assert.strictEqual(meta.encrypted, true);
    assert.ok(meta.migratedAt);
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('import_session.js - remoção de session.json legado ao importar nova sessão criptografada', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-cleanup-legacy-');
  const originalEnvUser2 = process.env.ALI_USER_2;
  const originalEnvPass2 = process.env.ALI_PASSWORD_2;
  delete process.env.ALI_USER_2;
  delete process.env.ALI_PASSWORD_2;

  try {
    const sPath = path.join(tmpDir, 'session.json');
    const encPath = path.join(tmpDir, 'session.json.enc');
    const mPath = path.join(tmpDir, 'session_meta.json');

    // 1. Simula um session.json legado existente no host
    await safeWriteFile(
      sPath,
      JSON.stringify({ cookies: [{ name: 'xman_us_t', value: 'old_val' }] })
    );

    // 2. Exporta uma nova sessão
    const newSession = {
      cookies: [{ name: 'xman_us_t', value: 'new_fresh_val' }],
      origins: []
    };
    const newDir = createIsolatedTestDir('import-helper-');
    try {
      await safeWriteFile(path.join(newDir, 'session.json'), JSON.stringify(newSession));
      await safeWriteFile(
        path.join(newDir, 'session_meta.json'),
        JSON.stringify({ user: 'new@example.com' })
      );
      const exported = await exportSession({ secret: TEST_SECRET, baseDir: newDir });

      // 3. Importa no diretório que continha o session.json legado
      await importSession({
        secret: TEST_SECRET,
        tokenString: exported.token,
        baseDir: tmpDir
      });

      assert.ok(fs.existsSync(encPath), 'Novo session.json.enc gravado');
      assert.ok(fs.existsSync(mPath), 'Novo session_meta.json gravado');
      assert.strictEqual(
        fs.existsSync(sPath),
        false,
        'session.json legado deve ter sido limpo após novo .enc'
      );

      const loaded = await loadSessionFiles({ baseDir: tmpDir, secret: TEST_SECRET });
      assert.strictEqual(loaded.sessionData.cookies[0].value, 'new_fresh_val');
    } finally {
      cleanupIsolatedTestDir(newDir);
    }
  } finally {
    if (originalEnvUser2 !== undefined) process.env.ALI_USER_2 = originalEnvUser2;
    if (originalEnvPass2 !== undefined) process.env.ALI_PASSWORD_2 = originalEnvPass2;
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('import_session.js - erro seguro quando SESSION_SECRET está ausente ou inválida (< 32 chars)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-secret-err-');

  try {
    // 1. Sem secret
    await assert.rejects(
      async () => {
        await importSession({
          secret: '',
          tokenString: 'v2:test',
          baseDir: tmpDir
        });
      },
      (err) => {
        assert.ok(err instanceof ImportSessionError);
        assert.ok(err.message.includes('SESSION_SECRET é obrigatório'));
        assert.ok(!err.stack.includes('crypto.js'), 'Não deve vazar stack interna de crypto');
        return true;
      }
    );

    // 2. Secret curta (< 32 caracteres)
    await assert.rejects(
      async () => {
        await importSession({
          secret: 'curta',
          tokenString: 'v2:test',
          baseDir: tmpDir
        });
      },
      (err) => {
        assert.ok(err instanceof ImportSessionError);
        assert.ok(err.message.includes('mínimo 32 caracteres'));
        return true;
      }
    );
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('export_session & import_session - auto-roteamento e isolamento de sessão multi-conta (Conta 1 e Conta 2)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('export-import-multi-');
  const originalEnv = {
    ALI_USER: process.env.ALI_USER,
    ALI_PASSWORD: process.env.ALI_PASSWORD,
    ALI_USER_2: process.env.ALI_USER_2,
    ALI_PASSWORD_2: process.env.ALI_PASSWORD_2
  };

  try {
    process.env.ALI_USER = 'primary@multi-test.com';
    process.env.ALI_PASSWORD = 'primary_password_123';
    process.env.ALI_USER_2 = 'secondary@multi-test.com';
    process.env.ALI_PASSWORD_2 = 'secondary_password_123';

    const { loadAccounts } = require('../config');
    const accounts = loadAccounts(process.env, tmpDir);
    assert.strictEqual(accounts.length, 2);

    const [acc1, acc2] = accounts;

    const session1 = {
      cookies: [{ name: 'xman_us_t', value: 'cookie_acc1', expires: 9999999999 }],
      origins: []
    };
    const session2 = {
      cookies: [{ name: 'xman_us_t', value: 'cookie_acc2', expires: 9999999999 }],
      origins: []
    };

    await safeWriteFile(acc1.sessionPath, JSON.stringify(session1, null, 2));
    await safeWriteFile(acc1.sessionMetaPath, JSON.stringify({ user: acc1.user }, null, 2));
    await safeWriteFile(acc2.sessionPath, JSON.stringify(session2, null, 2));
    await safeWriteFile(acc2.sessionMetaPath, JSON.stringify({ user: acc2.user }, null, 2));

    // Exportar Conta 2 especificando account: 2
    const exp2 = await exportSession({
      account: 2,
      secret: TEST_SECRET,
      showToken: false,
      baseDir: tmpDir
    });

    assert.strictEqual(exp2.user, 'secondary@multi-test.com');
    const tPath2 = path.join(tmpDir, 'session_token_2.txt');
    assert.ok(fs.existsSync(tPath2), 'Deve criar session_token_2.txt');

    // Remover arquivos da Conta 2 para simular máquina remota sem a sessão da Conta 2
    await fs.promises.unlink(acc2.sessionPath);
    await fs.promises.unlink(acc2.sessionMetaPath);

    // Importar na máquina remota sem passar sessionPath nem account (auto-roteamento via meta.user do token)
    const imp2 = await importSession({
      secret: TEST_SECRET,
      fromFile: tPath2,
      baseDir: tmpDir
    });

    assert.strictEqual(imp2.user, 'secondary@multi-test.com');
    assert.strictEqual(imp2.accountIndex, 2);
    assert.ok(fs.existsSync(`${acc2.sessionPath}.enc`), 'Deve criar session_<hash>.json.enc');
    assert.ok(fs.existsSync(acc2.sessionMetaPath), 'Deve criar session_meta_<hash>.json');

    // Verificar que a Conta 1 permaneceu intacta
    assert.ok(fs.existsSync(acc1.sessionPath), 'Sessão da Conta 1 não deve ser afetada');
    const acc1Content = JSON.parse(await fs.promises.readFile(acc1.sessionPath, 'utf-8'));
    assert.strictEqual(acc1Content.cookies[0].value, 'cookie_acc1');

    // Verificar que a sessão da Conta 2 pode ser carregada por loadSessionFiles
    const loaded2 = await loadSessionFiles({
      sessionPath: acc2.sessionPath,
      sessionMetaPath: acc2.sessionMetaPath,
      secret: TEST_SECRET
    });
    assert.ok(loaded2.sessionData);
    assert.strictEqual(loaded2.sessionData.cookies[0].value, 'cookie_acc2');
  } finally {
    process.env.ALI_USER = originalEnv.ALI_USER;
    process.env.ALI_PASSWORD = originalEnv.ALI_PASSWORD;
    if (originalEnv.ALI_USER_2 !== undefined) {
      process.env.ALI_USER_2 = originalEnv.ALI_USER_2;
    } else {
      delete process.env.ALI_USER_2;
    }
    if (originalEnv.ALI_PASSWORD_2 !== undefined) {
      process.env.ALI_PASSWORD_2 = originalEnv.ALI_PASSWORD_2;
    } else {
      delete process.env.ALI_PASSWORD_2;
    }
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('exportAllSessions & importAllSessions - fluxo completo multi-conta em lote', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('export-import-all-');
  const originalEnv = {
    ALI_USER: process.env.ALI_USER,
    ALI_PASSWORD: process.env.ALI_PASSWORD,
    ALI_USER_2: process.env.ALI_USER_2,
    ALI_PASSWORD_2: process.env.ALI_PASSWORD_2
  };

  try {
    process.env.ALI_USER = 'user1@batch-test.com';
    process.env.ALI_PASSWORD = 'pwd1_batch';
    process.env.ALI_USER_2 = 'user2@batch-test.com';
    process.env.ALI_PASSWORD_2 = 'pwd2_batch';

    const { loadAccounts } = require('../config');
    const accounts = loadAccounts(process.env, tmpDir);
    const [acc1, acc2] = accounts;

    const s1 = { cookies: [{ name: 'xman_us_t', value: 'tok1' }], origins: [] };
    const s2 = { cookies: [{ name: 'xman_us_t', value: 'tok2' }], origins: [] };

    await safeWriteFile(acc1.sessionPath, JSON.stringify(s1, null, 2));
    await safeWriteFile(acc1.sessionMetaPath, JSON.stringify({ user: acc1.user }, null, 2));
    await safeWriteFile(acc2.sessionPath, JSON.stringify(s2, null, 2));
    await safeWriteFile(acc2.sessionMetaPath, JSON.stringify({ user: acc2.user }, null, 2));

    // Exportar todas as contas
    const exported = await exportAllSessions({
      baseDir: tmpDir,
      secret: TEST_SECRET
    });

    assert.strictEqual(exported.length, 2);
    assert.strictEqual(exported[0].index, 1);
    assert.strictEqual(exported[0].user, 'user1@batch-test.com');
    assert.strictEqual(exported[0].tokenFile, 'session_token.txt');

    assert.strictEqual(exported[1].index, 2);
    assert.strictEqual(exported[1].user, 'user2@batch-test.com');
    assert.strictEqual(exported[1].tokenFile, 'session_token_2.txt');

    assert.ok(fs.existsSync(path.join(tmpDir, 'session_token.txt')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'session_token_2.txt')));

    // Limpar arquivos de sessão locais para simular servidor remoto limpo
    await fs.promises.unlink(acc1.sessionPath);
    await fs.promises.unlink(acc1.sessionMetaPath);
    await fs.promises.unlink(acc2.sessionPath);
    await fs.promises.unlink(acc2.sessionMetaPath);

    // Importar todas as contas no servidor remoto
    const imported = await importAllSessions({
      baseDir: tmpDir,
      secret: TEST_SECRET
    });

    assert.strictEqual(imported.length, 2);
    assert.ok(fs.existsSync(`${acc1.sessionPath}.enc`));
    assert.ok(fs.existsSync(acc1.sessionMetaPath));
    assert.ok(fs.existsSync(`${acc2.sessionPath}.enc`));
    assert.ok(fs.existsSync(acc2.sessionMetaPath));

    const loaded1 = await loadSessionFiles({
      sessionPath: acc1.sessionPath,
      sessionMetaPath: acc1.sessionMetaPath,
      secret: TEST_SECRET
    });
    const loaded2 = await loadSessionFiles({
      sessionPath: acc2.sessionPath,
      sessionMetaPath: acc2.sessionMetaPath,
      secret: TEST_SECRET
    });

    assert.strictEqual(loaded1.sessionData.cookies[0].value, 'tok1');
    assert.strictEqual(loaded2.sessionData.cookies[0].value, 'tok2');
  } finally {
    process.env.ALI_USER = originalEnv.ALI_USER;
    process.env.ALI_PASSWORD = originalEnv.ALI_PASSWORD;
    if (originalEnv.ALI_USER_2 !== undefined) {
      process.env.ALI_USER_2 = originalEnv.ALI_USER_2;
    } else {
      delete process.env.ALI_USER_2;
    }
    if (originalEnv.ALI_PASSWORD_2 !== undefined) {
      process.env.ALI_PASSWORD_2 = originalEnv.ALI_PASSWORD_2;
    } else {
      delete process.env.ALI_PASSWORD_2;
    }
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('import_session.js - Bug 13: lanca ImportSessionError se token nao corresponde a nenhuma conta quando accounts.length > 1', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-unmatched-');
  const originalEnv = {
    ALI_USER: process.env.ALI_USER,
    ALI_PASSWORD: process.env.ALI_PASSWORD,
    ALI_USER_2: process.env.ALI_USER_2,
    ALI_PASSWORD_2: process.env.ALI_PASSWORD_2
  };

  try {
    process.env.ALI_USER = 'user1@test.com';
    process.env.ALI_PASSWORD = 'pwd1';
    process.env.ALI_USER_2 = 'user2@test.com';
    process.env.ALI_PASSWORD_2 = 'pwd2';

    // Gerar arquivos e token de uma terceira conta inexistente
    const sPath = path.join(tmpDir, 'session.json');
    const mPath = path.join(tmpDir, 'session_meta.json');
    await safeWriteFile(
      sPath,
      JSON.stringify({ cookies: [{ name: 'xman_us_t', value: 'token_val' }], origins: [] })
    );
    await safeWriteFile(mPath, JSON.stringify({ user: 'unknown_account@test.com' }));

    const exportResult = await exportSession({
      secret: TEST_SECRET,
      baseDir: tmpDir
    });

    await assert.rejects(
      async () => {
        await importSession({
          tokenString: exportResult.token,
          secret: TEST_SECRET,
          baseDir: tmpDir
        });
      },
      (err) => {
        assert.ok(err instanceof ImportSessionError);
        assert.ok(err.message.includes('não corresponde a nenhuma conta configurada'));
        return true;
      }
    );
  } finally {
    process.env.ALI_USER = originalEnv.ALI_USER;
    process.env.ALI_PASSWORD = originalEnv.ALI_PASSWORD;
    if (originalEnv.ALI_USER_2 !== undefined) {
      process.env.ALI_USER_2 = originalEnv.ALI_USER_2;
    } else {
      delete process.env.ALI_USER_2;
    }
    if (originalEnv.ALI_PASSWORD_2 !== undefined) {
      process.env.ALI_PASSWORD_2 = originalEnv.ALI_PASSWORD_2;
    } else {
      delete process.env.ALI_PASSWORD_2;
    }
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
