const test = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeHtml,
  buildMessage,
  extractRelevantErrorMessage,
  truncateMessageIfNeeded,
  sendTelegram,
  checkIfImportedSessionExpired,
  toSafeInt,
  toSafeStreak,
  postToTelegramWithRetry,
  TELEGRAM_MAX_ATTEMPTS
} = require('../libs/notify');
const { configSchema } = require('../config');
const logger = require('../logger');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('libs/notify.js - escapeHtml neutraliza caracteres perigosos para HTML do Telegram', () => {
  assert.strictEqual(
    escapeHtml('Hello <world> & "friends"'),
    'Hello &lt;world&gt; &amp; "friends"'
  );
  assert.strictEqual(escapeHtml('<b>bold</b>'), '&lt;b&gt;bold&lt;/b&gt;');
  assert.strictEqual(escapeHtml(12345), '12345');
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
});

test('libs/notify.js - truncateMessageIfNeeded respeita limite de 4096 caracteres do Telegram', () => {
  const shortText = 'Mensagem curta de teste';
  assert.strictEqual(truncateMessageIfNeeded(shortText), shortText);

  const longText = 'A'.repeat(5000);
  const truncated = truncateMessageIfNeeded(longText);
  assert.ok(truncated.length <= 4096);
  assert.ok(truncated.includes('mensagem truncada'));
});

test('libs/notify.js - buildMessage gera mensagens formatadas em PT-BR para todos os eventos', () => {
  const hostname = 'test-server';

  // 1. Dry-run
  const dryMsg = buildMessage({ event: 'dry_run', hostname });
  assert.ok(dryMsg.includes('AliExpress Moedas - Teste Dry-Run'));
  assert.ok(dryMsg.includes('test-server'));

  // 2. Manual Test
  const testMsg = buildMessage({ event: 'manual_test', hostname });
  assert.ok(testMsg.includes('Teste de Notificação Telegram'));

  // 3. Lock Active
  const lockMsg = buildMessage({
    event: 'lock_active',
    error: new Error('PID 1234 ativo'),
    hostname
  });
  assert.ok(lockMsg.includes('Execução Bloqueada (Lock Ativo)'));
  assert.ok(lockMsg.includes('PID 1234'));

  // 4. Failure
  const failMsg = buildMessage({
    event: 'failure',
    error: new Error('Timeout ao autenticar'),
    report: { user: 'us***@example.com' },
    hostname
  });
  assert.ok(failMsg.includes('🔴 ali-coins —'));
  assert.ok(failMsg.includes('Timeout ao autenticar'));
  assert.ok(failMsg.includes('us***@example.com'));

  // 5. Unified Report (Sucesso)
  const unifiedReport = {
    type: 'unified_report',
    user: 'ag***@gmail.com',
    checkin: {
      alreadyCollected: false,
      coinsGainedToday: '70',
      streakDays: 33,
      totalBalance: '3135',
      duration: '45s'
    },
    tasks: {
      results: [{ title: 'Explore sponsored items', status: 'Concluída', coins: '+5 moedas' }],
      coinsGained: 41,
      finalCoins: '3176 moedas',
      duration: '2m'
    },
    meta: {
      finalBalance: '3176 moedas',
      totalCoinsGained: 111,
      checkinCoinsGained: 70,
      tasksCoinsGained: 41,
      totalDuration: '2m 45s',
      step1Duration: '45s',
      step2Duration: '2m'
    }
  };

  const successMsg = buildMessage({ report: unifiedReport, event: 'success', hostname });
  assert.ok(successMsg.includes('✅ ali-coins —'));
  assert.ok(successMsg.includes('👤 <b>Conta:</b> <code>ag***@gmail.com</code>'));
  assert.ok(successMsg.includes(`🖥️ <b>Host:</b> <code>${hostname}</code>`));
  assert.ok(successMsg.includes('🪙 Ganhas hoje: +111 moedas (check-in +70 / tarefas +41)'));
  assert.ok(successMsg.includes('📅 Sequência: 33 dias'));
  assert.ok(successMsg.includes('💰 Saldo: 3176 moedas'));
  assert.ok(successMsg.includes('⏱️ Duração: 2m 45s'));

  // 6. Check-in Report
  const checkinReport = {
    type: 'checkin',
    userEmail: 'ag***@gmail.com',
    alreadyCollected: false,
    coinsGainedToday: '70',
    streakDays: 33,
    totalBalance: '3135',
    duration: '45s'
  };
  const checkinMsg = buildMessage({ report: checkinReport, event: 'success', hostname });
  assert.ok(checkinMsg.includes('✅ ali-coins —'));
  assert.ok(checkinMsg.includes('👤 <b>Conta:</b> <code>ag***@gmail.com</code>'));
  assert.ok(checkinMsg.includes(`🖥️ <b>Host:</b> <code>${hostname}</code>`));
  assert.ok(checkinMsg.includes('🪙 Ganhas hoje: +70 moedas (check-in +70 / tarefas +0)'));
  assert.ok(checkinMsg.includes('📅 Sequência: 33 dias'));
  assert.ok(checkinMsg.includes('💰 Saldo: 3135 moedas'));
  assert.ok(checkinMsg.includes('⏱️ Duração: 45s'));

  // 7. Tasks Report
  const tasksReport = {
    type: 'tasks',
    userEmail: 'ag***@gmail.com',
    results: [{ title: 'Explore items', status: 'Concluída' }],
    coinsGained: 41,
    finalCoins: '3176 moedas',
    duration: '2m'
  };
  const tasksMsg = buildMessage({ report: tasksReport, event: 'success', hostname });
  assert.ok(tasksMsg.includes('✅ ali-coins —'));
  assert.ok(tasksMsg.includes('👤 <b>Conta:</b> <code>ag***@gmail.com</code>'));
  assert.ok(tasksMsg.includes(`🖥️ <b>Host:</b> <code>${hostname}</code>`));
  assert.ok(tasksMsg.includes('🪙 Ganhas hoje: +41 moedas (check-in +0 / tarefas +41)'));
  assert.ok(tasksMsg.includes('💰 Saldo: 3176 moedas'));
  assert.ok(tasksMsg.includes('⏱️ Duração: 2m'));

  // 8. Multi-Account Report
  const multiReport = {
    type: 'multi_account_report',
    accounts: [
      {
        user: 'acc1***@gmail.com',
        checkin: { streakDays: 10, coinsGainedToday: '10', totalBalance: '100' },
        tasks: { results: [], coinsGained: 5 },
        meta: {
          finalBalance: '105 moedas',
          totalCoinsGained: 15,
          checkinCoinsGained: 10,
          tasksCoinsGained: 5
        }
      },
      {
        user: 'acc2***@gmail.com',
        checkin: null,
        tasks: null,
        error: 'Sessão expirada'
      }
    ],
    meta: {
      totalAccounts: 2,
      successfulAccounts: 1,
      totalDuration: '30s'
    }
  };

  const multiMsg = buildMessage({ report: multiReport, event: 'success', hostname });
  assert.ok(multiMsg.includes('Multi-Conta'));
  assert.ok(multiMsg.includes('acc1***@gmail.com'));
  assert.ok(multiMsg.includes('acc2***@gmail.com'));
  assert.ok(multiMsg.includes('Sessão expirada'));
});

