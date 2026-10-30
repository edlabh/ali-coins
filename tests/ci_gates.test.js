'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CI = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const RELEASE = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
const SHELLCHECKRC = fs.readFileSync(path.join(ROOT, '.shellcheckrc'), 'utf8');

test('CI 2.5 - gates bloqueantes estão presentes e não são informativos', () => {
  for (const gate of [
    'npm run lint',
    'npm run format:check',
    'npm run test:coverage',
    'npm audit --omit=dev'
  ]) {
    assert.ok(CI.includes(gate), `CI deve executar o gate: ${gate}`);
  }
  assert.doesNotMatch(
    CI,
    /continue-on-error:\s*true/,
    'nenhum gate de qualidade pode mascarar falha com continue-on-error'
  );
  assert.ok(CI.includes('ubuntu-latest'));
  assert.ok(CI.includes('windows-latest'));
  assert.ok(CI.includes('macos-latest'));

  for (const job of ['gitleaks', 'docker', 'codeql', 'workflow-lint']) {
    assert.ok(CI.includes(`${job}:`), `CI deve manter o job ${job}`);
  }
});

test('CI 2.5 - ShellCheck, actionlint e PowerShell têm validação dedicada', () => {
  assert.match(CI, /shellcheck -x -f gcc/);
  assert.match(CI, /rhysd\/actionlint@sha256:[0-9a-f]{64}/);
  assert.match(CI, /System\.Management\.Automation\.Language\.Parser/);
  assert.match(CI, /shell:\s*pwsh/);
  assert.match(SHELLCHECKRC, /shell=bash/);
  assert.match(SHELLCHECKRC, /external-sources=true/);
});

test('CI 2.5 - artefatos de falha têm retenção curta e não são obrigatórios', () => {
  assert.match(CI, /Upload failure diagnostics/);
  assert.match(CI, /if:\s*failure\(\)/);
  assert.match(CI, /retention-days:\s*3/);
  assert.match(CI, /if-no-files-found:\s*ignore/);
});

test('Release 2.5 - verificação repete os gates de qualidade', () => {
  for (const gate of [
    'npm run lint',
    'npm run format:check',
    'npm run test:coverage',
    'npm audit --omit=dev'
  ]) {
    assert.ok(RELEASE.includes(gate), `release verify deve executar: ${gate}`);
  }
});

test('CI 2.5 - todos os scripts .sh passam no ShellCheck (quando instalado)', (t) => {
  const probe = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    t.skip('shellcheck não instalado neste ambiente');
    return;
  }

  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.husky', 'scratch'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.sh')) files.push(full);
    }
  }
  walk(ROOT);

  for (const file of files) {
    const result = spawnSync('shellcheck', ['-x', '-f', 'gcc', file], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    assert.strictEqual(
      result.status,
      0,
      `ShellCheck falhou em ${path.relative(ROOT, file)}:\n${result.stdout}${result.stderr}`
    );
  }
});
