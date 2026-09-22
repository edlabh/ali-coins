const test = require('node:test');
const assert = require('node:assert/strict');
const {
  unifiedReportSchema,
  multiAccountReportSchema,
  buildUnifiedReportPayload,
  buildMultiAccountReportPayload,
  sendWebhookNotification,
  renderCheckinReport,
  renderTasksReport,
  renderUnifiedReport,
  renderMultiAccountReport,
  computeCheckinCoinsGained,
  computeTasksCoinsGained
} = require('../libs/report');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('libs/report.js - buildUnifiedReportPayload e validação de contrato Zod', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const checkin = {
      userEmail: 'user@example.com',
      alreadyCollected: false,
      coinsGainedToday: '40',
      streakDays: 15,
      totalBalance: '1500',
      duration: '5s'
    };

    const tasks = {
      results: [{ title: 'Explore sponsored items', status: 'Concluída', coins: '+5 moedas' }],
      finalCoins: '1505 moedas',
      duration: '8s'
    };

    const meta = {
      mainStartTime: new Date('2026-09-14T10:00:00Z'),
      mainEndTime: new Date('2026-09-14T10:00:13Z'),
      totalDuration: '13s',
      step1Duration: '5s',
      step2Duration: '8s'
    };

    const payload = buildUnifiedReportPayload(checkin, tasks, meta);
    assert.strictEqual(payload.type, 'unified_report');
    assert.strictEqual(payload.user, 'user@example.com');
    assert.strictEqual(payload.meta.finalBalance, '1505 moedas');

    // Validação estrita do contrato via schema Zod
    const parsed = unifiedReportSchema.parse(payload);
    assert.strictEqual(parsed.type, 'unified_report');
    assert.strictEqual(parsed.checkin.coinsGainedToday, '40');
    assert.strictEqual(parsed.tasks.results.length, 1);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - unifiedReportSchema rejeita payload inválido', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const invalidPayload = {
      type: 'invalid_type',
      checkin: null,
      tasks: null,
      meta: { finalBalance: '100' }
    };

    const result = unifiedReportSchema.safeParse(invalidPayload);
    assert.strictEqual(result.success, false);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - sendWebhookNotification com mock de fetch', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const originalFetch = global.fetch;

  try {
    // 1. Sem URL configurada -> retorna false silenciosamente
    const resNoUrl = await sendWebhookNotification({ type: 'test' }, '');
    assert.strictEqual(resNoUrl, false);

    // 2. Com URL válida e resposta 200 OK
    global.fetch = async (url, options) => {
      assert.strictEqual(url, 'https://example.com/notify');
      assert.strictEqual(options.method, 'POST');
      // PII de usuário deve ser mascarada antes de sair para webhooks externos
      assert.strictEqual(options.body.includes('user@test.com'), false);
      assert.ok(options.body.includes('us***@test.com'));
      return { ok: true, status: 200 };
    };

    const resOk = await sendWebhookNotification(
      { type: 'unified_report', user: 'user@test.com' },
      'https://example.com/notify'
    );
    assert.strictEqual(resOk, true);

    // 3. Com resposta de erro HTTP (ex: 500) -> nunca lança exceção, retorna false
    global.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const resFail = await sendWebhookNotification({ type: 'test' }, 'https://example.com/notify');
    assert.strictEqual(resFail, false);

    // 4. Com falha de rede/timeout -> nunca quebra o job, retorna false
    global.fetch = async () => {
      throw new Error('Connection refused / timeout');
    };
    const resNetError = await sendWebhookNotification(
      { type: 'test' },
      'https://example.com/notify'
    );
    assert.strictEqual(resNetError, false);
  } finally {
    global.fetch = originalFetch;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - renderCheckinReport, renderTasksReport e renderUnifiedReport com json=true', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const originalWrite = process.stdout.write;
  let capturedOutput = '';

  try {
    process.stdout.write = (chunk) => {
      capturedOutput += chunk;
      return true;
    };

    renderCheckinReport(
      {
        alreadyCollected: true,
        coinsGainedToday: '10',
        totalBalance: '100',
        streakDays: 5,
        startTime: new Date(),
        endTime: new Date(),
        duration: '1s'
      },
      { json: true }
    );

    renderTasksReport(
      {
        results: [],
        finalCoins: '100',
        startTime: new Date(),
        endTime: new Date(),
        duration: '1s'
      },
      { json: true }
    );

    renderUnifiedReport(
      { userEmail: 'u@test.com', totalBalance: '100', coinsGainedToday: '10', duration: '1s' },
      { results: [], finalCoins: '100', duration: '1s' },
      { totalDuration: '2s' },
      { json: true }
    );

    assert.ok(capturedOutput.includes('"type": "checkin"'));
    assert.ok(capturedOutput.includes('"type": "tasks"'));
    assert.ok(capturedOutput.includes('"type": "unified_report"'));
  } finally {
    process.stdout.write = originalWrite;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - buildMultiAccountReportPayload e validação com multiAccountReportSchema', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const originalWrite = process.stdout.write;
  let capturedOutput = '';

  try {
    process.stdout.write = (chunk) => {
      capturedOutput += chunk;
      return true;
    };

    const accountResults = [
      {
        account: { maskedUser: 'us***@example.com' },
        checkinResult: {
          alreadyCollected: true,
          coinsGainedToday: '10',
          streakDays: 3,
          totalBalance: '250',
          duration: '3s'
        },
        tasksResult: {
          results: [{ title: 'Explore item', status: 'Concluída', coins: '+5' }],
          finalCoins: '255 moedas',
          duration: '4s'
        }
      },
      {
        account: { maskedUser: 'an***@example.com' },
        checkinResult: null,
        tasksResult: null,
        error: 'Timeout na autenticação'
      }
    ];

    const meta = {
      mainStartTime: new Date('2026-09-14T12:00:00Z'),
      mainEndTime: new Date('2026-09-14T12:00:10Z'),
      totalDuration: '10s'
    };

    const payload = buildMultiAccountReportPayload(accountResults, meta);
    assert.strictEqual(payload.type, 'multi_account_report');
    assert.strictEqual(payload.meta.totalAccounts, 2);
    assert.strictEqual(payload.meta.successfulAccounts, 1);
    assert.strictEqual(payload.accounts[0].user, 'us***@example.com');
    assert.strictEqual(payload.accounts[1].error, 'Timeout na autenticação');

    const parsed = multiAccountReportSchema.parse(payload);
    assert.strictEqual(parsed.type, 'multi_account_report');
    assert.strictEqual(parsed.accounts.length, 2);
    // Conta 1 está com alreadyCollected=true: coinsGainedToday é eco informativo,
    // não ganho desta execução (mesma regra do relatório unificado desde a 0.9.1)
    assert.strictEqual(
      parsed.accounts[0].meta.checkinCoinsGained,
      0,
      'alreadyCollected=true não pode contabilizar moedas fantasmas'
    );
    assert.strictEqual(parsed.accounts[0].meta.totalCoinsGained, 0);

    renderMultiAccountReport(accountResults, meta, { json: true });
    assert.ok(capturedOutput.includes('"type": "multi_account_report"'));
    assert.ok(capturedOutput.includes('us***@example.com'));
  } finally {
    process.stdout.write = originalWrite;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - cálculo de totalCoinsGained, checkinCoinsGained e tasksCoinsGained no buildUnifiedReportPayload', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const checkin = {
      userEmail: 'user@example.com',
      alreadyCollected: false,
      coinsGainedToday: '70',
      streakDays: 33,
      totalBalance: '3135',
      duration: '45s'
    };

    const tasks = {
      results: [
        { title: 'Explore sponsored items', status: 'Concluída', estimatedCoins: '+5 moedas' }
      ],
      initialBalance: 3135,
      finalBalance: 3176,
      coinsGained: 41,
      finalCoins: '3176 moedas',
      duration: '2m'
    };

    const meta = {
      mainStartTime: new Date('2026-09-15T08:20:30Z'),
      mainEndTime: new Date('2026-09-15T08:23:15Z'),
      totalDuration: '2m 45s',
      step1Duration: '45s',
      step2Duration: '2m'
    };

    const payload = buildUnifiedReportPayload(checkin, tasks, meta);
    assert.strictEqual(payload.meta.checkinCoinsGained, 70);
    assert.strictEqual(payload.meta.tasksCoinsGained, 41);
    assert.strictEqual(payload.meta.totalCoinsGained, 111);
    assert.strictEqual(payload.meta.finalBalance, '3176 moedas');
    assert.strictEqual(payload.tasks.initialBalance, 3135);
    assert.strictEqual(payload.tasks.finalBalance, 3176);
    assert.strictEqual(payload.tasks.coinsGained, 41);

    // Validação com Zod
    const validated = unifiedReportSchema.parse(payload);
    assert.strictEqual(validated.meta.totalCoinsGained, 111);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - sendWebhookNotification com formatação de moedas ganhas para Discord', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const originalFetch = global.fetch;

  try {
    let capturedBody = null;
    global.fetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return { ok: true, status: 200 };
    };

    const payload = {
      type: 'unified_report',
      user: 'test@example.com',
      meta: {
        totalCoinsGained: 111,
        checkinCoinsGained: 70,
        tasksCoinsGained: 41,
        finalBalance: '3176 moedas',
        totalDuration: '2m 45s'
      }
    };

    const res = await sendWebhookNotification(payload, 'https://discord.com/api/webhooks/123/abc');
    assert.strictEqual(res, true);
    assert.ok(capturedBody.content.includes('+111 moedas (check-in +70 / tarefas +41)'));
    assert.ok(capturedBody.content.includes('3176 moedas'));
  } finally {
    global.fetch = originalFetch;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - Bug 12: buildUnifiedReportPayload zera checkinCoinsGained quando alreadyCollected é true', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const checkin = {
      userEmail: 'user@example.com',
      alreadyCollected: true,
      coinsGainedToday: '70',
      streakDays: 33,
      totalBalance: '3135',
      duration: '45s'
    };

    const tasks = {
      results: [
        { title: 'Explore sponsored items', status: 'Concluída', estimatedCoins: '+5 moedas' }
      ],
      initialBalance: 3135,
      finalBalance: 3140,
      coinsGained: 5,
      finalCoins: '3140 moedas',
      duration: '30s'
    };

    const meta = {
      mainStartTime: new Date('2026-09-16T08:00:00Z'),
      mainEndTime: new Date('2026-09-16T08:01:15Z'),
      totalDuration: '1m 15s',
      step1Duration: '45s',
      step2Duration: '30s'
    };

    const payload = buildUnifiedReportPayload(checkin, tasks, meta);
    assert.strictEqual(
      payload.meta.checkinCoinsGained,
      0,
      'checkinCoinsGained deve ser 0 quando alreadyCollected === true'
    );
    assert.strictEqual(payload.meta.tasksCoinsGained, 5);
    assert.strictEqual(
      payload.meta.totalCoinsGained,
      5,
      'totalCoinsGained deve somar apenas tarefas quando check-in já foi coletado'
    );

    // Validação de contrato Zod
    const validated = unifiedReportSchema.parse(payload);
    assert.strictEqual(validated.meta.checkinCoinsGained, 0);
    assert.strictEqual(validated.meta.totalCoinsGained, 5);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - buildUnifiedReportPayload resolve totalDuration a partir de mainStartTime e mainEndTime quando ausente ou 0s', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const checkin = {
      userEmail: 'user@example.com',
      alreadyCollected: false,
      coinsGainedToday: '70',
      streakDays: 10,
      totalBalance: '1000',
      duration: '15s'
    };
    const tasks = {
      results: [{ title: 'Task 1', status: 'Concluída' }],
      coinsGained: 10,
      finalCoins: '1010 moedas',
      duration: '25s'
    };

    // Caso 1: meta sem totalDuration explícito, mas com datas
    const metaWithDates = {
      mainStartTime: new Date('2026-09-17T10:00:00Z'),
      mainEndTime: new Date('2026-09-17T10:00:40Z')
    };
    const payload1 = buildUnifiedReportPayload(checkin, tasks, metaWithDates);
    assert.strictEqual(payload1.meta.totalDuration, '40s');
    assert.strictEqual(payload1.meta.step1Duration, '15s');
    assert.strictEqual(payload1.meta.step2Duration, '25s');
    assert.ok(unifiedReportSchema.safeParse(payload1).success);

    // Caso 2: meta com totalDuration: '0s' deve recalcular usando mainStartTime e mainEndTime
    const metaWithZero = {
      mainStartTime: new Date('2026-09-17T10:00:00Z'),
      mainEndTime: new Date('2026-09-17T10:01:15Z'),
      totalDuration: '0s'
    };
    const payload2 = buildUnifiedReportPayload(checkin, tasks, metaWithZero);
    assert.strictEqual(payload2.meta.totalDuration, '1m 15s');
    assert.ok(unifiedReportSchema.safeParse(payload2).success);

    // Caso 3: meta totalmente vazio calcula a partir dos resultados de checkin e tasks
    const checkinWithDates = {
      ...checkin,
      startTime: new Date('2026-09-17T10:00:00Z'),
      endTime: new Date('2026-09-17T10:00:15Z')
    };
    const tasksWithDates = {
      ...tasks,
      startTime: new Date('2026-09-17T10:00:15Z'),
      endTime: new Date('2026-09-17T10:00:55Z')
    };
    const payload3 = buildUnifiedReportPayload(checkinWithDates, tasksWithDates, {});
    assert.strictEqual(payload3.meta.totalDuration, '55s');
    assert.ok(unifiedReportSchema.safeParse(payload3).success);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - buildMultiAccountReportPayload calcula duration individual e totalDuration', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const accountResults = [
      {
        account: { maskedUser: 'acc1***@example.com' },
        startTime: new Date('2026-09-17T10:00:00Z'),
        endTime: new Date('2026-09-17T10:00:25Z'),
        checkinResult: {
          alreadyCollected: false,
          coinsGainedToday: '70',
          streakDays: 5,
          totalBalance: '500',
          duration: '10s'
        },
        tasksResult: {
          results: [],
          finalCoins: '500 moedas',
          duration: '15s'
        }
      },
      {
        account: { maskedUser: 'acc2***@example.com' },
        duration: '35s',
        checkinResult: {
          alreadyCollected: true,
          coinsGainedToday: '0',
          streakDays: 12,
          totalBalance: '1200',
          duration: '5s'
        },
        tasksResult: {
          results: [],
          finalCoins: '1200 moedas',
          duration: '30s'
        }
      }
    ];

    const meta = {
      mainStartTime: new Date('2026-09-17T10:00:00Z'),
      mainEndTime: new Date('2026-09-17T10:01:05Z')
    };

    const payload = buildMultiAccountReportPayload(accountResults, meta);
    assert.strictEqual(payload.accounts[0].duration, '25s');
    assert.strictEqual(payload.accounts[1].duration, '35s');
    assert.strictEqual(payload.meta.totalDuration, '1m 05s');
    assert.ok(multiAccountReportSchema.safeParse(payload).success);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('report.js - payload multi-conta preserva isImportedSessionExpired para o alerta do Telegram', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { buildMultiAccountReportPayload } = require('../libs/report');
    const { checkIfImportedSessionExpired } = require('../libs/notify');

    const payload = buildMultiAccountReportPayload([
      {
        account: { maskedUser: 'us***@example.com', user: 'user1@example.com' },
        checkinResult: null,
        tasksResult: null,
        error: 'Sessão expirou ou exige login.',
        isImportedSessionExpired: true,
        duration: '1s'
      },
      {
        account: { maskedUser: 'ou***@example.com', user: 'user2@example.com' },
        checkinResult: {
          alreadyCollected: true,
          coinsGainedToday: '0',
          streakDays: 5,
          totalBalance: '100',
          duration: '1s'
        },
        tasksResult: null,
        error: null,
        duration: '1s'
      }
    ]);

    assert.strictEqual(payload.accounts[0].isImportedSessionExpired, true);
    assert.strictEqual(payload.accounts[1].isImportedSessionExpired, false);
    assert.strictEqual(
      checkIfImportedSessionExpired(null, payload),
      true,
      'Alerta de sessão remota deve ser detectado a partir do relatório multi-conta'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('report.js - renderUnifiedReport mascara o e-mail do usuário no log (PII)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const logger = require('../logger');
  const originalInfo = logger.info;
  const messages = [];

  try {
    logger.info = (...args) => {
      messages.push(JSON.stringify(args));
    };

    renderUnifiedReport(
      {
        userEmail: 'pii_report@example.com',
        alreadyCollected: false,
        coinsGainedToday: '10',
        streakDays: 5,
        totalBalance: '100',
        duration: '1s',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString()
      },
      null,
      { skipWebhook: true }
    );

    const joined = messages.join('\n');
    assert.strictEqual(
      joined.includes('pii_report@example.com'),
      false,
      'E-mail completo não deve aparecer no relatório logado'
    );
    assert.ok(joined.includes('pi***@example.com'), 'E-mail deve ser mascarado no relatório');
  } finally {
    logger.info = originalInfo;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('report.js - computeCheckinCoinsGained ignora valor fantasma quando alreadyCollected=true', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { computeCheckinCoinsGained } = require('../libs/report');

    // Bug reportado: eco informativo do check-in já feito não pode contar como ganho
    assert.strictEqual(
      computeCheckinCoinsGained({ alreadyCollected: true, coinsGainedToday: '70' }),
      0,
      'alreadyCollected=true não pode somar coinsGainedToday'
    );
    assert.strictEqual(
      computeCheckinCoinsGained({ alreadyCollected: false, coinsGainedToday: '70' }),
      70,
      'alreadyCollected=false deve somar o valor'
    );
    assert.strictEqual(
      computeCheckinCoinsGained({ alreadyCollected: false, coinsGainedToday: 15 }),
      15,
      'Valores numéricos devem ser aceitos'
    );
    assert.strictEqual(
      computeCheckinCoinsGained({ coinsGainedToday: '10' }),
      0,
      'Flag ausente = 0'
    );
    assert.strictEqual(
      computeCheckinCoinsGained({ alreadyCollected: false, coinsGainedToday: 'N/D' }),
      0
    );
    assert.strictEqual(
      computeCheckinCoinsGained({ alreadyCollected: false, coinsGainedToday: 'abc' }),
      0
    );
    assert.strictEqual(computeCheckinCoinsGained(null), 0);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('report.js - payload multi-conta não infla checkinCoinsGained quando alreadyCollected=true', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { buildMultiAccountReportPayload } = require('../libs/report');

    const payload = buildMultiAccountReportPayload([
      {
        account: { maskedUser: 'co***@example.com', user: 'conta1@example.com' },
        checkinResult: {
          alreadyCollected: true,
          coinsGainedToday: '70',
          streakDays: 212,
          totalBalance: '1000',
          duration: '1m'
        },
        tasksResult: { coinsGained: 5, finalCoins: '1000 moedas', results: [], duration: '1m' },
        duration: '2m'
      }
    ]);

    assert.strictEqual(payload.accounts[0].meta.checkinCoinsGained, 0, 'Check-in já feito = 0');
    assert.strictEqual(payload.accounts[0].meta.tasksCoinsGained, 5);
    assert.strictEqual(payload.accounts[0].meta.totalCoinsGained, 5, 'Total não pode ser inflado');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('report.js - payload unificado mantém a mesma regra (regressão simétrica)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { buildUnifiedReportPayload } = require('../libs/report');

    const already = buildUnifiedReportPayload(
      {
        alreadyCollected: true,
        coinsGainedToday: '70',
        streakDays: 30,
        totalBalance: '1000',
        duration: '1m'
      },
      { coinsGained: 5, finalCoins: '1000 moedas', results: [], duration: '1m' }
    );
    assert.strictEqual(already.meta.checkinCoinsGained, 0);
    assert.strictEqual(already.meta.totalCoinsGained, 5);

    const fresh = buildUnifiedReportPayload(
      {
        alreadyCollected: false,
        coinsGainedToday: '10',
        streakDays: 31,
        totalBalance: '1010',
        duration: '1m'
      },
      { coinsGained: 5, finalCoins: '1015 moedas', results: [], duration: '1m' }
    );
    assert.strictEqual(fresh.meta.checkinCoinsGained, 10);
    assert.strictEqual(fresh.meta.totalCoinsGained, 15);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('report.js - computeTasksCoinsGained ignora NaN/Infinity e tipos não numéricos', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { computeTasksCoinsGained } = require('../libs/report');
    assert.strictEqual(computeTasksCoinsGained({ coinsGained: 7 }), 7);
    assert.strictEqual(computeTasksCoinsGained({ coinsGained: NaN }), 0);
    assert.strictEqual(computeTasksCoinsGained({ coinsGained: Infinity }), 0);
    assert.strictEqual(computeTasksCoinsGained({ coinsGained: '7' }), 0);
    assert.strictEqual(computeTasksCoinsGained(null), 0);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('report.js - computeFinalBalance trata saldo ausente ou N/D como N/D (sem "undefined moedas")', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { computeFinalBalance } = require('../libs/report');
    assert.strictEqual(computeFinalBalance({}, null), 'N/D');
    assert.strictEqual(computeFinalBalance({ totalBalance: 'N/D' }, null), 'N/D');
    assert.strictEqual(computeFinalBalance({ totalBalance: '250' }, null), '250 moedas');
    assert.strictEqual(
      computeFinalBalance({ totalBalance: '250' }, { finalCoins: '300 moedas' }),
      '300 moedas'
    );
    assert.strictEqual(computeFinalBalance(null, null), 'N/D');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('report.js - computeCheckinCoinsGained recupera moedas do streak quando coinsGainedToday é N/D e alreadyCollected=false', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { computeCheckinCoinsGained } = require('../libs/report');
    assert.strictEqual(
      computeCheckinCoinsGained({
        alreadyCollected: false,
        coinsGainedToday: 'N/D',
        streakDays: 33
      }),
      40,
      'Streak 33 dias deve fornecer 40 moedas de checkin como fallback'
    );
    assert.strictEqual(
      computeCheckinCoinsGained({
        alreadyCollected: false,
        coinsGainedToday: 'N/D',
        streakDays: 3
      }),
      20,
      'Streak 3 dias deve fornecer 20 moedas'
    );
    assert.strictEqual(
      computeCheckinCoinsGained({
        alreadyCollected: true,
        coinsGainedToday: 'N/D',
        streakDays: 33
      }),
      0,
      'alreadyCollected=true deve sempre retornar 0 independente de streak'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('report.js - tarefas não absorvem moedas do check-in no extrato (isolamento contábil)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { buildUnifiedReportPayload, buildMultiAccountReportPayload } = require('../libs/report');

    // Cenário: Saldo inicial era 1000. Check-in ganhou +40 moedas. Saldo pós-checkin = 1040.
    // Tarefas ganharam +5 moedas. Saldo final = 1045 moedas.
    // Se o initialBalance das tarefas recebeu 1000 (pré-checkin), tasks.coinsGained calculou 45 (1045 - 1000).
    // O relatório unificado DEVE isolar as moedas: check-in = 40, tarefas = 5, total = 45.
    const checkin = {
      alreadyCollected: false,
      coinsGainedToday: '40',
      streakDays: 20,
      totalBalance: '1040',
      duration: '10s'
    };

    const tasksTainted = {
      results: [{ title: 'Explore sponsored items', status: 'Concluída', coins: '+5 moedas' }],
      initialBalance: 1000,
      finalBalance: 1045,
      coinsGained: 45, // 1045 - 1000 (absorveu indevidamente as 40 moedas do check-in)
      finalCoins: '1045 moedas',
      duration: '1m'
    };

    const payload = buildUnifiedReportPayload(checkin, tasksTainted);
    assert.strictEqual(
      payload.meta.checkinCoinsGained,
      40,
      'Check-in contabilizado exatamente em 40'
    );
    assert.strictEqual(
      payload.meta.tasksCoinsGained,
      5,
      'Tarefas não devem somar as moedas do check-in (deve ser 5, não 45)'
    );
    assert.strictEqual(
      payload.meta.totalCoinsGained,
      45,
      'Total deve ser 40 + 5 = 45 (sem duplicação)'
    );

    // Cenário Multi-Conta idêntico
    const multiPayload = buildMultiAccountReportPayload([
      {
        account: { maskedUser: 'us***@example.com' },
        checkinResult: checkin,
        tasksResult: tasksTainted
      }
    ]);
    assert.strictEqual(multiPayload.accounts[0].meta.checkinCoinsGained, 40);
    assert.strictEqual(multiPayload.accounts[0].meta.tasksCoinsGained, 5);
    assert.strictEqual(multiPayload.accounts[0].meta.totalCoinsGained, 45);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('report.js - renderCheckinReport exibe (+0 moedas) quando alreadyCollected=true e valor real quando coletado hoje', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const logger = require('../logger');
  const originalInfo = logger.info;
  const messages = [];

  try {
    logger.info = (...args) => {
      messages.push(
        args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      );
    };

    // Caso 1: Já coletado hoje -> não deve contabilizar moedas (+0 moedas)
    renderCheckinReport(
      {
        alreadyCollected: true,
        coinsGainedToday: '0',
        streakDays: 35,
        totalBalance: '1500',
        startTime: new Date(),
        endTime: new Date(),
        duration: '5s'
      },
      { skipWebhook: true }
    );

    const out1 = messages.join('\n');
    assert.ok(
      out1.includes('já estava coletado (+0 moedas)'),
      `Extrato checkin deve conter (+0 moedas): ${out1}`
    );
    assert.strictEqual(out1.includes('(+40 moedas)'), false);

    messages.length = 0;

    // Caso 2: Coletado com sucesso hoje -> deve exibir o valor ganho
    renderCheckinReport(
      {
        alreadyCollected: false,
        coinsGainedToday: '40',
        streakDays: 35,
        totalBalance: '1540',
        startTime: new Date(),
        endTime: new Date(),
        duration: '10s'
      },
      { skipWebhook: true }
    );

    const out2 = messages.join('\n');
    assert.ok(out2.includes('40 moedas'), `Extrato checkin deve conter 40 moedas: ${out2}`);
  } finally {
    logger.info = originalInfo;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('report.js - renderUnifiedReport e renderMultiAccountReport exibem (+0 moedas) quando alreadyCollected=true', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const logger = require('../logger');
  const originalInfo = logger.info;
  const messages = [];

  try {
    logger.info = (...args) => {
      messages.push(
        args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      );
    };

    // Relatório Unificado: alreadyCollected=true
    renderUnifiedReport(
      {
        userEmail: 'user@example.com',
        alreadyCollected: true,
        coinsGainedToday: '0',
        streakDays: 35,
        totalBalance: '1500',
        duration: '5s'
      },
      {
        results: [{ title: 'Explore items', status: 'Concluída', coins: '+5 moedas' }],
        initialBalance: 1500,
        finalBalance: 1505,
        coinsGained: 5,
        finalCoins: '1505 moedas',
        duration: '20s'
      },
      { mainStartTime: new Date(), mainEndTime: new Date(), totalDuration: '25s' }
    );

    const unifOut = messages.join('\n');
    assert.ok(
      unifOut.includes('Check-in Diário: Já coletado hoje (+0 moedas)'),
      `Unificado deve exibir (+0 moedas): ${unifOut}`
    );
    assert.ok(
      unifOut.includes('Moedas Ganhas Hoje:     +5 moedas (check-in +0 / tarefas +5)'),
      `Total não pode contabilizar check-in: ${unifOut}`
    );
    assert.strictEqual(unifOut.includes('check-in +40'), false);

    messages.length = 0;

    // Relatório Multi-Conta: Conta 1 (alreadyCollected=true), Conta 2 (coletado com sucesso)
    renderMultiAccountReport(
      [
        {
          account: { maskedUser: 'co1***@example.com' },
          checkinResult: {
            alreadyCollected: true,
            coinsGainedToday: '0',
            streakDays: 35,
            totalBalance: '1500',
            duration: '5s'
          },
          tasksResult: {
            results: [{ title: 'Explore items', status: 'Concluída', coins: '+5 moedas' }],
            coinsGained: 5,
            finalCoins: '1505 moedas',
            duration: '20s'
          },
          duration: '25s'
        },
        {
          account: { maskedUser: 'co2***@example.com' },
          checkinResult: {
            alreadyCollected: false,
            coinsGainedToday: '70',
            streakDays: 45,
            totalBalance: '2070',
            duration: '8s'
          },
          tasksResult: {
            results: [{ title: 'Explore items', status: 'Concluída', coins: '+5 moedas' }],
            coinsGained: 5,
            finalCoins: '2075 moedas',
            duration: '20s'
          },
          duration: '28s'
        }
      ],
      { mainStartTime: new Date(), mainEndTime: new Date(), totalDuration: '55s' }
    );

    const multiOut = messages.join('\n');
    // Conta 1
    assert.ok(
      multiOut.includes('Check-in: Já coletado (+0 moedas)'),
      `Conta 1 deve exibir (+0 moedas): ${multiOut}`
    );
    assert.ok(
      multiOut.includes('Moedas Ganhas Hoje: +5 moedas (check-in +0 / tarefas +5)'),
      `Conta 1 deve somar 0 do check-in: ${multiOut}`
    );
    // Conta 2
    assert.ok(
      multiOut.includes('Check-in: Coletado com sucesso (+70 moedas)'),
      `Conta 2 deve exibir (+70 moedas): ${multiOut}`
    );
    assert.ok(
      multiOut.includes('Moedas Ganhas Hoje: +75 moedas (check-in +70 / tarefas +5)'),
      `Conta 2 deve somar 70 do check-in: ${multiOut}`
    );
  } finally {
    logger.info = originalInfo;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - renderMultiAccountReport exibe a quantidade correta de tarefas executadas (results.length)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const logger = require('../logger');
  const originalInfo = logger.info;
  const messages = [];

  try {
    logger.info = (...args) => {
      messages.push(
        args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      );
    };

    renderMultiAccountReport(
      [
        {
          account: { maskedUser: 'test***@example.com' },
          checkinResult: {
            alreadyCollected: true,
            coinsGainedToday: '0',
            streakDays: 10,
            totalBalance: '1000',
            duration: '2s'
          },
          tasksResult: {
            results: [
              { title: 'Task 1', status: 'Concluída', coins: '+5 moedas' },
              { title: 'Task 2', status: 'Concluída', coins: '+10 moedas' },
              { title: 'Task 3', status: 'Falhou' }
            ],
            coinsGained: 15,
            finalCoins: '1015 moedas',
            duration: '12s'
          },
          duration: '14s'
        }
      ],
      { mainStartTime: new Date(), mainEndTime: new Date(), totalDuration: '14s' }
    );

    const out = messages.join('\n');
    assert.ok(
      out.includes('• Tarefas executadas: 3'),
      `Deve reportar 3 tarefas executadas (results.length): ${out}`
    );
    assert.strictEqual(
      out.includes('• Tarefas executadas: 0'),
      false,
      'Não deve reportar 0 tarefas executadas quando há resultados'
    );
  } finally {
    logger.info = originalInfo;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - renderCheckinReport no modo --json mascara e-mail enviado ao webhook mas preserva no stdout', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const originalWrite = process.stdout.write;
  const originalFetch = global.fetch;
  const originalWebhookEnv = process.env.NOTIFY_WEBHOOK_URL;
  let stdoutCaptured = '';
  let webhookPayloadCaptured = null;

  try {
    process.env.NOTIFY_WEBHOOK_URL = 'https://example.com/test';

    process.stdout.write = (chunk, encoding, callback) => {
      stdoutCaptured += chunk;
      return originalWrite.call(process.stdout, chunk, encoding, callback);
    };

    global.fetch = async (url, options) => {
      if (options && options.body) {
        webhookPayloadCaptured = JSON.parse(options.body);
      }
      return { ok: true, status: 200 };
    };

    renderCheckinReport(
      {
        userEmail: 'alice.bob@example.com',
        alreadyCollected: false,
        coinsGainedToday: '40',
        streakDays: 7,
        totalBalance: '1540',
        duration: '3s'
      },
      { json: true }
    );

    // Aguarda a conclusão do webhook em voo (determinístico, cobre DNS + fetch)
    await require('../libs/report').flushWebhooks(2000);

    // 1. stdout local preserva e-mail original/cru (não mascarado)
    assert.ok(
      stdoutCaptured.includes('"userEmail": "alice.bob@example.com"'),
      `stdout deve conter e-mail não mascarado: ${stdoutCaptured}`
    );
    assert.ok(stdoutCaptured.includes('"type": "checkin"'));

    // 2. webhook de terceiros recebe e-mail devidamente mascarado (PII protection)
    assert.ok(webhookPayloadCaptured, 'Webhook deve ter sido acionado');
    assert.strictEqual(webhookPayloadCaptured.type, 'checkin');
    assert.notStrictEqual(webhookPayloadCaptured.userEmail, 'alice.bob@example.com');
    assert.strictEqual(webhookPayloadCaptured.userEmail, 'al***@example.com');
  } finally {
    process.stdout.write = originalWrite;
    global.fetch = originalFetch;
    if (originalWebhookEnv !== undefined) {
      process.env.NOTIFY_WEBHOOK_URL = originalWebhookEnv;
    } else {
      delete process.env.NOTIFY_WEBHOOK_URL;
    }
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - renderTasksReport no modo --json mascara e-mail enviado ao webhook mas preserva no stdout', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const originalWrite = process.stdout.write;
  const originalFetch = global.fetch;
  const originalWebhookEnv = process.env.NOTIFY_WEBHOOK_URL;
  let stdoutCaptured = '';
  let webhookPayloadCaptured = null;

  try {
    process.env.NOTIFY_WEBHOOK_URL = 'https://example.com/test';

    process.stdout.write = (chunk, encoding, callback) => {
      stdoutCaptured += chunk;
      return originalWrite.call(process.stdout, chunk, encoding, callback);
    };

    global.fetch = async (url, options) => {
      if (options && options.body) {
        webhookPayloadCaptured = JSON.parse(options.body);
      }
      return { ok: true, status: 200 };
    };

    renderTasksReport(
      {
        userEmail: 'alice.bob@example.com',
        results: [{ title: 'Browse surprise items', status: 'Concluída', coins: '+5 moedas' }],
        finalCoins: '1540 moedas',
        duration: '8s'
      },
      { json: true }
    );

    // Aguarda a conclusão do webhook em voo (determinístico, cobre DNS + fetch)
    await require('../libs/report').flushWebhooks(2000);

    // 1. stdout local preserva e-mail original/cru (não mascarado)
    assert.ok(
      stdoutCaptured.includes('"userEmail": "alice.bob@example.com"'),
      `stdout deve conter e-mail não mascarado: ${stdoutCaptured}`
    );
    assert.ok(stdoutCaptured.includes('"type": "tasks"'));

    // 2. webhook de terceiros recebe e-mail devidamente mascarado (PII protection)
    assert.ok(webhookPayloadCaptured, 'Webhook deve ter sido acionado');
    assert.strictEqual(webhookPayloadCaptured.type, 'tasks');
    assert.notStrictEqual(webhookPayloadCaptured.userEmail, 'alice.bob@example.com');
    assert.strictEqual(webhookPayloadCaptured.userEmail, 'al***@example.com');
  } finally {
    process.stdout.write = originalWrite;
    global.fetch = originalFetch;
    if (originalWebhookEnv !== undefined) {
      process.env.NOTIFY_WEBHOOK_URL = originalWebhookEnv;
    } else {
      delete process.env.NOTIFY_WEBHOOK_URL;
    }
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - renderMultiAccountReport prioriza totalActions sobre results.length', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const logger = require('../logger');
  const originalInfo = logger.info;
  const messages = [];

  try {
    logger.info = (...args) => {
      messages.push(
        args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      );
    };

    renderMultiAccountReport(
      [
        {
          account: { maskedUser: 'test***@example.com' },
          checkinResult: {
            alreadyCollected: true,
            coinsGainedToday: '0',
            streakDays: 10,
            totalBalance: '1000',
            duration: '2s'
          },
          tasksResult: {
            results: [
              { title: 'Task 1', status: 'Concluída', coins: '+5 moedas' },
              { title: 'Task 2', status: 'Desativada', coins: '+5 moedas' },
              { title: 'Task 3', status: 'Falhou' }
            ],
            totalActions: 1,
            coinsGained: 5,
            finalCoins: '1005 moedas',
            duration: '12s'
          },
          duration: '14s'
        }
      ],
      { mainStartTime: new Date(), mainEndTime: new Date(), totalDuration: '14s' }
    );

    const out = messages.join('\n');
    assert.ok(
      out.includes('• Tarefas executadas: 1'),
      `Deve priorizar totalActions (1) sobre results.length (3): ${out}`
    );
  } finally {
    logger.info = originalInfo;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - buildUnifiedReportPayload propaga tasksError no meta', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const checkin = {
      alreadyCollected: true,
      coinsGainedToday: '0',
      streakDays: 5,
      totalBalance: '100',
      duration: '2s'
    };
    const payload = buildUnifiedReportPayload(checkin, null, {
      finalBalance: '100 moedas',
      tasksError: 'painel de tarefas inacessível'
    });

    assert.strictEqual(payload.meta.tasksError, 'painel de tarefas inacessível');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - buildUnifiedReportPayload omite tasksError nulo sem divergir do schema', () => {
  const realFilesSnapshot = snapshotRealFiles();
  const logger = require('../logger');
  const originalWarn = logger.warn;
  const warnings = [];
  logger.warn = (obj, msg) => {
    warnings.push(typeof obj === 'string' ? obj : msg || (obj && obj.msg));
  };
  try {
    const checkin = {
      alreadyCollected: true,
      coinsGainedToday: '0',
      streakDays: 5,
      totalBalance: '100',
      duration: '2s'
    };
    const payload = buildUnifiedReportPayload(checkin, null, {
      finalBalance: '100 moedas',
      tasksError: null
    });

    assert.strictEqual(payload.meta.tasksError, undefined);
    assert.strictEqual(
      warnings.some((msg) => String(msg).includes('diverge do schema')),
      false,
      'payload com tasksError nulo não pode divergir do schema'
    );
  } finally {
    logger.warn = originalWarn;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - buildMultiAccountReportPayload propaga tasksError por conta', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const payload = buildMultiAccountReportPayload(
      [
        {
          account: { maskedUser: 'a***@example.com' },
          checkinResult: {
            alreadyCollected: true,
            coinsGainedToday: '0',
            streakDays: 3,
            totalBalance: '100',
            duration: '2s'
          },
          tasksResult: null,
          tasksError: 'painel de tarefas inacessível',
          duration: '2s'
        }
      ],
      { totalAccounts: 1, successfulAccounts: 1, totalDuration: '2s' }
    );

    assert.strictEqual(payload.accounts[0].tasksError, 'painel de tarefas inacessível');
    assert.strictEqual(payload.accounts[0].meta.tasksError, 'painel de tarefas inacessível');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - flushWebhooks aguarda webhooks em voo antes do encerramento', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const { sendWebhookNotification, flushWebhooks } = require('../libs/report');
  const originalFetch = global.fetch;
  const originalUrl = process.env.NOTIFY_WEBHOOK_URL;
  let resolved = false;

  try {
    process.env.NOTIFY_WEBHOOK_URL = 'https://example.com/flush';
    global.fetch = () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolved = true;
          resolve({ ok: true, status: 200 });
        }, 80);
      });

    sendWebhookNotification({ type: 'tasks' }).catch(() => {});
    await flushWebhooks(2000);

    assert.strictEqual(resolved, true, 'flushWebhooks deve aguardar o webhook em voo');
  } finally {
    global.fetch = originalFetch;
    if (originalUrl !== undefined) process.env.NOTIFY_WEBHOOK_URL = originalUrl;
    else delete process.env.NOTIFY_WEBHOOK_URL;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - check-in NÃO é somado ao extrato das tarefas quando o saldo já é pós-crédito', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    // Fluxo real corrigido: collect.js reporta o saldo do desktop (já pós-check-in = 2050)
    // e all.js passa esse saldo como initialBalance das tarefas.
    const checkin = {
      userEmail: 'user@example.com',
      alreadyCollected: false,
      coinsGainedToday: '50',
      streakDays: 10,
      totalBalance: '2050',
      duration: '40s'
    };
    const tasks = {
      results: [{ title: 'Explore sponsored items', status: 'Concluída', coins: '+5 moedas' }],
      initialBalance: 2050,
      finalBalance: 2100,
      coinsGained: 50,
      finalCoins: '2100 moedas',
      duration: '2m'
    };

    const payload = buildUnifiedReportPayload(checkin, tasks, { totalDuration: '3m' });
    assert.strictEqual(payload.meta.checkinCoinsGained, 50, 'check-in contabilizado à parte');
    assert.strictEqual(
      payload.meta.tasksCoinsGained,
      50,
      'tarefas NÃO devem absorver as moedas do check-in'
    );
    assert.strictEqual(payload.meta.totalCoinsGained, 100, 'total = check-in + tarefas');

    // Multi-conta segue a mesma regra
    const multi = buildMultiAccountReportPayload(
      [
        {
          account: { maskedUser: 'a***@example.com' },
          checkinResult: checkin,
          tasksResult: tasks,
          duration: '3m'
        }
      ],
      { totalAccounts: 1, successfulAccounts: 1, totalDuration: '3m' }
    );
    assert.strictEqual(multi.accounts[0].meta.checkinCoinsGained, 50);
    assert.strictEqual(multi.accounts[0].meta.tasksCoinsGained, 50);
    assert.strictEqual(multi.accounts[0].meta.totalCoinsGained, 100);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - check-in já feito hoje não soma moedas (alreadyCollected)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const checkin = {
      alreadyCollected: true,
      coinsGainedToday: '0',
      streakDays: 10,
      totalBalance: '2050',
      duration: '40s'
    };
    const tasks = {
      results: [],
      initialBalance: 2050,
      finalBalance: 2150,
      coinsGained: 100,
      finalCoins: '2150 moedas',
      duration: '2m'
    };

    const payload = buildUnifiedReportPayload(checkin, tasks, { totalDuration: '3m' });
    assert.strictEqual(payload.meta.checkinCoinsGained, 0, 'já coletado hoje => 0');
    assert.strictEqual(payload.meta.tasksCoinsGained, 100, 'tarefas preservadas');
    assert.strictEqual(payload.meta.totalCoinsGained, 100);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - check-in não vaza para o extrato das tarefas com saldo defasado ou creditado', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    // Cenário saldo JÁ creditado: collect não soma; initialBalance já inclui o check-in
    const checkinCredited = {
      alreadyCollected: false,
      coinsGainedToday: '50',
      streakDays: 10,
      totalBalance: '2050'
    };
    const tasksCredited = {
      coinsGained: 50,
      initialBalance: 2050,
      finalBalance: 2100,
      results: []
    };
    assert.strictEqual(computeCheckinCoinsGained(checkinCredited), 50);
    assert.strictEqual(
      computeTasksCoinsGained(tasksCredited, checkinCredited),
      50,
      'tarefas não podem absorver as moedas do check-in'
    );

    // Cenário saldo DEFASADO: collect sincroniza base=2050; initialBalance das tarefas=2050
    const checkinStale = {
      alreadyCollected: false,
      coinsGainedToday: '50',
      streakDays: 10,
      totalBalance: '2050'
    };
    const tasksStale = {
      coinsGained: 50,
      initialBalance: 2050,
      finalBalance: 2100,
      results: []
    };
    assert.strictEqual(computeTasksCoinsGained(tasksStale, checkinStale), 50);

    const payload = buildUnifiedReportPayload(checkinStale, tasksStale, { totalDuration: '1m' });
    assert.strictEqual(payload.meta.checkinCoinsGained, 50);
    assert.strictEqual(payload.meta.tasksCoinsGained, 50);
    assert.strictEqual(payload.meta.totalCoinsGained, 100);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - webhook com payload gigante é truncado (teto de segurança)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const { sendWebhookNotification, flushWebhooks } = require('../libs/report');
  const originalFetch = global.fetch;
  const originalUrl = process.env.NOTIFY_WEBHOOK_URL;
  let capturedBody = null;

  try {
    process.env.NOTIFY_WEBHOOK_URL = 'https://example.com/hook';
    global.fetch = async (_url, options) => {
      capturedBody = options.body;
      return { ok: true, status: 200 };
    };

    // Payload com ~200 KB de resultados
    const huge = {
      type: 'tasks',
      userEmail: 'a@b.co',
      results: Array.from({ length: 5000 }, (_, i) => ({
        title: `Tarefa ${i}`,
        status: 'Concluída',
        coins: '+5 moedas'
      })),
      meta: { finalBalance: '100 moedas' }
    };

    sendWebhookNotification(huge).catch(() => {});
    await flushWebhooks(3000);

    assert.ok(capturedBody, 'webhook deve ter sido chamado');
    assert.ok(capturedBody.length <= 32 * 1024, `body deve ser truncado (${capturedBody.length})`);
    const parsed = JSON.parse(capturedBody);
    assert.strictEqual(parsed.truncated, true);
  } finally {
    global.fetch = originalFetch;
    if (originalUrl !== undefined) process.env.NOTIFY_WEBHOOK_URL = originalUrl;
    else delete process.env.NOTIFY_WEBHOOK_URL;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - webhook para destino loopback é bloqueado (SSRF) sem chamar fetch', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const { sendWebhookNotification, flushWebhooks } = require('../libs/report');
  const originalFetch = global.fetch;
  const originalUrl = process.env.NOTIFY_WEBHOOK_URL;
  let fetchCalled = false;

  try {
    process.env.NOTIFY_WEBHOOK_URL = 'http://127.0.0.1:8080/hook';
    global.fetch = async () => {
      fetchCalled = true;
      return { ok: true, status: 200 };
    };

    sendWebhookNotification({ type: 'tasks', userEmail: 'a@b.co' }).catch(() => {});
    await flushWebhooks(1500);

    assert.strictEqual(fetchCalled, false, 'não deve chamar fetch para destino privado');
  } finally {
    global.fetch = originalFetch;
    if (originalUrl !== undefined) process.env.NOTIFY_WEBHOOK_URL = originalUrl;
    else delete process.env.NOTIFY_WEBHOOK_URL;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - webhook NUNCA envia sessionData/cookies (segredos de sessão)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const { sendWebhookNotification, flushWebhooks } = require('../libs/report');
  const originalFetch = global.fetch;
  const originalUrl = process.env.NOTIFY_WEBHOOK_URL;
  let captured = null;

  try {
    process.env.NOTIFY_WEBHOOK_URL = 'https://example.com/hook';
    global.fetch = async (_url, options) => {
      captured = options.body;
      return { ok: true, status: 200 };
    };

    const payload = {
      type: 'checkin',
      userEmail: 'victim@example.com',
      sessionData: {
        cookies: [{ name: 'xman_us_t', value: 'SECRET_TOKEN_ABC', domain: '.aliexpress.com' }]
      },
      nested: { storageState: { cookies: [{ name: 'x', value: 'Y' }] } }
    };

    sendWebhookNotification(payload).catch(() => {});
    await flushWebhooks(2000);

    assert.ok(captured, 'webhook deve ter sido chamado');
    assert.strictEqual(captured.includes('SECRET_TOKEN_ABC'), false, 'cookie não pode vazar');
    assert.strictEqual(captured.includes('sessionData'), false);
    assert.strictEqual(captured.includes('storageState'), false);
    assert.strictEqual(captured.includes('victim@example.com'), false, 'e-mail deve ser mascarado');
    assert.ok(captured.includes('vi***@example.com'));
  } finally {
    global.fetch = originalFetch;
    if (originalUrl !== undefined) process.env.NOTIFY_WEBHOOK_URL = originalUrl;
    else delete process.env.NOTIFY_WEBHOOK_URL;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - renderCheckinReport --json não vaza sessionData no stdout nem no webhook', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const { renderCheckinReport, flushWebhooks } = require('../libs/report');
  const originalFetch = global.fetch;
  const originalUrl = process.env.NOTIFY_WEBHOOK_URL;
  const originalWrite = process.stdout.write;
  let captured = null;
  let stdout = '';

  try {
    process.env.NOTIFY_WEBHOOK_URL = 'https://example.com/hook';
    global.fetch = async (_url, options) => {
      captured = options.body;
      return { ok: true, status: 200 };
    };
    process.stdout.write = (chunk) => {
      stdout += chunk;
      return true;
    };

    renderCheckinReport(
      {
        userEmail: 'victim@example.com',
        alreadyCollected: false,
        coinsGainedToday: '40',
        totalBalance: '1000',
        streakDays: 10,
        sessionData: { cookies: [{ name: 'xman_us_t', value: 'TOKEN_XYZ' }] }
      },
      { json: true }
    );
    await flushWebhooks(2000);
    process.stdout.write = originalWrite;

    assert.strictEqual(
      stdout.includes('TOKEN_XYZ'),
      false,
      'stdout não pode conter o storageState (cookies) — vai para cron.log/Docker logs'
    );
    assert.strictEqual(captured.includes('TOKEN_XYZ'), false, 'webhook não pode conter a sessão');
  } finally {
    process.stdout.write = originalWrite;
    global.fetch = originalFetch;
    if (originalUrl !== undefined) process.env.NOTIFY_WEBHOOK_URL = originalUrl;
    else delete process.env.NOTIFY_WEBHOOK_URL;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - payloads reais passam no contrato runtime dos schemas', () => {
  const {
    buildUnifiedReportPayload,
    unifiedReportSchema,
    buildMultiAccountReportPayload,
    multiAccountReportSchema
  } = require('../libs/report');
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const unified = buildUnifiedReportPayload(
      {
        userEmail: 'a@b.co',
        totalBalance: '100',
        coinsGainedToday: '40',
        streakDays: 5,
        duration: '1s',
        alreadyCollected: false
      },
      { results: [], finalCoins: '100', duration: '1s' },
      { totalDuration: '2s' }
    );
    assert.strictEqual(unifiedReportSchema.safeParse(unified).success, true);

    const multi = buildMultiAccountReportPayload(
      [
        {
          account: { maskedUser: 'a***' },
          user: 'a***',
          checkinResult: null,
          tasksResult: null,
          error: null,
          startTime: new Date(),
          endTime: new Date(),
          duration: '1s'
        }
      ],
      { mainStartTime: new Date(), mainEndTime: new Date(), totalDuration: '2s' }
    );
    assert.strictEqual(multiAccountReportSchema.safeParse(multi).success, true);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - A1: computeCheckinCoinsGained não credita quando coinsGainedToday=0', () => {
  const { computeCheckinCoinsGained } = require('../libs/report');
  const realFilesSnapshot = snapshotRealFiles();
  try {
    // '0' significa que NADA foi coletado: o fallback por streak não pode creditar.
    assert.strictEqual(
      computeCheckinCoinsGained({ coinsGainedToday: '0', alreadyCollected: false, streakDays: 15 }),
      0,
      'coinsGainedToday=0 não pode gerar crédito por streak'
    );
    // Ausente/N/D continuam usando o fallback (compatibilidade).
    assert.strictEqual(
      computeCheckinCoinsGained({
        coinsGainedToday: 'N/D',
        alreadyCollected: false,
        streakDays: 15
      }),
      40
    );
    // Já coletado sem flag de ledger: 0.
    assert.strictEqual(
      computeCheckinCoinsGained({ coinsGainedToday: '40', alreadyCollected: true, streakDays: 15 }),
      0
    );
    // Crédito vindo do extrato é contabilizado mesmo com alreadyCollected=true.
    assert.strictEqual(
      computeCheckinCoinsGained({
        coinsGainedToday: '40',
        alreadyCollected: true,
        checkinCoinsFromLedger: true
      }),
      40
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - skipWebhook evita POST de relatórios sintéticos', async () => {
  const { renderCheckinReport } = require('../libs/report');
  const realFilesSnapshot = snapshotRealFiles();
  const originalFetch = global.fetch;
  const originalUrl = process.env.NOTIFY_WEBHOOK_URL;
  let fetchCalls = 0;
  try {
    process.env.NOTIFY_WEBHOOK_URL = 'https://example.com/hook';
    global.fetch = async () => {
      fetchCalls++;
      return { ok: true, status: 200 };
    };
    renderCheckinReport(
      { alreadyCollected: true, coinsGainedToday: '0', totalBalance: '100', streakDays: 5 },
      { json: true, skipWebhook: true }
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(fetchCalls, 0, 'skipWebhook deve impedir qualquer POST');
  } finally {
    global.fetch = originalFetch;
    if (originalUrl !== undefined) process.env.NOTIFY_WEBHOOK_URL = originalUrl;
    else delete process.env.NOTIFY_WEBHOOK_URL;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/report.js - sanitizeWebhookPayload mascara telefone/ID (sem @) e não vaza por profundidade', () => {
  const { sanitizeWebhookPayload } = require('../libs/report');
  const out = sanitizeWebhookPayload({
    user: '5511999998888',
    userEmail: 'alice@example.com',
    account: { user: '5511888887777' },
    meta: { totalCoinsGained: 10 },
    sessionData: { cookies: [{ name: 'xman_us_t', value: 'SEGREDO' }] }
  });
  assert.strictEqual(out.user, '55***', 'telefone deve ser mascarado');
  assert.strictEqual(out.account.user, '55***');
  assert.strictEqual(out.userEmail, 'al***@example.com');
  assert.strictEqual(out.sessionData, undefined, 'sessionData deve ser removido');
  assert.strictEqual(out.meta.totalCoinsGained, 10);
});

test('libs/report.js - sanitizeWebhookPayload não devolve objeto cru além da profundidade máxima', () => {
  const { sanitizeWebhookPayload } = require('../libs/report');
  let deep = { password: 'SEGREDO' };
  for (let i = 0; i < 10; i++) deep = { nested: deep };
  const out = sanitizeWebhookPayload(deep);
  assert.strictEqual(
    JSON.stringify(out).includes('SEGREDO'),
    false,
    'não deve vazar segredo profundo'
  );
});

test('libs/report.js - payload de webhook Discord neutraliza menções e markdown', async () => {
  const { sendWebhookNotification } = require('../libs/report');
  const originalFetch = global.fetch;
  const originalWebhook = process.env.NOTIFY_WEBHOOK_URL;
  let captured = null;
  global.fetch = async (u, opts) => {
    captured = opts.body;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: { cancel: async () => {} }
    };
  };
  try {
    process.env.NOTIFY_WEBHOOK_URL = 'https://discord.com/api/webhooks/1/abc';
    process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
    await sendWebhookNotification({
      type: 'checkin',
      user: 'a@b.com',
      coinsGainedToday: '10',
      totalBalance: '@everyone **pwn**'
    });
    await require('../libs/report').flushWebhooks(2000);
    assert.ok(captured, 'webhook deve ter sido enviado');
    assert.ok(!captured.includes('@everyone'), 'menção @everyone deve ser neutralizada');
    assert.ok(!/\*\*pwn\*\*/.test(captured), 'markdown deve ser escapado');
  } finally {
    global.fetch = originalFetch;
    if (originalWebhook !== undefined) process.env.NOTIFY_WEBHOOK_URL = originalWebhook;
    else delete process.env.NOTIFY_WEBHOOK_URL;
    delete process.env.ALLOW_PRIVATE_WEBHOOKS;
  }
});
