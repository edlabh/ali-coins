const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  isCaptchaCooldownActive,
  recordCaptchaChallenge,
  getCaptchaCooldown,
  clearCaptchaChallenge
} = require('../libs/session');
const {
  buildMessage,
  shouldNotifyCaptchaFailure,
  shouldSendConsolidatedCaptcha
} = require('../libs/notify');

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
