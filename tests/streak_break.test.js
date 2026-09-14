const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isStreakBreak } = require('../libs/report');
const { updateSessionStreak, saveSession, loadSessionFiles } = require('../libs/session');
const { buildMessage } = require('../libs/notify');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

test('libs/report.js - isStreakBreak detecta quebras reais e descarta falso-positivos', () => {
  // 1. Primeira execução ou dados ausentes: nunca é quebra
  assert.strictEqual(isStreakBreak(1, null), false, 'Sem histórico anterior (null) não é quebra');
  assert.strictEqual(
    isStreakBreak(1, undefined),
    false,
    'Sem histórico anterior (undefined) não é quebra'
  );
  assert.strictEqual(isStreakBreak(1, 0), false, 'Anterior 0 não é quebra');
  assert.strictEqual(isStreakBreak(1, 1), false, 'Anterior 1 não é quebra');
  assert.strictEqual(isStreakBreak(null, 100), false, 'Streak atual nulo não é quebra válida');
  assert.strictEqual(isStreakBreak(NaN, 100), false, 'Streak atual NaN não é quebra');
  assert.strictEqual(isStreakBreak(100, NaN), false, 'Streak anterior NaN não é quebra');

  // 2. Evolução normal ou estável
  assert.strictEqual(isStreakBreak(2, 1), false, '1 -> 2 é progressão normal');
  assert.strictEqual(isStreakBreak(100, 99), false, '99 -> 100 é progressão normal');
  assert.strictEqual(
    isStreakBreak(100, 100, true),
    false,
    '100 -> 100 com alreadyCollected é normal'
  );
  assert.strictEqual(
    isStreakBreak(100, 100, false),
    false,
    '100 -> 100 sem alreadyCollected é estável'
  );

  // 3. Quebra real (queda de streak)
  assert.strictEqual(isStreakBreak(1, 200), true, '200 -> 1 é quebra catastrófica de streak');
  assert.strictEqual(isStreakBreak(1, 15), true, '15 -> 1 é quebra de streak');
  assert.strictEqual(isStreakBreak(14, 15), true, '15 -> 14 é queda de streak');
  assert.strictEqual(
    isStreakBreak(1, 50, true),
    true,
    '50 -> 1 com alreadyCollected ainda é queda'
  );
});

test('libs/session.js - updateSessionStreak e saveSession persistem metadados de streak isoladamente', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('streak-test-');

  try {
    const fakeState = { cookies: [{ name: 'xman_us_t', value: 'token123' }] };

    // 1. Salva sessão inicial sem streak
    await saveSession(fakeState, 'user@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false
    });

    let loaded = await loadSessionFiles({ baseDir: tmpDir, encryptLocalSession: false });
    assert.strictEqual(loaded.metaData.user, 'user@example.com');
    assert.strictEqual(loaded.metaData.lastStreakDays, undefined);

    // 2. Atualiza streak para 45 dias de forma assíncrona
    const updatedMeta = await updateSessionStreak(45, { baseDir: tmpDir });
    assert.strictEqual(updatedMeta.lastStreakDays, 45);
    assert.ok(updatedMeta.lastCheckinDate, 'lastCheckinDate deve ser preenchido');
    assert.strictEqual(
      updatedMeta.user,
      'user@example.com',
      'Metadados anteriores como user devem ser preservados'
    );

    // 3. Verifica em disco
    const metaPath = path.join(tmpDir, 'session_meta.json');
    const onDiskMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert.strictEqual(onDiskMeta.lastStreakDays, 45);
    assert.strictEqual(onDiskMeta.user, 'user@example.com');

    // 4. Salva sessão novamente passando streakDays nas opções
    await saveSession(fakeState, 'user@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false,
      streakDays: 46
    });

    loaded = await loadSessionFiles({ baseDir: tmpDir, encryptLocalSession: false });
    assert.strictEqual(loaded.metaData.lastStreakDays, 46);
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/notify.js - formatação do evento streak_break no Telegram', () => {
  const hostname = 'server-prod-01';
  const report = {
    user: 'us***@example.com',
    previousStreakDays: 142,
    streakDays: 1,
    totalBalance: 5320
  };

  const message = buildMessage({
    event: 'streak_break',
    report,
    hostname
  });

  assert.ok(message.includes('🚨'), 'Deve conter ícone de alerta crítico');
  assert.ok(message.includes('STREAK QUEBRADO'), 'Deve conter o título STREAK QUEBRADO');
  assert.ok(message.includes('142 dias'), 'Deve exibir o streak anterior de ontem');
  assert.ok(
    message.includes('1 dias') || message.includes('1 dia'),
    'Deve exibir o streak atual de hoje'
  );
  assert.ok(message.includes('5320 moedas'), 'Deve exibir o saldo formatado');
  assert.ok(message.includes('us***@example.com'), 'Deve exibir o usuário mascarado');
  assert.ok(message.includes('server-prod-01'), 'Deve exibir o hostname');
});
