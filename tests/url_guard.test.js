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

test('libs/url_guard.js - bloqueia IPv6 literal privado/loopback e IPv4 mapeado', async () => {
  // Regressão: URL.hostname devolve IPv6 entre colchetes ("[::1]"), o que fazia net.isIP()
  // retornar 0 e o host cair no ramo de DNS (que tolera falha) → ok: true indevidamente.
  const bloqueados = [
    'http://[::1]/x', // loopback
    'http://[fd00::1]/x', // unique local
    'http://[fe80::1]/x', // link-local
    'http://[::ffff:127.0.0.1]/x', // IPv4 mapeado (forma decimal)
    'http://[::ffff:7f00:1]/x', // IPv4 mapeado (forma hexadecimal, normalizada por new URL)
    'http://[::ffff:a9fe:a9fe]/x', // 169.254.169.254 (metadata da nuvem) em hex
    'http://[::7f00:1]/x', // IPv4 compatível (sem ffff)
    'http://localhost./x' // FQDN absoluto de loopback
  ];
  for (const url of bloqueados) {
    const res = await validateExternalUrl(url, { allowPrivate: false });
    assert.strictEqual(res.ok, false, `${url} deveria ser bloqueado (SSRF)`);
  }

  // IPv6 público continua permitido
  assert.strictEqual(
    (await validateExternalUrl('https://[2606:4700:4700::1111]/', { allowPrivate: false })).ok,
    true
  );

  // Opt-in explícito libera o loopback IPv6
  assert.strictEqual(
    (await validateExternalUrl('http://[::1]/x', { allowPrivate: true })).ok,
    true
  );
});

test('libs/url_guard.js - bloqueia IPv6 especiais (link-local /10, site-local, NAT64, 6to4, Teredo)', async () => {
  const { isPrivateIp } = require('../libs/url_guard');
  // link-local fe80::/10 completo + site-local fec0::/10
  for (const ip of ['fe80::1', 'fe90::1', 'fea0::1', 'feb0::1', 'fec0::1', 'fc00::1', 'fd12::1']) {
    assert.strictEqual(isPrivateIp(ip), true, `${ip} deve ser privado`);
  }
  // NAT64 (embute IPv4, ex.: metadata 169.254.169.254 e loopback)
  for (const ip of ['64:ff9b::a9fe:a9fe', '64:ff9b::7f00:1', '64:ff9b:1::a9fe:a9fe']) {
    assert.strictEqual(isPrivateIp(ip), true, `${ip} (NAT64) deve ser bloqueado`);
  }
  // 6to4 (2002::/16) e Teredo (2001::/32)
  assert.strictEqual(isPrivateIp('2002:7f00:1::'), true, '6to4 com 127.0.0.1 embutido');
  assert.strictEqual(isPrivateIp('2002:a9fe:a9fe::'), true, '6to4 com 169.254.169.254 embutido');
  assert.strictEqual(isPrivateIp('2001::1'), true, 'Teredo 2001::/32');
  // Públicos continuam liberados
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001::1']) {
    assert.strictEqual(isPrivateIp(ip), false, `${ip} deve ser público`);
  }
});

test('libs/url_guard.js - validateExternalUrl falha fechada quando o DNS não resolve', async () => {
  const { validateExternalUrl } = require('../libs/url_guard');
  const res = await validateExternalUrl('https://nao-existe-mesmo-xyz-12345.invalid/hook', {
    allowPrivate: false
  });
  assert.strictEqual(res.ok, false, 'deve bloquear quando não resolve (fail-closed)');
  assert.match(res.reason, /resolver|DNS|SSRF/i);
});

test('libs/url_guard.js - safeFetch revalida cada hop e bloqueia redirect para rede privada', async () => {
  const { safeFetch } = require('../libs/url_guard');
  const originalFetch = global.fetch;
  const fetched = [];
  // Primeiro hop: 8.8.8.8 (IP público literal, sem DNS) responde 302 para o metadata.
  // O guard deve bloquear o SEGUNDO hop (169.254.169.254) e nunca buscá-lo.
  global.fetch = async (u) => {
    fetched.push(String(u));
    return {
      status: 302,
      ok: false,
      headers: {
        get: (k) =>
          String(k).toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null
      },
      body: { cancel: async () => {} }
    };
  };
  try {
    await assert.rejects(
      () => safeFetch('http://8.8.8.8/hook', { method: 'POST' }, { allowPrivate: false }),
      (err) => err && err.code === 'SSRF_BLOCKED',
      'deve lançar SSRF_BLOCKED ao tentar seguir redirect para IP privado'
    );
    assert.ok(
      fetched.every((u) => !u.includes('169.254.169.254')),
      'nunca deve buscar o destino interno'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('browser.js - stripUrlCredentials remove credenciais mesmo sem esquema', () => {
  const { stripUrlCredentials } = require('../browser');
  assert.ok(stripUrlCredentials, 'deve ser exportado');
  assert.strictEqual(stripUrlCredentials('user:pass@proxy.local:8080'), 'proxy.local:8080');
  assert.strictEqual(
    stripUrlCredentials('http://user:pass@proxy.local:8080'),
    'http://proxy.local:8080'
  );
  assert.strictEqual(stripUrlCredentials('http://proxy.local:8080'), 'http://proxy.local:8080');
});
