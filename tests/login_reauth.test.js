const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performMobileLogin } = require('../libs/ui/login');
const { isLoginPromptText, isLoginGateText } = require('../libs/ui/balance');
const { shouldAttemptLogin } = require('../collect');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

/**
 * Cria um ElementHandle falso que registra as interações.
 */
function makeElement(calls, label) {
  return {
    async fill(value) {
      calls.push(['fill', label, value]);
    },
    async press(key) {
      calls.push(['press', label, key]);
    },
    async isVisible() {
      return true;
    },
    async boundingBox() {
      return null;
    }
  };
}

/**
 * Cria uma Page falsa com os campos do fluxo de login (usuário/senha/Sign in).
 */
function makePage({ withUsername = false, withPassword = true, loginResponse = null } = {}) {
  const calls = [];
  const listeners = { response: [] };
  const elements = {
    username: makeElement(calls, 'username'),
    password: makeElement(calls, 'password'),
    signIn: makeElement(calls, 'signin')
  };
  return {
    calls,
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
    },
    off(event, fn) {
      listeners[event] = (listeners[event] || []).filter((h) => h !== fn);
    },
    async waitForSelector(selector) {
      const s = String(selector);
      if (s.includes('type="password"')) {
        if (withPassword) return elements.password;
        throw new Error('timeout');
      }
      if (s.includes('fm-login-id')) {
        if (withUsername) return elements.username;
        throw new Error('timeout');
      }
      throw new Error('timeout');
    },
    async $(selector) {
      const s = String(selector);
      if (s.includes('type="password"')) return withPassword ? elements.password : null;
      if (s.includes('fm-login-id')) return withUsername ? elements.username : null;
      if (s.includes('cosmos-btn-primary') || s.includes('type="submit"')) return elements.signIn;
      return null;
    },
    async innerText() {
      return '';
    },
    async waitForLoadState() {},
    async waitForTimeout() {},
    async evaluate() {
      calls.push(['evaluate']);
      if (loginResponse) {
        const res = {
          url: () => 'https://login.aliexpress.com/user/buyer/login/loginByPwd',
          headers: () => ({ 'content-type': 'application/json' }),
          json: async () => loginResponse
        };
        for (const h of listeners.response.slice()) await h(res);
      }
    },
    frames() {
      return [];
    },
    async screenshot() {},
    url() {
      return 'https://m.aliexpress.com/p/coin-index/index.html';
    }
  };
}

function makeContext() {
  const cookies = [
    { name: 'xman_us_t', value: 'auth-token' },
    { name: 'login_aliyunid_ticket', value: 'ticket-value' }
  ];
  return {
    async cookies() {
      return [...cookies];
    },
    async storageState() {
      return { cookies: [...cookies], origins: [] };
    }
  };
}

test('collect.js - shouldAttemptLogin detecta prompt de reautenticação in-page (issue #17)', () => {
  // Cenário do bug: sessão "válida" e URL do coin-index, mas com campo de senha visível
  // (prompt de reautenticação SPA) → deve tentar autenticar.
  assert.strictEqual(
    shouldAttemptLogin({
      hasValidSession: true,
      passwordVisible: true,
      loginUrl: false,
      usernameVisible: false,
      bodyText: 'COINS\nLog in\nPassword\nForgot password'
    }),
    true,
    'senha visível deve acionar o login independentemente da URL'
  );

  // Sessão válida em página normal → não força re-login.
  assert.strictEqual(
    shouldAttemptLogin({
      hasValidSession: true,
      passwordVisible: false,
      loginUrl: false,
      usernameVisible: false,
      bodyText: 'Minhas moedas\n521'
    }),
    false
  );

  // Comportamento histórico preservado: URL de login + campo de usuário/textos.
  assert.strictEqual(
    shouldAttemptLogin({ hasValidSession: true, loginUrl: true, usernameVisible: true }),
    true
  );
  assert.strictEqual(
    shouldAttemptLogin({
      hasValidSession: true,
      loginUrl: true,
      bodyText: 'Email or phone number'
    }),
    true
  );

  // Sem sessão válida sempre tenta (mesmo sem campos detectados).
  assert.strictEqual(shouldAttemptLogin({ hasValidSession: false }), true);
});

test('libs/ui/balance.js - isLoginPromptText reconhece o prompt de reautenticação', () => {
  const promptCapturado =
    'COINS\nLog in\nNome\nma***@example.com\nPassword\nForgot password\n' +
    'Sign in with email code\nSign in\nSwitch account';
  assert.strictEqual(isLoginPromptText(promptCapturado), true);

  // Página normal de moedas não é prompt de login.
  assert.strictEqual(isLoginPromptText('Minhas moedas\n521\nCheck-in diário no app\n+40'), false);
  assert.strictEqual(isLoginPromptText(''), false);
  assert.strictEqual(isLoginPromptText(null), false);
});

