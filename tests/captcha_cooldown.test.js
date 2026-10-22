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

test('libs/session.js - cooldown de risco RGV587 usa 48h sobre o padrão', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-coins-risk-cd-'));
  try {
    const sessionPath = path.join(tmp, 'session_x.json');
    const metaPath = path.join(tmp, 'session_meta_x.json');
    const opts = { baseDir: tmp, sessionPath, sessionMetaPath: metaPath };

    const at = new Date('2026-10-13T12:00:00Z');
    const meta = await recordCaptchaChallenge(opts, at, {
      cooldownHours: 48,
      requireManualLogin: true
    });
    assert.strictEqual(meta.captchaCooldownHours, 48, 'horas custom gravadas no meta');
    assert.strictEqual(meta.captchaRiskControl, true, 'registro marcado como risco');
    assert.strictEqual(meta.captchaRequireManualLogin, true, 'gate manual gravado no meta');

    const now = new Date('2026-10-14T11:00:00Z'); // 23h depois: além do padrão de 12h
    const cd = await getCaptchaCooldown(opts, 12, now);
    assert.strictEqual(cd.active, true, '48h deve sobrepor o padrão de 12h');
    assert.strictEqual(cd.hours, 48, 'janela efetiva é 48h');
    assert.strictEqual(cd.riskControl, true, 'cooldown sinaliza risco');
    assert.strictEqual(cd.requireManualLogin, true, 'gate manual sinalizado');
    assert.strictEqual(cd.until, new Date('2026-10-15T12:00:00Z').toISOString());

    const after = new Date('2026-10-15T13:00:00Z');
    const expired = await getCaptchaCooldown(opts, 12, after);
    assert.strictEqual(expired.active, false, 'expira após as 48h');
    assert.strictEqual(
      expired.requireManualLogin,
      true,
      'gate manual permanece mesmo após a janela expirar'
    );

    await clearCaptchaChallenge(opts);
    const clearedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    assert.strictEqual(clearedMeta.captchaCooldownHours, undefined);
    assert.strictEqual(clearedMeta.captchaRiskControl, undefined);
    assert.strictEqual(clearedMeta.captchaRequireManualLogin, undefined);
    const cleared = await getCaptchaCooldown(opts, 12, now);
    assert.strictEqual(cleared.active, false);
    assert.strictEqual(cleared.riskControl, false);
    assert.strictEqual(cleared.requireManualLogin, false);

    // Registro sem horas custom → volta ao padrão (12h) e sem marcação de risco/gate
    await recordCaptchaChallenge(opts, at);
    const def = await getCaptchaCooldown(opts, 12, new Date('2026-10-13T18:00:00Z'));
    assert.strictEqual(def.hours, 12);
    assert.strictEqual(def.riskControl, false);
    assert.strictEqual(def.requireManualLogin, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collect.js - checkCaptchaCooldownForLogin sinaliza renovação manual após a janela', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ali-coins-manual-gate-'));
  try {
    const sessionPath = path.join(tmp, 'session_x.json');
    const metaPath = path.join(tmp, 'session_meta_x.json');
    const sessionOpts = {
      baseDir: tmp,
      sessionPath,
      sessionMetaPath: metaPath,
      account: { user: 'x@example.com' }
    };

    // Registro de risco há 49h (janela de 48h já expirou), mas com gate manual pendente
    const past = new Date(Date.now() - 49 * 3600 * 1000);
    await recordCaptchaChallenge(sessionOpts, past, {
      cooldownHours: 48,
      requireManualLogin: true
    });
    const r = await checkCaptchaCooldownForLogin(sessionOpts, 12);
    assert.strictEqual(r.cooldown.active, false, 'janela de 48h expirada');
    assert.strictEqual(r.manualRequired, true, 'gate manual permanece ativo até renovar a sessão');

    // --force continua sendo o override manual explícito
    const forced = await checkCaptchaCooldownForLogin(sessionOpts, 12, { force: true });
    assert.strictEqual(forced.manualRequired, true, 'gate continua sinalizado');
    assert.strictEqual(forced.blocked, false, '--force ignora a pausa');
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

test('libs/notify.js - evento risk_blocked avisa bloqueio por bot, tempo restante e coleta manual', () => {
  const until = new Date(Date.now() + 47 * 3600 * 1000).toISOString();
  const msg = buildMessage({
    event: 'risk_blocked',
    hostname: 'test-host',
    report: { type: 'unified_report', user: 'x***@example.com' },
    error: {
      isCaptchaChallenge: true,
      isCaptchaCooldown: true,
      isRiskControl: true,
      cooldownHours: 48,
      cooldownUntil: until
    }
  });
  assert.ok(msg.includes('bloqueou a conta por suspeita de uso de bot'), 'avisa o bloqueio');
  assert.ok(msg.includes('RGV587'), 'cita o código do bloqueio');
  assert.ok(msg.includes('48h'), 'informa o cooldown de 48h');
  assert.ok(msg.includes('Tempo restante'), 'informa quanto falta do cooldown');
  assert.ok(msg.includes('coleta manual'), 'lembra a coleta manual');
  assert.ok(msg.includes('x***@example.com'), 'identifica a conta');

  // Multi-conta: lista as contas afetadas pelo bloqueio
  const multi = buildMessage({
    event: 'risk_blocked',
    hostname: 'test-host',
    report: {
      type: 'multi_account_report',
      accounts: [
        {
          user: 'a***@example.com',
          error: 'Login rejeitado pelo controle de risco',
          riskControl: true,
          riskCooldownHours: 48,
          riskCooldownUntil: until
        },
        {
          user: 'b***@example.com',
          error: 'Login rejeitado pelo controle de risco',
          riskControl: true,
          riskCooldownHours: 48,
          riskCooldownUntil: until
        }
      ],
      meta: { totalAccounts: 2, successfulAccounts: 0 }
    }
  });
  assert.ok(multi.includes('a***@example.com'));
  assert.ok(multi.includes('b***@example.com'));
  assert.ok(multi.includes('Tempo restante'));
});

test('libs/notify.js - evento manual_login_required instrui login local, captcha e export/import', () => {
  const msg = buildMessage({
    event: 'manual_login_required',
    hostname: 'test-host',
    report: { type: 'unified_report', user: 'x***@example.com' },
    error: {
      isManualLoginRequired: true,
      cooldownHours: 48,
      cooldownUntil: new Date(Date.now() - 3600 * 1000).toISOString()
    }
  });
  assert.ok(msg.includes('Login remoto suspenso'), 'avisa a suspensão');
  assert.ok(msg.includes('na máquina local'), 'instrui o login local');
  assert.ok(msg.includes('captcha'), 'manda resolver o captcha se existir');
  assert.ok(msg.includes('export_session.js'), 'manda exportar a sessão');
  assert.ok(msg.includes('import_session.js'), 'manda importar a sessão');
  assert.ok(msg.includes('só voltará a executar'), 'explica quando a automação volta');
  assert.ok(msg.includes('x***@example.com'), 'identifica a conta');
  assert.ok(msg.includes('Cooldown encerrado em'), 'cooldown passado aparece como encerrado');

  // Cooldown ainda em curso: a mensagem não deve dizer que "encerrou"
  const futuro = buildMessage({
    event: 'manual_login_required',
    hostname: 'test-host',
    report: { type: 'unified_report', user: 'x***@example.com' },
    error: {
      isManualLoginRequired: true,
      cooldownHours: 48,
      cooldownUntil: new Date(Date.now() + 2 * 3600 * 1000).toISOString()
    }
  });
  assert.ok(futuro.includes('Cooldown previsto até'), 'cooldown futuro aparece como previsto');
  assert.ok(!futuro.includes('Cooldown encerrado em'), 'não diz que encerrou antes da hora');

  const tentativa = buildMessage({
    event: 'manual_login_required',
    hostname: 'test-host',
    report: { type: 'unified_report', user: 'x***@example.com' },
    error: {
      isManualLoginRequired: true,
      manualAttempted: true
    }
  });
  assert.ok(
    tentativa.includes('tentativa de login manual em janela não foi concluída'),
    'distingue falha da tentativa manual do gate remoto'
  );
  assert.ok(tentativa.includes('Login manual necessário'), 'cabeçalho genérico sem RGV587');
  assert.ok(
    tentativa.includes('escolha a opção <b>2</b>'),
    'aponta o menu local como alternativa ao export/import'
  );
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
        captchaCooldownHours: 48,
        captchaRiskControl: true,
        captchaRequireManualLogin: true,
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
    assert.strictEqual(meta.captchaCooldownHours, undefined, 'cooldown custom (48h) removido');
    assert.strictEqual(meta.captchaRiskControl, undefined, 'marcação de risco removida');
    assert.strictEqual(meta.captchaRequireManualLogin, undefined, 'gate manual liberado');
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
      JSON.stringify({
        user: 'x@example.com',
        lastCaptchaAt: '2026-09-24T09:00:00Z',
        captchaCooldownHours: 48,
        captchaRiskControl: true,
        captchaRequireManualLogin: true
      }),
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
    assert.strictEqual(meta.captchaCooldownHours, undefined, 'import limpa o cooldown custom');
    assert.strictEqual(meta.captchaRiskControl, undefined, 'import limpa a marcação de risco');
    assert.strictEqual(meta.captchaRequireManualLogin, undefined, 'import libera o gate manual');
    assert.strictEqual(meta.isImported, true, 'sessão importada marcada');

    const cooldown = await getCaptchaCooldown(
      { baseDir: tmp, sessionPath: targetSession, sessionMetaPath: targetMeta },
      12
    );
    assert.strictEqual(cooldown.active, false, 'nova tentativa de login permitida');
    assert.strictEqual(cooldown.requireManualLogin, false, 'gate manual liberado pelo import');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
