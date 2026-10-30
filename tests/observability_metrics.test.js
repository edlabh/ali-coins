'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  METRICS_SCHEMA_VERSION,
  createRunMetrics,
  recordCheckin,
  recordTasks,
  markStreakBroken,
  finalizeRun,
  computeTotals,
  toLogPayload,
  formatSummary,
  summaryParams,
  logRunMetrics,
  classifyCheckin,
  classifyTasks,
  classifyError
} = require('../libs/observability/metrics');

const START = new Date('2026-10-30T12:00:00.000Z');
const END = new Date('2026-10-30T12:01:30.000Z');

function checkinResult(overrides = {}) {
  return {
    userEmail: 'user@example.com',
    alreadyCollected: false,
    coinsGainedToday: '40',
    checkinCoinsFromLedger: true,
    statementStreakDays: 254,
    totalBalance: '5245',
    streakDays: 254,
    previousStreakDays: 253,
    longestStreakDays: 260,
    trustDetected: true,
    startTime: new Date('2026-10-30T12:00:00.000Z'),
    endTime: new Date('2026-10-30T12:00:30.000Z'),
    duration: '30s',
    sessionData: { cookies: [{ name: 'xman_us_t', value: 'segredo' }] },
    loginAttempted: true,
    reusedEarlyDesktop: false,
    ...overrides
  };
}

test('observability/metrics - contexto mascara conta e não expõe sessão', () => {
  const metrics = createRunMetrics({
    mode: 'multi',
    accounts: [
      { user: 'user@example.com', index: 1 },
      { maskedUser: 'ou***@example.com', index: 2 }
    ],
    now: START,
    runId: 'run-fixo'
  });

  assert.strictEqual(metrics.schemaVersion, METRICS_SCHEMA_VERSION);
  assert.strictEqual(metrics.runId, 'run-fixo');
  assert.strictEqual(metrics.mode, 'multi');
  assert.strictEqual(metrics.accounts[0].account, 'us***@example.com');
  assert.strictEqual(metrics.accounts[1].account, 'ou***@example.com');
  assert.strictEqual(metrics.accounts[1].index, 2);

  const serialized = JSON.stringify(metrics);
  assert.ok(!serialized.includes('user@example.com'));
  assert.ok(!serialized.includes('cookies'));
  assert.ok(!serialized.includes('segredo'));
});

test('observability/metrics - classifica check-in e tarefas', () => {
  assert.strictEqual(classifyCheckin({ result: checkinResult() }), 'success');
  assert.strictEqual(
    classifyCheckin({
      result: checkinResult({ alreadyCollected: true, checkinCoinsFromLedger: false })
    }),
    'already'
  );
  assert.strictEqual(
    classifyCheckin({
      result: checkinResult({ alreadyCollected: true, checkinCoinsFromLedger: true })
    }),
    'success',
    'crédito no extrato conta como nova ação mesmo já coletado'
  );
  assert.strictEqual(classifyCheckin({ result: null }), 'skipped');
  assert.strictEqual(classifyCheckin({ error: new Error('falha') }), 'error');
  assert.strictEqual(
    classifyCheckin({ error: Object.assign(new Error('captcha'), { isCaptchaChallenge: true }) }),
    'blocked'
  );
  assert.strictEqual(classifyTasks({ result: { results: [] } }), 'success');
  assert.strictEqual(classifyTasks({ result: null }), 'skipped');
  assert.strictEqual(classifyTasks({ error: new Error('x') }), 'error');

  assert.strictEqual(classifyError(null), null);
  assert.strictEqual(
    classifyError(Object.assign(new Error('x'), { isRiskControl: true })),
    'risk_control'
  );
  assert.strictEqual(
    classifyError(Object.assign(new Error('x'), { name: 'LockActiveError' })),
    'lock_active'
  );
  assert.strictEqual(
    classifyError(Object.assign(new Error('x'), { isImportedSessionExpired: true })),
    'session_expired'
  );
});

