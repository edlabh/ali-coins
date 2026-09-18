const test = require('node:test');
const assert = require('node:assert/strict');
const {
  maskHeartbeatUrl,
  normalizeBaseUrl,
  pingStart,
  pingSuccess,
  pingFail,
  sendHeartbeat
} = require('../libs/heartbeat');
const { configSchema, isHeartbeat } = require('../config');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('libs/heartbeat.js - maskHeartbeatUrl mascara UUID e tokens sem vazar segredos', () => {
  assert.strictEqual(maskHeartbeatUrl(null), '');
  assert.strictEqual(maskHeartbeatUrl(''), '');
  assert.strictEqual(maskHeartbeatUrl(undefined), '');

  const hcUrl = 'https://hc-ping.com/a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const masked = maskHeartbeatUrl(hcUrl);
  assert.ok(masked.startsWith('https://hc-ping.com/a1b2***'));
  assert.ok(masked.endsWith('7890'));
  assert.ok(!masked.includes('e5f6-7890-abcd'));

  const hcUrlWithStart = 'https://hc-ping.com/a1b2c3d4-e5f6-7890-abcd-ef1234567890/start';
  const maskedStart = maskHeartbeatUrl(hcUrlWithStart);
  assert.ok(maskedStart.endsWith('/start'));
  assert.ok(!maskedStart.includes('e5f6-7890-abcd'));

  const genericUrl = 'https://uptime.example.com/api/push/mysecrettoken12345';
  const maskedGeneric = maskHeartbeatUrl(genericUrl);
  assert.ok(maskedGeneric.startsWith('https://uptime.example.com/api/push/myse***'));
});

test('libs/heartbeat.js - normalizeBaseUrl limpa barras e rotas de ação', () => {
  assert.strictEqual(normalizeBaseUrl(''), '');
  assert.strictEqual(normalizeBaseUrl('https://hc-ping.com/uuid/'), 'https://hc-ping.com/uuid');
  assert.strictEqual(
    normalizeBaseUrl('https://hc-ping.com/uuid/start'),
    'https://hc-ping.com/uuid'
  );
  assert.strictEqual(
    normalizeBaseUrl('https://hc-ping.com/uuid/fail/'),
    'https://hc-ping.com/uuid'
  );
});

test('libs/heartbeat.js - pingStart, pingSuccess e pingFail com mock de fetch', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (targetUrl, options) => {
    calls.push({ url: targetUrl, method: options.method, body: options.body });
    return {
      ok: true,
      status: 200,
      text: async () => 'OK'
    };
  };

  try {
    const testUrl = 'https://hc-ping.com/12345678-1234-1234-1234-123456789abc';

    // 1. pingStart
    const startRes = await pingStart(testUrl, { timeoutMs: 1000 });
    assert.strictEqual(startRes.ok, true);
    assert.strictEqual(startRes.status, 200);
    assert.strictEqual(calls[0].url, `${testUrl}/start`);
    assert.strictEqual(calls[0].method, 'POST');

    // 2. pingSuccess
    const reportData = { user: 'us***@example.com', totalBalance: '500' };
    const successRes = await pingSuccess(testUrl, reportData, { timeoutMs: 1000 });
    assert.strictEqual(successRes.ok, true);
    assert.strictEqual(calls[1].url, testUrl);
    assert.strictEqual(calls[1].method, 'POST');
    assert.ok(calls[1].body.includes('us***@example.com'));
    // Body compacto (sem indentação) para reduzir payload de rede
    assert.strictEqual(
      calls[1].body.includes('\n  "'),
      false,
      'Body do heartbeat de sucesso deve ser JSON compacto'
    );

    // 3. pingFail
    const failErr = new Error('Falha simulada na navegação');
    const failRes = await pingFail(testUrl, failErr, { timeoutMs: 1000 });
    assert.strictEqual(failRes.ok, true);
    assert.strictEqual(calls[2].url, `${testUrl}/fail`);
    assert.strictEqual(calls[2].method, 'POST');
    assert.ok(calls[2].body.includes('Falha simulada'));
    // Privacidade: stack trace não deve ser enviado a monitor externo
    assert.strictEqual(
      calls[2].body.includes('\n    at '),
      false,
      'Body do heartbeat não deve conter stack trace'
    );
    assert.strictEqual(
      calls[2].body.includes('heartbeat.test.js'),
      false,
      'Body do heartbeat não deve expor caminhos internos'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('libs/heartbeat.js - fallback GET quando serviço retorna 405 Method Not Allowed', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (targetUrl, options) => {
    calls.push({ url: targetUrl, method: options.method });
    if (options.method === 'POST') {
      return { ok: false, status: 405, text: async () => 'Method Not Allowed' };
    }
    return { ok: true, status: 200, text: async () => 'OK' };
  };

  try {
    const testUrl = 'https://uptime.example.com/push';
    const res = await pingStart(testUrl, { timeoutMs: 1000 });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].method, 'POST');
    assert.strictEqual(calls[1].method, 'GET');
  } finally {
    global.fetch = originalFetch;
  }
});

