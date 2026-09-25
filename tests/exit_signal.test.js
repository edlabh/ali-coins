const test = require('node:test');
const assert = require('node:assert/strict');
const { signalExitCode } = require('../libs/exit');

test('libs/exit.js - signalExitCode devolve o código convencional 128+n (PID 1 sem re-raise)', () => {
  assert.strictEqual(signalExitCode('SIGINT'), 130, 'SIGINT = 128 + 2');
  assert.strictEqual(signalExitCode('SIGTERM'), 143, 'SIGTERM = 128 + 15');
  assert.strictEqual(signalExitCode('SIGKILL'), 1, 'sinal desconhecido cai no código de falha');
  assert.strictEqual(signalExitCode(null), 1);
  assert.strictEqual(signalExitCode(undefined), 1);
  assert.strictEqual(signalExitCode(''), 1);
});