test('config.js - validação Zod para variáveis do Telegram', () => {
  const baseConfig = {
    ALI_USER: 'test@example.com',
    ALI_PASSWORD: 'password123'
  };

  // 1. TELEGRAM_ENABLED=false permite campos vazios
  const parsedDisabled = configSchema.safeParse({
    ...baseConfig,
    TELEGRAM_ENABLED: 'false',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: ''
  });
  assert.strictEqual(parsedDisabled.success, true);
  assert.strictEqual(parsedDisabled.data.TELEGRAM_ENABLED, false);

  // 2. TELEGRAM_ENABLED=true com token inválido deve falhar
  const parsedInvalidToken = configSchema.safeParse({
    ...baseConfig,
    TELEGRAM_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: 'invalid-token',
    TELEGRAM_CHAT_ID: '12345678'
  });
  assert.strictEqual(parsedInvalidToken.success, false);
  assert.ok(parsedInvalidToken.error.issues.some((i) => i.path.includes('TELEGRAM_BOT_TOKEN')));

  // 3. TELEGRAM_ENABLED=true com chat_id vazio deve falhar
  const parsedMissingChat = configSchema.safeParse({
    ...baseConfig,
    TELEGRAM_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456',
    TELEGRAM_CHAT_ID: '   '
  });
  assert.strictEqual(parsedMissingChat.success, false);
  assert.ok(parsedMissingChat.error.issues.some((i) => i.path.includes('TELEGRAM_CHAT_ID')));

  // 4. TELEGRAM_ENABLED=true com dados válidos deve passar
  const parsedValid = configSchema.safeParse({
    ...baseConfig,
    TELEGRAM_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456',
    TELEGRAM_CHAT_ID: '-1001234567890',
    TELEGRAM_SILENT: 'true',
    TELEGRAM_TIMEOUT_MS: '8000'
  });
  assert.strictEqual(parsedValid.success, true);
  assert.strictEqual(parsedValid.data.TELEGRAM_ENABLED, true);
  assert.strictEqual(parsedValid.data.TELEGRAM_SILENT, true);
  assert.strictEqual(parsedValid.data.TELEGRAM_TIMEOUT_MS, 8000);
});

