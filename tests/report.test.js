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
  renderMultiAccountReport
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
      assert.strictEqual(url, 'https://webhook.example.com/notify');
      assert.strictEqual(options.method, 'POST');
      assert.ok(options.body.includes('user@test.com'));
      return { ok: true, status: 200 };
    };

    const resOk = await sendWebhookNotification(
      { type: 'unified_report', user: 'user@test.com' },
      'https://webhook.example.com/notify'
    );
    assert.strictEqual(resOk, true);

    // 3. Com resposta de erro HTTP (ex: 500) -> nunca lança exceção, retorna false
    global.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const resFail = await sendWebhookNotification(
      { type: 'test' },
      'https://webhook.example.com/notify'
    );
    assert.strictEqual(resFail, false);

    // 4. Com falha de rede/timeout -> nunca quebra o job, retorna false
    global.fetch = async () => {
      throw new Error('Connection refused / timeout');
    };
    const resNetError = await sendWebhookNotification(
      { type: 'test' },
      'https://webhook.example.com/notify'
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
    assert.strictEqual(parsed.accounts[0].meta.totalCoinsGained, 10);

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
