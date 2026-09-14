const test = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeHtml,
  buildMessage,
  truncateMessageIfNeeded,
  sendTelegram,
  checkIfImportedSessionExpired
} = require('../libs/notify');
const { configSchema } = require('../config');
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

  // 5. Unified Report (Sucesso e Já Coletado)
  const unifiedReport = {
    type: 'unified_report',
    user: 'ag***@gmail.com',
    checkin: {
      alreadyCollected: false,
      coinsGainedToday: '40',
      streakDays: 200,
      totalBalance: '1550',
      duration: '5s'
    },
    tasks: {
      results: [{ title: 'Explore sponsored items', status: 'Concluída', coins: '+5 moedas' }],
      finalCoins: '1555 moedas',
      duration: '10s'
    },
    meta: {
      finalBalance: '1555 moedas',
      totalDuration: '15s',
      step1Duration: '5s',
      step2Duration: '10s'
    }
  };

  const successMsg = buildMessage({ report: unifiedReport, event: 'success', hostname });
  assert.ok(successMsg.includes('ali-coins —'));
  assert.ok(successMsg.includes('ag***@gmail.com'));
  assert.ok(successMsg.includes('1555 moedas'));
  assert.ok(successMsg.includes('200 dias'));
  assert.ok(successMsg.includes('Tarefas: 1/1 concluídas'));

  // 6. Multi-Account Report
  const multiReport = {
    type: 'multi_account_report',
    accounts: [
      {
        user: 'acc1***@gmail.com',
        checkin: { streakDays: 10, coinsGainedToday: '10', totalBalance: '100' },
        tasks: { results: [] },
        meta: { finalBalance: '100 moedas' }
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
    assert.ok(lastUrl.includes('bot123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456/sendMessage'));
    assert.strictEqual(lastBody.chat_id, '987654321');
    assert.strictEqual(lastBody.parse_mode, 'HTML');

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
});