test('libs/notify.js - sendTelegram com mock de fetch em ambiente isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const originalFetch = global.fetch;

  try {
    const validConfig = {
      TELEGRAM_ENABLED: true,
      TELEGRAM_BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456',
      TELEGRAM_CHAT_ID: '987654321',
      TELEGRAM_SILENT: false,
      TELEGRAM_TIMEOUT_MS: 5000
    };

    // 1. Quando TELEGRAM_ENABLED=false, pula envio sem erro
    const skippedRes = await sendTelegram({
      config: { ...validConfig, TELEGRAM_ENABLED: false },
      event: 'success'
    });
    assert.strictEqual(skippedRes.ok, false);
    assert.strictEqual(skippedRes.skipped, true);

    // 2. Sucesso HTTP 200
    let lastUrl = null;
    let lastBody = null;
    let loggedSuccessMessage = false;
    const origInfo = logger.info;
    logger.info = (...args) => {
      if (
        args.some(
          (a) => typeof a === 'string' && a.includes('Notificação Telegram enviada com sucesso')
        )
      ) {
        loggedSuccessMessage = true;
      }
      return origInfo.apply(logger, args);
    };

    try {
      global.fetch = async (url, options) => {
        lastUrl = url;
        lastBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          text: async () => '{"ok":true}'
        };
      };

      const successRes = await sendTelegram({
        config: validConfig,
        event: 'dry_run'
      });
      assert.strictEqual(successRes.ok, true);
      assert.strictEqual(successRes.status, 200);
      assert.strictEqual(
        loggedSuccessMessage,
        true,
        'Deve emitir log de sucesso no envio da notificação'
      );
      assert.ok(lastUrl.includes('bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456/sendMessage'));
      assert.strictEqual(lastBody.chat_id, '987654321');
      assert.strictEqual(lastBody.parse_mode, 'HTML');
    } finally {
      logger.info = origInfo;
    }

    // 2.1 Envio com chatId customizado por conta
    await sendTelegram({
      config: validConfig,
      chatId: '999888777',
      event: 'dry_run'
    });
    assert.strictEqual(lastBody.chat_id, '999888777');

    // 3. Falha HTTP 403 (bot bloqueado pelo usuário) -> não lança exceção, retorna ok=false
    global.fetch = async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden: bot was blocked by the user',
      text: async () => '{"ok":false,"error_code":403}'
    });

    const blockedRes = await sendTelegram({
      config: validConfig,
      event: 'failure',
      error: new Error('Erro simulado')
    });
    assert.strictEqual(blockedRes.ok, false);
    assert.strictEqual(blockedRes.status, 403);

    // 3.1 Falha HTTP 403 (bot can't initiate conversation) -> trata e retorna ok=false
    global.fetch = async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden: bot can't initiate conversation with a user",
      text: async () =>
        '{"ok":false,"error_code":403,"description":"Forbidden: bot can\'t initiate conversation with a user"}'
    });

    const cantInitiateRes = await sendTelegram({
      config: validConfig,
      event: 'dry_run'
    });
    assert.strictEqual(cantInitiateRes.ok, false);
    assert.strictEqual(cantInitiateRes.status, 403);

    // 4. Erro de rede ou timeout (AbortSignal) -> não quebra a execução do chamador
    global.fetch = async () => {
      throw new Error('The operation was aborted due to timeout');
    };

    const timeoutRes = await sendTelegram({
      config: validConfig,
      event: 'manual_test'
    });
    assert.strictEqual(timeoutRes.ok, false);
    assert.ok(timeoutRes.error.includes('aborted'));

    // 5. HTTP 400 fallback para plain text quando parse de HTML falha
    let postCalls = 0;
    let fallbackSentPlainText = false;
    global.fetch = async (url, options) => {
      postCalls++;
      if (postCalls === 1) {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request: can't parse entities",
          text: async () => '{"ok":false,"description":"Bad Request: can\'t parse entities"}'
        };
      }
      const body = JSON.parse(options.body);
      if (!body.parse_mode && !body.text.includes('<b>')) {
        fallbackSentPlainText = true;
      }
      return {
        ok: true,
        status: 200,
        text: async () => '{"ok":true}'
      };
    };

    const fallbackRes = await sendTelegram({
      config: validConfig,
      event: 'dry_run'
    });
    assert.strictEqual(fallbackRes.ok, true);
    assert.strictEqual(postCalls, 2, 'Deve ter tentado novamente');
    assert.strictEqual(fallbackSentPlainText, true, 'Deve ter enviado sem parse_mode em fallback');

    // 6. Teste da função notify.test()
    const { test: runNotifyTest } = require('../libs/notify');
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '{"ok":true}'
    });
    const testFnRes = await runNotifyTest(validConfig);
    assert.strictEqual(testFnRes, true);
  } finally {
    global.fetch = originalFetch;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/notify.js - detecção e aviso de sessão remota importada expirada no Telegram', () => {
  const hostname = 'remote-vps';

  // 1. checkIfImportedSessionExpired com flag no erro
  const errorWithFlag = new Error('Falha de login no AliExpress');
  errorWithFlag.isImportedSessionExpired = true;
  assert.strictEqual(checkIfImportedSessionExpired(errorWithFlag), true);

  // 2. checkIfImportedSessionExpired com erro padrão sem flag
  const regularError = new Error('Falha de conexão genérica');
  assert.strictEqual(checkIfImportedSessionExpired(regularError), false);

  // 3. checkIfImportedSessionExpired com flag no report
  assert.strictEqual(checkIfImportedSessionExpired(null, { isImportedSessionExpired: true }), true);

  // 4. checkIfImportedSessionExpired com flag em conta multi-conta
  assert.strictEqual(
    checkIfImportedSessionExpired(null, {
      accounts: [{ user: 'acc1', isImportedSessionExpired: true }]
    }),
    true
  );

  // 5. buildMessage inclui alerta explícito e sugestão de node export_session.js
  const msg = buildMessage({
    event: 'failure',
    error: errorWithFlag,
    report: { user: 'user***@gmail.com' },
    hostname
  });

  assert.ok(msg.includes('🔴 ali-coins —'));
  assert.ok(msg.includes('Aviso de Sessão Remota'));
  assert.ok(msg.includes('import_session.js'));
  assert.ok(msg.includes('node export_session.js'));
  assert.ok(msg.includes('servidor de origem'));
  assert.ok(msg.includes('remote-vps'));

  // 6. buildMessage para multi-conta com sessão remota expirada
  const multiMsg = buildMessage({
    event: 'failure',
    report: {
      type: 'multi_account_report',
      accounts: [
        {
          user: 'acc1***@gmail.com',
          error: 'Sessão expirada',
          isImportedSessionExpired: true
        }
      ],
      meta: { totalAccounts: 1, successfulAccounts: 0 }
    },
    error: new Error('Multi-conta falhou'),
    hostname
  });

  assert.ok(multiMsg.includes('Aviso de Sessão Remota'));
  assert.ok(multiMsg.includes('node export_session.js'));
  assert.ok(multiMsg.includes('node import_session.js'));

  // 7. Regex match em string de erro direta
  assert.strictEqual(
    checkIfImportedSessionExpired('Erro: a sessão remota expirou durante o login'),
    true
  );
  assert.strictEqual(
    checkIfImportedSessionExpired('Gere uma nova sessão com node export_session.js'),
    true
  );

  // 8. customMessage em buildMessage
  assert.strictEqual(
    buildMessage({ customMessage: 'Mensagem customizada direta' }),
    'Mensagem customizada direta'
  );

  // 9. customMessage é escapado para HTML (parse_mode do Telegram)
  assert.strictEqual(
    buildMessage({ customMessage: '<b>oi</b> & <script>alert(1)</script>' }),
    '&lt;b&gt;oi&lt;/b&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;'
  );
});

