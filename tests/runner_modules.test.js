'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { runCheckin, checkCaptchaCooldownForLogin } = require('../libs/runner/single');
const { main } = require('../libs/runner/multi');
const collect = require('../collect');
const all = require('../all');

const ROOT = path.join(__dirname, '..');

test('libs/runner - módulos extraídos expõem o contrato e adaptadores reexportam', () => {
  assert.strictEqual(typeof runCheckin, 'function');
  assert.strictEqual(typeof checkCaptchaCooldownForLogin, 'function');
  assert.strictEqual(typeof main, 'function');

  assert.strictEqual(collect.runCheckin, runCheckin);
  assert.strictEqual(collect.checkCaptchaCooldownForLogin, checkCaptchaCooldownForLogin);
  assert.strictEqual(all.main, main);
});

test('collect.js e all.js permanecem adaptadores finos de CLI', () => {
  const collectSource = fs.readFileSync(path.join(ROOT, 'collect.js'), 'utf-8');
  const allSource = fs.readFileSync(path.join(ROOT, 'all.js'), 'utf-8');

  assert.ok(
    collectSource.split('\n').length < 250,
    'collect.js deve ficar abaixo de 250 linhas após a extração'
  );
  assert.ok(allSource.split('\n').length < 50, 'all.js deve ficar abaixo de 50 linhas');
  assert.ok(!collectSource.includes('async function runCheckin'));
  assert.ok(!allSource.includes('async function main'));
});

test('collect.js e all.js continuam executáveis via require.main === module', () => {
  for (const script of ['collect.js', 'all.js']) {
    const result = spawnSync(process.execPath, [script, '--help'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 20000,
      env: { ...process.env, LOG_LEVEL: 'silent' }
    });
    assert.strictEqual(result.status, 0, `${script} --help falhou: ${result.stderr}`);
    assert.match(result.stdout, /Usage: ali-coins \[options\]/);
  }
});
