const test = require('node:test');
const assert = require('node:assert/strict');
const { isSessionDataMissing, shouldConfirmCheckinByLedger } = require('../collect');

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