test('libs/notify.js - extractRelevantErrorMessage prioriza causa raiz em vez de logs de encerramento do Playwright', () => {
  // Caso 1: Erro real com seção de logs de encerramento/cleanup do Playwright
  const playwrightSandboxError = `
browserType.launch: Chromium sandboxing failed! No usable sandbox!
=========================== logs ===========================
  - [pid=21] starting temporary directories cleanup
  - [pid=21] finished temporary directories cleanup
  - [pid=21] <gracefully close end>
============================================================
  `;
  const extracted = extractRelevantErrorMessage(playwrightSandboxError);
  assert.ok(
    extracted.includes('Chromium sandboxing failed! No usable sandbox!'),
    'Deve capturar a linha de falha do sandbox'
  );
  assert.ok(
    !extracted.includes('finished temporary directories cleanup'),
    'Não deve incluir a cauda de limpeza de diretórios temporários'
  );

  // Caso 2: Erro com Call log
  const callLogError = `
Error: Timeout 35000ms exceeded while waiting for selector ".aecoin-today-checked"
Call log:
  - waiting for selector ".aecoin-today-checked" to be visible
  -   selector did not match any elements
  - retrying click...
  `;
  const extractedCallLog = extractRelevantErrorMessage(callLogError);
  assert.ok(extractedCallLog.includes('Timeout 35000ms exceeded'));
  assert.ok(!extractedCallLog.includes('retrying click'));

  // Caso 3: Objeto Error padrão
  const simpleError = new Error('Falha de conexão com a página de moedas');
  assert.strictEqual(
    extractRelevantErrorMessage(simpleError),
    'Falha de conexão com a página de moedas'
  );

  // Caso 4: buildMessage com falha real formata a causa raiz
  const failureHtml = buildMessage({
    event: 'failure',
    error: playwrightSandboxError,
    hostname: 'test-vm'
  });
  assert.ok(failureHtml.includes('Chromium sandboxing failed! No usable sandbox!'));
  assert.ok(!failureHtml.includes('finished temporary directories cleanup'));
});

test('libs/notify.js - NOTIFY_HOST_LABEL sobrescreve o hostname aleatório de containers', () => {
  const originalEnv = process.env.NOTIFY_HOST_LABEL;
  try {
    process.env.NOTIFY_HOST_LABEL = 'servidor-producao-vps';

    const msg = buildMessage({ event: 'dry_run' });
    assert.ok(
      msg.includes('servidor-producao-vps'),
      'Deve usar o NOTIFY_HOST_LABEL definido nas variáveis de ambiente'
    );
  } finally {
    if (originalEnv === undefined) {
      delete process.env.NOTIFY_HOST_LABEL;
    } else {
      process.env.NOTIFY_HOST_LABEL = originalEnv;
    }
  }
});

test('libs/notify.js - cálculo de moedas das tarefas por diferença de saldo quando meta não possui tasksCoinsGained', () => {
  const rawReport = {
    type: 'unified_report',
    checkin: {
      alreadyCollected: false,
      coinsGainedToday: '70',
      totalBalance: '3135',
      streakDays: 33
    },
    meta: {
      finalBalance: '3176 moedas',
      totalDuration: '2m 45s'
    }
  };

  const msg = buildMessage({ report: rawReport, event: 'success' });
  assert.ok(
    msg.includes('🪙 Ganhas hoje: +111 moedas (check-in +70 / tarefas +41)'),
    'Deve calcular automaticamente 41 moedas de ganho das tarefas pela diferença (3176 - 3135)'
  );
  assert.ok(msg.includes('💰 Saldo: 3176 moedas'));
  assert.ok(msg.includes('📅 Sequência: 33 dias'));
});

