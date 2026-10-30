'use strict';

// Silencia logs de produção durante os testes de integração (o arquivo roda em processo
// isolado pelo node --test). Precisa vir antes do primeiro require do logger.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  freezeTime,
  createCoinCenterPage,
  createCalendarPage,
  createLoginGatePage,
  createAuthenticatedCoinPage,
  createBrowserForPage,
  createSearchScenario,
  createCaptureLogger,
  todayPacificDate
} = require('./helpers/playwright-harness');
const { checkSessionReadOnly } = require('../libs/session-check');
const {
  getBalanceDesktop,
  getCheckinCalendarFromCoinPage,
  isRealStreakReading,
  isLoginGateVisible,
  isLoginGateText
} = require('../libs/ui/balance');
const { executeSearchTask, isCoinSearchResultUrl } = require('../libs/tasks/search');
const {
  REPORT_SCHEMA_VERSION,
  buildUnifiedReportPayload,
  resolveDailyCheckinCoins,
  unifiedReportSchema
} = require('../libs/report');
const { shouldAttemptLogin } = require('../collect');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

const ENV_KEYS = [
  'PW_OUTPUT_DIR',
  'PW_TRACE',
  'PW_SCREENSHOT',
  'ENCRYPT_LOCAL_SESSION',
  'DESKTOP_REUSE_CONTEXT'
];

/**
 * Isola artefatos de diagnóstico e desliga criptografia/migração de sessão no teste.
 * @param {string} tmpDir
 * @returns {() => void} restaurador do ambiente anterior
 */
/**
 * Lista nomes de arquivos de um diretório para detectar escrita fora do isolamento.
 * @param {string} dir
 * @returns {string[]}
 */
