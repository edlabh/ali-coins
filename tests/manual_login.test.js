const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CHOICE_HEADLESS,
  CHOICE_MANUAL,
  ManualLoginError,
  ManualLoginTimeoutError,
  isManualLoginAvailable,
  shouldOfferManualLogin,
  manualLoginReason,
  buildLoginChoiceMenu,
  parseLoginChoice,
  askLoginChoice,
  waitForManualLogin,
  performManualLogin
} = require('../libs/ui/manual-login');

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

function makePage() {
  return {
    waitForLoadState: async () => {},
    bringToFront: async () => {},
    url: () => 'https://m.aliexpress.com/p/coin-index/index.html'
  };
}

function makeContext() {
  const page = makePage();
  return {
    page,
    newPage: async () => page,
    addInitScript: async () => {},
    storageState: async () => ({
      cookies: [{ name: 'login_aliyunid_ticket', value: 'ticket' }],
      origins: []
    })
  };
}

function makeReadlineFake({ answer, onQuestion } = {}) {
  const handlers = {};
  const rl = {
    lastPrompt: '',
    question(prompt, cb) {
      rl.lastPrompt = prompt;
      if (onQuestion) return onQuestion(cb, rl);
      if (answer !== undefined) setImmediate(() => cb(answer));
    },
    once(event, cb) {
      handlers[event] = cb;
    },
    close() {
      if (handlers.close) setImmediate(() => handlers.close());
    }
  };
  return rl;
}

