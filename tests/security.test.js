const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  encryptSession,
  encryptSessionAsync,
  decryptSession,
  decryptSessionAsync,
  validateSession,
  isCookieExpired,
  validateSessionPayload,
  safeWriteFile,
  safeChmod600,
  cleanOrphanTmpFiles,
  APP_SCRYPT_SALT_V1,
  SCRYPT_PARAMS_V3,
  SCRYPT_MIN_N,
  SCRYPT_DEFAULT_N,
  SCRYPT_MAX_N,
  sanitizeScryptParams
} = require('../security');
const logger = require('../logger');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

const VALID_SECRET = 'a'.repeat(32);
const SHORT_SECRET = 'too-short';

test('security.js - encryptSession e decryptSession v3 roundtrip (moderno com parâmetros scrypt N=2^17)', () => {
  const payload = JSON.stringify({
    session: {
      cookies: [{ name: 'xman_us_t', value: 'secret-token-value' }]
    },
    meta: { user: 'user@example.com' }
  });

  const encrypted = encryptSession(payload, VALID_SECRET);
  assert.ok(
    encrypted.startsWith('v3:131072:8:1:'),
    'Token v3 deve iniciar com v3:131072:8:1: indicando parâmetros scrypt'
  );
  assert.ok(encrypted.endsWith(':base64'), 'Token v3 deve terminar com :base64');

  const parts = encrypted.split(':');
  assert.strictEqual(parts.length, 9, 'Token v3 deve possuir 9 partes separadas por :');

  const decrypted = decryptSession(encrypted, VALID_SECRET);
  assert.strictEqual(decrypted, payload, 'Payload descriptografado deve ser idêntico ao original');
});

test('security.js - encryptSession e decryptSession v2 roundtrip com options.version', () => {
  const payload = JSON.stringify({
    session: {
      cookies: [{ name: 'xman_us_t', value: 'secret-token-v2' }]
    },
    meta: { user: 'user@example.com' }
  });

  const encrypted = encryptSession(payload, VALID_SECRET, { version: 'v2' });
  assert.ok(encrypted.startsWith('v2:'), 'Token v2 deve iniciar com v2:');
  assert.ok(encrypted.endsWith(':base64'), 'Token v2 deve terminar com :base64');

  const parts = encrypted.split(':');
  assert.strictEqual(parts.length, 6, 'Token v2 deve possuir 6 partes separadas por :');

  const decrypted = decryptSession(encrypted, VALID_SECRET);
  assert.strictEqual(decrypted, payload, 'Payload descriptografado deve ser idêntico ao original');
});