test('libs/notify.js - Bug 12: Telegram report exibe check-in +0 quando alreadyCollected é true', () => {
  const report = {
    type: 'unified_report',
    user: 'test@example.com',
    checkin: {
      coinsGainedToday: '70',
      totalBalance: '3135',
      streakDays: 33,
      alreadyCollected: true
    },
    tasks: {
      coinsGained: 5,
      finalCoins: '3140 moedas'
    },
    meta: {
      finalBalance: '3140 moedas',
      checkinCoinsGained: 0,
      tasksCoinsGained: 5,
      totalCoinsGained: 5,
      totalDuration: '1m 15s'
    }
  };

  const msg = buildMessage({ report, event: 'already_collected' });
  assert.ok(msg.includes('🪙 Ganhas hoje: +5 moedas (check-in +0 / tarefas +5)'));
});

test('libs/notify.js - Bug 15: alertas de multi-conta não atribuem falsamente a Conta 1', () => {
  const multiReport = {
    type: 'multi_account_report',
    accounts: [
      { user: 'acc1***@gmail.com', checkin: { streakDays: 10 } },
      { user: 'acc2***@gmail.com', error: 'Streak quebrado' }
    ]
  };

  const events = ['streak_break', 'lock_active', 'failure', '2fa_required'];
  for (const event of events) {
    const msg = buildMessage({ report: multiReport, event });
    assert.strictEqual(
      msg.includes('👤 <b>Conta:</b>'),
      false,
      `Evento ${event} em relatório consolidado multi-conta não deve incluir a linha "Conta:"`
    );
  }
});

test('libs/notify.js - resolução de duração em notificações unificadas, individuais e multi-conta', () => {
  const hostname = 'test-host';

  // 1. unified_report com totalDuration preenchido (modo conta única ou individual)
  const report1 = {
    type: 'unified_report',
    user: 'single@example.com',
    meta: {
      finalBalance: '1500 moedas',
      totalCoinsGained: 75,
      totalDuration: '42s'
    }
  };
  const msg1 = buildMessage({ report: report1, event: 'success', hostname });
  assert.ok(msg1.includes('⏱️ Duração: 42s'));

  // 2. unified_report com totalDuration='0s' mas com startTime e endTime (recupera duração real)
  const report2 = {
    type: 'unified_report',
    user: 'acc1@example.com',
    meta: {
      finalBalance: '1500 moedas',
      totalCoinsGained: 75,
      startTime: '2026-09-17T10:00:00.000Z',
      endTime: '2026-09-17T10:00:38.000Z',
      totalDuration: '0s'
    }
  };
  const msg2 = buildMessage({ report: report2, event: 'success', hostname });
  assert.ok(
    msg2.includes('⏱️ Duração: 38s'),
    'Deve recuperar duração real a partir de startTime/endTime se totalDuration for 0s'
  );

  // 3. unified_report com totalDuration ausente/0s mas com checkin.duration e tasks.duration
  const report3 = {
    type: 'unified_report',
    user: 'acc2@example.com',
    checkin: {
      duration: '12s'
    },
    tasks: {
      duration: '0s'
    },
    meta: {
      finalBalance: '2000 moedas',
      totalCoinsGained: 40
    }
  };
  const msg3 = buildMessage({ report: report3, event: 'success', hostname });
  assert.ok(msg3.includes('⏱️ Duração: 12s'));

  // 4. checkin com duration='0s' mas com startTime e endTime
  const checkinReport = {
    type: 'checkin',
    userEmail: 'user@example.com',
    alreadyCollected: false,
    coinsGainedToday: '70',
    streakDays: 5,
    totalBalance: '1000',
    startTime: new Date('2026-09-17T10:00:00Z'),
    endTime: new Date('2026-09-17T10:00:19Z'),
    duration: '0s'
  };
  const checkinMsg = buildMessage({ report: checkinReport, event: 'success', hostname });
  assert.ok(checkinMsg.includes('⏱️ Duração: 19s'));

  // 5. tasks com duration='0s' mas com startTime e endTime
  const tasksReport = {
    type: 'tasks',
    userEmail: 'user@example.com',
    coinsGained: 15,
    finalBalance: '1015',
    startTime: new Date('2026-09-17T10:00:00Z'),
    endTime: new Date('2026-09-17T10:01:02Z'),
    duration: '0s'
  };
  const tasksMsg = buildMessage({ report: tasksReport, event: 'success', hostname });
  assert.ok(tasksMsg.includes('⏱️ Duração: 1m 02s'));

  // 6. multi_account_report com startTime e endTime no meta
  const multiReport = {
    type: 'multi_account_report',
    accounts: [{ user: 'acc1***@gmail.com', checkin: { streakDays: 10 } }],
    meta: {
      totalAccounts: 1,
      successfulAccounts: 1,
      startTime: '2026-09-17T10:00:00.000Z',
      endTime: '2026-09-17T10:01:25.000Z',
      totalDuration: '0s'
    }
  };
  const multiMsg = buildMessage({ report: multiReport, event: 'success', hostname });
  assert.ok(multiMsg.includes('⏱️ <b>Duração Total:</b> 1m 25s'));
});

