const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  isCaptchaCooldownActive,
  recordCaptchaChallenge,
  getCaptchaCooldown,
  clearCaptchaChallenge,
  saveSession
} = require('../libs/session');
const {
  buildMessage,
  shouldNotifyCaptchaFailure,
  shouldSendConsolidatedCaptcha
} = require('../libs/notify');
const { exportSession } = require('../export_session');
const { importSession } = require('../import_session');
const { checkCaptchaCooldownForLogin } = require('../collect');

test('libs/session.js - isCaptchaCooldownActive respeita a janela de horas', () => {
  const now = new Date('2026-09-24T12:00:00Z');

  assert.strictEqual(isCaptchaCooldownActive(null, 12, now), false, 'sem registro: sem cooldown');
  assert.strictEqual(isCaptchaCooldownActive('', 12, now), false);
  assert.strictEqual(
    isCaptchaCooldownActive('2026-09-24T11:00:00Z', 12, now),
    true,
    '1h atrás com janela de 12h: em cooldown'
  );
  assert.strictEqual(
    isCaptchaCooldownActive('2026-09-23T23:00:00Z', 12, now),
    false,
    '13h atrás: janela expirada'
  );
  assert.strictEqual(
    isCaptchaCooldownActive('2026-09-24T11:00:00Z', 0, now),
    false,
    '0 horas desliga o cooldown'
  );
  assert.strictEqual(isCaptchaCooldownActive('data-invalida', 12, now), false);
});

