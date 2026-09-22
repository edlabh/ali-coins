const test = require('node:test');
const assert = require('node:assert/strict');
const { isSessionDataMissing } = require('../collect');

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