test('libs/notify.js - template multi-conta normalização e proteção contra valores exóticos / injeção HTML', () => {
  const hostname = 'test-server';

  // 1. Snapshot da linha [1] ... para entrada válida (garante equivalência byte-a-byte com a versão anterior)
  const validReport = {
    type: 'multi_account_report',
    accounts: [
      {
        user: 'acc1***@gmail.com',
        checkin: { streakDays: 10, coinsGainedToday: '10', totalBalance: '100' },
        tasks: { results: [], coinsGained: 5 },
        meta: {
          finalBalance: '105 moedas',
          totalCoinsGained: 15,
          checkinCoinsGained: 10,
          tasksCoinsGained: 5
        }
      }
    ],
    meta: {
      totalAccounts: 1,
      successfulAccounts: 1,
      totalDuration: '10s'
    }
  };
  const validMsg = buildMessage({ report: validReport, event: 'success', hostname });
  const expectedLine =
    '[1] <code>acc1***@gmail.com</code>: 💰 <b>105 moedas</b> | 🪙 +15 (+10/+5) | Streak: 10 dias';
  assert.ok(
    validMsg.includes(expectedLine),
    `A linha de saída deve corresponder exatamente ao snapshot:\nEsperado: ${expectedLine}\nRecebido na msg:\n${validMsg}`
  );

  // 2. Valores exóticos (streakDays com tag HTML crua, totalCoins e checkinCoins não-numéricos)
  const exoticReport = {
    type: 'multi_account_report',
    accounts: [
      {
        user: 'evil<script>***@evil.com',
        checkin: { streakDays: '12<b>evil', coinsGainedToday: 'invalid' },
        tasks: { coinsGained: 'undefined' },
        meta: {
          finalBalance: '<b>fake</b> moedas',
          totalCoinsGained: 'abc',
          checkinCoinsGained: 'corrupted',
          tasksCoinsGained: null
        }
      }
    ],
    meta: {
      totalAccounts: 'NaN',
      successfulAccounts: -1
    }
  };

  let exoticMsg;
  assert.doesNotThrow(() => {
    exoticMsg = buildMessage({ report: exoticReport, event: 'success', hostname });
  });

  // Não deve conter tags cruas perigosas
  assert.ok(!exoticMsg.includes('<b>evil'));
  assert.ok(!exoticMsg.includes('<script>'));
  // Tags escapadas com segurança
  assert.ok(exoticMsg.includes('&lt;script&gt;'));
  assert.ok(exoticMsg.includes('&lt;b&gt;fake&lt;/b&gt;'));
  // Streak inválido coage para N/D
  assert.ok(exoticMsg.includes('Streak: N/D'));
  // Moedas inválidas coagem para 0
  assert.ok(exoticMsg.includes('🪙 +0 (+0/+0)'));
  // Resumo coage para 0/0
  assert.ok(exoticMsg.includes('📊 <b>Resumo:</b> 0/0'));
});

test('libs/notify.js - toSafeInt e toSafeStreak sanitizam valores com segurança', () => {
  assert.strictEqual(toSafeInt(10), 10);
  assert.strictEqual(toSafeInt('15'), 15);
  assert.strictEqual(toSafeInt('0'), 0);
  assert.strictEqual(toSafeInt(0), 0);
  assert.strictEqual(toSafeInt(-5), 0);
  assert.strictEqual(toSafeInt('abc'), 0);
  assert.strictEqual(toSafeInt(null), 0);
  assert.strictEqual(toSafeInt(undefined), 0);
  assert.strictEqual(toSafeInt(NaN), 0);
  assert.strictEqual(toSafeInt(Infinity), 0);

  assert.strictEqual(toSafeStreak(10), '10 dias');
  assert.strictEqual(toSafeStreak('15'), '15 dias');
  assert.strictEqual(toSafeStreak(0), 'N/D');
  assert.strictEqual(toSafeStreak(-2), 'N/D');
  assert.strictEqual(toSafeStreak('12<b>evil'), 'N/D');
  assert.strictEqual(toSafeStreak('abc'), 'N/D');
  assert.strictEqual(toSafeStreak(null), 'N/D');
  assert.strictEqual(toSafeStreak(undefined), 'N/D');
});

test('libs/notify.js - sendTelegram trunca erros longos antes de enviar (limite de 4096)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const originalFetch = global.fetch;

  try {
    const validConfig = {
      TELEGRAM_ENABLED: true,
      TELEGRAM_BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456',
      TELEGRAM_CHAT_ID: '987654321',
      TELEGRAM_SILENT: false,
      TELEGRAM_TIMEOUT_MS: 5000
    };

    let lastBody = null;
    global.fetch = async (url, options) => {
      lastBody = JSON.parse(options.body);
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    };

    const hugeError = new Error('E'.repeat(9000));
    const res = await sendTelegram({ config: validConfig, event: 'failure', error: hugeError });

    assert.strictEqual(res.ok, true);
    assert.ok(lastBody, 'Payload deve ter sido enviado');
    assert.ok(
      lastBody.text.length <= 4096,
      `Texto enviado ao Telegram deve respeitar 4096 chars (obtido ${lastBody.text.length})`
    );
    assert.ok(lastBody.text.includes('mensagem truncada'));
  } finally {
    global.fetch = originalFetch;
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/notify.js - escapa campos dinâmicos (streak/saldo/duração) no HTML do Telegram', () => {
  const report = {
    type: 'unified_report',
    user: 'us***@example.com',
    checkin: {
      alreadyCollected: false,
      coinsGainedToday: '10',
      streakDays: '<b>7</b>',
      totalBalance: '<i>100</i>',
      duration: '1s'
    },
    tasks: null,
    meta: {
      finalBalance: '<script>alert(1)</script>',
      totalCoinsGained: 10,
      checkinCoinsGained: 10,
      tasksCoinsGained: 0,
      totalDuration: '<x>1s</x>'
    }
  };

  const msg = buildMessage({ report, event: 'success', hostname: 'host-teste' });

  assert.strictEqual(msg.includes('<b>7</b>'), false, 'streakDays deve ser escapado');
  assert.ok(msg.includes('&lt;b&gt;7&lt;/b&gt;'), 'streakDays escapado deve aparecer');
  assert.strictEqual(msg.includes('<script>'), false, 'saldo não deve injetar HTML');
  assert.strictEqual(msg.includes('<i>100</i>'), false, 'saldo deve ser escapado');
  assert.strictEqual(msg.includes('<x>1s</x>'), false, 'duração deve ser escapada');
});

