const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatDate,
  formatTime,
  formatDateTime,
  formatDuration,
  calculateAccountBackoff,
  pickPauseMs
} = require('../time_utils');

test('time_utils.js - formatDate formata data no formato DD/MM/AAAA (fuso do relatório)', () => {
  // Instante fixo em UTC; a data exibida é a do fuso do relatório (America/Los_Angeles)
  const date = new Date('2025-01-05T17:08:07Z'); // 09:08 PT
  assert.strictEqual(formatDate(date), '05/01/2025');
});

test('time_utils.js - formatTime formata hora no formato HH:mm:ss (fuso do relatório)', () => {
  const date = new Date('2025-01-05T17:08:07Z'); // 09:08:07 PT
  assert.strictEqual(formatTime(date), '09:08:07');
});

test('time_utils.js - formatDateTime combina data e hora (fuso do relatório)', () => {
  const date = new Date('2025-06-15T21:30:45Z'); // 14:30:45 PT
  assert.strictEqual(formatDateTime(date), '15/06/2025 14:30:45');
});

test('time_utils.js - REPORT_TIMEZONE permite usar outro fuso', () => {
  // Verificação do mecanismo: com TZ de São Paulo (UTC-3), o instante UTC muda de dia
  const original = process.env.REPORT_TIMEZONE;
  delete require.cache[require.resolve('../time_utils')];
  try {
    process.env.REPORT_TIMEZONE = 'UTC';
    const { formatDateTime } = require('../time_utils');
    assert.strictEqual(formatDateTime(new Date('2025-01-05T17:08:07Z')), '05/01/2025 17:08:07');
  } finally {
    if (original !== undefined) process.env.REPORT_TIMEZONE = original;
    else delete process.env.REPORT_TIMEZONE;
    delete require.cache[require.resolve('../time_utils')];
  }
});

test('time_utils.js - formatDuration formata milissegundos legíveis', () => {
  assert.strictEqual(formatDuration(0), '0s');
  assert.strictEqual(formatDuration(-100), '0s');
  assert.strictEqual(formatDuration(null), '0s');
  assert.strictEqual(formatDuration(45000), '45s');
  assert.strictEqual(formatDuration(80000), '1m 20s');
  assert.strictEqual(formatDuration(3665000), '1h 01m 05s');
});

test('time_utils.js - calculateAccountBackoff respeita jitter e limites de teto', () => {
  assert.strictEqual(calculateAccountBackoff(0, 1000, 10000, 0.5), 1000);
  assert.strictEqual(calculateAccountBackoff(1, 1000, 10000, 0.5), 2000);
  assert.strictEqual(calculateAccountBackoff(5, 1000, 10000, 0.5), 10000);
});

test('time_utils.js - formatDuration e backoff são resilientes a valores não finitos', () => {
  assert.strictEqual(formatDuration(Infinity), '0s');
  assert.strictEqual(formatDuration(NaN), '0s');
  assert.ok(Number.isFinite(calculateAccountBackoff(NaN, 1000, 10000, 0.5)));
  assert.ok(Number.isFinite(calculateAccountBackoff(Infinity, 1000, 10000, 0.5)));
  assert.strictEqual(calculateAccountBackoff(NaN, 1000, 10000, 0.5), 1000);
});

test('time_utils.js - pickPauseMs sorteia dentro de [min, max] e desliga com max 0', () => {
  // Extremos do sorteio determinístico: random()=0 -> min; random()->1- -> max (inclusivo)
  assert.strictEqual(
    pickPauseMs(15000, 60000, () => 0),
    15000
  );
  assert.strictEqual(
    pickPauseMs(15000, 60000, () => 0.999999999),
    60000
  );
  const meio = pickPauseMs(10, 20, () => 0.5);
  assert.ok(meio >= 10 && meio <= 20);

  // Desligada (padrão) e entradas inválidas
  assert.strictEqual(pickPauseMs(), 0);
  assert.strictEqual(pickPauseMs(0, 0), 0);
  assert.strictEqual(pickPauseMs(-5, -1), 0);
  assert.strictEqual(pickPauseMs('abc', undefined), 0);
  // max < min: usa min (nunca devolve valor fora do intervalo pedido)
  assert.strictEqual(
    pickPauseMs(5000, 1000, () => 0.7),
    5000
  );
  // Sempre inteiro
  assert.ok(Number.isInteger(pickPauseMs(1, 1000, () => 0.123456)));
});