test('observability/metrics - agrega durações, streaks, moedas e totais', () => {
  const metrics = createRunMetrics({
    mode: 'single',
    accounts: [{ user: 'user@example.com', index: 1 }],
    now: START,
    runId: 'run-1'
  });

  recordCheckin(metrics, {
    index: 1,
    account: { user: 'user@example.com', index: 1 },
    result: checkinResult()
  });
  recordTasks(metrics, {
    index: 1,
    account: { user: 'user@example.com', index: 1 },
    result: {
      results: [{ title: 'Buscar', status: 'Concluída' }],
      coinsGained: 25,
      startTime: new Date('2026-10-30T12:00:40.000Z'),
      endTime: new Date('2026-10-30T12:01:10.000Z')
    }
  });
  markStreakBroken(metrics, { index: 1 });

  assert.strictEqual(metrics.accounts[0].checkin.outcome, 'success');
  assert.strictEqual(metrics.accounts[0].checkin.durationMs, 30000);
  assert.strictEqual(metrics.accounts[0].checkin.streakBefore, 253);
  assert.strictEqual(metrics.accounts[0].checkin.streakAfter, 254);
  assert.strictEqual(metrics.accounts[0].checkin.coins, 40);
  assert.strictEqual(metrics.accounts[0].checkin.loginAttempted, true);
  assert.strictEqual(metrics.accounts[0].tasks.outcome, 'success');
  assert.strictEqual(metrics.accounts[0].tasks.durationMs, 30000);
  assert.strictEqual(metrics.accounts[0].tasks.coinsGained, 25);
  assert.strictEqual(metrics.accounts[0].streakBroken, true);

  finalizeRun(metrics, { exitCode: 4, now: END });
  assert.strictEqual(metrics.exitCode, 4);
  assert.strictEqual(metrics.durationMs, 90000);
  assert.deepStrictEqual(computeTotals(metrics), {
    accounts: 1,
    checkin: { success: 1, already: 0, blocked: 0, error: 0, skipped: 0 },
    tasks: { success: 1, error: 0, skipped: 0 },
    streakBroken: 1,
    coinsGained: 65
  });

  // Idempotente: uma segunda finalização não muda o snapshot.
  const snapshot = JSON.stringify(metrics);
  finalizeRun(metrics, { exitCode: 0, now: new Date('2026-10-30T13:00:00.000Z') });
  assert.strictEqual(JSON.stringify(metrics), snapshot);
});

test('observability/metrics - payload de log é allowlist e resumo cobre o run', () => {
  const metrics = createRunMetrics({
    mode: 'multi',
    accounts: [{ user: 'user@example.com', index: 1 }],
    now: START,
    runId: 'run-2'
  });
  recordCheckin(metrics, {
    index: 1,
    account: { user: 'user@example.com', index: 1 },
    result: checkinResult()
  });
  recordCheckin(metrics, {
    index: 2,
    account: { user: 'second@example.com', index: 2 },
    error: Object.assign(new Error('segredo-do-erro'), { isCaptchaChallenge: true })
  });
  recordTasks(metrics, {
    index: 1,
    account: { user: 'user@example.com', index: 1 },
    result: { results: [], coinsGained: 0 }
  });
  finalizeRun(metrics, { exitCode: 1, now: END });

  const payload = toLogPayload(metrics);
  assert.strictEqual(payload.event, 'run_metrics');
  assert.strictEqual(payload.runId, 'run-2');
  assert.deepStrictEqual(payload.totals.checkin, {
    success: 1,
    already: 0,
    blocked: 1,
    error: 0,
    skipped: 0
  });

  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes('user@example.com'));
  assert.ok(!serialized.includes('second@example.com'));
  assert.ok(!serialized.includes('cookies'));
  assert.ok(!serialized.includes('segredo'));
  assert.ok(!serialized.includes('segredo-do-erro'), 'não deve expor a mensagem crua do erro');

  const summary = formatSummary(metrics);
  assert.match(summary, /run=run-2/);
  assert.match(summary, /modo=multi/);
  assert.match(summary, /check-in=success:1,blocked:1/);
  assert.match(summary, /saída=1/);
  assert.strictEqual(summaryParams(metrics).length, 9);
});

test('observability/run-context - logger correlaciona runId e conta mascarada', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const script = `
    const logger = require('./logger');
    const { setRunContext, clearRunContext } = require('./libs/observability/run-context');
    setRunContext({ runId: 'run-ctx', account: 'us***@example.com' });
    logger.info('Evento com contexto');
    clearRunContext();
    logger.info('Evento sem contexto');
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, LOG_LEVEL: 'info' }
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const lines = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const withContext = lines.find((line) => line.msg === 'Evento com contexto');
  const withoutContext = lines.find((line) => line.msg === 'Evento sem contexto');
  assert.strictEqual(withContext.runId, 'run-ctx');
  assert.strictEqual(withContext.account, 'us***@example.com');
  assert.strictEqual(withoutContext.runId, undefined);
  assert.strictEqual(withoutContext.account, undefined);
});

test('observability/metrics - logRunMetrics emite um único evento estruturado', () => {
  const metrics = createRunMetrics({
    mode: 'single',
    accounts: [{ user: 'user@example.com', index: 1 }],
    now: START,
    runId: 'run-3'
  });
  recordCheckin(metrics, {
    index: 1,
    account: { user: 'user@example.com', index: 1 },
    result: checkinResult()
  });

  const calls = [];
  const logger = {
    info: (context, message) => calls.push({ context, message })
  };

  const payload = logRunMetrics(metrics, logger, { exitCode: 0, now: END });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].context.event, 'run_metrics');
  assert.strictEqual(calls[0].context.msgId, 'observability.metrics.summary');
  assert.strictEqual(calls[0].context.runId, 'run-3');
  assert.match(calls[0].message, /run=run-3/);
  assert.strictEqual(payload.exitCode, 0);

  // Segunda chamada não deve emitir de novo se o chamador controlar o flag; o módulo
  // permanece idempotente no snapshot, mas o log é responsabilidade do chamador.
  assert.strictEqual(metrics.exitCode, 0);
});