test('libs/notify.js - multi-conta sem meta não conta check-in fantasma (alreadyCollected=true)', () => {
  const report = {
    type: 'multi_account_report',
    accounts: [
      {
        user: 'co***@example.com',
        checkin: {
          alreadyCollected: true,
          coinsGainedToday: '70',
          streakDays: 10,
          totalBalance: '500'
        },
        tasks: null
        // sem `meta` de propósito: força o fallback compartilhado
      }
    ],
    meta: { totalAccounts: 1, successfulAccounts: 1 }
  };

  const msg = buildMessage({ report, event: 'success' });
  assert.ok(msg.includes('+0 (+0/+0)'), `Ganho não pode ser inflado por check-in já feito: ${msg}`);
  assert.strictEqual(msg.includes('+70'), false, 'Valor fantasma de 70 não pode aparecer');
});

test('libs/notify.js - notificação Telegram exibe extrato separado (check-in e tarefas) sem soma indevida', () => {
  const { buildUnifiedReportPayload, buildMultiAccountReportPayload } = require('../libs/report');

  const checkin = {
    alreadyCollected: false,
    coinsGainedToday: '40',
    streakDays: 35,
    totalBalance: '1040',
    duration: '15s'
  };

  const tasksTainted = {
    results: [{ title: 'Explore sponsored items', status: 'Concluída', coins: '+5 moedas' }],
    initialBalance: 1000,
    finalBalance: 1045,
    coinsGained: 45, // Absorveu as 40 moedas do check-in
    finalCoins: '1045 moedas',
    duration: '1m'
  };

  // 1. Relatório Unificado
  const unifiedPayload = buildUnifiedReportPayload(checkin, tasksTainted, {
    user: 'us***@example.com'
  });
  const singleMsg = buildMessage({ report: unifiedPayload, event: 'success' });
  assert.ok(
    singleMsg.includes('🪙 Ganhas hoje: +45 moedas (check-in +40 / tarefas +5)'),
    `Notificação unificada deve mostrar check-in +40 e tarefas +5: ${singleMsg}`
  );
  assert.ok(singleMsg.includes('📅 Sequência: 35 dias'));

  // 2. Relatório Multi-Conta
  const multiPayload = buildMultiAccountReportPayload([
    {
      account: { maskedUser: 'us***@example.com' },
      checkinResult: checkin,
      tasksResult: tasksTainted
    }
  ]);
  const multiMsg = buildMessage({ report: multiPayload, event: 'success' });
  assert.ok(
    multiMsg.includes('🪙 +45 (+40/+5)'),
    `Notificação multi-conta deve exibir +45 (+40/+5): ${multiMsg}`
  );
  assert.ok(multiMsg.includes('Streak: 35'));
});

test('libs/notify.js - extrato e notificações não contabilizam nada de check-in quando alreadyCollected=true', () => {
  const { buildUnifiedReportPayload, buildMultiAccountReportPayload } = require('../libs/report');

  const checkinAlready = {
    alreadyCollected: true,
    coinsGainedToday: '0',
    streakDays: 35,
    totalBalance: '1000',
    duration: '10s'
  };

  const tasks = {
    results: [{ title: 'Explore sponsored items', status: 'Concluída', coins: '+5 moedas' }],
    initialBalance: 1000,
    finalBalance: 1005,
    coinsGained: 5,
    finalCoins: '1005 moedas',
    duration: '1m'
  };

  // 1. Relatório apenas check-in (alreadyCollected=true)
  const checkinMsg = buildMessage({
    report: {
      type: 'checkin',
      alreadyCollected: true,
      coinsGainedToday: '0',
      streakDays: 35,
      totalBalance: '1000',
      duration: '5s'
    },
    event: 'already_collected'
  });
  assert.ok(
    checkinMsg.includes('🪙 Ganhas hoje: +0 moedas (check-in +0 / tarefas +0)'),
    `Check-in notification não deve contabilizar moedas: ${checkinMsg}`
  );

  // 2. Relatório unificado (alreadyCollected=true com tarefas)
  const unifiedPayload = buildUnifiedReportPayload(checkinAlready, tasks, {
    user: 'us***@example.com'
  });
  const unifMsg = buildMessage({ report: unifiedPayload, event: 'success' });
  assert.ok(
    unifMsg.includes('🪙 Ganhas hoje: +5 moedas (check-in +0 / tarefas +5)'),
    `Notificação unificada deve exibir check-in +0 e tarefas +5: ${unifMsg}`
  );

  // 3. Relatório multi-conta (Conta 1 alreadyCollected=true, Conta 2 coletado hoje)
  const multiPayload = buildMultiAccountReportPayload([
    {
      account: { maskedUser: 'co1***@example.com' },
      checkinResult: checkinAlready,
      tasksResult: tasks
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
        initialBalance: 2070,
        finalBalance: 2075,
        coinsGained: 5,
        finalCoins: '2075 moedas',
        duration: '1m'
      }
    }
  ]);
  const multiMsg = buildMessage({ report: multiPayload, event: 'success' });
  assert.ok(
    multiMsg.includes(
      '<code>co1***@example.com</code>: 💰 <b>1005 moedas</b> | 🪙 +5 (+0/+5) | Streak: 35 dias'
    ),
    `Conta 1 deve exibir (+0/+5): ${multiMsg}`
  );
  assert.ok(
    multiMsg.includes(
      '<code>co2***@example.com</code>: 💰 <b>2075 moedas</b> | 🪙 +75 (+70/+5) | Streak: 45 dias'
    ),
    `Conta 2 deve exibir (+70/+5): ${multiMsg}`
  );
});

