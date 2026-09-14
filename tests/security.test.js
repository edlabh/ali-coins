const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  encryptSession,
  decryptSession,
  validateSession,
  isCookieExpired,
  validateSessionPayload,
  APP_SCRYPT_SALT_V1
} = require('../security');

const VALID_SECRET = 'a'.repeat(32);
const SHORT_SECRET = 'too-short';

test('security.js - encryptSession e decryptSession v2 roundtrip', () => {
  const payload = JSON.stringify({
    session: {
      cookies: [{ name: 'xman_us_t', value: 'secret-token-value' }]
    },
    meta: { user: 'user@example.com' }
  });

  const encrypted = encryptSession(payload, VALID_SECRET);
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

test('security.js - secret com menos de 32 caracteres deve falhar', () => {
  assert.throws(
    () => encryptSession('{}', SHORT_SECRET),
    /SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres/
  );

  assert.throws(
    () => decryptSession('v2:a:b:c:d:base64', SHORT_SECRET),
    /SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres/
  );

  assert.throws(
    () => encryptSession('{}', null),
    /SESSION_SECRET é obrigatório/
  );
});

test('security.js - tokens inválidos ou corrompidos devem falhar', () => {
  assert.throws(() => decryptSession('', VALID_SECRET), /não fornecido ou inválido/);
  assert.throws(() => decryptSession('invalid_token', VALID_SECRET), /deve iniciar com "v1:" ou "v2:"/);
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
  const resNoAuth = validateSession({ cookies: [{ name: 'outroc', value: '1' }] }, meta, 'test@example.com');
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
