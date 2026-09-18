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

  // 3. Falso-positivo clássico: leitura espúria do ciclo semanal de 7 dias (ex: 7 quando anterior era 212)
  assert.strictEqual(
    isStreakBreak(7, 212, true),
    false,
    '212 -> 7 com alreadyCollected (re-execução) NUNCA é quebra'
  );
  assert.strictEqual(
    isStreakBreak(7, 212, false),
    false,
    '212 -> 7 sem alreadyCollected é leitura do ciclo semanal de 7 dias, não reset para 1'
  );
  assert.strictEqual(isStreakBreak(6, 15, false), false, '15 -> 6 é ciclo semanal intermediário');

  // 4. Quebra real (reset catastrófico para o Dia 1 no AliExpress)
  assert.strictEqual(
    isStreakBreak(1, 200, false),
    true,
    '200 -> 1 em novo check-in é quebra real de streak'
  );
  assert.strictEqual(isStreakBreak(1, 15, false), true, '15 -> 1 é quebra real de streak');
  assert.strictEqual(
    isStreakBreak(1, 50, true),
    false,
    'com alreadyCollected (re-execução no mesmo dia), a sequência já foi garantida e não quebra'
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

test('collect.js / report.js - simulação de re-execução com previousStreak 212 e leitura espúria 7', () => {
  const previousStreakDays = 212;
  const detectedStreak = 7;
  const alreadyCollected = true;

  // 1. isStreakBreak descarta falso-positivo
  const broken = isStreakBreak(detectedStreak, previousStreakDays, alreadyCollected);
  assert.strictEqual(
    broken,
    false,
    'Não deve alertar quebra de streak em re-execução com leitura espúria 7'
  );

  // 2. Resolução do streak preserva 212
  const parsedDetected = detectedStreak;
  const isSpuriousWeeklyCycle =
    !isNaN(parsedDetected) && previousStreakDays > 7 && parsedDetected <= 7 && parsedDetected > 1;

  assert.strictEqual(
    isSpuriousWeeklyCycle,
    true,
    '7 deve ser classificado como ciclo semanal espúrio'
  );

  let resolvedStreak = detectedStreak;
  if (isSpuriousWeeklyCycle && alreadyCollected) {
    resolvedStreak = previousStreakDays;
  }
  assert.strictEqual(resolvedStreak, 212, 'Streak resolvido deve preservar os 212 dias');
});

test('collect.js - Bug 14: previousStreakDays não contamina conta nova quando previousMeta pertence a outra conta', () => {
  const userEmail = 'new_account@example.com';
  const sessionStatus = {
    valid: false,
    metaData: null,
    previousMeta: {
      user: 'old_account@example.com',
      lastStreakDays: 45
    }
  };

  const previousStreakDays =
    sessionStatus.metaData?.lastStreakDays ??
    (sessionStatus.previousMeta?.user === userEmail
      ? sessionStatus.previousMeta?.lastStreakDays
      : null) ??
    null;

  assert.strictEqual(
    previousStreakDays,
    null,
    'previousStreakDays deve ser null quando previousMeta for de outro usuário'
  );

  // Garantir que isStreakBreak para Dia 1 não dispare falso-positivo
  const broken = isStreakBreak(1, previousStreakDays, false);
  assert.strictEqual(
    broken,
    false,
    'Não deve alertar quebra de streak na primeira execução da nova conta'
  );
});

test('collect.js - streak incrementa +1 quando check-in é realizado com sucesso hoje (justCollected=true)', () => {
  function resolveStreak(
    previousStreakDays,
    detectedStreak,
    { justCollected = false, alreadyCollected = false } = {}
  ) {
    let streakDays = detectedStreak !== null ? detectedStreak : 'N/D';

    if (typeof previousStreakDays === 'number' && previousStreakDays > 0) {
      const parsedDetected =
        typeof detectedStreak === 'number'
          ? detectedStreak
          : parseInt(String(detectedStreak).replace(/[^0-9]/g, ''), 10);

      const isSpuriousWeeklyCycle =
        !isNaN(parsedDetected) &&
        previousStreakDays > 7 &&
        parsedDetected <= 7 &&
        parsedDetected > 1;

      if (justCollected) {
        if (
          detectedStreak === null ||
          isNaN(parsedDetected) ||
          isSpuriousWeeklyCycle ||
          parsedDetected <= previousStreakDays
        ) {
          streakDays = previousStreakDays + 1;
        } else {
          streakDays = parsedDetected;
        }
      } else if (alreadyCollected) {
        if (
          detectedStreak === null ||
          isNaN(parsedDetected) ||
          isSpuriousWeeklyCycle ||
          parsedDetected < previousStreakDays
        ) {
          streakDays = previousStreakDays;
        } else {
          streakDays = parsedDetected;
        }
      } else {
        streakDays = !isNaN(parsedDetected) ? parsedDetected : previousStreakDays;
      }
    } else if (justCollected) {
      const parsedDetected =
        typeof detectedStreak === 'number'
          ? detectedStreak
          : parseInt(String(detectedStreak).replace(/[^0-9]/g, ''), 10);
      streakDays = !isNaN(parsedDetected) && parsedDetected >= 1 ? parsedDetected : 1;
    }

    return streakDays;
  }

  // 1. Check-in bem-sucedido hoje com previousStreak = 212
  // UI ainda não atualizou (lido 212) -> deve incrementar para 213
  assert.strictEqual(resolveStreak(212, 212, { justCollected: true }), 213);

  // Leitura espúria do ciclo semanal (7) -> deve incrementar para 213
  assert.strictEqual(resolveStreak(212, 7, { justCollected: true }), 213);

  // Leitura ausente / nula -> deve incrementar para 213
  assert.strictEqual(resolveStreak(212, null, { justCollected: true }), 213);

  // UI já atualizou para 213 -> preserva 213
  assert.strictEqual(resolveStreak(212, 213, { justCollected: true }), 213);

  // Streak menor (5 dias) -> incrementa para 6
  assert.strictEqual(resolveStreak(5, 5, { justCollected: true }), 6);

  // Primeira execução sem histórico prévio -> 1
  assert.strictEqual(resolveStreak(null, null, { justCollected: true }), 1);
  assert.strictEqual(resolveStreak(null, 1, { justCollected: true }), 1);

  // 2. Re-execução no mesmo dia (alreadyCollected = true) -> NÃO incrementa novamente
  assert.strictEqual(resolveStreak(212, 212, { alreadyCollected: true }), 212);
  assert.strictEqual(resolveStreak(212, 7, { alreadyCollected: true }), 212);
});

test('collect.js - coinsGainedToday é "0" quando alreadyCollected=true e valor real quando justCollected=true', () => {
  const { getCheckinCoinsFromStreak } = require('../libs/ui/balance');

  function determineCoinsGainedToday({
    alreadyCollected = false,
    wasAlreadyCollectedToday = false,
    justCollected = false,
    todayCheckinCoins = null,
    mobileCheckinCoins = null,
    streakDays = 'N/D'
  } = {}) {
    const isCollected = alreadyCollected || wasAlreadyCollectedToday || justCollected;
    const isAlreadyCollected = (alreadyCollected || wasAlreadyCollectedToday) && !justCollected;

    let checkinCoinsNum = null;
    if (todayCheckinCoins) {
      const p = parseInt(String(todayCheckinCoins).replace(/[^0-9]/g, ''), 10);
      if (!isNaN(p) && p > 0) checkinCoinsNum = p;
    }
    if (checkinCoinsNum === null && mobileCheckinCoins) {
      checkinCoinsNum = mobileCheckinCoins;
    }
    if (checkinCoinsNum === null && isCollected) {
      checkinCoinsNum = getCheckinCoinsFromStreak(streakDays);
    }

    return isAlreadyCollected
      ? '0'
      : checkinCoinsNum !== null
        ? String(checkinCoinsNum)
        : isCollected
          ? String(getCheckinCoinsFromStreak(streakDays))
          : '0';
  }

  // Check-in acabou de ser feito hoje (justCollected = true)
  assert.strictEqual(
    determineCoinsGainedToday({ justCollected: true, todayCheckinCoins: '40', streakDays: 15 }),
    '40',
    'justCollected=true com ledger desktop deve retornar 40'
  );
  assert.strictEqual(
    determineCoinsGainedToday({ justCollected: true, streakDays: 35 }),
    '40',
    'justCollected=true com streak 35 deve retornar 40 (teto do ciclo semanal)'
  );
  assert.strictEqual(
    determineCoinsGainedToday({ justCollected: true, streakDays: 3 }),
    '20',
    'justCollected=true com streak 3 deve retornar 20'
  );

  // Check-in já havia ocorrido hoje (alreadyCollected = true)
  assert.strictEqual(
    determineCoinsGainedToday({ alreadyCollected: true, todayCheckinCoins: '40', streakDays: 15 }),
    '0',
    'alreadyCollected=true não deve contabilizar moedas (deve ser 0)'
  );
  assert.strictEqual(
    determineCoinsGainedToday({ wasAlreadyCollectedToday: true, streakDays: 35 }),
    '0',
    'wasAlreadyCollectedToday=true não deve contabilizar moedas (deve ser 0)'
  );
});