test('libs/session.js - recordCaptchaChallenge + getCaptchaCooldown (meta da conta)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-coins-captcha-'));
  try {
    const sessionPath = path.join(tmp, 'session_x.json');
    const metaPath = path.join(tmp, 'session_meta_x.json');
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ user: 'x@example.com', lastStreakDays: 7 }),
      'utf-8'
    );

    const at = new Date('2026-09-24T10:00:00Z');
    const meta = await recordCaptchaChallenge(
      { baseDir: tmp, sessionPath, sessionMetaPath: metaPath },
      at
    );
    assert.strictEqual(meta.lastCaptchaAt, at.toISOString());
    assert.strictEqual(meta.lastStreakDays, 7, 'campos existentes do meta são preservados');

    const now = new Date('2026-09-24T15:00:00Z'); // 5h depois
    const cooldown = await getCaptchaCooldown(
      { baseDir: tmp, sessionPath, sessionMetaPath: metaPath },
      12,
      now
    );
    assert.strictEqual(cooldown.active, true);
    assert.strictEqual(cooldown.lastCaptchaAt, at.toISOString());
    assert.strictEqual(cooldown.until, new Date('2026-09-24T22:00:00Z').toISOString());

    const after = new Date('2026-09-25T01:00:00Z'); // 15h depois
    const expired = await getCaptchaCooldown(
      { baseDir: tmp, sessionPath, sessionMetaPath: metaPath },
      12,
      after
    );
    assert.strictEqual(expired.active, false);
    assert.strictEqual(expired.until, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('libs/notify.js - evento captcha_cooldown_released avisa que o login será retomado', () => {
  const msg = buildMessage({
    event: 'captcha_cooldown_released',
    hostname: 'test-host',
    report: { type: 'unified_report', user: 'x***@example.com' }
  });
  assert.ok(msg.includes('Cooldown pós-captcha liberado'));
  assert.ok(msg.includes('x***@example.com'));
  assert.ok(msg.includes('voltará a tentar o login'));
});

test('libs/notify.js - dedupe: só o captcha inédito notifica; cooldown repetido silencia', () => {
  const first = new Error(
    'Falha de autenticação no AliExpress (desafio de segurança não superado).'
  );
  first.isCaptchaChallenge = true;
  assert.strictEqual(shouldNotifyCaptchaFailure(first), true, 'captcha inédito deve notificar');

  const cooldown = new Error('Login pausado pelo cooldown pós-captcha (...)');
  cooldown.isCaptchaChallenge = true;
  cooldown.isCaptchaCooldown = true;
  assert.strictEqual(
    shouldNotifyCaptchaFailure(cooldown),
    false,
    'bloqueio repetido pelo cooldown NÃO deve notificar'
  );

  assert.strictEqual(shouldNotifyCaptchaFailure(new Error('outra falha')), false);
  assert.strictEqual(shouldNotifyCaptchaFailure(null), false);

  // Consolidado: silencia quando o evento é captcha e nenhuma falha é inédita.
  assert.strictEqual(
    shouldSendConsolidatedCaptcha({ multiEvent: 'captcha_required', anyCaptchaFirstTime: false }),
    false
  );
  assert.strictEqual(
    shouldSendConsolidatedCaptcha({ multiEvent: 'captcha_required', anyCaptchaFirstTime: true }),
    true
  );
  assert.strictEqual(
    shouldSendConsolidatedCaptcha({ multiEvent: 'failure', anyCaptchaFirstTime: false }),
    true,
    'outros eventos não são silenciados'
  );
});

test('collect.js - checkCaptchaCooldownForLogin bloqueia o login dentro da janela', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-coins-block-'));
  try {
    const sessionPath = path.join(tmp, 'session_x.json');
    const metaPath = path.join(tmp, 'session_meta_x.json');
    const sessionOpts = {
      baseDir: tmp,
      sessionPath,
      sessionMetaPath: metaPath,
      account: { user: 'x@example.com' }
    };

    // Sem registro de captcha → não bloqueia
    const none = await checkCaptchaCooldownForLogin(sessionOpts, 12);
    assert.strictEqual(none.blocked, false);

    // Registro recente → bloqueia (regressão: sem await, `active` vinha undefined e
    // o login era tentado mesmo dentro da janela)
    await recordCaptchaChallenge(sessionOpts, new Date());
    const blocked = await checkCaptchaCooldownForLogin(sessionOpts, 12);
    assert.strictEqual(blocked.blocked, true, 'cooldown ativo deve bloquear o login');
    assert.ok(blocked.cooldown.until, 'deve informar quando a janela libera');

    // --force ignora a pausa e permite a tentativa (execução forçada)
    const forced = await checkCaptchaCooldownForLogin(sessionOpts, 12, { force: true });
    assert.strictEqual(forced.blocked, false, '--force deve ignorar o cooldown');
    assert.strictEqual(forced.forced, true);
    assert.ok(forced.cooldown.active, 'o cooldown continua existindo (apenas ignorado)');

    // Meta inexistente + account: cria o meta já com o user (após limpeza da sessão)
    const freshMetaPath = path.join(tmp, 'session_meta_y.json');
    const meta = await recordCaptchaChallenge({
      baseDir: tmp,
      sessionPath,
      sessionMetaPath: freshMetaPath,
      account: { user: 'y@example.com' }
    });
    assert.strictEqual(meta.user, 'y@example.com', 'user preservado/criado no meta');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('libs/session.js - clearCaptchaChallenge remove o marcador preservando o meta', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-coins-clear-captcha-'));
  try {
    const sessionPath = path.join(tmp, 'session_x.json');
    const metaPath = path.join(tmp, 'session_meta_x.json');
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        user: 'x@example.com',
        lastStreakDays: 7,
        lastCaptchaAt: '2026-09-24T10:00:00Z'
      }),
      'utf-8'
    );

    const meta = await clearCaptchaChallenge({
      baseDir: tmp,
      sessionPath,
      sessionMetaPath: metaPath
    });
    assert.strictEqual(meta.lastCaptchaAt, undefined, 'marcador removido');
    assert.strictEqual(meta.lastStreakDays, 7, 'demais campos preservados');

    const cooldown = await getCaptchaCooldown(
      { baseDir: tmp, sessionPath, sessionMetaPath: metaPath },
      12
    );
    assert.strictEqual(cooldown.active, false);
    assert.strictEqual(cooldown.lastCaptchaAt, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('libs/notify.js - evento captcha_required tem mensagem dedicada com ação', () => {
  const msg = buildMessage({
    event: 'captcha_required',
    hostname: 'test-host',
    report: { type: 'unified_report', user: 'x***@example.com' },
    error: new Error('Falha de autenticação no AliExpress (desafio de segurança não superado).')
  });
  assert.ok(msg.includes('Desafio anti-bot (captcha)'));
  assert.ok(msg.includes('x***@example.com'));
  assert.ok(msg.includes('import_session.js'));
  assert.ok(msg.includes('CAPTCHA_COOLDOWN_HOURS'));

  // Consolidado multi-conta com captcha: lista as contas (formato da 1.5.4)
  const multi = buildMessage({
    event: 'captcha_required',
    hostname: 'test-host',
    report: {
      type: 'multi_account_report',
      accounts: [
        {
          user: 'a***@example.com',
          checkin: { streakDays: 5, totalBalance: '100' },
          meta: { finalBalance: '100 moedas' }
        },
        {
          user: 'b***@example.com',
          error: 'Falha de autenticação no AliExpress (desafio de segurança não superado).'
        }
      ],
      meta: { totalAccounts: 2, successfulAccounts: 1, totalDuration: '2m' }
    }
  });
  assert.ok(multi.includes('Multi-Conta (Captcha Solicitado)'));
  assert.ok(multi.includes('a***@example.com'));
  assert.ok(multi.includes('b***@example.com'));
  assert.ok(multi.includes('❌ Falha'));
});

test('libs/session.js - login novo (freshLogin) zera o cooldown pós-captcha', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-coins-fresh-'));
  try {
    const sessionPath = path.join(tmp, 'session_x.json');
    const metaPath = path.join(tmp, 'session_meta_x.json');
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        user: 'x@example.com',
        lastStreakDays: 7,
        lastCaptchaAt: '2026-09-24T10:00:00Z',
        isImported: true,
        importedAt: '2026-09-20T00:00:00Z'
      }),
      'utf-8'
    );

    await saveSession(
      { cookies: [{ name: 'xman_us_t', value: 'abc' }], origins: [] },
      'x@example.com',
      {
        baseDir: tmp,
        sessionPath,
        sessionMetaPath: metaPath,
        encryptLocalSession: false,
        freshLogin: true,
        streakDays: 5
      }
    );

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    assert.strictEqual(meta.lastCaptchaAt, undefined, 'desafio superado: cooldown zerado');
    assert.strictEqual(meta.isImported, undefined, 'marcadores de importação limpos');
    assert.strictEqual(meta.importedAt, undefined);
    assert.strictEqual(meta.lastStreakDays, 5, 'streak atualizado no login novo');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('import_session - importar sessão nova remove o cooldown do host', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-coins-import-'));
  const SECRET = 'x'.repeat(64);
  try {
    const originSession = path.join(tmp, 'session_a.json');
    const originMeta = path.join(tmp, 'session_meta_a.json');
    const tokenPath = path.join(tmp, 'session_token.txt');
    fs.writeFileSync(
      originSession,
      JSON.stringify({
        cookies: [{ name: 'xman_us_t', value: 'abc', domain: '.aliexpress.com', path: '/' }],
        origins: []
      }),
      'utf-8'
    );
    fs.writeFileSync(
      originMeta,
      JSON.stringify({ user: 'x@example.com', lastCaptchaAt: '2026-09-24T10:00:00Z' }),
      'utf-8'
    );

    await exportSession({
      baseDir: tmp,
      sessionPath: originSession,
      sessionMetaPath: originMeta,
      sessionTokenPath: tokenPath,
      secret: SECRET,
      expectedUser: 'x@example.com'
    });

    const targetSession = path.join(tmp, 'session_b.json');
    const targetMeta = path.join(tmp, 'session_meta_b.json');
    fs.writeFileSync(
      targetMeta,
      JSON.stringify({ user: 'x@example.com', lastCaptchaAt: '2026-09-24T09:00:00Z' }),
      'utf-8'
    );

    await importSession({
      fromFile: tokenPath,
      baseDir: tmp,
      sessionPath: targetSession,
      sessionMetaPath: targetMeta,
      secret: SECRET,
      encryptLocalSession: false
    });

    const meta = JSON.parse(fs.readFileSync(targetMeta, 'utf-8'));
    assert.strictEqual(meta.lastCaptchaAt, undefined, 'import limpa o cooldown');
    assert.strictEqual(meta.isImported, true, 'sessão importada marcada');

    const cooldown = await getCaptchaCooldown(
      { baseDir: tmp, sessionPath: targetSession, sessionMetaPath: targetMeta },
      12
    );
    assert.strictEqual(cooldown.active, false, 'nova tentativa de login permitida');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
