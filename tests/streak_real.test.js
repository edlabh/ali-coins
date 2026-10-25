const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseCheckinCalendar, isRealStreakReading } = require('../libs/ui/balance');
const { resolveStreakDays } = require('../libs/report');
const { updateSessionStreak, saveSession } = require('../libs/session');
const { buildMessage } = require('../libs/notify');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

// Trechos reais do innerText da central de moedas mobile (out/2026), com a sequência
// real do AliExpress contada no calendário "Daily coins".
const CALENDAR_LONG = [
  'worth R$199,89',
  'Daily coins',
  'Earn more >',
  'Day 38',
  '✓',
  '+40',
  'Day 39',
  '✓',
  '+40',
  'Today',
  '✓',
  '+40',
  'Tomorrow',
  '40',
  'Worth R$2,18',
  'Day 42',
  '40',
  'Day 43',
  '40',
  'Day 44',
  '40',
  'Day 45',
  '40',
  'Day 46',
  '40',
  '40',
  '40',
  'days streak'
].join('\n');

const CALENDAR_AFTER_RESET = [
  'Daily coins',
  'Day 4',
  '✓',
  '+1',
  'Day 5',
  '✓',
  '+1',
  'Today',
  '✓',
  '+1',
  'Tomorrow',
  '1',
  'Day 8',
  '1',
  'Day 9',
  '1',
  'Day 10',
  '1',
  'Day 11',
  '1',
  'Day 12',
  '1',
  '6',
  '6',
  'days streak'
].join('\n');

// Sequência recém-iniciada: "Today" é o primeiro slot da janela.
const CALENDAR_DAY_ONE = [
  'Daily coins',
  'Today',
  '✓',
  '+10',
  'Tomorrow',
  '15',
  'Day 3',
  '20',
  'Day 4',
  '25',
  'Day 5',
  '30',
  'Day 6',
  '35',
  'Day 7',
  '40',
  'Day 8',
  '40',
  'Day 9',
  '40'
].join('\n');

// Layout antigo de ciclo semanal: nunca passa de "Day 7".
const CALENDAR_WEEKLY_CYCLE = [
  'Daily coins',
  'Day 1',
  '✓',
  'Day 2',
  '✓',
  'Day 3',
  '✓',
  'Today',
  '✓',
  'Tomorrow',
  'Day 6',
  'Day 7'
].join('\n');

test('balance.js - parseCheckinCalendar lê o dia de HOJE e o maior rótulo do calendário', () => {
  assert.deepStrictEqual(parseCheckinCalendar(CALENDAR_LONG), { todayDay: 40, maxDay: 46 });
  assert.deepStrictEqual(parseCheckinCalendar(CALENDAR_AFTER_RESET), { todayDay: 6, maxDay: 12 });
  assert.deepStrictEqual(parseCheckinCalendar(CALENDAR_DAY_ONE), { todayDay: 1, maxDay: 9 });
  assert.deepStrictEqual(parseCheckinCalendar(CALENDAR_WEEKLY_CYCLE), { todayDay: 4, maxDay: 7 });

  // Rótulos em português (locale pt-BR)
  const pt = CALENDAR_AFTER_RESET.replace(/Day /g, 'Dia ')
    .replace('Today', 'Hoje')
    .replace('Tomorrow', 'Amanhã');
  assert.deepStrictEqual(parseCheckinCalendar(pt), { todayDay: 6, maxDay: 12 });

  // Sem calendário / entrada inválida
  assert.strictEqual(parseCheckinCalendar(''), null);
  assert.strictEqual(parseCheckinCalendar(null), null);
  assert.strictEqual(parseCheckinCalendar('Coins\n100\nFor you'), null);
});

test('balance.js - isRealStreakReading só confia em calendário sem ciclo semanal e coerente', () => {
  const long = parseCheckinCalendar(CALENDAR_LONG);
  const reset = parseCheckinCalendar(CALENDAR_AFTER_RESET);
  const cycle = parseCheckinCalendar(CALENDAR_WEEKLY_CYCLE);

  assert.strictEqual(isRealStreakReading(40, long), true);
  assert.strictEqual(isRealStreakReading('40', long), true, 'aceita string numérica');
  assert.strictEqual(isRealStreakReading(6, reset), true, 'sequência curta também é real');
  assert.strictEqual(isRealStreakReading(39, long), false, 'leitura divergente do calendário');
  assert.strictEqual(isRealStreakReading(4, cycle), false, 'ciclo semanal nunca é confiável');
  assert.strictEqual(isRealStreakReading(6, null), false, 'sem calendário');
  assert.strictEqual(isRealStreakReading(null, reset), false);
  assert.strictEqual(isRealStreakReading('N/D', reset), false);
});

