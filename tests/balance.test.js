const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractStreakFromText,
  getStreakFromCheckinCoins,
  getCheckinCoinsFromStreak,
  getStreakFromDesktopHistory,
  getStreakFromCoinPage,
  getBalanceDesktop
} = require('../libs/ui/balance');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('libs/ui/balance.js - extractStreakFromText reconhece padrões multilíngues (pt, en, es)', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    // Padrões em Português
    assert.strictEqual(extractStreakFromText('Sequência de 15 dias'), 15);
    assert.strictEqual(extractStreakFromText('sequencia de 7 dias'), 7);
    assert.strictEqual(extractStreakFromText('Sequência: 10 dias'), 10);
    assert.strictEqual(extractStreakFromText('7 dias seguidos (+40 moedas/dia)'), 7);
    assert.strictEqual(extractStreakFromText('3 dias consecutivos'), 3);
    assert.strictEqual(extractStreakFromText('14 dias de sequência'), 14);
    assert.strictEqual(extractStreakFromText('Check-in de 10 dias'), 10);
    assert.strictEqual(extractStreakFromText('Check-in diário: 5 dias'), 5);
    assert.strictEqual(extractStreakFromText('Você completou 21 dias seguidos!'), 21);

    // Padrões em Inglês
    assert.strictEqual(extractStreakFromText('15 days streak'), 15);
    assert.strictEqual(extractStreakFromText('15 day streak'), 15);
    assert.strictEqual(extractStreakFromText('5-day streak'), 5);
    assert.strictEqual(extractStreakFromText('streak: 20'), 20);
    assert.strictEqual(extractStreakFromText('8 days in a row'), 8);

    // Padrões em Espanhol
    assert.strictEqual(extractStreakFromText('Secuencia de 5 dias'), 5);
    assert.strictEqual(extractStreakFromText('5 dias seguidos'), 5);

    // Casos negativos / neutros (ciclo semanal não é streak contínuo)
    assert.strictEqual(extractStreakFromText('Dia 4 de 7'), null);
    assert.strictEqual(extractStreakFromText('dia 6/7'), null);
    assert.strictEqual(extractStreakFromText('Day 3 of 7'), null);
    assert.strictEqual(extractStreakFromText(null), null);
    assert.strictEqual(extractStreakFromText(''), null);
    assert.strictEqual(extractStreakFromText('+40 moedas'), null);
    assert.strictEqual(extractStreakFromText('Minhas moedas: 521'), null);
    assert.strictEqual(extractStreakFromText('Ganhe mais moedas'), null);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - getStreakFromCheckinCoins mapeia moedas ganhas para dias da sequência', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    assert.strictEqual(getStreakFromCheckinCoins(10), 1);
    assert.strictEqual(getStreakFromCheckinCoins(15), 2);
    assert.strictEqual(getStreakFromCheckinCoins(20), 3);
    assert.strictEqual(getStreakFromCheckinCoins(25), 4);
    assert.strictEqual(getStreakFromCheckinCoins(30), 5);
    assert.strictEqual(getStreakFromCheckinCoins(35), 6);
    assert.strictEqual(getStreakFromCheckinCoins(40), 7);

    // Suporte a strings formatadas
    assert.strictEqual(getStreakFromCheckinCoins('+10'), 1);
    assert.strictEqual(getStreakFromCheckinCoins('+40 moedas'), 7);
    assert.strictEqual(getStreakFromCheckinCoins('20'), 3);

    // Casos inválidos
    assert.strictEqual(getStreakFromCheckinCoins(null), null);
    assert.strictEqual(getStreakFromCheckinCoins(undefined), null);
    assert.strictEqual(getStreakFromCheckinCoins('N/D'), null);
    assert.strictEqual(getStreakFromCheckinCoins(50), null);
    assert.strictEqual(getStreakFromCheckinCoins(0), null);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - getStreakFromDesktopHistory conta dias consecutivos do histórico', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    // Datas dinâmicas no fuso do histórico (PT) para que a exigência de recência seja estável
    const ptDateParts = (daysAgo) => {
      const [y, m, d] = new Date()
        .toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
        .split('-')
        .map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d - daysAgo));
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    };
    const ptBr = (daysAgo) => {
      const { y, m, d } = ptDateParts(daysAgo);
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    };
    const enUs = (daysAgo) => {
      const { y, m, d } = ptDateParts(daysAgo);
      return `${m}/${d}/${y}`;
    };

    // Caso 1: 3 dias consecutivos terminando hoje, formato pt-BR (DD/MM/YYYY)
    const historyPtBr = `
      Minhas moedas: 521
      ${ptBr(0)} PT
      Check-in diário no app
      +40
      ${ptBr(1)} PT
      Check-in diário no app
      +40
      ${ptBr(2)} PT
      Check-in diário no app
      +40
    `;
    assert.strictEqual(getStreakFromDesktopHistory(historyPtBr), 3);

    // Caso 2: 4 dias consecutivos terminando hoje, formato en-US (M/D/YYYY)
    const historyEnUs = `
      My coins: 521
      ${enUs(0)} PT
      App daily check-in
      +40
      ${enUs(1)} PT
      App daily check-in
      +40
      ${enUs(2)} PT
      App daily check-in
      +40
      ${enUs(3)} PT
      App daily check-in
      +40
    `;
    assert.strictEqual(getStreakFromDesktopHistory(historyEnUs), 4);

    // Caso 3: Registro mais recente hoje com intervalo (hoje e anteontem) -> streak 1
    const historyWithGap = `
      ${ptBr(0)} PT
      Check-in diário no app
      +40
      ${ptBr(2)} PT
      Check-in diário no app
      +40
    `;
    assert.strictEqual(getStreakFromDesktopHistory(historyWithGap), 1);

    // Caso 4: Histórico antigo (mais recente há 5 dias) não é streak atual
    const staleHistory = `
      ${ptBr(5)} PT
      Check-in diário no app
      +40
      ${ptBr(6)} PT
      Check-in diário no app
      +40
    `;
    assert.strictEqual(
      getStreakFromDesktopHistory(staleHistory),
      null,
      'Sequência antiga sem registro de hoje/ontem deve ser descartada'
    );

    // Caso 5: Sem check-in
    assert.strictEqual(getStreakFromDesktopHistory('Nenhum dado encontrado'), null);
    assert.strictEqual(getStreakFromDesktopHistory(''), null);
    assert.strictEqual(getStreakFromDesktopHistory(null), null);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - getStreakFromCoinPage extrai streak de modal, container ou body', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    // Mock com modal pós-checkin visível
    const mockPageWithModal = {
      evaluate: async (_fn, _args) => {
        // Simula execução no browser retornando o streak via regex no modal
        return 15;
      }
    };
    const streakFromModal = await getStreakFromCoinPage(mockPageWithModal);
    assert.strictEqual(streakFromModal, 15);

    // Mock com erro de evaluate
    const mockPageWithError = {
      evaluate: async () => {
        throw new Error('DOM navigation failed');
      }
    };
    const streakOnError = await getStreakFromCoinPage(mockPageWithError);
    assert.strictEqual(streakOnError, null);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - getBalanceDesktop calcula desktopStreak via histórico ou tier', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    // Datas RELATIVAS a hoje (fuso PT) para que a seção de hoje seja reconhecida.
    const pt = (offsetDias) =>
      new Date(Date.now() - offsetDias * 86400000).toLocaleDateString('pt-BR', {
        timeZone: 'America/Los_Angeles'
      });
    const fakeDesktopText = `
      Minhas moedas
      521
      ${pt(0)} PT
      Check-in diário no app
      +40
      ${pt(1)} PT
      Check-in diário no app
      +40
    `;

    const mockContext = {
      newPage: async () => ({
        goto: async () => {},
        waitForSelector: async () => {},
        innerText: async () => fakeDesktopText,
        screenshot: async () => {},
        close: async () => {}
      }),
      route: async () => {},
      tracing: { start: async () => {}, stop: async () => {} },
      close: async () => {}
    };
    const mockBrowser = {
      newContext: async () => mockContext
    };

    const result = await getBalanceDesktop(mockBrowser, { cookies: [] });
    assert.strictEqual(result.totalBalance, '521');
    assert.strictEqual(result.todayCheckinCoins, '40');
    assert.strictEqual(result.hasAppCheckinToday, true);
    assert.strictEqual(typeof result.desktopStreak, 'number');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - A2: extrato só com data de ONTEM não marca check-in de hoje', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const pt = (offsetDias) =>
      new Date(Date.now() - offsetDias * 86400000).toLocaleDateString('pt-BR', {
        timeZone: 'America/Los_Angeles'
      });
    // Só existe a entrada de ONTEM; hoje ainda não houve lançamento.
    const fakeDesktopText = `
      Minhas moedas
      100
      ${pt(1)} PT
      Bônus diário
      +40
    `;
    const mockContext = {
      newPage: async () => ({
        goto: async () => {},
        waitForSelector: async () => {},
        innerText: async () => fakeDesktopText,
        screenshot: async () => {},
        close: async () => {}
      }),
      route: async () => {},
      tracing: { start: async () => {}, stop: async () => {} },
      close: async () => {}
    };
    const result = await getBalanceDesktop(
      { newContext: async () => mockContext },
      { cookies: [] }
    );
    assert.strictEqual(
      result.hasAppCheckinToday,
      false,
      'data de ontem não pode ser tratada como check-in de hoje'
    );
    assert.strictEqual(result.todayCheckinCoins, null);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - A3: histórico não associa o valor de um dia à data anterior', async () => {
  const { getStreakFromDesktopHistory } = require('../libs/ui/balance');
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const pt = (offsetDias) =>
      new Date(Date.now() - offsetDias * 86400000).toLocaleDateString('pt-BR', {
        timeZone: 'America/Los_Angeles'
      });
    // Hoje SEM check-in; ontem/anteontem COM check-in.
    const text =
      `${pt(0)} PT\nMissões de moedas\n+5\n` +
      `${pt(1)} PT\nBônus diário\n+40\n` +
      `${pt(2)} PT\nBônus diário\n+40\n`;
    assert.strictEqual(
      getStreakFromDesktopHistory(text),
      2,
      'hoje sem check-in: streak deve contar apenas ontem+anteontem'
    );

    // Com check-in hoje também: 3
    const textWithToday =
      `${pt(0)} PT\nBônus diário\n+40\n` +
      `${pt(1)} PT\nBônus diário\n+40\n` +
      `${pt(2)} PT\nBônus diário\n+40\n`;
    assert.strictEqual(getStreakFromDesktopHistory(textWithToday), 3);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - saldo com separador de milhar não é truncado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const cases = [
      { text: 'Minhas moedas\n2.917\n', expected: '2917' },
      { text: 'My coins\n12,345\n', expected: '12345' }
    ];
    for (const { text, expected } of cases) {
      const mockContext = {
        newPage: async () => ({
          goto: async () => {},
          waitForSelector: async () => {},
          innerText: async () => text,
          screenshot: async () => {},
          close: async () => {}
        }),
        route: async () => {},
        tracing: { start: async () => {}, stop: async () => {} },
        close: async () => {}
      };
      const result = await getBalanceDesktop(
        { newContext: async () => mockContext },
        { cookies: [] }
      );
      assert.strictEqual(result.totalBalance, expected, `saldo de "${text}" truncado`);
    }
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - getBalanceDesktop reutiliza options.context sem fechá-lo', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  let contextClosed = false;

  try {
    const desktopText = 'Minhas moedas\n777\n';
    const page = {
      goto: async () => {},
      waitForSelector: async () => {},
      innerText: async () => desktopText,
      screenshot: async () => {},
      close: async () => {}
    };
    const context = {
      newPage: async () => page,
      close: async () => {
        contextClosed = true;
      }
    };

    const result = await getBalanceDesktop(null, { cookies: [] }, { context });

    assert.strictEqual(result.totalBalance, '777');
    assert.strictEqual(contextClosed, false, 'contexto fornecido pelo caller não deve ser fechado');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - getCheckinCoinsFromStreak mapeia streak para quantidade de moedas oficial', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    assert.strictEqual(getCheckinCoinsFromStreak(1), 10);
    assert.strictEqual(getCheckinCoinsFromStreak(2), 15);
    assert.strictEqual(getCheckinCoinsFromStreak(3), 20);
    assert.strictEqual(getCheckinCoinsFromStreak(4), 25);
    assert.strictEqual(getCheckinCoinsFromStreak(5), 30);
    assert.strictEqual(getCheckinCoinsFromStreak(6), 35);
    assert.strictEqual(getCheckinCoinsFromStreak(7), 40);
    assert.strictEqual(getCheckinCoinsFromStreak(30), 40);
    assert.strictEqual(getCheckinCoinsFromStreak(212), 40);

    // Suporte a strings
    assert.strictEqual(getCheckinCoinsFromStreak('1'), 10);
    assert.strictEqual(getCheckinCoinsFromStreak('4 dias'), 25);
    assert.strictEqual(getCheckinCoinsFromStreak('7 dias seguidos'), 40);

    // Valores nulos/indefinidos/inválidos -> piso mínimo 10
    assert.strictEqual(getCheckinCoinsFromStreak(null), 10);
    assert.strictEqual(getCheckinCoinsFromStreak(undefined), 10);
    assert.strictEqual(getCheckinCoinsFromStreak('N/D'), 10);
    assert.strictEqual(getCheckinCoinsFromStreak(0), 10);
    assert.strictEqual(getCheckinCoinsFromStreak(-5), 10);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - closeCachedDesktopContext fecha o contexto reutilizado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const { getBalanceDesktop, closeCachedDesktopContext } = require('../libs/ui/balance');
  let closed = false;
  let newPageCalls = 0;

  try {
    const page = {
      goto: async () => {},
      waitForSelector: async () => {},
      innerText: async () => 'Minhas moedas\n321\n',
      screenshot: async () => {},
      close: async () => {}
    };
    const context = {
      isClosed: () => closed,
      route: async () => {},
      tracing: { start: async () => {}, stop: async () => {} },
      newPage: async () => {
        newPageCalls++;
        return page;
      },
      close: async () => {
        closed = true;
      }
    };
    const browser = { newContext: async () => context };

    // reuseContext cria e cacheia; segunda chamada reutiliza a mesma página
    await getBalanceDesktop(browser, { cookies: [] }, { reuseContext: true });
    await getBalanceDesktop(browser, { cookies: [] }, { reuseContext: true });
    assert.strictEqual(newPageCalls, 1, 'deve reutilizar a página cacheada');

    await closeCachedDesktopContext();
    assert.strictEqual(closed, true, 'closeCachedDesktopContext deve fechar o contexto');
  } finally {
    await closeCachedDesktopContext().catch(() => {});
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - shouldReuseDesktopContext é false por padrão (opt-in) e aceita opt-in', () => {
  const { shouldReuseDesktopContext } = require('../libs/ui/balance');
  const original = process.env.DESKTOP_REUSE_CONTEXT;
  try {
    delete process.env.DESKTOP_REUSE_CONTEXT;
    assert.strictEqual(
      shouldReuseDesktopContext(),
      false,
      'padrão deve ser desligado (pico de RAM)'
    );

    for (const on of ['true', '1', 'on', 'yes', 'TRUE']) {
      process.env.DESKTOP_REUSE_CONTEXT = on;
      assert.strictEqual(shouldReuseDesktopContext(), true, `${on} deve ativar o reuso`);
    }
    for (const off of ['false', '0', 'off', 'no']) {
      process.env.DESKTOP_REUSE_CONTEXT = off;
      assert.strictEqual(shouldReuseDesktopContext(), false);
    }
  } finally {
    if (original !== undefined) process.env.DESKTOP_REUSE_CONTEXT = original;
    else delete process.env.DESKTOP_REUSE_CONTEXT;
  }
});

