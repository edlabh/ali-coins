const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

function runNodeChild(script, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timeout de ${timeoutMs}ms aguardando processo filho`));
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test('libs/exit.js - flushAndExit não trunca stdout maior que o buffer de pipe (~64KB)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const script = `
      const { flushAndExit } = require('./libs/exit');
      process.stdout.write('X'.repeat(300000));
      flushAndExit(0);
    `;
    const res = await runNodeChild(script);

    assert.strictEqual(res.code, 0);
    assert.strictEqual(
      res.stdout.length,
      300000,
      `stdout deve ser integral (obtido ${res.stdout.length} bytes); process.exit() sem flush truncaria em 65536`
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/exit.js - flushAndExit preserva o código de saída informado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const script = `
      const { flushAndExit } = require('./libs/exit');
      process.stdout.write('saida-curta');
      flushAndExit(7);
    `;
    const res = await runNodeChild(script);

    assert.strictEqual(res.code, 7);
    assert.strictEqual(res.stdout, 'saida-curta');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/exit.js - flushStdStreams resolve mesmo com streams já encerrados', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const script = `
      const { flushStdStreams } = require('./libs/exit');
      process.stdout.end();
      flushStdStreams().then(() => {
        process.stderr.write('FLUSH_OK\\n');
        process.exit(0);
      });
    `;
    const res = await runNodeChild(script);

    assert.strictEqual(res.code, 0);
    assert.ok(res.stderr.includes('FLUSH_OK'));
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/exit.js - flushStream respeita o teto de tempo com stream travado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const { flushStream } = require('../libs/exit');
  try {
    // Stream que nunca chama o callback de write (simula pipe entupido)
    const stuckStream = {
      writableLength: 10,
      destroyed: false,
      writableEnded: false,
      write: () => {}
    };

    const t0 = Date.now();
    await flushStream(stuckStream, 200);
    const elapsed = Date.now() - t0;

    assert.ok(elapsed >= 180, `Deveria aguardar o teto (~200ms), levou ${elapsed}ms`);
    assert.ok(elapsed < 2000, `Não pode travar indefinidamente, levou ${elapsed}ms`);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
