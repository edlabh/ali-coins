'use strict';

/**
 * Benchmark reproduzível de boot, memória e scrypt.
 *
 * Mede processos separados (cold start) para não contaminar o require cache entre
 * módulos. Não toca em credenciais/sessões reais: usa apenas payload sintético.
 *
 * Uso: npm run bench
 */

const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

function runNode(code, env = {}) {
  const result = spawnSync(NODE, ['-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, LOG_LEVEL: 'silent', ...env }
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `processo saiu com ${result.status}`);
  }
  return result.stdout.trim();
}

function measureRequire(modulePath) {
  const code = `
    const { performance } = require('node:perf_hooks');
    const t = performance.now();
    require(${JSON.stringify(modulePath)});
    const ms = performance.now() - t;
    const m = process.memoryUsage();
    const playwright = Object.keys(require.cache).some((p) =>
      p.includes('node_modules/playwright') || p.endsWith('/browser.js')
    );
    process.stdout.write(JSON.stringify({
      ms: Number(ms.toFixed(1)),
      rssMB: Number((m.rss / 1048576).toFixed(1)),
      heapMB: Number((m.heapUsed / 1048576).toFixed(1)),
      playwright
    }));
  `;
  return { module: modulePath, ...JSON.parse(runNode(code)) };
}

function measureHelp(script, runs = 3) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const result = spawnSync(NODE, [script, '--help'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, LOG_LEVEL: 'silent' }
    });
    if (result.status !== 0) throw new Error(`${script} --help falhou: ${result.stderr}`);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    script,
    medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(1)),
    samplesMs: samples.map((value) => Number(value.toFixed(1)))
  };
}

function measureScrypt(n) {
  const code = `
    const { performance } = require('node:perf_hooks');
    const { encryptSession, decryptSession } = require('./libs/core/security');
    const secret = 'benchmark_secret_with_at_least_32_characters_123';
    const payload = JSON.stringify({
      cookies: Array.from({ length: 20 }, (_, i) => ({
        name: 'cookie_' + i,
        value: 'v'.repeat(40),
        expires: 9999999999
      }))
    });
    const before = process.memoryUsage();
    const t0 = performance.now();
    const token = encryptSession(payload, secret);
    const t1 = performance.now();
    const out = decryptSession(token, secret);
    const t2 = performance.now();
    const after = process.memoryUsage();
    process.stdout.write(JSON.stringify({
      N: process.env.SCRYPT_N,
      encryptMs: Number((t1 - t0).toFixed(1)),
      decryptMs: Number((t2 - t1).toFixed(1)),
      rssDeltaMB: Number(((after.rss - before.rss) / 1048576).toFixed(1)),
      heapDeltaMB: Number(((after.heapUsed - before.heapUsed) / 1048576).toFixed(1)),
      ok: out === payload,
      tokenBytes: token.length
    }));
  `;
  return JSON.parse(runNode(code, { SCRYPT_N: String(n) }));
}

function main() {
  const modules = ['./libs/report', './all', './collect', './libs/runner/single'].map(
    measureRequire
  );
  const help = [measureHelp('all.js'), measureHelp('collect.js')];
  const scrypt = [measureScrypt(131072), measureScrypt(32768)];

  const output = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    require: modules,
    help,
    scrypt
  };

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return;
  }

  console.log('Require (processo cold start)');
  for (const item of modules) {
    console.log(
      `  ${item.module.padEnd(26)} ${String(item.ms).padStart(7)} ms  ` +
        `rss=${String(item.rssMB).padStart(6)} MB  heap=${String(item.heapMB).padStart(5)} MB  ` +
        `playwright=${item.playwright}`
    );
  }

  console.log('\n--help (mediana de 3 execuções)');
  for (const item of help) {
    console.log(
      `  ${item.script.padEnd(26)} ${String(item.medianMs).padStart(7)} ms  ` +
        `samples=[${item.samplesMs.join(', ')}]`
    );
  }

  console.log('\nscrypt (payload sintético de sessão)');
  for (const item of scrypt) {
    console.log(
      `  N=${String(item.N).padEnd(7)} encrypt=${String(item.encryptMs).padStart(7)} ms  ` +
        `decrypt=${String(item.decryptMs).padStart(7)} ms  ` +
        `rssDelta=${String(item.rssDeltaMB).padStart(5)} MB  ok=${item.ok}`
    );
  }
}

try {
  main();
} catch (err) {
  console.error(`Benchmark falhou: ${err.message}`);
  process.exitCode = 1;
}
