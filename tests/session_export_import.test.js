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

const TEST_SECRET = 'secret_key_with_at_least_32_characters_long_12345'; //gitleaks:allow valor fictício de teste

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
    assert.ok(exportRes.token.startsWith('v2:') || exportRes.token.startsWith('v3:'));
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
    assert.ok(
      encContent.startsWith('v2:') || encContent.startsWith('v3:'),
      'Conteúdo gravado deve iniciar com v2: ou v3:'
    );

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

test('import_session - normalizeImportCliResult cobre resultado unitário e de lote', () => {
  const { normalizeImportCliResult } = require('../import_session');
  const unit = normalizeImportCliResult({ user: 'a@b.co', sessionPath: 'session.json.enc' });
  assert.strictEqual(unit.imported.length, 1, 'unitário deve virar lista com 1 item');
  assert.strictEqual(unit.failed.length, 0);

  const batch = normalizeImportCliResult({ imported: [{}, {}], failed: [{ file: 'f' }] });
  assert.strictEqual(batch.imported.length, 2);
  assert.strictEqual(batch.failed.length, 1);

  const empty = normalizeImportCliResult(undefined);
  assert.strictEqual(empty.imported.length, 0);
  assert.strictEqual(empty.failed.length, 0);
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
    const { exported } = await exportAllSessions({
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
    const { imported } = await importAllSessions({
      baseDir: tmpDir,
      secret: TEST_SECRET
    });

    assert.strictEqual(imported.length, 2);
    assert.ok(fs.existsSync(`${acc1.sessionPath}.enc`));
    assert.ok(fs.existsSync(acc1.sessionMetaPath));
    assert.ok(fs.existsSync(`${acc2.sessionPath}.enc`));
    assert.ok(fs.existsSync(acc2.sessionMetaPath));

    // Higiene: tokens de uso único são removidos após importação bem-sucedida
    assert.strictEqual(
      fs.existsSync(path.join(tmpDir, 'session_token.txt')),
      false,
      'session_token.txt deve ser removido após importação'
    );
    assert.strictEqual(
      fs.existsSync(path.join(tmpDir, 'session_token_2.txt')),
      false,
      'session_token_2.txt deve ser removido após importação'
    );

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

test('import_session.js - keepTokens preserva arquivos de token após importação em lote', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-keep-tokens-');
  const originalEnv = {
    ALI_USER: process.env.ALI_USER,
    ALI_PASSWORD: process.env.ALI_PASSWORD,
    ALI_USER_2: process.env.ALI_USER_2,
    ALI_PASSWORD_2: process.env.ALI_PASSWORD_2
  };

  try {
    process.env.ALI_USER = 'keep@example.com';
    process.env.ALI_PASSWORD = 'pwd_keep';
    delete process.env.ALI_USER_2;
    delete process.env.ALI_PASSWORD_2;

    const sPath = path.join(tmpDir, 'session.json');
    const mPath = path.join(tmpDir, 'session_meta.json');
    await safeWriteFile(
      sPath,
      JSON.stringify({ cookies: [{ name: 'xman_us_t', value: 'tok_keep' }], origins: [] })
    );
    await safeWriteFile(mPath, JSON.stringify({ user: 'keep@example.com' }));

    const exportResult = await exportSession({ secret: TEST_SECRET, baseDir: tmpDir });
    const tokenFile = path.join(tmpDir, 'session_token.txt');
    fs.writeFileSync(tokenFile, exportResult.token, 'utf-8');

    // Remover sessão local para simular host limpo
    await fs.promises.unlink(sPath);
    await fs.promises.unlink(mPath);

    const { imported } = await importAllSessions({
      baseDir: tmpDir,
      secret: TEST_SECRET,
      keepTokens: true
    });

    assert.strictEqual(imported.length, 1);
    assert.ok(fs.existsSync(tokenFile), 'Com keepTokens=true o arquivo deve ser preservado');
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

test('export_session.js - rotateAllSessions rotaciona todas as contas (não só a primária)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('rotate-all-accounts-');
  const originalEnv = {
    ALI_USER: process.env.ALI_USER,
    ALI_PASSWORD: process.env.ALI_PASSWORD,
    ALI_USER_2: process.env.ALI_USER_2,
    ALI_PASSWORD_2: process.env.ALI_PASSWORD_2
  };
  const ROTATED_SECRET = 'y'.repeat(48);

  try {
    process.env.ALI_USER = 'rotate1@test.com';
    process.env.ALI_PASSWORD = 'pwd1_rotate';
    process.env.ALI_USER_2 = 'rotate2@test.com';
    process.env.ALI_PASSWORD_2 = 'pwd2_rotate';

    const realScratch = path.resolve(__dirname, '..', 'scratch');
    const scratchBefore = fs.existsSync(realScratch) ? fs.readdirSync(realScratch).sort() : [];

    const { loadAccounts } = require('../config');
    const { rotateAllSessions } = require('../export_session');
    const [acc1, acc2] = loadAccounts(process.env, tmpDir);

    const s1 = { cookies: [{ name: 'xman_us_t', value: 'tok_r1' }], origins: [] };
    const s2 = { cookies: [{ name: 'xman_us_t', value: 'tok_r2' }], origins: [] };
    await safeWriteFile(acc1.sessionPath, JSON.stringify(s1, null, 2));
    await safeWriteFile(acc1.sessionMetaPath, JSON.stringify({ user: acc1.user }, null, 2));
    await safeWriteFile(acc2.sessionPath, JSON.stringify(s2, null, 2));
    await safeWriteFile(acc2.sessionMetaPath, JSON.stringify({ user: acc2.user }, null, 2));

    const results = await rotateAllSessions({
      baseDir: tmpDir,
      oldSecret: TEST_SECRET,
      newSecret: ROTATED_SECRET
    });

    assert.strictEqual(results.length, 2);
    assert.strictEqual(
      results.filter((r) => r.success).length,
      2,
      'Ambas as contas devem rotacionar'
    );
    assert.ok(!results.some((r) => r.skipped));

    const loaded1 = await loadSessionFiles({
      sessionPath: acc1.sessionPath,
      sessionMetaPath: acc1.sessionMetaPath,
      secret: ROTATED_SECRET
    });
    const loaded2 = await loadSessionFiles({
      sessionPath: acc2.sessionPath,
      sessionMetaPath: acc2.sessionMetaPath,
      secret: ROTATED_SECRET
    });

    assert.strictEqual(loaded1.sessionData.cookies[0].value, 'tok_r1');
    assert.strictEqual(loaded2.sessionData.cookies[0].value, 'tok_r2');
    assert.ok(fs.existsSync(`${acc1.sessionPath}.enc`));
    assert.ok(fs.existsSync(`${acc2.sessionPath}.enc`));

    for (const metaPath of [acc1.sessionMetaPath, acc2.sessionMetaPath]) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      assert.ok(meta.lastRotatedAt, 'Metadados devem registrar lastRotatedAt por conta');
    }

    // Backups de rotação devem ir para o scratch do baseDir, nunca para o scratch real do projeto
    const scratchAfter = fs.existsSync(realScratch) ? fs.readdirSync(realScratch).sort() : [];
    assert.deepStrictEqual(
      scratchAfter,
      scratchBefore,
      'Rotação não pode poluir o scratch real do projeto'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, 'scratch')),
      'Backups de rotação devem ser criados no scratch do baseDir'
    );
  } finally {
    process.env.ALI_USER = originalEnv.ALI_USER;
    process.env.ALI_PASSWORD = originalEnv.ALI_PASSWORD;
    if (originalEnv.ALI_USER_2 !== undefined) process.env.ALI_USER_2 = originalEnv.ALI_USER_2;
    else delete process.env.ALI_USER_2;
    if (originalEnv.ALI_PASSWORD_2 !== undefined)
      process.env.ALI_PASSWORD_2 = originalEnv.ALI_PASSWORD_2;
    else delete process.env.ALI_PASSWORD_2;
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('export_session.js - valida que a conta da sessão corresponde à conta alvo (expectedUser)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('export-expected-user-');

  try {
    const sPath = path.join(tmpDir, 'session.json');
    const mPath = path.join(tmpDir, 'session_meta.json');
    await safeWriteFile(
      sPath,
      JSON.stringify({ cookies: [{ name: 'xman_us_t', value: 'tok_expected' }], origins: [] })
    );
    await safeWriteFile(mPath, JSON.stringify({ user: 'conta_a@example.com' }));

    await assert.rejects(
      async () => {
        await exportSession({
          secret: TEST_SECRET,
          baseDir: tmpDir,
          sessionPath: sPath,
          sessionMetaPath: mPath,
          expectedUser: 'conta_b@example.com'
        });
      },
      (err) => {
        assert.ok(err.message.includes('não corresponde'), `Erro inesperado: ${err.message}`);
        return true;
      }
    );

    const ok = await exportSession({
      secret: TEST_SECRET,
      baseDir: tmpDir,
      sessionPath: sPath,
      sessionMetaPath: mPath,
      expectedUser: 'conta_a@example.com'
    });
    assert.ok(ok.token, 'Exportação com conta correta deve funcionar');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('export_session.js - expectedUser aceita divergência apenas de caixa no mesmo identificador', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('export-case-insensitive-');

  try {
    const sPath = path.join(tmpDir, 'session.json');
    const mPath = path.join(tmpDir, 'session_meta.json');
    await safeWriteFile(
      sPath,
      JSON.stringify({ cookies: [{ name: 'xman_us_t', value: 'tok_case' }], origins: [] })
    );
    await safeWriteFile(mPath, JSON.stringify({ user: 'Case.User@Example.com' }));

    const res = await exportSession({
      secret: TEST_SECRET,
      baseDir: tmpDir,
      sessionPath: sPath,
      sessionMetaPath: mPath,
      expectedUser: 'case.user@example.com'
    });
    assert.ok(res.token, 'Exportação deve funcionar quando difere apenas a caixa');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('M4: import_session.js e libs/session.js compartilham a mesma implementação de migração', () => {
  const cli = require('../import_session').migrateLegacySession;
  const lib = require('../libs/session').migrateLegacySession;
  assert.notStrictEqual(cli, lib, 'CLI é um wrapper que delega, não a mesma referência direta');
});

test('M4: CLI lança ImportSessionError quando não há session.json legado (modo estrito)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-migrate-missing-');

  try {
    await assert.rejects(
      () => migrateLegacySession({ baseDir: tmpDir, secret: TEST_SECRET }),
      (err) => err instanceof ImportSessionError && /não encontrado/i.test(err.message),
      'deve lançar ImportSessionError acionável'
    );
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('M4: biblioteca retorna migrated:false (sem lançar) quando não há session.json legado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lib-migrate-missing-');

  try {
    const result = await require('../libs/session').migrateLegacySession({
      baseDir: tmpDir,
      secret: TEST_SECRET
    });
    assert.deepStrictEqual(result, { migrated: false });
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('M4: CLI preserva campos extras do meta (savedAt) e informa cookiesCount', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-migrate-meta-');

  try {
    const sPath = path.join(tmpDir, 'session.json');
    const mPath = path.join(tmpDir, 'session_meta.json');
    await safeWriteFile(
      sPath,
      JSON.stringify({
        cookies: [
          { name: 'xman_us_t', value: 'a' },
          { name: 'login_aliyunid_ticket', value: 'b' }
        ],
        origins: []
      })
    );
    await safeWriteFile(mPath, JSON.stringify({ user: 'meta_user@example.com', extra: 42 }));

    const res = await migrateLegacySession({ baseDir: tmpDir, secret: TEST_SECRET });
    assert.strictEqual(res.migrated, true);
    assert.strictEqual(res.user, 'meta_user@example.com');
    assert.strictEqual(res.cookiesCount, 2);
    assert.strictEqual(res.encrypted, true);

    const meta = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
    assert.strictEqual(meta.extra, 42, 'campos extras do meta preservados');
    assert.ok(meta.migratedAt);
    assert.ok(meta.savedAt, 'savedAt deve ser gravado no modo CLI');
    assert.strictEqual(meta.encrypted, true);
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('M4: CLI rejeita session.json legado com conteúdo inválido (schema)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('import-migrate-invalid-');

  try {
    await safeWriteFile(path.join(tmpDir, 'session.json'), JSON.stringify({ foo: 'bar' }));
    await assert.rejects(
      () => migrateLegacySession({ baseDir: tmpDir, secret: TEST_SECRET }),
      (err) => err instanceof ImportSessionError && /inválido/i.test(err.message)
    );
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