test('collect.js - shouldAttemptLogin detecta a portaria "COINS / Log in" com sessão expirada', () => {
  // Cenário de out/2026: sessão local "válida", mesma URL do coin-index, sem campos de
  // login — só o título e o botão. Antes caía em "não foi possível obter streak e saldo"
  // com attemptedLogin=false e o --manual-login nunca era oferecido.
  assert.strictEqual(
    shouldAttemptLogin({
      hasValidSession: true,
      passwordVisible: false,
      loginUrl: false,
      usernameVisible: false,
      bodyText: 'COINS\nLog in'
    }),
    true
  );
});

test('libs/ui/balance.js - isLoginGateText só reconhece a portaria sem saldo', () => {
  assert.strictEqual(isLoginGateText('COINS\nLog in'), true);
  assert.strictEqual(isLoginGateText('  COINS \n  Log in  \n'), true);

  // Coin-index autenticado sempre tem dígitos (saldo/sequência), mesmo com um "Log in" solto.
  assert.strictEqual(isLoginGateText('COINS\nLog in\nMinhas moedas\n521'), false);
  // "Log in" dentro de uma frase não é o botão da portaria.
  assert.strictEqual(isLoginGateText('COINS\nLog in to see your coins'), false);
  assert.strictEqual(isLoginGateText(''), false);
  assert.strictEqual(isLoginGateText(null), false);
});

test('libs/ui/balance.js - isLoginPromptText reconhece a tela "Register/Sign in" do desktop', () => {
  const telaDesktop =
    'Download the AliExpress app\nRegister/Sign in\nYour information is protected\n' +
    'Continue\nTrouble signing in?\nOr continue with\nPasskey\nGoogle\nFacebook\n' +
    'More options\nLocation: Brazil';
  assert.strictEqual(isLoginPromptText(telaDesktop), true);
});

test('libs/ui/login.js - login somente-senha (prompt in-page) autentica sem campo de usuário', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-coins-reauth-'));
  try {
    const page = makePage({ withUsername: false, withPassword: true });
    const context = makeContext();
    const config = { SELECTOR_TIMEOUT: 50, ALI_USER: 'x@example.com', ALI_PASSWORD: 'pw' };
    const options = {
      account: { user: 'x@example.com', password: 'pw' },
      baseDir: tmp,
      sessionPath: path.join(tmp, 'session_x.json'),
      sessionMetaPath: path.join(tmp, 'session_meta_x.json'),
      encryptLocalSession: false
    };

    const result = await performMobileLogin(page, context, config, options);

    assert.ok(result && Array.isArray(result.cookies), 'deve retornar o storageState');
    assert.ok(
      page.calls.some(
        ([op, label, value]) => op === 'fill' && label === 'password' && value === 'pw'
      ),
      'deve preencher a senha'
    );
    assert.ok(
      page.calls.some(([op]) => op === 'evaluate'),
      'deve clicar em Sign in'
    );
    assert.ok(fs.existsSync(path.join(tmp, 'session_x.json')), 'deve salvar a sessão no destino');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/login.js - falha por captcha marca isCaptchaChallenge no erro', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-coins-captcha-flag-'));
  const prevOut = process.env.PW_OUTPUT_DIR;
  process.env.PW_OUTPUT_DIR = tmp;
  try {
    const page = makePage({ withUsername: false, withPassword: true });
    // Sem cookie de autenticação → desafio anti-bot não superado
    const context = {
      async cookies() {
        return [];
      },
      async storageState() {
        return { cookies: [], origins: [] };
      }
    };

    await assert.rejects(
      () =>
        performMobileLogin(
          page,
          context,
          { SELECTOR_TIMEOUT: 50 },
          {
            account: { user: 'x@example.com', password: 'pw' },
            baseDir: tmp,
            sessionPath: path.join(tmp, 'session_x.json'),
            sessionMetaPath: path.join(tmp, 'session_meta_x.json')
          }
        ),
      (err) => {
        assert.strictEqual(err.isCaptchaChallenge, true, 'erro deve sinalizar captcha');
        assert.match(err.message, /desafio de segurança/);
        return true;
      }
    );
  } finally {
    if (prevOut === undefined) delete process.env.PW_OUTPUT_DIR;
    else process.env.PW_OUTPUT_DIR = prevOut;
    fs.rmSync(tmp, { recursive: true, force: true });
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/login.js - sem campo de usuário nem senha mantém o erro original', async () => {
  const page = makePage({ withUsername: false, withPassword: false });
  await assert.rejects(
    () =>
      performMobileLogin(
        page,
        makeContext(),
        { SELECTOR_TIMEOUT: 50 },
        {
          account: { user: 'x@example.com', password: 'pw' }
        }
      ),
    /Campo de identificador de usuário/
  );
});