test('libs/ui/balance.js - extractTodayLedger lê Bônus diário e Missões de moedas (pt/en)', () => {
  const { extractTodayLedger } = require('../libs/ui/balance');

  const pt = `
    20/09/2026 PT
    Bônus diário
    +1
    Missões de moedas
    +5
    Missões de moedas
    +5
    Bônus diário
    +40
  `;
  const ptRes = extractTodayLedger(pt);
  assert.strictEqual(ptRes.bonusCoins, 41, 'soma do Bônus diário do dia');
  assert.strictEqual(ptRes.bonusCount, 2);
  assert.strictEqual(ptRes.missionsCoins, 10, 'soma das Missões de moedas');
  assert.strictEqual(ptRes.missionsCount, 2);

  const en = `
    9/20/2026 PT
    Daily bonus
    +1
    Coin missions
    +15
    Coin page task
    +5
  `;
  const enRes = extractTodayLedger(en);
  assert.strictEqual(enRes.bonusCoins, 1);
  assert.strictEqual(enRes.missionsCoins, 20);

  assert.deepStrictEqual(extractTodayLedger(''), {
    bonusCoins: null,
    missionsCoins: 0,
    bonusCount: 0,
    missionsCount: 0
  });
});

test('libs/report.js - coinsFromLedger não é descontado por computeTasksCoinsGained', () => {
  const { computeTasksCoinsGained } = require('../libs/report');
  const checkin = { alreadyCollected: false, coinsGainedToday: '40', totalBalance: '1000' };
  // coinsGained do extrato já isolado; não deve descontar o check-in
  assert.strictEqual(
    computeTasksCoinsGained(
      { coinsGained: 56, initialBalance: 1000, coinsFromLedger: true },
      checkin
    ),
    56
  );
  // Sem o flag, mantém o comportamento anterior (diferença de saldo)
  assert.strictEqual(
    computeTasksCoinsGained({ coinsGained: 96, initialBalance: 1000 }, checkin),
    96
  );
});