test('security.js - decryptSession compatibilidade retroativa com tokens v1', () => {
  const payload = JSON.stringify({
    session: {
      cookies: [{ name: 'xman_us_t', value: 'legacy-v1-token' }]
    }
  });

  // Simulação manual da criação de token v1 legado
  const key = crypto.scryptSync(VALID_SECRET, APP_SCRYPT_SALT_V1, 32, { N: 16384, r: 8, p: 1 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const v1Token = `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}:base64`;

  const decrypted = decryptSession(v1Token, VALID_SECRET);
  assert.strictEqual(decrypted, payload, 'Deve descriptografar tokens v1 com salt estático');
});

test('security.js - roundtrip cruzado v1, v2 e v3 descriptografados com a mesma chave', () => {
  const payload = JSON.stringify({ test: 'cross-version-compatibility', timestamp: Date.now() });

  // 1. Token v1
  const key1 = crypto.scryptSync(VALID_SECRET, APP_SCRYPT_SALT_V1, 32, { N: 16384, r: 8, p: 1 });
  const iv1 = crypto.randomBytes(12);
  const cipher1 = crypto.createCipheriv('aes-256-gcm', key1, iv1);
  const ct1 = Buffer.concat([cipher1.update(payload, 'utf-8'), cipher1.final()]);
  const v1Token = `v1:${iv1.toString('base64')}:${cipher1.getAuthTag().toString('base64')}:${ct1.toString('base64')}:base64`;

  // 2. Token v2
  const v2Token = encryptSession(payload, VALID_SECRET, { version: 'v2' });

  // 3. Token v3
  const v3Token = encryptSession(payload, VALID_SECRET);

  assert.strictEqual(decryptSession(v1Token, VALID_SECRET), payload, 'v1 ok');
  assert.strictEqual(decryptSession(v2Token, VALID_SECRET), payload, 'v2 ok');
  assert.strictEqual(decryptSession(v3Token, VALID_SECRET), payload, 'v3 ok');
});

test('security.js - secret com menos de 32 caracteres deve falhar', () => {
  assert.throws(
    () => encryptSession('{}', SHORT_SECRET),
    /SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres/
  );

  assert.throws(
    () => decryptSession('v2:a:b:c:d:base64', SHORT_SECRET),
    /SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres/
  );

  assert.throws(() => encryptSession('{}', null), /SESSION_SECRET é obrigatório/);
});

test('security.js - tokens inválidos ou corrompidos devem falhar', () => {
  assert.throws(() => decryptSession('', VALID_SECRET), /não fornecido ou inválido/);
  assert.throws(
    () => decryptSession('invalid_token', VALID_SECRET),
    /deve iniciar com "v1:", "v2:" ou "v3:"/
  );
  assert.throws(() => decryptSession('v3:curto', VALID_SECRET), /Formato de token v3 inválido/);
  assert.throws(() => decryptSession('v2:curto', VALID_SECRET), /Formato de token v2 inválido/);
  assert.throws(() => decryptSession('v1:curto', VALID_SECRET), /Formato de token v1 inválido/);

  // Token com dados corrompidos (autenticação GCM deve falhar)
  const fakeToken = `v2:${Buffer.from('salt16bytes12345').toString('base64')}:${Buffer.from('iv12bytes123').toString('base64')}:${Buffer.from('tag16bytes123456').toString('base64')}:${Buffer.from('ciphertext').toString('base64')}:base64`;
  assert.throws(() => decryptSession(fakeToken, VALID_SECRET), /Falha na autenticação/);
});

test('security.js - isCookieExpired', () => {
  const futureCookie = { name: 'c1', value: 'v1', expires: Math.floor(Date.now() / 1000) + 3600 };
  const pastCookie = { name: 'c2', value: 'v2', expires: Math.floor(Date.now() / 1000) - 3600 };
  const sessionCookie = { name: 'c3', value: 'v3' };

  assert.strictEqual(isCookieExpired(futureCookie), false);
  assert.strictEqual(isCookieExpired(pastCookie), true);
  assert.strictEqual(isCookieExpired(sessionCookie), false);
});

test('security.js - validateSession', () => {
  const validSessionData = {
    cookies: [
      { name: 'xman_us_t', value: 'auth_value', expires: Math.floor(Date.now() / 1000) + 86400 }
    ]
  };
  const meta = { user: 'test@example.com' };

  // Sucesso
  const resSuccess = validateSession(validSessionData, meta, 'test@example.com');
  assert.strictEqual(resSuccess.valid, true);

  // Divergência de conta
  const resMismatch = validateSession(validSessionData, meta, 'outro@example.com');
  assert.strictEqual(resMismatch.valid, false);
  assert.match(resMismatch.reason, /não corresponde/);

  // Cookies sem auth cookie
  const resNoAuth = validateSession(
    { cookies: [{ name: 'outroc', value: '1' }] },
    meta,
    'test@example.com'
  );
  assert.strictEqual(resNoAuth.valid, false);
  assert.match(resNoAuth.reason, /Nenhum cookie de autenticação/);

  // Cookie expirado
  const expiredSessionData = {
    cookies: [
      { name: 'xman_us_t', value: 'auth_value', expires: Math.floor(Date.now() / 1000) - 100 }
    ]
  };
  const resExpired = validateSession(expiredSessionData, meta, 'test@example.com');
  assert.strictEqual(resExpired.valid, false);
  assert.match(resExpired.reason, /expirados/);
});

test('security.js - validateSessionPayload schema Zod', () => {
  const validPayload = {
    session: {
      cookies: [{ name: 'test', value: 'val' }]
    },
    meta: {
      user: 'test_user'
    }
  };

  const parsed = validateSessionPayload(validPayload);
  assert.strictEqual(parsed.meta.user, 'test_user');

  assert.throws(() => validateSessionPayload({}), /Estrutura de sessão inválida/);
  assert.throws(
    () => validateSessionPayload({ session: { cookies: [] } }),
    /A sessão deve conter ao menos um cookie/
  );
});

test('security.js - permissões efetivas 0o600 em arquivos de segredos (session.json.enc, session.bak-*, dom-*.hash.txt, session_token.txt)', async () => {
  const { saveSession, clearSession } = require('../libs/session');
  const { exportSession } = require('../export_session');
  const { captureDomHashAndArtifacts } = require('../libs/ui');

  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('sec-perm-test-');

  try {
    const isWindows = process.platform === 'win32';

    // 1. safeWriteFile diretamente
    const testFile = path.join(tmpDir, 'test_secret.txt');
    await safeWriteFile(testFile, 'secret-data', 'utf-8');
    safeChmod600(testFile);
    if (!isWindows) {
      const mode = fs.statSync(testFile).mode & 0o777;
      assert.strictEqual(mode, 0o600, 'safeWriteFile deve criar arquivo com 0o600');
    }

    // 2. session.json.enc e session_meta.json
    const fakeState = {
      cookies: [{ name: 'xman_us_t', value: 'tok', expires: Math.floor(Date.now() / 1000) + 3600 }]
    };
    await saveSession(fakeState, 'test@example.com', {
      baseDir: tmpDir,
      secret: VALID_SECRET
    });
    const encFile = path.join(tmpDir, 'session.json.enc');
    const metaFile = path.join(tmpDir, 'session_meta.json');
    if (!isWindows) {
      assert.strictEqual(
        fs.statSync(encFile).mode & 0o777,
        0o600,
        'session.json.enc deve ter modo 0o600'
      );
      assert.strictEqual(
        fs.statSync(metaFile).mode & 0o777,
        0o600,
        'session_meta.json deve ter modo 0o600'
      );
    }

    // 3. session.bak-* gerado por clearSession
    await clearSession({ baseDir: tmpDir, secret: VALID_SECRET });
    const scratchDir = path.join(tmpDir, 'scratch');
    const backups = fs.readdirSync(scratchDir).filter((f) => f.startsWith('session.bak-'));
    assert.ok(backups.length >= 1, 'Deve gerar backup em scratch/');
    if (!isWindows) {
      const bakPath = path.join(scratchDir, backups[0]);
      assert.strictEqual(
        fs.statSync(bakPath).mode & 0o777,
        0o600,
        'session.bak-* deve ter modo 0o600'
      );
    }

    // 4. dom-*.hash.txt gerado por captureDomHashAndArtifacts
    const prevOutDir = process.env.PW_OUTPUT_DIR;
    process.env.PW_OUTPUT_DIR = tmpDir;
    try {
      const mockPage = {
        evaluate: async () => '<html><body>test</body></html>',
        screenshot: async () => {}
      };
      const res = await captureDomHashAndArtifacts(mockPage, 'perm_test');
      if (!isWindows && res.hashFile) {
        assert.strictEqual(
          fs.statSync(res.hashFile).mode & 0o777,
          0o600,
          'dom-*.hash.txt deve ter modo 0o600'
        );
      }
    } finally {
      if (prevOutDir !== undefined) process.env.PW_OUTPUT_DIR = prevOutDir;
      else delete process.env.PW_OUTPUT_DIR;
    }

    // 5. session_token.txt gerado por exportSession
    await saveSession(fakeState, 'test@example.com', {
      baseDir: tmpDir,
      secret: VALID_SECRET
    });
    await exportSession({
      baseDir: tmpDir,
      secret: VALID_SECRET,
      showToken: false
    });
    const tokenFile = path.join(tmpDir, 'session_token.txt');
    assert.ok(fs.existsSync(tokenFile));
    if (!isWindows) {
      assert.strictEqual(
        fs.statSync(tokenFile).mode & 0o777,
        0o600,
        'session_token.txt deve ter modo 0o600'
      );
    }
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('security.js - safeWriteFile escrita atômica protege contra corrupção em crash/falha no meio', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('sec-atomic-');

  try {
    const targetFile = path.join(tmpDir, 'important_session.json');
    const originalContent = JSON.stringify({ state: 'original_clean_session' });

    // 1. Grava arquivo inicial íntegro
    await safeWriteFile(targetFile, originalContent);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf-8'), originalContent);

    // 2. Simula falha/crash durante o rename (mock de fs.promises.rename)
    const originalRename = fs.promises.rename;
    fs.promises.rename = async () => {
      throw new Error('Simulated crash / process abort between write and rename');
    };

    try {
      const corruptedContent = JSON.stringify({ state: 'truncated_partial_write' });
      await assert.rejects(() => safeWriteFile(targetFile, corruptedContent), /Simulated crash/);
    } finally {
      fs.promises.rename = originalRename;
    }

    // 3. O arquivo de destino NUNCA é truncado ou corrompido: permanece idêntico ao original
    assert.strictEqual(
      fs.readFileSync(targetFile, 'utf-8'),
      originalContent,
      'Destino original deve permanecer 100% íntegro após crash na escrita'
    );

    // 4. Arquivos temporários residuais são limpos no catch de safeWriteFile
    const filesInDir = fs.readdirSync(tmpDir);
    const tmpFiles = filesInDir.filter((f) => f.includes('.tmp-'));
    assert.strictEqual(tmpFiles.length, 0, 'Arquivos temporários devem ser removidos após falha');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('security.js - cleanOrphanTmpFiles remove arquivos .tmp-* órfãos antigos e ignora arquivos válidos', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('sec-orphan-tmp-');

  try {
    const validFile = path.join(tmpDir, 'session.json');
    fs.writeFileSync(validFile, '{}', 'utf-8');

    const orphanTmp = path.join(tmpDir, 'session.json.tmp-9999-deadbeef1234');
    fs.writeFileSync(orphanTmp, 'corrupted data', 'utf-8');

    // Ajusta mtime do arquivo órfão para 10 minutos atrás
    const tenMinutesAgo = new Date(Date.now() - 600000);
    fs.utimesSync(orphanTmp, tenMinutesAgo, tenMinutesAgo);

    // Executa limpeza com maxAgeMs = 300000 (5 minutos)
    const cleaned = await cleanOrphanTmpFiles(tmpDir, 300000);
    assert.strictEqual(cleaned.length, 1);
    assert.strictEqual(cleaned[0], orphanTmp);

    // Arquivo válido deve permanecer intacto
    assert.ok(fs.existsSync(validFile));
    assert.ok(!fs.existsSync(orphanTmp));
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('security.js - SCRYPT_PARAMS_V3 piso de seguranca (N >= 16384), warning e clamp defensivo', () => {
  const originalEnvN = process.env.SCRYPT_N;
  try {
    assert.strictEqual(SCRYPT_MIN_N, 16384);
    assert.strictEqual(SCRYPT_DEFAULT_N, 131072);

    delete process.env.SCRYPT_N;
    SCRYPT_PARAMS_V3.N = null;
    assert.strictEqual(SCRYPT_PARAMS_V3.N, SCRYPT_DEFAULT_N);

    // 1. SCRYPT_N=32768 -> respeita valor acima do piso
    process.env.SCRYPT_N = '32768';
    assert.strictEqual(SCRYPT_PARAMS_V3.N, 32768);

    // 2. SCRYPT_N=16 -> abaixo do piso (16384): emite warn e clampeia para 131072
    let warned = false;
    let warnPayload = null;
    const originalWarn = logger.warn;
    logger.warn = (obj, msg) => {
      warned = true;
      warnPayload = { obj, msg };
    };
    try {
      process.env.SCRYPT_N = '16';
      assert.strictEqual(SCRYPT_PARAMS_V3.N, SCRYPT_DEFAULT_N);
      assert.strictEqual(warned, true, 'Deve emitir warning ao ler SCRYPT_N abaixo de 16384');
      assert.ok(warnPayload.msg.includes('abaixo do piso'));
    } finally {
      logger.warn = originalWarn;
    }

    // 3. Setter customScryptN válido (>= 16384)
    delete process.env.SCRYPT_N;
    SCRYPT_PARAMS_V3.N = SCRYPT_MIN_N;
    assert.strictEqual(SCRYPT_PARAMS_V3.N, SCRYPT_MIN_N);

    // 4. Setter customScryptN inválido (< 16384 ou não-numérico) -> reseta para null/default
    SCRYPT_PARAMS_V3.N = 16;
    assert.strictEqual(
      SCRYPT_PARAMS_V3.N,
      SCRYPT_DEFAULT_N,
      'Setter com N < 16384 deve resetar para default'
    );

    SCRYPT_PARAMS_V3.N = -500;
    assert.strictEqual(
      SCRYPT_PARAMS_V3.N,
      SCRYPT_DEFAULT_N,
      'Setter com N negativo deve resetar para default'
    );

    SCRYPT_PARAMS_V3.N = 'invalido';
    assert.strictEqual(
      SCRYPT_PARAMS_V3.N,
      SCRYPT_DEFAULT_N,
      'Setter não-numérico deve resetar para default'
    );

    SCRYPT_PARAMS_V3.N = NaN;
    assert.strictEqual(
      SCRYPT_PARAMS_V3.N,
      SCRYPT_DEFAULT_N,
      'Setter NaN deve resetar para default'
    );

    // 5. options.N em encryptSession abaixo de 16384 -> emite warn e usa 131072
    let encryptWarned = false;
    logger.warn = () => {
      encryptWarned = true;
    };
    try {
      const payload = JSON.stringify({ test: 'floor' });
      const enc = encryptSession(payload, VALID_SECRET, { N: 16 });
      assert.ok(
        enc.startsWith(`v3:${SCRYPT_DEFAULT_N}:8:1:`),
        'Token v3 deve ter N clampeado para default'
      );
      assert.strictEqual(encryptWarned, true, 'Deve emitir warning para options.N < 16384');
    } finally {
      logger.warn = originalWarn;
    }
  } finally {
    SCRYPT_PARAMS_V3.N = null;
    if (originalEnvN !== undefined) {
      process.env.SCRYPT_N = originalEnvN;
    } else {
      delete process.env.SCRYPT_N;
    }
    assert.strictEqual(SCRYPT_PARAMS_V3.N, SCRYPT_DEFAULT_N);
  }
});

test('security.js - sanitizeScryptParams aplica piso, tetos e limite de memoria combinada', () => {
  // Entradas válidas dentro dos limites são preservadas
  const ok = sanitizeScryptParams(32768, 8, 1);
  assert.strictEqual(ok.N, 32768);
  assert.strictEqual(ok.r, 8);
  assert.strictEqual(ok.p, 1);

  // N abaixo do piso -> fallback (default), nunca valor inseguro
  assert.strictEqual(sanitizeScryptParams(16, 8, 1).N, SCRYPT_DEFAULT_N);
  // N/r/p inválidos -> fallback seguro
  assert.strictEqual(sanitizeScryptParams(NaN, 8, 1).N, SCRYPT_DEFAULT_N);
  assert.strictEqual(sanitizeScryptParams(131072, 0, 1).r, 8);
  assert.strictEqual(sanitizeScryptParams(131072, 8, -5).p, 1);

  // Token forjado com N gigantesco não pode forçar alocação desproporcional:
  // a memória combinada (128*N*r) deve ficar limitada mesmo no pior caso.
  const huge = sanitizeScryptParams(1073741824, 16, 16);
  assert.ok(128 * huge.N * huge.r <= 256 * 1024 * 1024, 'Deve limitar 128*N*r a <= 256MB');
  assert.ok(huge.N >= SCRYPT_MIN_N, 'N nunca abaixo do piso após clamp');
  assert.ok(128 * huge.N * huge.r <= 256 * 1024 * 1024);
});

test('security.js - decryptSession clampa N/r/p vindos de token v3 nao confiavel', () => {
  const secret = 'x'.repeat(40);
  const b64 = (n) => Buffer.alloc(n).toString('base64');
  // Token forjado: N=2^30, r/p absurdos. Deve falhar (auth) rapidamente sem estourar memória.
  const forged =
    'v3:1073741824:999:999:' +
    b64(16) +
    ':' +
    b64(12) +
    ':' +
    b64(16) +
    ':' +
    Buffer.from('dummy').toString('base64') +
    ':base64';
  const start = Date.now();
  assert.throws(() => decryptSession(forged, secret), /Falha na autenticação\/descriptografia/);
  // O clamp deve tornar a tentativa limitada; bem abaixo de um minuto mesmo em host lento
  assert.ok(Date.now() - start < 60000, 'Decifragem de token forjado deve ser limitada no tempo');
});

test('security.js - encryptSession aceita N numerico em string e mantem roundtrip', () => {
  const secret = 'y'.repeat(40);
  const token = encryptSession(JSON.stringify({ n: 'string' }), secret, { N: '16384' });
  assert.ok(
    token.startsWith('v3:16384:8:1:'),
    'String numérica de N deve ser coagida e preservada'
  );
  assert.deepStrictEqual(JSON.parse(decryptSession(token, secret)), { n: 'string' });

  // N acima do teto de memória deve ser clampeado de forma decifrável (encrypt e decrypt consistentes)
  const big = encryptSession(JSON.stringify({ n: 'big' }), secret, { N: 1073741824 });
  assert.ok(!big.startsWith('v3:1073741824:'), 'N gigante deve ser clampeado na geração');
  assert.deepStrictEqual(JSON.parse(decryptSession(big, secret)), { n: 'big' });
});

test('security.js - SCRYPT_MAX_N exposto e coherente com o piso', () => {
  assert.strictEqual(typeof SCRYPT_MAX_N, 'number');
  assert.ok(SCRYPT_MAX_N > SCRYPT_DEFAULT_N, 'Teto deve ser maior que o default');
});

test('security.js - token v3 compacto com SCRYPT_N alto falha como erro de autenticação (sem erro cru)', () => {
  const secret = 'z'.repeat(40);
  const full = encryptSession(JSON.stringify({ ok: true }), secret);
  const parts = full.split(':');
  // v3:N:r:p:salt:iv:tag:cipher:base64 -> compacto v3:salt:iv:tag:cipher:base64
  const compact = ['v3', parts[4], parts[5], parts[6], parts[7], parts[8]].join(':');

  const originalN = SCRYPT_PARAMS_V3.N;
  try {
    SCRYPT_PARAMS_V3.N = 1048576; // 2^20: exigiria ~1GB, acima do maxmem fixo do formato compacto
    assert.throws(
      () => decryptSession(compact, secret),
      /Falha na autenticação\/descriptografia/,
      'Erro de parâmetros do scrypt deve ser reportado como falha de autenticação'
    );
  } finally {
    SCRYPT_PARAMS_V3.N = originalN;
  }
});

test('security.js - encryptSessionAsync/decryptSessionAsync são compatíveis com as versões síncronas', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const payload = JSON.stringify({
      session: { cookies: [{ name: 'xman_us_t', value: 'tok', domain: '.aliexpress.com' }] },
      meta: { user: 'async@example.com' }
    });

    // async encrypt -> sync decrypt
    const tokenAsync = await encryptSessionAsync(payload, VALID_SECRET);
    assert.strictEqual(decryptSession(tokenAsync, VALID_SECRET), payload);

    // sync encrypt -> async decrypt (compatibilidade retroativa de tokens)
    const tokenSync = encryptSession(payload, VALID_SECRET);
    assert.strictEqual(await decryptSessionAsync(tokenSync, VALID_SECRET), payload);

    // v2 async + validações com as mesmas mensagens
    const tokenV2 = await encryptSessionAsync(payload, VALID_SECRET, { version: 'v2' });
    assert.strictEqual(await decryptSessionAsync(tokenV2, VALID_SECRET), payload);

    await assert.rejects(
      () => encryptSessionAsync('{}', SHORT_SECRET),
      /SESSION_SECRET é obrigatório/
    );
    await assert.rejects(() => decryptSessionAsync('', VALID_SECRET), /não fornecido ou inválido/);
    await assert.rejects(
      () => decryptSessionAsync('v2:AAAA:BBBB:CCCC:DDDD:base64', VALID_SECRET),
      /Falha na autenticação\/descriptografia/
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('security.js - validateSession aceita usuário com caixa diferente (case-insensitive)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const sessionData = {
      cookies: [{ name: 'xman_us_t', value: 'tok_caixa', expires: 0 }]
    };

    const res = validateSession(sessionData, { user: 'User@Example.com' }, 'user@example.com');
    assert.strictEqual(res.valid, true, 'Diferença de caixa no e-mail não deve invalidar a sessão');

    const mismatch = validateSession(
      sessionData,
      { user: 'outro@example.com' },
      'user@example.com'
    );
    assert.strictEqual(mismatch.valid, false);
    assert.match(mismatch.reason, /não corresponde/);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