test('libs/ui/login.js - classifyLoginRet identifica risco (RGV587) e sucesso', () => {
  const { classifyLoginRet } = require('../libs/ui/login');

  const risco = classifyLoginRet(['FAIL_SYS_USER_VALIDATE', 'RGV587_ERROR::SM::tente mais tarde']);
  assert.strictEqual(risco.risk, true);
  assert.strictEqual(risco.success, false);

  const sucesso = classifyLoginRet(['SUCCESS::SUCCESS']);
  assert.strictEqual(sucesso.success, true);
  assert.strictEqual(sucesso.risk, false);

  assert.strictEqual(classifyLoginRet([]).success, false);
  assert.strictEqual(classifyLoginRet(undefined).risk, false);
  assert.strictEqual(classifyLoginRet('RGV587_ERROR::SM').risk, true);
});

test('libs/ui/login.js - decideLoginSuccess não aceita xman_us_t antigo sem rotação', () => {
  const { decideLoginSuccess } = require('../libs/ui/login');

  assert.strictEqual(decideLoginSuccess({ hasTicket: true }), true, 'ticket forte autentica');
  assert.strictEqual(
    decideLoginSuccess({ xmanRotated: true }),
    true,
    'cookie rotacionado autentica'
  );
  assert.strictEqual(
    decideLoginSuccess({ responseSuccess: true }),
    true,
    'resposta SUCCESS autentica'
  );
  assert.strictEqual(decideLoginSuccess({}), false, 'sem sinais fortes não autentica');
  assert.strictEqual(
    decideLoginSuccess({ responseRisk: true, hasTicket: true }),
    false,
    'risco tem prioridade sobre qualquer cookie'
  );
});

test('libs/ui/login.js - xman_us_t antigo sem ticket falha como desafio e não salva sessão', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-coins-stale-cookie-'));
  const prevOut = process.env.PW_OUTPUT_DIR;
  process.env.PW_OUTPUT_DIR = tmp;
  try {
    const page = makePage({ withUsername: false, withPassword: true });
    const context = {
      async cookies() {
        return [{ name: 'xman_us_t', value: 'antigo' }];
      },
      async storageState() {
        return { cookies: [], origins: [] };
      }
    };

    await assert.rejects(
      () =>
        performMobileLogin(
          page,
          context,
          { SELECTOR_TIMEOUT: 50 },
          {
            account: { user: 'x@example.com', password: 'pw' },
            baseDir: tmp,
            sessionPath: path.join(tmp, 'session_x.json'),
            sessionMetaPath: path.join(tmp, 'session_meta_x.json')
          }
        ),
      (err) => {
        assert.strictEqual(err.isCaptchaChallenge, true);
        return true;
      }
    );
    assert.ok(!fs.existsSync(path.join(tmp, 'session_x.json')), 'não deve salvar sessão');
  } finally {
    if (prevOut === undefined) delete process.env.PW_OUTPUT_DIR;
    else process.env.PW_OUTPUT_DIR = prevOut;
    fs.rmSync(tmp, { recursive: true, force: true });
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/login.js - rejeição RGV587 aborta com isCaptchaChallenge', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-coins-rgv587-'));
  const prevOut = process.env.PW_OUTPUT_DIR;
  process.env.PW_OUTPUT_DIR = tmp;
  try {
    const page = makePage({
      withUsername: false,
      withPassword: true,
      loginResponse: { ret: ['FAIL_SYS_USER_VALIDATE', 'RGV587_ERROR::SM::tente mais tarde'] }
    });
    const context = {
      async cookies() {
        return [{ name: 'xman_us_t', value: 'antigo' }];
      },
      async storageState() {
        return { cookies: [], origins: [] };
      }
    };

    await assert.rejects(
      () =>
        performMobileLogin(
          page,
          context,
          { SELECTOR_TIMEOUT: 50 },
          {
            account: { user: 'x@example.com', password: 'pw' },
            baseDir: tmp,
            sessionPath: path.join(tmp, 'session_x.json'),
            sessionMetaPath: path.join(tmp, 'session_meta_x.json')
          }
        ),
      (err) => {
        assert.strictEqual(err.isCaptchaChallenge, true);
        assert.match(err.message, /risco|RGV587/i);
        assert.strictEqual(err.isRiskControl, true, 'erro deve sinalizar bloqueio de risco');
        assert.strictEqual(err.captchaCooldownHours, 48, 'cooldown de risco é 48h');
        return true;
      }
    );
    assert.ok(!fs.existsSync(path.join(tmp, 'session_x.json')), 'não deve salvar sessão');
  } finally {
    if (prevOut === undefined) delete process.env.PW_OUTPUT_DIR;
    else process.env.PW_OUTPUT_DIR = prevOut;
    fs.rmSync(tmp, { recursive: true, force: true });
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