test('report.js - resolveStreakDays: leitura confiável prevalece sobre o histórico (quebra real)', () => {
  // Caso real da conta secundária: 11 dias bloqueada, o AliExpress zerou a sequência, o
  // contador local seguiu em 27 e a tela leu 6. Antes: 28 (27 + 1). Agora: 6.
  const trusted = resolveStreakDays({
    detectedStreak: 6,
    previousStreakDays: 27,
    justCollected: true,
    trustDetected: true
  });
  assert.strictEqual(trusted.streakDays, 6);
  assert.strictEqual(trusted.baseStreak, 27);

  // Sem a confiança (layout antigo / calendário ausente) o comportamento anterior é mantido
  const legacy = resolveStreakDays({
    detectedStreak: 6,
    previousStreakDays: 27,
    justCollected: true
  });
  assert.strictEqual(legacy.streakDays, 28);

  // Já coletado hoje e confiável: preserva a leitura (não volta ao histórico)
  assert.strictEqual(
    resolveStreakDays({
      detectedStreak: 6,
      previousStreakDays: 27,
      alreadyCollected: true,
      trustDetected: true
    }).streakDays,
    6
  );

  // Progressão normal continua igual
  assert.strictEqual(
    resolveStreakDays({
      detectedStreak: 40,
      previousStreakDays: 39,
      justCollected: true,
      trustDetected: true
    }).streakDays,
    40
  );

  // trustDetected sem leitura numérica cai no caminho antigo
  assert.strictEqual(
    resolveStreakDays({
      detectedStreak: null,
      previousStreakDays: 27,
      justCollected: true,
      trustDetected: true
    }).streakDays,
    28
  );
});

test('session.js - longestStreakDays guarda o recorde e não é semeado por lastStreakDays', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('streak-record-');

  try {
    const fakeState = { cookies: [{ name: 'xman_us_t', value: 'token123' }] };
    await saveSession(fakeState, 'user@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false
    });
    const metaPath = path.join(tmpDir, 'session_meta.json');

    // Meta legado com contador inflado, sem recorde: o recorde nasce do valor atual
    const legacy = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    legacy.lastStreakDays = 28;
    fs.writeFileSync(metaPath, JSON.stringify(legacy));

    let meta = await updateSessionStreak(6, { baseDir: tmpDir });
    assert.strictEqual(meta.lastStreakDays, 6);
    assert.strictEqual(meta.longestStreakDays, 6, 'não herda os 28 inflados');

    // Sequência cresce: recorde acompanha
    meta = await updateSessionStreak(9, { baseDir: tmpDir });
    assert.strictEqual(meta.longestStreakDays, 9);

    // Quebra: sequência atual cai, recorde permanece
    meta = await updateSessionStreak(1, { baseDir: tmpDir });
    assert.strictEqual(meta.lastStreakDays, 1);
    assert.strictEqual(meta.longestStreakDays, 9);

    // saveSession com streakDays também respeita o recorde
    await saveSession(fakeState, 'user@example.com', {
      baseDir: tmpDir,
      encryptLocalSession: false,
      streakDays: 3
    });
    const onDisk = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert.strictEqual(onDisk.lastStreakDays, 3);
    assert.strictEqual(onDisk.longestStreakDays, 9);
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('notify.js - Telegram mostra a maior sequência (multi-conta e conta única)', () => {
  const multi = buildMessage({
    event: 'success',
    report: {
      type: 'multi_account_report',
      accounts: [
        {
          user: 'le***@gmail.com',
          checkin: {
            alreadyCollected: false,
            coinsGainedToday: '40',
            streakDays: 40,
            longestStreakDays: 40,
            totalBalance: '3667',
            duration: '1m'
          },
          tasks: null,
          meta: { finalBalance: '3667 moedas', totalCoinsGained: 96, checkinCoinsGained: 40 }
        },
        {
          user: 'mi***@hotmail.com',
          checkin: {
            alreadyCollected: false,
            coinsGainedToday: '1',
            streakDays: 6,
            longestStreakDays: 23,
            totalBalance: '1634',
            duration: '1m'
          },
          tasks: null,
          meta: { finalBalance: '1634 moedas', totalCoinsGained: 57, checkinCoinsGained: 1 }
        }
      ]
    }
  });
  assert.match(multi, /Streak: 40 dias \(recorde: 40 dias\)/);
  assert.match(multi, /Streak: 6 dias \(recorde: 23 dias\)/);

  const single = buildMessage({
    event: 'success',
    report: {
      type: 'unified_report',
      user: 'le***@gmail.com',
      checkin: {
        alreadyCollected: false,
        coinsGainedToday: '40',
        streakDays: 40,
        longestStreakDays: 41,
        totalBalance: '3667',
        duration: '1m'
      },
      tasks: null,
      meta: { finalBalance: '3667 moedas', totalCoinsGained: 40, checkinCoinsGained: 40 }
    }
  });
  assert.match(single, /📅 Sequência: 40 dias/);
  assert.match(single, /🏆 Maior sequência: 41 dias/);

  // Sem recorde conhecido, nada muda no texto
  const legacy = buildMessage({
    event: 'success',
    report: {
      type: 'unified_report',
      user: 'le***@gmail.com',
      checkin: {
        alreadyCollected: false,
        coinsGainedToday: '40',
        streakDays: 40,
        totalBalance: '3667',
        duration: '1m'
      },
      tasks: null,
      meta: { finalBalance: '3667 moedas', totalCoinsGained: 40, checkinCoinsGained: 40 }
    }
  });
  assert.doesNotMatch(legacy, /Maior sequência/);
});