test('manual-login - isManualLoginAvailable exige TTY e GUI conforme a plataforma', () => {
  const base = { stdinIsTTY: true, stdoutIsTTY: true, env: {} };
  assert.strictEqual(isManualLoginAvailable({ ...base, platform: 'linux' }), false);
  assert.strictEqual(
    isManualLoginAvailable({ ...base, platform: 'linux', env: { DISPLAY: ':0' } }),
    true
  );
  assert.strictEqual(
    isManualLoginAvailable({ ...base, platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } }),
    true
  );
  assert.strictEqual(
    isManualLoginAvailable({ ...base, platform: 'win32', env: {} }),
    true,
    'Windows é considerado GUI quando há TTY'
  );
  assert.strictEqual(
    isManualLoginAvailable({ ...base, platform: 'darwin', env: {} }),
    true,
    'macOS é considerado GUI quando há TTY'
  );
  assert.strictEqual(
    isManualLoginAvailable({
      ...base,
      platform: 'linux',
      env: { DISPLAY: ':0' },
      stdinIsTTY: false
    }),
    false,
    'sem stdin TTY não pergunta'
  );
  assert.strictEqual(
    isManualLoginAvailable({
      ...base,
      platform: 'linux',
      env: { DISPLAY: ':0' },
      stdoutIsTTY: false
    }),
    false,
    'sem stdout TTY não pergunta'
  );
  assert.strictEqual(
    isManualLoginAvailable({
      ...base,
      platform: 'linux',
      env: { DISPLAY: ':0', CI: 'true' }
    }),
    false,
    'CI nunca pergunta'
  );
  assert.strictEqual(
    isManualLoginAvailable({
      ...base,
      platform: 'win32',
      env: { SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22' }
    }),
    false,
    'SSH no Windows não abre janela na sessão gráfica'
  );
  assert.strictEqual(
    isManualLoginAvailable({
      ...base,
      platform: 'darwin',
      env: { SSH_TTY: '/dev/ttys001' }
    }),
    false,
    'SSH no macOS não abre janela na sessão gráfica'
  );
  assert.strictEqual(
    isManualLoginAvailable({
      ...base,
      platform: 'linux',
      env: { DISPLAY: ':10', SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22' }
    }),
    true,
    'X11 forwarding no Linux continua permitido'
  );
  assert.strictEqual(
    isManualLoginAvailable({
      ...base,
      platform: 'linux',
      env: { DISPLAY: ':0' },
      mode: 'never'
    }),
    false,
    'MANUAL_LOGIN=never nunca pergunta'
  );
  assert.strictEqual(
    isManualLoginAvailable({ ...base, platform: 'freebsd', env: {} }),
    false,
    'plataforma desconhecida não pergunta'
  );
});

test('manual-login - shouldOfferManualLogin cobre sessão, reautenticação e cooldown', () => {
  assert.strictEqual(shouldOfferManualLogin({ hasValidLogin: false }), true);
  assert.strictEqual(shouldOfferManualLogin({ hasValidLogin: true }), false);
  assert.strictEqual(
    shouldOfferManualLogin({ hasValidLogin: true, needsLogin: true }),
    true,
    'sessão válida localmente mas rejeitada pelo site oferece login manual'
  );
  assert.strictEqual(
    shouldOfferManualLogin({ hasValidLogin: true, passwordVisible: true }),
    true,
    'campo de senha visível indica reautenticação'
  );
  assert.strictEqual(
    shouldOfferManualLogin({ hasValidLogin: true, cooldown: { active: true } }),
    true,
    'cooldown ativo oferece login manual'
  );
  assert.strictEqual(
    shouldOfferManualLogin({ hasValidLogin: true, cooldown: { requireManualLogin: true } }),
    true,
    'gate manual oferece login manual mesmo com cooldown expirado'
  );
  assert.strictEqual(
    shouldOfferManualLogin({
      hasValidLogin: true,
      cooldown: { active: false, requireManualLogin: false }
    }),
    false
  );
  assert.strictEqual(
    shouldOfferManualLogin({ hasValidLogin: false, mode: 'never' }),
    false,
    'modo never tem precedência'
  );
});

test('manual-login - manualLoginReason descreve o gatilho sem expor segredos', () => {
  assert.match(manualLoginReason({ hasValidLogin: false }), /sem sessão válida/);
  assert.match(manualLoginReason({ hasValidLogin: true, passwordVisible: true }), /reautenticação/);
  assert.match(
    manualLoginReason({
      hasValidLogin: true,
      cooldown: { active: true, riskControl: true }
    }),
    /RGV587/
  );
  assert.match(
    manualLoginReason({
      hasValidLogin: true,
      cooldown: { active: false, requireManualLogin: true }
    }),
    /RGV587/
  );
  assert.match(
    manualLoginReason({ hasValidLogin: true, cooldown: { active: true } }),
    /cooldown pós-captcha/
  );
});

test('manual-login - parseLoginChoice aceita 1/2 e cai em headless no inválido', () => {
  for (const value of ['', ' ', '1', 'h', 'HEADLESS', 'qualquer coisa']) {
    assert.strictEqual(parseLoginChoice(value), CHOICE_HEADLESS, `valor ${JSON.stringify(value)}`);
  }
  for (const value of ['2', 'm', 'MANUAL', ' 2 ']) {
    assert.strictEqual(parseLoginChoice(value), CHOICE_MANUAL, `valor ${JSON.stringify(value)}`);
  }
  assert.strictEqual(parseLoginChoice('', { defaultValue: CHOICE_MANUAL }), CHOICE_MANUAL);
});

test('manual-login - menu mostra as duas opções, conta mascarada e motivo', () => {
  const menu = buildLoginChoiceMenu({
    account: { user: 'segredo@example.com', maskedUser: 'se***@example.com' },
    reason: 'sem sessão válida',
    timeoutMs: 60000
  });
  assert.ok(menu.includes('1) Continuar 100% headless'));
  assert.ok(menu.includes('2) Abrir janela para login manual'));
  assert.ok(menu.includes('se***@example.com'));
  assert.ok(!menu.includes('segredo@example.com'), 'não expõe o usuário completo');
  assert.ok(menu.includes('sem sessão válida'));
  assert.ok(menu.includes('timeout 60s'));

  const masked = buildLoginChoiceMenu({
    account: { user: 'outro@example.com' },
    timeoutMs: 1000
  });
  assert.ok(masked.includes('ou***@example.com'));
  assert.ok(masked.includes('timeout 1s'));

  const riskMenu = buildLoginChoiceMenu({
    reason: 'bloqueio anti-bot (RGV587) ativo',
    timeoutMs: 60000
  });
  assert.ok(riskMenu.includes('cooldown de 48h'), 'avisa para respeitar o cooldown');
});

test('manual-login - askLoginChoice lê a opção 2', async () => {
  const rl = makeReadlineFake({ answer: '2' });
  const answer = await askLoginChoice({
    account: { maskedUser: 'x***@example.com' },
    reason: 'teste',
    timeoutMs: 1000,
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    createInterface: () => rl
  });
  assert.strictEqual(answer.choice, CHOICE_MANUAL);
  assert.strictEqual(answer.timedOut, false);
  assert.ok(rl.lastPrompt.includes('x***@example.com'));
});

test('manual-login - askLoginChoice usa headless em timeout, cancelamento e sem TTY', async () => {
  const silent = makeReadlineFake({ onQuestion: () => {} });
  const timedOut = await askLoginChoice({
    timeoutMs: 10,
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    createInterface: () => silent
  });
  assert.strictEqual(timedOut.choice, CHOICE_HEADLESS);
  assert.strictEqual(timedOut.timedOut, true);

  const abortedRl = makeReadlineFake({ onQuestion: () => {} });
  const originalOnce = abortedRl.once;
  abortedRl.once = (event, cb) => {
    originalOnce(event, cb);
    if (event === 'close') setImmediate(cb);
  };
  const aborted = await askLoginChoice({
    timeoutMs: 1000,
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    createInterface: () => abortedRl
  });
  assert.strictEqual(aborted.choice, CHOICE_HEADLESS);
  assert.strictEqual(aborted.aborted, true);

  const nonInteractive = await askLoginChoice({
    stdin: { isTTY: false },
    stdout: { isTTY: false },
    createInterface: () => {
      throw new Error('não deveria criar interface');
    }
  });
  assert.strictEqual(nonInteractive.choice, CHOICE_HEADLESS);
  assert.strictEqual(nonInteractive.nonInteractive, true);
});

test('manual-login - waitForManualLogin aceita ticket quando o formulário de login sumiu', async () => {
  const page = {
    isClosed: () => false,
    $$: async () => [],
    $: async () => null
  };
  let cookieCalls = 0;
  const context = {
    cookies: async () => {
      cookieCalls++;
      if (cookieCalls === 1) return [];
      return [{ name: 'login_aliyunid_ticket', value: 'ticket_novo' }];
    }
  };
  const result = await waitForManualLogin({
    context,
    page,
    timeoutMs: 1000,
    sleep: async () => {}
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.hasTicket, true);
});

test('manual-login - waitForManualLogin aceita xman_us_t novo (login desktop)', async () => {
  const page = {
    isClosed: () => false,
    $$: async () => [],
    $: async () => null
  };
  let calls = 0;
  const context = {
    cookies: async () => {
      calls++;
      if (calls === 1) return [{ name: 'xman_us_t', value: 'xman_antigo' }];
      return [{ name: 'xman_us_t', value: 'xman_novo' }];
    }
  };
  const result = await waitForManualLogin({
    context,
    page,
    timeoutMs: 1000,
    sleep: async () => {}
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.authCookie, 'xman_us_t');
});

test('manual-login - waitForManualLogin não aceita xman_us_t antigo que não se renovou', async () => {
  const page = {
    isClosed: () => false,
    $$: async () => []
  };
  const context = {
    cookies: async () => [{ name: 'xman_us_t', value: 'xman_antigo' }]
  };
  await assert.rejects(
    waitForManualLogin({ context, page, timeoutMs: 0, now: () => 0 }),
    ManualLoginTimeoutError
  );
});

test('manual-login - waitForManualLogin aceita quando a página de moedas abriu', async () => {
  const page = {
    isClosed: () => false,
    $$: async () => [{ isVisible: async () => true }]
  };
  let calls = 0;
  const context = {
    cookies: async () => {
      calls++;
      if (calls === 1) return [];
      return [{ name: 'xman_us_t', value: 'xman_novo' }];
    },
    pages: () => [{ url: () => 'https://www.aliexpress.com/p/coin-pc-index/mycoin.html' }]
  };
  const result = await waitForManualLogin({
    context,
    page,
    timeoutMs: 1000,
    sleep: async () => {}
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.authCookie, 'xman_us_t');
});

test('manual-login - waitForManualLogin não confunde return_url com a página de moedas', async () => {
  const page = {
    isClosed: () => false,
    $$: async () => [{ isVisible: async () => true }],
    url: () =>
      'https://www.aliexpress.com/p/ug-login-page/login.html?return_url=https%3A%2F%2Fwww.aliexpress.com%2Fp%2Fcoin-pc-index%2Fmycoin.html'
  };
  let calls = 0;
  const context = {
    cookies: async () => {
      calls++;
      if (calls === 1) return [];
      return [{ name: 'xman_us_t', value: 'xman_novo' }];
    },
    pages: () => [page]
  };
  await assert.rejects(
    waitForManualLogin({ context, page, timeoutMs: 0, now: () => 0 }),
    ManualLoginTimeoutError
  );
});

test('manual-login - waitForManualLogin não aceita ticket antigo com senha ainda visível', async () => {
  const page = {
    isClosed: () => false,
    $: async () => ({ isVisible: async () => true })
  };
  const context = {
    cookies: async () => [{ name: 'login_aliyunid_ticket', value: 'ticket_antigo' }]
  };
  await assert.rejects(
    waitForManualLogin({ context, page, timeoutMs: 0, now: () => 0 }),
    ManualLoginTimeoutError
  );
});

test('manual-login - waitForManualLogin também espera o campo de usuário sumir', async () => {
  let userVisible = true;
  let selectorSeen = '';
  const page = {
    isClosed: () => false,
    // Simula o fluxo usuário-primeiro: existe uma senha oculta ANTES do usuário visível.
    $$: async (selector) => {
      selectorSeen = selector;
      return [{ isVisible: async () => false }, { isVisible: async () => userVisible }];
    }
  };
  let cookieCalls = 0;
  const context = {
    cookies: async () => {
      cookieCalls++;
      if (cookieCalls === 1) return [];
      return [{ name: 'login_aliyunid_ticket', value: 'ticket_novo' }];
    }
  };
  let calls = 0;
  const wait = waitForManualLogin({
    context,
    page,
    timeoutMs: 1000,
    sleep: async () => {
      calls++;
      userVisible = false;
    }
  });
  const result = await wait;
  assert.strictEqual(result.ok, true);
  assert.strictEqual(calls, 1, 'só concluiu depois que o campo de login sumiu');
  assert.match(selectorSeen, /fm-login-id/, 'considera também o passo de usuário');
});

test('manual-login - waitForManualLogin rejeita ticket antigo que não se renovou', async () => {
  const page = {
    isClosed: () => false,
    $$: async () => []
  };
  const context = {
    cookies: async () => [{ name: 'login_aliyunid_ticket', value: 'ticket_antigo' }]
  };
  await assert.rejects(
    waitForManualLogin({ context, page, timeoutMs: 0, now: () => 0 }),
    ManualLoginTimeoutError,
    'o mesmo ticket de antes do login não pode ser aceito como sessão nova'
  );
});

test('manual-login - waitForManualLogin aceita ticket renovado sem formulário', async () => {
  const page = {
    isClosed: () => false,
    $$: async () => []
  };
  let cookieCalls = 0;
  const context = {
    cookies: async () => {
      cookieCalls++;
      if (cookieCalls === 1) return [{ name: 'login_aliyunid_ticket', value: 'ticket_antigo' }];
      return [{ name: 'login_aliyunid_ticket', value: 'ticket_renovado' }];
    }
  };
  const result = await waitForManualLogin({
    context,
    page,
    timeoutMs: 1000,
    sleep: async () => {}
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.hasTicket, true);
});

test('manual-login - waitForManualLogin aborta em janela fechada, timeout e erro de cookies', async () => {
  await assert.rejects(
    waitForManualLogin({
      context: { cookies: async () => [] },
      page: { isClosed: () => true },
      timeoutMs: 1000
    }),
    (err) => err instanceof ManualLoginError && /fechada/.test(err.message)
  );

  await assert.rejects(
    waitForManualLogin({
      context: { cookies: async () => [] },
      page: null,
      timeoutMs: 0,
      now: () => 0
    }),
    ManualLoginTimeoutError
  );

  await assert.rejects(
    waitForManualLogin({
      context: {
        cookies: async () => {
          throw new Error('contexto morto');
        }
      },
      page: null,
      timeoutMs: 1000
    }),
    (err) => err instanceof ManualLoginError && /contexto morto/.test(err.message)
  );
});

test('manual-login - performManualLogin abre janela, salva com freshLogin e fecha', async () => {
  let launchOptions = null;
  let closed = 0;
  let saved = null;
  const context = makeContext();
  const browser = {
    close: async () => {
      closed++;
    }
  };

  const result = await performManualLogin({
    config: {
      ALI_USER: 'user@example.com',
      MANUAL_LOGIN_TIMEOUT_MS: 1234,
      MANUAL_LOGIN_CONTEXT: 'mobile',
      NAV_TIMEOUT: 999
    },
    sessionOpts: { baseDir: '/tmp/ali-coins-manual-test' },
    account: { user: 'user@example.com', maskedUser: 'us***@example.com' },
    deps: {
      launch: async (options) => {
        launchOptions = options;
        return browser;
      },
      createMobileContext: async (b, storageState, options) => {
        assert.strictEqual(b, browser);
        assert.strictEqual(storageState, null);
        assert.strictEqual(options.allowMedia, true);
        return context;
      },
      goto: async (page, url, options) => {
        assert.strictEqual(page, context.page);
        assert.ok(url.includes('coin-index'));
        assert.strictEqual(options.timeout, 999);
      },
      waitForLogin: async ({ context: ctx, page, timeoutMs }) => {
        assert.strictEqual(ctx, context);
        assert.strictEqual(page, context.page);
        assert.strictEqual(timeoutMs, 1234);
      },
      save: async (storage, user, options) => {
        saved = { storage, user, options };
        return { sessionData: storage, metaData: { user } };
      },
      writeLog: noopLog
    }
  });

  assert.strictEqual(launchOptions.headless, false);
  assert.strictEqual(closed, 1, 'janela temporária deve ser fechada');
  assert.strictEqual(result.reusedContext, false);
  assert.deepStrictEqual(result.sessionData, saved.storage);
  assert.strictEqual(saved.user, 'user@example.com');
  assert.strictEqual(saved.options.freshLogin, true);
  assert.strictEqual(saved.options.baseDir, '/tmp/ali-coins-manual-test');
});

test('manual-login - performManualLogin usa contexto desktop por padrão (captcha com mouse)', async () => {
  let created = null;
  let targetUrl = null;
  let saved = null;
  const context = makeContext();

  const result = await performManualLogin({
    config: {
      ALI_USER: 'user@example.com',
      MANUAL_LOGIN_TIMEOUT_MS: 1000
    },
    account: { user: 'user@example.com' },
    deps: {
      launch: async () => ({ close: async () => {} }),
      createDesktopContext: async (b, storageState, options) => {
        created = { b, storageState, options };
        return context;
      },
      createMobileContext: async () => {
        throw new Error('não deve usar o contexto mobile por padrão');
      },
      goto: async (page, url) => {
        targetUrl = url;
      },
      waitForLogin: async () => {},
      save: async (storage, user) => {
        saved = { storage, user };
        return { sessionData: storage, metaData: { user } };
      },
      writeLog: noopLog
    }
  });

  assert.ok(created, 'createDesktopContext deve ser chamado');
  assert.strictEqual(created.storageState, null);
  assert.strictEqual(created.options.allowMedia, true);
  assert.ok(targetUrl.includes('coin-pc-index'), `URL desktop inesperada: ${targetUrl}`);
  assert.strictEqual(saved.user, 'user@example.com');
  assert.strictEqual(result.reusedContext, false);
});

test('manual-login - performManualLogin reaproveita a janela existente em HEADLESS=false', async () => {
  let launched = 0;
  let closed = 0;
  let saved = null;
  const page = makePage();
  const context = makeContext();

  const result = await performManualLogin({
    config: { MANUAL_LOGIN_TIMEOUT_MS: 1000 },
    account: { user: 'user@example.com' },
    existingPage: page,
    existingContext: context,
    deps: {
      launch: async () => {
        launched++;
        return { close: async () => {} };
      },
      save: async (storage, user, options) => {
        saved = { user, options };
        return { sessionData: storage, metaData: { user } };
      },
      waitForLogin: async ({ page: waitedPage }) => {
        assert.strictEqual(waitedPage, page);
      },
      writeLog: noopLog
    }
  });

  assert.strictEqual(launched, 0, 'não abre um segundo navegador');
  assert.strictEqual(closed, 0);
  assert.strictEqual(result.reusedContext, true);
  assert.strictEqual(saved.options.freshLogin, true);
});

test('manual-login - performManualLogin falha se a sessão não puder ser salva', async () => {
  let closed = 0;
  await assert.rejects(
    performManualLogin({
      config: { MANUAL_LOGIN_TIMEOUT_MS: 1000, MANUAL_LOGIN_CONTEXT: 'mobile' },
      account: { user: 'user@example.com' },
      deps: {
        launch: async () => ({
          close: async () => {
            closed++;
          }
        }),
        createMobileContext: async () => makeContext(),
        save: async () => null,
        goto: async () => {},
        waitForLogin: async () => {},
        writeLog: noopLog
      }
    }),
    ManualLoginError
  );
  assert.strictEqual(closed, 1, 'navegador deve ser fechado mesmo em falha');
});

test('manual-login - performManualLogin fecha o navegador quando a espera falha', async () => {
  let closed = 0;
  await assert.rejects(
    performManualLogin({
      config: { MANUAL_LOGIN_TIMEOUT_MS: 1000, MANUAL_LOGIN_CONTEXT: 'mobile' },
      account: { user: 'user@example.com' },
      deps: {
        launch: async () => ({
          close: async () => {
            closed++;
          }
        }),
        createMobileContext: async () => makeContext(),
        save: async () => ({ sessionData: {} }),
        goto: async () => {},
        waitForLogin: async () => {
          throw new ManualLoginError('janela fechada');
        },
        writeLog: noopLog
      }
    }),
    /janela fechada/
  );
  assert.strictEqual(closed, 1);
});

test('manual-login - performManualLogin exige conta identificada', async () => {
  await assert.rejects(
    performManualLogin({ config: {}, account: null, deps: { writeLog: noopLog } }),
    (err) => err instanceof ManualLoginError && /Conta não identificada/.test(err.message)
  );
});