test('libs/ui/balance.js - getBalanceDesktop expõe todayBonusCoins e todayMissionsCoins do extrato', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const { getBalanceDesktop } = require('../libs/ui/balance');
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Los_Angeles' });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('pt-BR', {
    timeZone: 'America/Los_Angeles'
  });

  try {
    const desktopText = `
      Minhas moedas
      2917
      ${hoje} PT
      Bônus diário
      +1
      Missões de moedas
      +56
      ${yesterday} PT
      Bônus diário
      +40
    `;
    const context = {
      isClosed: () => false,
      route: async () => {},
      tracing: { start: async () => {}, stop: async () => {} },
      newPage: async () => ({
        goto: async () => {},
        waitForSelector: async () => {},
        innerText: async () => desktopText,
        screenshot: async () => {},
        close: async () => {}
      }),
      close: async () => {}
    };
    const browser = { newContext: async () => context };

    const res = await getBalanceDesktop(browser, { cookies: [] });
    assert.strictEqual(res.totalBalance, '2917');
    assert.strictEqual(res.todayBonusCoins, 1, 'usa o Bônus diário de HOJE (valor real)');
    assert.strictEqual(res.todayMissionsCoins, 56, 'soma das Missões de moedas de hoje');
    assert.strictEqual(res.todayMissionsCount, 1);
    assert.strictEqual(res.hasAppCheckinToday, true, 'Bônus diário conta como check-in do dia');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/balance.js - extractTodayLedger no extrato real em inglês (Coin page task + App daily check-in)', () => {
  const { extractTodayLedger } = require('../libs/ui/balance');
  // Texto real observado na VM (conta com UI em inglês)
  const realEn =
    'Coin page task\n+5\nCoin page task\n+5\nCoin page task\n+5\nCoin page task\n+5\nCoin page task\n+1\nApp daily check-in\n+40\n';
  const res = extractTodayLedger(realEn);
  assert.strictEqual(res.bonusCoins, 40, 'check-in real = 40 (App daily check-in)');
  assert.strictEqual(res.bonusCount, 1);
  assert.strictEqual(res.missionsCoins, 21, 'soma das tarefas = 5+5+5+5+1');
  assert.strictEqual(res.missionsCount, 5);
});

