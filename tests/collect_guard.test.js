const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isSessionDataMissing,
  shouldConfirmCheckinByLedger,
  shouldConfirmStreakByStatement,
  shouldReuseEarlyDesktop
} = require('../collect');

test('collect.js - segunda verificação do check-in pelo extrato ("Bônus diário" de hoje)', () => {
  // UI não confirmou o clique, nada constava coletado antes, mas o extrato tem o crédito
  // de hoje -> o check-in funcionou e a sequência pode ser incrementada.
  assert.strictEqual(
    shouldConfirmCheckinByLedger({
      justCollected: false,
      alreadyCollected: false,
      hasBonusFromLedger: true
    }),
    true
  );

  // Modo primário já confirmou (marcador da UI) -> o fallback é desnecessário.
  assert.strictEqual(
    shouldConfirmCheckinByLedger({
      justCollected: true,
      alreadyCollected: false,
      hasBonusFromLedger: true
    }),
    false
  );

  // Já constava coletado antes desta execução (re-execução/app) -> não incrementa de novo.
  assert.strictEqual(
    shouldConfirmCheckinByLedger({
      justCollected: false,
      alreadyCollected: true,
      hasBonusFromLedger: true
    }),
    false
  );

  // Sem crédito no extrato -> não confirma.
  assert.strictEqual(
    shouldConfirmCheckinByLedger({
      justCollected: false,
      alreadyCollected: false,
      hasBonusFromLedger: false
    }),
    false
  );
  assert.strictEqual(shouldConfirmCheckinByLedger({}), false);
});

test('collect.js - confirmação da quebra de streak pelo extrato (somente quando necessário)', () => {
  // Tela lê 1, histórico anterior > 1 e extrato ainda não disponível -> precisa confirmar
  assert.strictEqual(
    shouldConfirmStreakByStatement({
      detectedStreak: 1,
      previousStreakDays: 221,
      statementStreak: null,
      alreadyCollected: false
    }),
    true
  );

  // Extrato já desmente (mostra sequência > 1) -> não precisa de nova leitura
  assert.strictEqual(
    shouldConfirmStreakByStatement({
      detectedStreak: 1,
      previousStreakDays: 221,
      statementStreak: 222
    }),
    false
  );

  // Extrato também mostra 1 (quebra confirmada) -> não precisa reler
  assert.strictEqual(
    shouldConfirmStreakByStatement({
      detectedStreak: 1,
      previousStreakDays: 221,
      statementStreak: 1
    }),
    false
  );

  // Histórico anterior <= 1 -> não é cenário de quebra
  assert.strictEqual(
    shouldConfirmStreakByStatement({ detectedStreak: 1, previousStreakDays: 1 }),
    false
  );

  // Já constava coletado -> sem alerta de quebra
  assert.strictEqual(
    shouldConfirmStreakByStatement({
      detectedStreak: 1,
      previousStreakDays: 221,
      statementStreak: null,
      alreadyCollected: true
    }),
    false
  );

  // Leitura diferente de 1 -> fora do escopo
  assert.strictEqual(
    shouldConfirmStreakByStatement({ detectedStreak: 7, previousStreakDays: 221 }),
    false
  );
  assert.strictEqual(shouldConfirmStreakByStatement({}), false);
});

test('collect.js - reúso da leitura desktop inicial (evita 2ª leitura redundante)', () => {
  // Check-in recém-feito -> o saldo/streak mudaram: NÃO reutilizar (relê o desktop)
  assert.strictEqual(
    shouldReuseEarlyDesktop({ justCollected: true, earlyDesktop: { totalBalance: '2531' } }),
    false
  );

  // Nada coletado nesta execução e leitura inicial válida -> reutiliza (economiza ~18s)
  assert.strictEqual(
    shouldReuseEarlyDesktop({ justCollected: false, earlyDesktop: { totalBalance: '2531' } }),
    true
  );

  // Leitura inicial ausente ou sem saldo válido -> relê
  assert.strictEqual(shouldReuseEarlyDesktop({ justCollected: false, earlyDesktop: null }), false);
  assert.strictEqual(
    shouldReuseEarlyDesktop({ justCollected: false, earlyDesktop: { totalBalance: 'N/D' } }),
    false
  );
  assert.strictEqual(shouldReuseEarlyDesktop({ justCollected: false, earlyDesktop: {} }), false);
  assert.strictEqual(
    shouldReuseEarlyDesktop({ justCollected: false, earlyDesktop: { totalBalance: '' } }),
    false
  );
  assert.strictEqual(shouldReuseEarlyDesktop({}), false);
});

test('collect.js - sessão inválida: saldo N/D falha mesmo com streak herdado (regressão)', () => {
  // Cenário do bug: previousStreakDays=38 vinha do session_meta.json (último dia bom) e o
  // guarda antigo aceitava o streak em cache como prova de sessão viva, terminando com ✅,
  // +0 moedas e saldo "N/D" mesmo com os cookies invalidados pelo AliExpress.
  assert.strictEqual(
    isSessionDataMissing({ totalBalance: 'N/D', streakDays: 38, previousStreakDays: 38 }),
    true
  );
  assert.strictEqual(isSessionDataMissing({ totalBalance: null, streakDays: 38 }), true);
  assert.strictEqual(isSessionDataMissing({ totalBalance: undefined, streakDays: 38 }), true);
  assert.strictEqual(isSessionDataMissing({}), true);

  // Sessão viva: o saldo lido fresco é suficiente, mesmo sem streak detectado hoje.
  assert.strictEqual(isSessionDataMissing({ totalBalance: '3028', streakDays: 'N/D' }), false);
  assert.strictEqual(isSessionDataMissing({ totalBalance: 0, streakDays: 'N/D' }), false);
});
