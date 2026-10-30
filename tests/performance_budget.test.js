'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function checkBoot(modulePath) {
  const code = `
    require(${JSON.stringify(modulePath)});
    const playwright = Object.keys(require.cache).some((p) =>
      p.includes('node_modules/playwright') || p.endsWith('/browser.js')
    );
    process.stdout.write(String(playwright));
  `;
  const result = spawnSync(process.execPath, ['-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, LOG_LEVEL: 'silent' }
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim() === 'true';
}

test('performance 2.5 - boot de all/collect/report não carrega Playwright', () => {
  assert.strictEqual(checkBoot('./all'), false, 'all.js deve bootar sem Playwright');
  assert.strictEqual(checkBoot('./collect'), false, 'collect.js deve bootar sem Playwright');
  assert.strictEqual(checkBoot('./libs/report'), false, 'report.js deve bootar sem Playwright');
});

test('performance 2.5 - --help permanece dentro do orçamento de boot', () => {
  for (const script of ['all.js', 'collect.js']) {
    const start = Date.now();
    const result = spawnSync(process.execPath, [script, '--help'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, LOG_LEVEL: 'silent' }
    });
    const elapsed = Date.now() - start;
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(elapsed < 5000, `${script} --help levou ${elapsed}ms (orçamento: 5000ms)`);
  }
});
