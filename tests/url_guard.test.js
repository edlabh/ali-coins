const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateIp, allowPrivateTargets, validateExternalUrl } = require('../libs/url_guard');

test('libs/url_guard.js - isPrivateIp classifica IPv4/IPv6 privados e públicos', () => {
  // Privados/loopback/link-local/metadata
  for (const ip of [
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1'
  ]) {
    assert.strictEqual(isPrivateIp(ip), true, `${ip} deve ser privado`);
  }

  // Públicos
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
    assert.strictEqual(isPrivateIp(ip), false, `${ip} deve ser público`);
  }
});

test('libs/url_guard.js - allowPrivateTargets lê ALLOW_PRIVATE_WEBHOOKS', () => {
  assert.strictEqual(allowPrivateTargets({}), false);
  assert.strictEqual(allowPrivateTargets({ ALLOW_PRIVATE_WEBHOOKS: 'false' }), false);
  assert.strictEqual(allowPrivateTargets({ ALLOW_PRIVATE_WEBHOOKS: '0' }), false);
  assert.strictEqual(allowPrivateTargets({ ALLOW_PRIVATE_WEBHOOKS: 'true' }), true);
  assert.strictEqual(allowPrivateTargets({ ALLOW_PRIVATE_WEBHOOKS: '1' }), true);
});

test('libs/url_guard.js - validateExternalUrl bloqueia SSRF e permite destinos públicos', async () => {
  // Loopback/privado bloqueado por padrão
  assert.strictEqual((await validateExternalUrl('http://127.0.0.1/hook')).ok, false);
  assert.strictEqual((await validateExternalUrl('http://localhost/hook')).ok, false);
  assert.strictEqual((await validateExternalUrl('http://192.168.0.10/hook')).ok, false);
  assert.strictEqual(
    (await validateExternalUrl('http://169.254.169.254/latest/meta-data')).ok,
    false
  );
  assert.strictEqual((await validateExternalUrl('http://10.0.0.1:8080/hook')).ok, false);

  // Protocolos não permitidos
  assert.strictEqual((await validateExternalUrl('file:///etc/passwd')).ok, false);
  assert.strictEqual((await validateExternalUrl('ftp://example.com/x')).ok, false);

  // URL malformada/ausente
  assert.strictEqual((await validateExternalUrl('')).ok, false);
  assert.strictEqual((await validateExternalUrl('nao-e-url')).ok, false);

  // Público permitido (IP público, sem DNS)
  assert.strictEqual((await validateExternalUrl('https://8.8.8.8/hook')).ok, true);

  // Opt-in explícito permite privado
  assert.strictEqual(
    (await validateExternalUrl('http://127.0.0.1/hook', { allowPrivate: true })).ok,
    true
  );
});

test('libs/url_guard.js - validateExternalUrl bloqueia hostname que resolve para IP privado', async () => {
  const res = await validateExternalUrl('http://localhost.localdomain/hook');
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /loopback|bloqueado/i);
});