test('libs/heartbeat.js - resiliência: falha de rede nunca lança exceção', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => {
    throw new Error('ETIMEDOUT: Connection timed out');
  };

  try {
    const testUrl = 'https://hc-ping.com/unreachable-uuid-12345';

    // Nenhuma chamada deve lançar erro, todas devem retornar { ok: false }
    const startRes = await pingStart(testUrl);
    assert.strictEqual(startRes.ok, false);
    assert.ok(startRes.error.includes('ETIMEDOUT'));

    const successRes = await pingSuccess(testUrl);
    assert.strictEqual(successRes.ok, false);

    const failRes = await pingFail(testUrl, 'Erro');
    assert.strictEqual(failRes.ok, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('libs/heartbeat.js - sendHeartbeat respeita desativação e URLs vazias', async () => {
  let fetchCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200 };
  };

  try {
    // 1. Sem URL configurada
    const res1 = await sendHeartbeat('start', { url: '' });
    assert.strictEqual(res1.ok, true);
    assert.strictEqual(res1.skipped, true);
    assert.strictEqual(fetchCalled, false);

    // 2. Com config desativada
    const res2 = await sendHeartbeat('start', {
      config: { HEARTBEAT_ENABLED: false, HEARTBEAT_URL: 'https://hc-ping.com/uuid' }
    });
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.skipped, true);
    assert.strictEqual(fetchCalled, false);

    // 3. Com config ativada
    const res3 = await sendHeartbeat('start', {
      config: { HEARTBEAT_ENABLED: true, HEARTBEAT_URL: 'https://hc-ping.com/uuid' }
    });
    assert.strictEqual(res3.ok, true);
    assert.strictEqual(fetchCalled, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('config.js - validações Zod e CLI de heartbeat', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    // 1. Zod: HEARTBEAT_ENABLED=true sem URL válida deve falhar
    assert.throws(() => {
      configSchema.parse({
        ALI_USER: 'test@example.com',
        ALI_PASSWORD: 'secretpassword',
        HEARTBEAT_ENABLED: true,
        HEARTBEAT_URL: 'invalid-url'
      });
    }, /HEARTBEAT_URL é obrigatória e deve ser uma URL válida/);

    // 2. Zod: HEARTBEAT_URL válida deve passar
    const valid = configSchema.parse({
      ALI_USER: 'test@example.com',
      ALI_PASSWORD: 'secretpassword',
      HEARTBEAT_ENABLED: true,
      HEARTBEAT_URL: 'https://hc-ping.com/a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    });
    assert.strictEqual(valid.HEARTBEAT_ENABLED, true);
    assert.strictEqual(valid.HEARTBEAT_TIMEOUT_MS, 5000);

    // 3. Flags CLI: --heartbeat e --no-heartbeat
    assert.strictEqual(isHeartbeat(['node', 'all.js', '--heartbeat']), true);
    assert.strictEqual(isHeartbeat(['node', 'all.js', '--no-heartbeat']), false);
    assert.strictEqual(isHeartbeat(['node', 'all.js']), null);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/heartbeat.js - maskHeartbeatUrl mascara tokens em query string', () => {
  const { maskHeartbeatUrl } = require('../libs/heartbeat');

  // Valor montado em runtime (nunca literal no fonte, que é varrido pelo Gitleaks)
  const fakeToken = ['SUPER', 'SECRET', 'TOKEN', 'VALUE'].join('') + '_123456';
  const masked = maskHeartbeatUrl(`https://example.com/api/ping?token=${fakeToken}&x=1`);
  assert.strictEqual(masked.includes(fakeToken), false, 'Token não deve vazar');
  assert.ok(masked.includes('token=SUPE***3456'), `Token deve ser mascarado: ${masked}`);
  assert.ok(masked.includes('x=***'), 'Valores curtos devem ser totalmente mascarados');

  const maskedHash = maskHeartbeatUrl('https://example.com/ping#fragmento-secreto');
  assert.strictEqual(
    maskedHash.includes('fragmento-secreto'),
    false,
    'Fragmento deve ser removido'
  );
});

test('libs/heartbeat.js - maskHeartbeatUrl mascara token no meio do path e credenciais da URL', () => {
  const { maskHeartbeatUrl } = require('../libs/heartbeat');

  // Token em segmento intermediário (ex: /api/<token>/ping)
  const middle = maskHeartbeatUrl('https://hc.example.com/api/TELEGRAMSECRETTOKEN123/ping');
  assert.strictEqual(
    middle.includes('TELEGRAMSECRETTOKEN123'),
    false,
    'Token no meio do path não pode vazar'
  );
  assert.ok(middle.includes('TELE***N123'), `Token do meio deve ser mascarado: ${middle}`);

  // Credenciais embutidas (user:senha@host)
  const creds = maskHeartbeatUrl('https://usuario:SENHA_SECRETA@example.com/ping');
  assert.strictEqual(creds.includes('SENHA_SECRETA'), false, 'Senha da URL não pode vazar');
  assert.strictEqual(creds.includes('usuario:'), false, 'Usuário da URL não pode vazar');

  // Ação final continua preservada e o token anterior mascarado
  const withAction = maskHeartbeatUrl('https://hc-ping.com/a1b2c3d4-e5f6-7890-abcd/start');
  assert.ok(withAction.endsWith('/start'));
  assert.strictEqual(withAction.includes('e5f6-7890-abcd'), false);
});