function listDirSafe(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function isolateHarnessEnv(tmpDir) {
  const previous = {};
  for (const key of ENV_KEYS) previous[key] = process.env[key];

  process.env.PW_OUTPUT_DIR = path.join(tmpDir, 'scratch');
  process.env.PW_TRACE = 'off';
  process.env.PW_SCREENSHOT = 'off';
  process.env.ENCRYPT_LOCAL_SESSION = 'false';
  delete process.env.DESKTOP_REUSE_CONTEXT;

  return () => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

/**
 * Grava uma sessão em texto plano no diretório temporário (nunca no projeto real).
 * @param {string} dir
 * @param {{user?: string, expiresInSeconds?: number}} [options={}]
 * @returns {{sessionPath: string, metaPath: string}}
 */
function writePlainSession(dir, { user = 'user@example.com', expiresInSeconds = 3600 } = {}) {
  const sessionPath = path.join(dir, 'session.json');
  const metaPath = path.join(dir, 'session_meta.json');
  const storageState = {
    cookies: [
      {
        name: 'xman_us_t',
        value: 'token_de_teste_nao_real',
        domain: '.aliexpress.com',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + expiresInSeconds,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax'
      }
    ]
  };
  const meta = {
    schemaVersion: 1,
    user,
    savedAt: new Date().toISOString(),
    encrypted: false
  };
  fs.writeFileSync(sessionPath, JSON.stringify(storageState, null, 2), { mode: 0o600 });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  return { sessionPath, metaPath };
}

test('integração: sessão válida lê check-in/calendário e gera relatório unificado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('ali-integration-valid-');
  const restoreEnv = isolateHarnessEnv(tmpDir);
  // Relógio fixo: a data de HOJE no fuso do AliExpress não pode mudar no meio do teste.
  const restoreClock = freezeTime('2026-10-30T12:00:00.000Z');

  try {
    const user = 'user@example.com';
    const { sessionPath } = writePlainSession(tmpDir, { user });

    // 1) --check-session somente leitura: não clica, não coleta, apenas lê o saldo/streak.
    const coinPage = createCoinCenterPage({ balance: '5,245', bonus: 40, streak: 254 });
    const { browser: checkBrowser } = createBrowserForPage(coinPage);
    const check = await checkSessionReadOnly({
      browser: checkBrowser,
      account: { user, sessionPath },
      config: { NAV_TIMEOUT_SHORT: 2000 }
    });
    assert.deepStrictEqual(check, {
      user: 'us***@example.com',
      ok: true,
      reason: null,
      balance: '5245',
      streak: 254
    });
    assert.strictEqual(coinPage.isClosed(), true, 'contexto desktop deve ser fechado na checagem');

    // 2) Leitura do extrato de HOJE no desktop (fonte de verdade do check-in).
    const ledgerPage = createCoinCenterPage({ balance: '5,245', bonus: 40, streak: 254 });
    const { browser: ledgerBrowser } = createBrowserForPage(ledgerPage);
    const desktop = await getBalanceDesktop(ledgerBrowser, { cookies: [] });
    assert.strictEqual(desktop.totalBalance, '5245');
    assert.strictEqual(desktop.todayCheckinCoins, '40');
    assert.strictEqual(desktop.todayBonusCoins, 40);
    assert.strictEqual(desktop.hasAppCheckinToday, true);
    assert.strictEqual(desktop.desktopStreak, 254);
    assert.strictEqual(desktop.loginPromptDetected, false);
    assert.ok(
      desktop.rawText.includes(todayPacificDate()),
      'fixture deve conter a data de hoje no fuso do AliExpress'
    );

    // 3) Calendário mobile: a leitura de 254 dias é confirmada como streak real.
    const calendar = await getCheckinCalendarFromCoinPage(
      createCalendarPage({ todayDay: 254, maxDay: 260 })
    );
    assert.deepStrictEqual(calendar, { todayDay: 254, maxDay: 260 });
    assert.strictEqual(isRealStreakReading(desktop.desktopStreak, calendar), true);
    assert.strictEqual(isRealStreakReading(7, calendar), false, 'ciclo semanal não é streak real');

    // 4) Relatório: o crédito do extrato entra no consolidado, mesmo já coletado.
    const checkinResult = {
      userEmail: user,
      alreadyCollected: desktop.hasAppCheckinToday,
      coinsGainedToday: desktop.todayCheckinCoins,
      streakDays: desktop.desktopStreak,
      previousStreakDays: 254,
      totalBalance: desktop.totalBalance,
      duration: '1s',
      startTime: new Date(Date.now() - 2000),
      endTime: new Date(Date.now() - 1000),
      checkinCoinsFromLedger: desktop.todayBonusCoins !== null
    };
    const payload = buildUnifiedReportPayload(checkinResult, null, {
      user,
      startTime: new Date(Date.now() - 2000).toISOString(),
      endTime: new Date(Date.now() - 1000).toISOString(),
      totalDuration: '2s'
    });

    assert.strictEqual(payload.type, 'unified_report');
    assert.strictEqual(payload.schemaVersion, REPORT_SCHEMA_VERSION);
    assert.strictEqual(payload.user, user);
    assert.strictEqual(payload.checkin.alreadyCollected, true);
    assert.strictEqual(payload.checkin.coinsGainedToday, '40');
    assert.strictEqual(payload.checkin.streakDays, 254);
    assert.strictEqual(payload.checkin.totalBalance, '5245');
    assert.strictEqual(payload.meta.finalBalance, '5245 moedas');
    assert.strictEqual(payload.meta.checkinCoinsGained, 40);
    assert.strictEqual(payload.meta.totalCoinsGained, 40);
    assert.deepStrictEqual(resolveDailyCheckinCoins(checkinResult), {
      coins: 40,
      source: 'real'
    });
    const contract = unifiedReportSchema.safeParse(payload);
    assert.strictEqual(
      contract.success,
      true,
      contract.success ? '' : JSON.stringify(contract.error.issues)
    );
  } finally {
    restoreClock();
    restoreEnv();
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('integração: sessão expirada no servidor exibe gate DOM e falha de forma clara', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('ali-integration-gate-');
  const restoreEnv = isolateHarnessEnv(tmpDir);
  const realScratchDir = path.join(__dirname, '..', 'scratch');
  const realScratchBefore = listDirSafe(realScratchDir);

  try {
    const user = 'user@example.com';
    const { sessionPath } = writePlainSession(tmpDir, { user });

    // Portaria de login (DOM): título COINS + botão "Log in", sem saldo.
    const gatePage = createLoginGatePage();
    assert.strictEqual(await isLoginGateVisible(gatePage), true);
    assert.strictEqual(isLoginGateText(gatePage.bodyText), true);
    assert.strictEqual(
      shouldAttemptLogin({
        hasValidSession: true,
        gateVisible: true,
        bodyText: gatePage.bodyText
      }),
      true,
      'sessão local válida não impede o re-login quando o servidor mostra a portaria'
    );

    // Página autenticada com link "Log in" no rodapé NÃO pode ser confundida com gate.
    const authenticatedPage = createAuthenticatedCoinPage({ balance: '5,245' });
    assert.strictEqual(await isLoginGateVisible(authenticatedPage), false);
    assert.strictEqual(
      shouldAttemptLogin({ hasValidSession: true, bodyText: authenticatedPage.bodyText }),
      false,
      'link de login no rodapé de página autenticada não dispara re-login'
    );

    // Sessão local ainda válida, mas o servidor pede reautenticação in-page: a checagem
    // somente leitura precisa falhar com motivo explícito (não "saldo N/D" genérico).
    const promptPage = createCoinCenterPage({ loginPrompt: true });
    const { browser } = createBrowserForPage(promptPage);
    const result = await checkSessionReadOnly({
      browser,
      account: { user, sessionPath },
      config: { NAV_TIMEOUT_SHORT: 2000 }
    });

    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /Prompt de login\/reautenticação/);
    assert.strictEqual(result.balance, null);
    assert.strictEqual(result.streak, null);

    // Diagnóstico vai para o diretório isolado, nunca para o scratch/ real.
    const scratchDir = path.join(tmpDir, 'scratch');
    const artifacts = fs.readdirSync(scratchDir);
    assert.ok(
      artifacts.some((name) => name.startsWith('balance-not-found-') && name.endsWith('.png')),
      `esperava screenshot de diagnóstico isolado; encontrado: ${artifacts.join(', ')}`
    );
    assert.deepStrictEqual(
      listDirSafe(realScratchDir),
      realScratchBefore,
      'o teste não pode gravar diagnóstico no scratch/ real'
    );
  } finally {
    restoreEnv();
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('integração: --check-session aceita sessão válida e rejeita expirada/ausente/de outra conta', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('ali-integration-check-session-');
  const restoreEnv = isolateHarnessEnv(tmpDir);

  try {
    const user = 'user@example.com';
    const valid = writePlainSession(tmpDir, { user });

    // Válida: abre o desktop falso e devolve saldo/streak.
    const validScenario = createBrowserForPage(createCoinCenterPage({ balance: '1.234' }));
    const ok = await checkSessionReadOnly({
      browser: validScenario.browser,
      account: { user, sessionPath: valid.sessionPath },
      config: { NAV_TIMEOUT_SHORT: 2000 }
    });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.balance, '1234');
    assert.strictEqual(ok.streak, 254);

    // Expirada: validação local barra antes de abrir qualquer contexto de navegador.
    const expired = writePlainSession(tmpDir, { user, expiresInSeconds: -60 });
    const expiredBrowserScenario = createBrowserForPage(createCoinCenterPage());
    const expiredResult = await checkSessionReadOnly({
      browser: expiredBrowserScenario.browser,
      account: { user, sessionPath: expired.sessionPath },
      config: {}
    });
    assert.strictEqual(expiredResult.ok, false);
    assert.match(expiredResult.reason, /cookies de autenticação.*expirados/i);
    assert.strictEqual(expiredBrowserScenario.browser.calls.length, 0);

    // Ausente: arquivo de sessão inexistente.
    const missingBrowserScenario = createBrowserForPage(createCoinCenterPage());
    const missingResult = await checkSessionReadOnly({
      browser: missingBrowserScenario.browser,
      account: { user, sessionPath: path.join(tmpDir, 'nao-existe.json') },
      config: {}
    });
    assert.strictEqual(missingResult.ok, false);
    assert.match(missingResult.reason, /Sessão local inválida ou ausente|Dados da sessão ausentes/);
    assert.strictEqual(missingBrowserScenario.browser.calls.length, 0);

    // Outra conta: a sessão pertence a outro usuário e não pode ser reutilizada.
    const other = writePlainSession(tmpDir, { user: 'outra-conta@example.com' });
    const mismatchBrowserScenario = createBrowserForPage(createCoinCenterPage());
    const mismatchResult = await checkSessionReadOnly({
      browser: mismatchBrowserScenario.browser,
      account: { user, sessionPath: other.sessionPath },
      config: {}
    });
    assert.strictEqual(mismatchResult.ok, false);
    assert.match(mismatchResult.reason, /não corresponde à conta configurada/);
    assert.strictEqual(mismatchBrowserScenario.browser.calls.length, 0);
  } finally {
    restoreEnv();
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('integração: busca embutida abre popup permitido e o fecha ao terminar', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('ali-integration-search-');
  const restoreEnv = isolateHarnessEnv(tmpDir);

  try {
    const scenario = createSearchScenario();
    const logger = createCaptureLogger();
    const result = await executeSearchTask({
      page: scenario.page,
      scrollWaitSeconds: 0,
      config: { TASK_SCROLL_MAX_MS: 0 },
      logger
    });

    assert.strictEqual(result, true);
    assert.strictEqual(
      scenario.context.calls.filter((call) => call.name === 'waitForEvent').length,
      1,
      'deve aguardar exatamente uma nova aba'
    );
    assert.deepStrictEqual(
      scenario.context.calls.find((call) => call.name === 'waitForEvent')?.args,
      ['page', { timeout: 8000 }]
    );
    assert.strictEqual(scenario.popup.isClosed(), true, 'aba de resultado deve ser fechada');
    assert.ok(scenario.popup.calls.some((call) => call.name === 'close'));
    assert.strictEqual(scenario.page.isClosed(), false, 'página principal permanece aberta');
    assert.ok(
      logger.messages.some((message) => message.includes('Busca embutida da central de moedas')),
      `esperava log da busca embutida; recebido: ${logger.messages.join(' | ')}`
    );

    // Sem nova aba: o fluxo avisa e não tenta rolar uma página que não é o resultado.
    const noPopup = createSearchScenario({ openPopup: false });
    const noPopupLogger = createCaptureLogger();
    await executeSearchTask({
      page: noPopup.page,
      scrollWaitSeconds: 0,
      config: { TASK_SCROLL_MAX_MS: 0 },
      logger: noPopupLogger
    });
    assert.strictEqual(noPopup.popup.isClosed(), false);
    assert.ok(
      noPopupLogger.messages.some((message) =>
        message.includes('não abriu a página de resultados esperada')
      )
    );
    assert.ok(
      noPopupLogger.messages.some((message) =>
        message.includes('Campo/atalho de busca não disponível')
      )
    );
  } finally {
    restoreEnv();
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('integração: popup externo ou HTTP é rejeitado e fechado sem rolagem', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('ali-integration-popup-');
  const restoreEnv = isolateHarnessEnv(tmpDir);

  try {
    assert.strictEqual(
      isCoinSearchResultUrl('https://m.aliexpress.com/p/coin-search/result.html?search_query=rx'),
      true
    );
    assert.strictEqual(
      isCoinSearchResultUrl('https://pt.aliexpress.com/p/coin-search/result.html'),
      true,
      'subdomínios regionais do AliExpress são aceitos'
    );

    const rejectedUrls = [
      'https://evil.example/p/coin-search/result.html',
      'http://m.aliexpress.com/p/coin-search/result.html',
      'https://aliexpress.com.evil.example/p/coin-search/result.html',
      'https://evil-aliexpress.com/p/coin-search/result.html'
    ];

    for (const popupUrl of rejectedUrls) {
      assert.strictEqual(isCoinSearchResultUrl(popupUrl), false, popupUrl);

      const scenario = createSearchScenario({ popupUrl });
      const logger = createCaptureLogger();
      const result = await executeSearchTask({
        page: scenario.page,
        scrollWaitSeconds: 0,
        config: { TASK_SCROLL_MAX_MS: 0 },
        logger
      });

      assert.strictEqual(result, true, 'contrato atual: falha de busca é reportada por log');
      assert.strictEqual(scenario.popup.isClosed(), true, `popup deve ser fechado: ${popupUrl}`);
      assert.ok(
        logger.messages.some((message) =>
          message.includes('não é a página de resultados esperada')
        ),
        `esperava aviso de rejeição para ${popupUrl}; recebido: ${logger.messages.join(' | ')}`
      );
      assert.ok(
        !scenario.popup.calls.some((call) => call.name === 'evaluate'),
        'popup rejeitado não pode receber rolagem/interação'
      );
    }
  } finally {
    restoreEnv();
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