test('libs/notify.js - fallback de sessão importada não usa o meta primário em relatório multi-conta', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const config = require('../config');
  const {
    createIsolatedTestDir,
    cleanupIsolatedTestDir,
    snapshotRealFiles,
    assertRealFilesUntouched
  } = require('./test_helper');

  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('notify-multi-meta-');
  const originalMetaPath = config.sessionMetaPath;

  try {
    const metaPath = path.join(tmpDir, 'session_meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({ user: 'primary@example.com', isImported: true }));
    config.sessionMetaPath = metaPath;

    // Conta única (sem report.accounts): fallback no meta continua valendo
    assert.strictEqual(
      checkIfImportedSessionExpired(new Error('Falha de login no AliExpress')),
      true,
      'Conta única deve continuar usando o fallback do meta para sessão importada'
    );

    // Multi-conta: meta primário NÃO deve ser aplicado a falhas de outras contas
    assert.strictEqual(
      checkIfImportedSessionExpired(new Error('Falha de login no AliExpress'), {
        type: 'multi_account_report',
        accounts: [{ user: 'acc2***@example.com' }]
      }),
      false,
      'Relatório multi-conta sem flags por conta não deve herdar o meta da conta primária'
    );

    // Flags por conta continuam funcionando
    assert.strictEqual(
      checkIfImportedSessionExpired(null, {
        accounts: [{ user: 'acc2***@example.com', isImportedSessionExpired: true }]
      }),
      true
    );
  } finally {
    config.sessionMetaPath = originalMetaPath;
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/notify.js - postToTelegramWithRetry reenvia em 5xx/429 e desiste em 4xx', async () => {
  const originalFetch = global.fetch;
  const url = 'https://api.telegram.org/botX/sendMessage';
  const payload = { chat_id: '1', text: 'oi' };

  try {
    // 503 duas vezes, depois 200
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls < 3) return { ok: false, status: 503, text: async () => 'unavailable' };
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    };
    const res = await postToTelegramWithRetry(url, payload, 1000);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(calls, 3, 'deve tentar novamente até obter sucesso');

    // 400 é definitivo: 1 tentativa
    calls = 0;
    global.fetch = async () => {
      calls++;
      return { ok: false, status: 400, text: async () => 'bad request' };
    };
    const bad = await postToTelegramWithRetry(url, payload, 1000);
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(calls, 1, '4xx não deve ser reenviado');

    assert.ok(TELEGRAM_MAX_ATTEMPTS >= 2, 'deve haver mais de uma tentativa por padrão');
  } finally {
    global.fetch = originalFetch;
  }
});

test('libs/notify.js - postToTelegramWithRetry lança após esgotar tentativas de rede', async () => {
  const originalFetch = global.fetch;
  const url = 'https://api.telegram.org/botX/sendMessage';
  let calls = 0;

  try {
    global.fetch = async () => {
      calls++;
      throw new Error('socket hang up');
    };
    await assert.rejects(
      () => postToTelegramWithRetry(url, { chat_id: '1', text: 'oi' }, 500),
      /socket hang up/
    );
    assert.strictEqual(calls, TELEGRAM_MAX_ATTEMPTS, 'deve esgotar todas as tentativas');
  } finally {
    global.fetch = originalFetch;
  }
});

test('libs/notify.js - shouldSkipAccountNotification suprime conta com chat igual ao global', () => {
  const { shouldSkipAccountNotification } = require('../libs/notify');
  assert.strictEqual(shouldSkipAccountNotification('2659***', '2659***'), true);
  assert.strictEqual(shouldSkipAccountNotification(123456, '123456'), true);
  assert.strictEqual(shouldSkipAccountNotification('111', '222'), false);
  assert.strictEqual(shouldSkipAccountNotification(null, '222'), false);
  assert.strictEqual(shouldSkipAccountNotification('111', null), false);
  assert.strictEqual(shouldSkipAccountNotification('', ''), false);
});
