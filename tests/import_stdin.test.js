const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const SCRIPT = `
  const { readTokenFromInput } = require('./import_session');
  readTokenFromInput()
    .then((buf) => { process.stdout.write('OK:' + (buf ? buf.length : 0)); })
    .catch((err) => { process.stdout.write('ERR:' + err.message); });
`;

function runWithStdin(input) {
  return spawnSync(process.execPath, ['-e', SCRIPT], {
    cwd: process.cwd(),
    input,
    encoding: 'utf-8',
    timeout: 20000
  });
}

test('import_session.js - lê token de sessão via STDIN normalmente', () => {
  const res = runWithStdin('v3:abc');
  assert.strictEqual(res.status, 0);
  assert.ok(res.stdout.startsWith('OK:'), `deve resolver o buffer: ${res.stdout}`);
  assert.strictEqual(res.stdout.trim(), 'OK:6');
});

test('import_session.js - rejeita STDIN acima do limite (proteção contra OOM)', () => {
  const oversized = Buffer.alloc(2 * 1024 * 1024 + 16, 0x41);
  const res = runWithStdin(oversized);
  assert.strictEqual(res.status, 0);
  assert.ok(
    res.stdout.includes('excede o limite'),
    `deve rejeitar entrada excessiva: ${res.stdout}`
  );
});