test('libs/ui/balance.js - extractTodayLedger conta tudo que não é check-in como tarefa (Widget coins)', () => {
  const { extractTodayLedger } = require('../libs/ui/balance');
  // Extrato real observado na VM (conta 1, hoje): 13x "Coin page task +5",
  // 1x "Coin page task +1", 1x "Widget coins +5" e "App daily check-in +40".
  let real = '';
  for (let i = 0; i < 13; i++) real += 'Coin page task\n+5\n';
  real += 'Coin page task\n+1\n';
  real += 'Widget coins\n+5\n';
  real += 'App daily check-in\n+40\n';

  const r = extractTodayLedger(real);
  assert.strictEqual(r.bonusCoins, 40, 'check-in real = 40');
  assert.strictEqual(r.missionsCoins, 71, 'tarefas = 13x5 + 1 (Coin page task) + 5 (Widget coins)');
  assert.strictEqual(r.bonusCount, 1);
  assert.strictEqual(r.missionsCount, 15);
});

test('libs/report.js - computeCheckinCoinsGained contabiliza check-in do extrato mesmo com alreadyCollected', () => {
  const { computeCheckinCoinsGained } = require('../libs/report');
  // check-in já coletado (feito no app) mas com crédito real do dia no extrato
  assert.strictEqual(
    computeCheckinCoinsGained({
      alreadyCollected: true,
      coinsGainedToday: '40',
      checkinCoinsFromLedger: true
    }),
    40,
    'deve contabilizar o check-in do dia vindo do extrato'
  );
  // já coletado sem crédito no extrato -> 0
  assert.strictEqual(
    computeCheckinCoinsGained({ alreadyCollected: true, coinsGainedToday: '0' }),
    0
  );
  // não coletado -> valor normal
  assert.strictEqual(
    computeCheckinCoinsGained({ alreadyCollected: false, coinsGainedToday: '25' }),
    25
  );
});

test('libs/ui/balance.js - extractTodayLedger aceita separador de milhar', () => {
  const { extractTodayLedger } = require('../libs/ui/balance');
  const r = extractTodayLedger('Bônus diário\n+1.000\nMissões de moedas\n+2,500\n');
  assert.strictEqual(r.bonusCoins, 1000);
  assert.strictEqual(r.missionsCoins, 2500);
});

test('libs/ui/balance.js - histórico reconhece "Bônus diário"/"Daily bonus" como check-in', () => {
  const { getStreakFromDesktopHistory } = require('../libs/ui/balance');
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Los_Angeles' });
  const ontem = new Date(Date.now() - 86400000).toLocaleDateString('pt-BR', {
    timeZone: 'America/Los_Angeles'
  });
  const t = `${hoje} PT\nBônus diário\n+40\n${ontem} PT\nBônus diário\n+40\n`;
  assert.strictEqual(getStreakFromDesktopHistory(t), 2, 'deve contar 2 dias consecutivos');
});
