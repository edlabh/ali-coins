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
    const fakeDesktopText = `
      Minhas moedas
      521
      14/09/2026 PT
      Check-in diário no app
      +40
      13/09/2026 PT
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
    // tier dá 7, histórico dá 2 -> Math.max(2, 7) = 7
    assert.strictEqual(result.desktopStreak, 7);
    assert.strictEqual(typeof result.desktopStreak, 'number');
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