test('time_utils.js - composeAccountWaitMs usa a maior espera (nunca soma backoff + pausa)', () => {
  const { composeAccountWaitMs } = require('../time_utils');

  assert.strictEqual(composeAccountWaitMs(3000, 0), 3000, 'só backoff');
  assert.strictEqual(composeAccountWaitMs(0, 9000), 9000, 'só pausa');
  assert.strictEqual(composeAccountWaitMs(3000, 9000), 9000, 'maior espera vence');
  assert.strictEqual(composeAccountWaitMs(9000, 3000), 9000, 'ordem não importa');
  assert.ok(composeAccountWaitMs(3000, 9000) < 12000, 'nunca soma as duas esperas');
  assert.strictEqual(composeAccountWaitMs(NaN, 5000), 5000, 'NaN é ignorado');
  assert.strictEqual(composeAccountWaitMs(-100, 5000), 5000, 'negativo é ignorado');
  assert.strictEqual(composeAccountWaitMs(undefined, undefined), 0);
  assert.strictEqual(composeAccountWaitMs(0, 0), 0);
});

test('time_utils.js - getReportTimeZoneLabel devolve rótulo curto do fuso do relatório', () => {
  const { getReportTimeZoneLabel } = require('../time_utils');
  const label = getReportTimeZoneLabel(new Date('2026-09-25T15:00:00Z'));
  assert.strictEqual(typeof label, 'string');
  assert.ok(label.trim().length > 0, 'rótulo do fuso não pode ser vazio');
});

test('time_utils.js - waitUntilWallClock espera em pedaços até o alvo (relógio injetado)', async () => {
  const { waitUntilWallClock } = require('../time_utils');
  let t = 1000;
  const slept = [];
  const now = () => t;
  const sleep = async (ms) => {
    slept.push(ms);
    t += ms;
  };

  assert.strictEqual(await waitUntilWallClock(3050, { chunkMs: 1000, now, sleep }), true);
  assert.deepStrictEqual(slept, [1000, 1000, 50], 'dorme em pedaços curtos até completar o alvo');
});

test('time_utils.js - waitUntilWallClock retorna na hora se o alvo já passou (suspensão)', async () => {
  const { waitUntilWallClock } = require('../time_utils');
  let slept = 0;
  const sleep = async () => {
    slept++;
  };

  assert.strictEqual(await waitUntilWallClock(500, { now: () => 100000, sleep }), true);
  assert.strictEqual(slept, 0, 'alvo no passado não deve dormir (notebook acordou depois da hora)');
});

test('time_utils.js - waitUntilWallClock é interrompível por sinal (AbortSignal)', async () => {
  const { waitUntilWallClock } = require('../time_utils');

  // Abortado antes de começar
  let slept = 0;
  const ac = new AbortController();
  ac.abort();
  assert.strictEqual(
    await waitUntilWallClock(10000, {
      chunkMs: 1000,
      signal: ac.signal,
      now: () => 0,
      sleep: async () => {
        slept++;
      }
    }),
    false
  );
  assert.strictEqual(slept, 0);

  // Abortado no meio da espera
  let t = 0;
  let n = 0;
  const ac2 = new AbortController();
  const sleep2 = async (ms) => {
    t += ms;
    n++;
    ac2.abort();
  };
  assert.strictEqual(
    await waitUntilWallClock(5000, {
      chunkMs: 1000,
      signal: ac2.signal,
      now: () => t,
      sleep: sleep2
    }),
    false
  );
  assert.strictEqual(n, 1, 'não deve continuar dormindo após o abort');
});
