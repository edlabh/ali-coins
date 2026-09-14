const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatDate,
  formatTime,
  formatDateTime,
  formatDuration,
  calculateAccountBackoff
} = require('../time_utils');

test('time_utils.js - formatDate formata data no formato DD/MM/AAAA', () => {
  const date = new Date(2025, 0, 5, 9, 8, 7); // 05/01/2025
  assert.strictEqual(formatDate(date), '05/01/2025');
});

test('time_utils.js - formatTime formata hora no formato HH:mm:ss', () => {
  const date = new Date(2025, 0, 5, 9, 8, 7); // 09:08:07
  assert.strictEqual(formatTime(date), '09:08:07');
});

test('time_utils.js - formatDateTime combina data e hora', () => {
  const date = new Date(2025, 5, 15, 14, 30, 45); // 15/06/2025 14:30:45
  assert.strictEqual(formatDateTime(date), '15/06/2025 14:30:45');
});

test('time_utils.js - formatDuration formata milissegundos legíveis', () => {
  assert.strictEqual(formatDuration(0), '0s');
  assert.strictEqual(formatDuration(-100), '0s');
  assert.strictEqual(formatDuration(null), '0s');
  assert.strictEqual(formatDuration(45000), '45s');
  assert.strictEqual(formatDuration(80000), '1m 20s');
  assert.strictEqual(formatDuration(3665000), '1h 01m 05s');
});

test('time_utils.js - calculateAccountBackoff respeita jitter e limites de teto', () => {
  assert.strictEqual(calculateAccountBackoff(0, 1000, 10000, 0.5), 1000);
  assert.strictEqual(calculateAccountBackoff(1, 1000, 10000, 0.5), 2000);
  assert.strictEqual(calculateAccountBackoff(5, 1000, 10000, 0.5), 10000);
});
