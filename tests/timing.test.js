const test = require('node:test');
const assert = require('node:assert/strict');
const { startAccountTimer, finishAccountTimer } = require('../libs/timing');
const { buildUnifiedReportPayload, buildMultiAccountReportPayload } = require('../libs/report');
const { buildMessage } = require('../libs/notify');
const { formatDuration } = require('../time_utils');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('libs/timing.js - startAccountTimer calcula duração determinística com datas mockadas (90s -> 1m 30s)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const t0 = new Date('2026-09-17T10:00:00.000Z');
    const t90s = new Date('2026-09-17T10:01:30.000Z');

    const timer = startAccountTimer(t0);
    assert.strictEqual(timer.startTime.getTime(), t0.getTime());

    const result = timer.end(t90s);
    assert.strictEqual(result.startTime.getTime(), t0.getTime());
    assert.strictEqual(result.endTime.getTime(), t90s.getTime());
    assert.strictEqual(result.duration, '1m 30s');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/timing.js - startAccountTimer aceita label e customEndTime para mocks em testes', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const t0 = new Date('2026-09-17T10:00:00.000Z');
    const t45s = new Date('2026-09-17T10:00:45.000Z');

    const timer = startAccountTimer(t0);
    const result = timer.end('lock', t45s);

    assert.strictEqual(result.startTime.getTime(), t0.getTime());
    assert.strictEqual(result.endTime.getTime(), t45s.getTime());
    assert.strictEqual(result.duration, '45s');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/timing.js - idempotência: chamadas subsequentes a end() retornam o mesmo resultado gravado', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const t0 = new Date('2026-09-17T10:00:00.000Z');
    const tFirstEnd = new Date('2026-09-17T10:02:15.000Z');
    const tLaterEnd = new Date('2026-09-17T10:15:00.000Z');

    const timer = startAccountTimer(t0);
    const firstResult = timer.end('success', tFirstEnd);
    assert.strictEqual(firstResult.duration, '2m 15s');

    // Segunda chamada simulando leitura posterior antes do Telegram
    const secondResult = timer.end();
    assert.strictEqual(secondResult, firstResult);
    assert.strictEqual(secondResult.endTime.getTime(), tFirstEnd.getTime());
    assert.strictEqual(secondResult.duration, '2m 15s');

    // Terceira chamada com outro rótulo e data posterior ignorados devido ao cache
    const thirdResult = timer.end('error', tLaterEnd);
    assert.strictEqual(thirdResult, firstResult);
    assert.strictEqual(thirdResult.endTime.getTime(), tFirstEnd.getTime());
    assert.strictEqual(thirdResult.duration, '2m 15s');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/timing.js - caminhos de sucesso, erro e lock produzem objetos com estrutura de campos idêntica', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const t0 = new Date('2026-09-17T10:00:00.000Z');
    const t1 = new Date('2026-09-17T10:01:00.000Z');

    const timerSuccess = startAccountTimer(t0);
    const successRes = timerSuccess.end('success', t1);

    const timerError = startAccountTimer(t0);
    const errorRes = timerError.end('error', t1);

    const timerLock = startAccountTimer(t0);
    const lockRes = timerLock.end('lock', t1);

    const expectedKeys = ['startTime', 'endTime', 'duration'];
    assert.deepStrictEqual(Object.keys(successRes), expectedKeys);
    assert.deepStrictEqual(Object.keys(errorRes), expectedKeys);
    assert.deepStrictEqual(Object.keys(lockRes), expectedKeys);

    for (const res of [successRes, errorRes, lockRes]) {
      assert.ok(res.startTime instanceof Date);
      assert.ok(res.endTime instanceof Date);
      assert.strictEqual(typeof res.duration, 'string');
      assert.strictEqual(res.duration, '1m 00s');
    }
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/timing.js - getElapsed retorna duração decorrida sem congelar o cronômetro', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const t0 = new Date('2026-09-17T10:00:00.000Z');
    const tHalfway = new Date('2026-09-17T10:00:30.000Z');
    const tFinal = new Date('2026-09-17T10:01:10.000Z');

    const timer = startAccountTimer(t0);
    const elapsed = timer.getElapsed(tHalfway);
    assert.strictEqual(elapsed, '30s');

    // Finaliza depois
    const finalResult = timer.end(tFinal);
    assert.strictEqual(finalResult.duration, '1m 10s');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/timing.js - finishAccountTimer calcula duração pontual com ou sem rótulo', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const t0 = new Date('2026-09-17T10:00:00.000Z');
    const tEnd = new Date('2026-09-17T10:03:00.000Z');

    // 1. Chamada com (startTime, endTime)
    const res1 = finishAccountTimer(t0, tEnd);
    assert.strictEqual(res1.duration, '3m 00s');
    assert.strictEqual(res1.startTime.getTime(), t0.getTime());
    assert.strictEqual(res1.endTime.getTime(), tEnd.getTime());

    // 2. Chamada com (startTime, label, customEndTime)
    const res2 = finishAccountTimer(t0, 'lock', tEnd);
    assert.strictEqual(res2.duration, '3m 00s');

    // 3. Chamada com startTime apenas (termina com new Date())
    const res3 = finishAccountTimer(new Date());
    assert.ok(res3.duration);
    assert.ok(res3.startTime instanceof Date);
    assert.ok(res3.endTime instanceof Date);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/timing.js - limites: datas retroativas ou inválidas retornam 0s com segurança', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const t0 = new Date('2026-09-17T10:05:00.000Z');
    const tBefore = new Date('2026-09-17T10:00:00.000Z');

    const timer = startAccountTimer(t0);
    const res = timer.end(tBefore);
    assert.strictEqual(res.duration, '0s');

    const invalidTimer = startAccountTimer('invalid-date');
    const invalidRes = invalidTimer.end();
    assert.ok(invalidRes.startTime instanceof Date);
    assert.ok(invalidRes.endTime instanceof Date);
    assert.strictEqual(typeof invalidRes.duration, 'string');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/timing.js - formatos alternativos: string ISO, timestamp numérico e end() sem argumentos', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const t0 = new Date('2026-09-17T10:00:00.000Z');

    // 1. String ISO como labelOrEndTime
    const timerIso = startAccountTimer(t0);
    const resIso = timerIso.end('2026-09-17T10:01:30.000Z');
    assert.strictEqual(resIso.duration, '1m 30s');

    // 2. Timestamp numérico como labelOrEndTime
    const timerNum1 = startAccountTimer(t0);
    const resNum1 = timerNum1.end(t0.getTime() + 45000);
    assert.strictEqual(resNum1.duration, '45s');

    // 3. Timestamp numérico como customEndTime
    const timerNum2 = startAccountTimer(t0);
    const resNum2 = timerNum2.end('success', t0.getTime() + 75000);
    assert.strictEqual(resNum2.duration, '1m 15s');

    // 4. end() sem argumentos
    const timerEmpty = startAccountTimer();
    const resEmpty = timerEmpty.end();
    assert.ok(resEmpty.startTime instanceof Date);
    assert.ok(resEmpty.endTime instanceof Date);
    assert.strictEqual(typeof resEmpty.duration, 'string');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/timing.js - prova de equivalência: payloads e mensagens do Telegram idênticos byte-a-byte', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const t0 = new Date('2026-09-17T10:00:00.000Z');
    const t15s = new Date('2026-09-17T10:00:15.000Z');
    const t45s = new Date('2026-09-17T10:00:45.000Z');

    const account = { maskedUser: 'us***@example.com', telegramChatId: '999888' };
    const checkin = {
      alreadyCollected: false,
      coinsGainedToday: '70',
      streakDays: 5,
      previousStreakDays: 4,
      totalBalance: '500',
      duration: '15s',
      startTime: t0,
      endTime: t15s
    };
    const tasks = {
      results: [{ title: 'Ver ofertas', status: 'concluida', coins: '20' }],
      initialBalance: 500,
      finalBalance: 520,
      coinsGained: 20,
      finalCoins: '520 moedas',
      duration: '30s',
      totalActions: 1,
      startTime: t15s,
      endTime: t45s
    };

    // 1. Método legado (antes do helper)
    const legacyStartTime = t0;
    const legacyEndTime = t45s;
    const legacyTotalDuration = formatDuration(legacyEndTime - legacyStartTime);

    const legacyPayload = buildUnifiedReportPayload(checkin, tasks, {
      user: account.maskedUser,
      mainStartTime: legacyStartTime,
      mainEndTime: legacyEndTime,
      totalDuration: legacyTotalDuration,
      step1Duration: '15s',
      step2Duration: '30s'
    });

    const legacyReportItem = {
      account,
      user: account.maskedUser,
      checkinResult: checkin,
      tasksResult: tasks,
      error: null,
      isImportedSessionExpired: false,
      is2FARequired: false,
      streakBroken: false,
      startTime: legacyStartTime,
      endTime: legacyEndTime,
      duration: legacyTotalDuration
    };

    // 2. Novo método com startAccountTimer
    const timer = startAccountTimer(t0);
    timer.end('success', t45s);
    const newTiming = timer.end(); // idempotente

    const newPayload = buildUnifiedReportPayload(checkin, tasks, {
      user: account.maskedUser,
      mainStartTime: newTiming.startTime,
      mainEndTime: newTiming.endTime,
      totalDuration: newTiming.duration,
      step1Duration: '15s',
      step2Duration: '30s'
    });

    const newReportItem = {
      account,
      user: account.maskedUser,
      checkinResult: checkin,
      tasksResult: tasks,
      error: null,
      isImportedSessionExpired: false,
      is2FARequired: false,
      streakBroken: false,
      startTime: newTiming.startTime,
      endTime: newTiming.endTime,
      duration: newTiming.duration
    };

    // Verificação de igualdade estrutural e byte-a-byte JSON
    assert.deepStrictEqual(newPayload, legacyPayload);
    assert.strictEqual(JSON.stringify(newPayload), JSON.stringify(legacyPayload));

    assert.deepStrictEqual(newReportItem, legacyReportItem);
    assert.strictEqual(JSON.stringify(newReportItem), JSON.stringify(legacyReportItem));

    // Verificação de mensagens Telegram idênticas byte-a-byte
    const legacyTelegramMsg = buildMessage({
      event: 'success',
      report: legacyPayload,
      hostname: 'ci-runner'
    });
    const newTelegramMsg = buildMessage({
      event: 'success',
      report: newPayload,
      hostname: 'ci-runner'
    });
    assert.strictEqual(newTelegramMsg, legacyTelegramMsg);

    // Multi-account report payload idêntico
    const legacyMultiPayload = buildMultiAccountReportPayload([legacyReportItem], {
      startTime: t0.toISOString(),
      endTime: t45s.toISOString(),
      totalDuration: legacyTotalDuration
    });
    const newMultiPayload = buildMultiAccountReportPayload([newReportItem], {
      startTime: t0.toISOString(),
      endTime: t45s.toISOString(),
      totalDuration: newTiming.duration
    });
    assert.deepStrictEqual(newMultiPayload, legacyMultiPayload);
    assert.strictEqual(JSON.stringify(newMultiPayload), JSON.stringify(legacyMultiPayload));

    // Lock path equivalence
    const legacyLockReport = {
      account,
      user: account.maskedUser,
      checkinResult: null,
      tasksResult: null,
      error: 'Lock ativo por outro processo',
      duration: formatDuration(1000),
      startTime: t0,
      endTime: new Date(t0.getTime() + 1000)
    };

    const lockTimer = startAccountTimer(t0);
    const lockTiming = lockTimer.end('lock', new Date(t0.getTime() + 1000));
    const newLockReport = {
      account,
      user: account.maskedUser,
      checkinResult: null,
      tasksResult: null,
      error: 'Lock ativo por outro processo',
      duration: lockTiming.duration,
      startTime: lockTiming.startTime,
      endTime: lockTiming.endTime
    };

    assert.deepStrictEqual(newLockReport, legacyLockReport);
    assert.strictEqual(JSON.stringify(newLockReport), JSON.stringify(legacyLockReport));
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
