const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireLock, LockActiveError } = require('../lockfile');
const {
  createIsolatedTestDir,
  cleanupIsolatedTestDir,
  snapshotRealFiles,
  assertRealFilesUntouched
} = require('./test_helper');

test('lockfile.js - adquirir e liberar lock com sucesso em ambiente isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lockfile-test-');
  const tmpLockPath = path.join(tmpDir, 'test.lock');

  try {
    const release = await acquireLock(false, null, tmpLockPath);
    assert.ok(fs.existsSync(tmpLockPath), 'Arquivo de lock deve existir após aquisição');

    const content = JSON.parse(await fs.promises.readFile(tmpLockPath, 'utf-8'));
    assert.strictEqual(content.pid, process.pid);

    await release();
    assert.ok(!fs.existsSync(tmpLockPath), 'Arquivo de lock deve ser removido após liberação');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('lockfile.js - lock ativo impede segunda aquisição sem force isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lockfile-test-');
  const tmpLockPath = path.join(tmpDir, 'test.lock');

  try {
    const release = await acquireLock(false, null, tmpLockPath);

    await assert.rejects(
      async () => {
        await acquireLock(false, null, tmpLockPath);
      },
      (err) => {
        assert.ok(err instanceof LockActiveError);
        assert.strictEqual(err.code, 'LOCK_ACTIVE');
        return true;
      }
    );

    await release();
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('lockfile.js - flag force sobrescreve lock ativo isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lockfile-test-');
  const tmpLockPath = path.join(tmpDir, 'test.lock');

  try {
    const release1 = await acquireLock(false, null, tmpLockPath);

    // Com force = true deve adquirir novo lock sem erro
    const release2 = await acquireLock(true, null, tmpLockPath);
    assert.ok(fs.existsSync(tmpLockPath));

    await release2();
    await release1();
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('lockfile.js - lock órfão (stale timeout) é removido automaticamente isolado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lockfile-test-');
  const tmpLockPath = path.join(tmpDir, 'test.lock');

  try {
    // Criar lock simulando processo antigo de 2 horas atrás
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await fs.promises.writeFile(
      tmpLockPath,
      JSON.stringify({ pid: process.pid, createdAt: oldDate, host: os.hostname() }),
      'utf-8'
    );

    // Stale timeout de 1 segundo
    const release = await acquireLock(false, 1000, tmpLockPath);
    assert.ok(fs.existsSync(tmpLockPath));

    const content = JSON.parse(await fs.promises.readFile(tmpLockPath, 'utf-8'));
    assert.strictEqual(content.pid, process.pid);

    await release();
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

const { spawn } = require('child_process');

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
      reject(new Error(`Timeout de ${timeoutMs}ms aguardando processo filho. stdout=${stdout}`));
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

test('lockfile.js - criação atômica impede dupla aquisição sob concorrência real', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lockfile-race-');
  const tmpLockPath = path.join(tmpDir, 'race.lock');
  const lockModule = path.resolve(__dirname, '..', 'lockfile.js');

  const childScript = `
    const { acquireLock } = require(${JSON.stringify(lockModule)});
    acquireLock(false, 60000, ${JSON.stringify(tmpLockPath)})
      .then(async (release) => {
        process.stdout.write('ACQUIRED\\n');
        await new Promise((r) => setTimeout(r, 1200));
        await release();
        process.exit(0);
      })
      .catch((err) => {
        process.stdout.write('BLOCKED:' + (err.code || err.message) + '\\n');
        process.exit(3);
      });
  `;

  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => runNodeChild(childScript)));
    const acquired = results.filter((r) => r.stdout.includes('ACQUIRED'));
    const blocked = results.filter((r) => r.stdout.includes('LOCK_ACTIVE'));

    assert.strictEqual(
      acquired.length,
      1,
      `Apenas 1 processo deve adquirir o lock (obtidos: ${acquired.length}). Saídas: ${results
        .map((r) => r.stdout.trim())
        .join(' | ')}`
    );
    assert.strictEqual(blocked.length, 5, 'Os demais processos devem receber LOCK_ACTIVE');
    assert.strictEqual(
      fs.existsSync(tmpLockPath),
      false,
      'Lock deve ser removido após a liberação do vencedor'
    );
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test(
  'lockfile.js - SIGINT libera o lock e encerra o processo (sem travar em segundo plano)',
  { skip: process.platform === 'win32' },
  async () => {
    const realFilesSnapshot = snapshotRealFiles();
    const tmpDir = createIsolatedTestDir('lockfile-sigint-');
    const tmpLockPath = path.join(tmpDir, 'sigint.lock');
    const lockModule = path.resolve(__dirname, '..', 'lockfile.js');

    const childScript = `
      const { acquireLock } = require(${JSON.stringify(lockModule)});
      acquireLock(false, 60000, ${JSON.stringify(tmpLockPath)}).then((release) => {
        process.stdout.write('LOCK_OK\\n');
        setInterval(() => {}, 1000);
      });
    `;

    const child = spawn(process.execPath, ['-e', childScript], {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timeout aguardando LOCK_OK do processo filho')),
          10000
        );
        child.stdout.on('data', (d) => {
          if (d.toString().includes('LOCK_OK')) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.on('close', () => {
          clearTimeout(timer);
          reject(new Error('Processo filho encerrou antes de LOCK_OK'));
        });
      });

      assert.ok(fs.existsSync(tmpLockPath), 'Lock deve existir antes do sinal');

      const closed = new Promise((resolve) => {
        child.on('close', (code, signal) => resolve({ code, signal }));
      });
      child.kill('SIGINT');

      const outcome = await Promise.race([
        closed,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Processo não encerrou após SIGINT (bug regressivo)')),
            8000
          )
        )
      ]);

      assert.ok(
        outcome.signal === 'SIGINT' || outcome.code === 130 || outcome.code === 1,
        `Processo deve encerrar via SIGINT (code=${outcome.code}, signal=${outcome.signal})`
      );
      assert.strictEqual(
        fs.existsSync(tmpLockPath),
        false,
        'Lock deve ser liberado antes do encerramento'
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      cleanupIsolatedTestDir(tmpDir);
      assertRealFilesUntouched(realFilesSnapshot);
    }
  }
);

test(
  'lockfile.js - symlink malicioso no caminho do lock não é seguido nem sobrescreve o alvo',
  { skip: process.platform === 'win32' },
  async () => {
    const realFilesSnapshot = snapshotRealFiles();
    const tmpDir = createIsolatedTestDir('lockfile-symlink-');
    const victimPath = path.join(tmpDir, 'victim.txt');
    const tmpLockPath = path.join(tmpDir, 'symlink.lock');
    const victimContent = 'CONTEUDO_CRITICO_QUE_NAO_PODE_SER_TRUNCADO';

    try {
      fs.writeFileSync(victimPath, victimContent, 'utf-8');
      fs.symlinkSync(victimPath, tmpLockPath);

      const release = await acquireLock(false, null, tmpLockPath);
      assert.strictEqual(
        fs.readFileSync(victimPath, 'utf-8'),
        victimContent,
        'Arquivo alvo do symlink não pode ser alterado/truncado'
      );
      assert.ok(
        !fs.lstatSync(tmpLockPath).isSymbolicLink(),
        'Symlink deve ser substituído por lock real'
      );
      await release();
    } finally {
      cleanupIsolatedTestDir(tmpDir);
      assertRealFilesUntouched(realFilesSnapshot);
    }
  }
);

test('lockfile.js - stress concorrente: nenhuma sobreposição de posse por leitura parcial', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lockfile-stress-');
  const tmpLockPath = path.join(tmpDir, 'stress.lock');
  const lockModule = path.resolve(__dirname, '..', 'lockfile.js');

  const childScript = `
    const fs = require('fs');
    const { acquireLock } = require(${JSON.stringify(lockModule)});
    let overlap = 0;
    let acquired = 0;
    (async () => {
      for (let i = 0; i < 25; i++) {
        try {
          const release = await acquireLock(false, 60000, ${JSON.stringify(tmpLockPath)});
          acquired++;
          let observed = null;
          try {
            observed = JSON.parse(fs.readFileSync(${JSON.stringify(tmpLockPath)}, 'utf-8'));
          } catch {
            observed = null;
          }
          if (!observed || observed.pid !== process.pid) overlap++;
          await new Promise((r) => setTimeout(r, 2));
          await release();
        } catch {
          // LOCK_ACTIVE é esperado sob concorrência
        }
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));
      }
      process.stdout.write('OVERLAP=' + overlap + ';ACQUIRED=' + acquired + '\\n');
    })();
  `;

  try {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => runNodeChild(childScript, 20000))
    );

    let totalOverlap = 0;
    let totalAcquired = 0;
    for (const res of results) {
      const m = res.stdout.match(/OVERLAP=(\d+);ACQUIRED=(\d+)/);
      assert.ok(m, `Saída inválida do filho: ${res.stdout} ${res.stderr}`);
      totalOverlap += parseInt(m[1], 10);
      totalAcquired += parseInt(m[2], 10);
    }

    assert.strictEqual(
      totalOverlap,
      0,
      `Nenhuma sobreposição de posse é permitida (obtidas ${totalOverlap}). totalAcquired=${totalAcquired}`
    );
    assert.ok(totalAcquired > 0, 'Pelo menos uma aquisição deve ocorrer no stress');
    assert.strictEqual(fs.existsSync(tmpLockPath), false, 'Lock final deve estar liberado');
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('lockfile.js - createdAt futuro ou inválido não causa bloqueio permanente (anti-DoS)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('lockfile-timestamp-');
  const tmpLockPath = path.join(tmpDir, 'timestamp.lock');

  try {
    // 1. createdAt no futuro: tratado como stale e substituído imediatamente
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      tmpLockPath,
      JSON.stringify({ pid: process.pid, createdAt: future, host: os.hostname() })
    );
    const releaseFuture = await acquireLock(false, 30000, tmpLockPath);
    const afterFuture = JSON.parse(fs.readFileSync(tmpLockPath, 'utf-8'));
    assert.strictEqual(afterFuture.pid, process.pid);
    assert.notStrictEqual(afterFuture.createdAt, future, 'Timestamp futuro deve ser substituído');
    await releaseFuture();

    // 2. createdAt inválido: tratado como stale imediatamente
    fs.writeFileSync(
      tmpLockPath,
      JSON.stringify({ pid: process.pid, createdAt: 'data-invalida', host: os.hostname() })
    );
    const releaseInvalid = await acquireLock(false, 30000, tmpLockPath);
    assert.strictEqual(JSON.parse(fs.readFileSync(tmpLockPath, 'utf-8')).pid, process.pid);
    await releaseInvalid();

    // 3. createdAt ausente: continua sendo stale (comportamento histórico preservado)
    fs.writeFileSync(tmpLockPath, JSON.stringify({ pid: process.pid, host: os.hostname() }));
    const releaseMissing = await acquireLock(false, 30000, tmpLockPath);
    assert.strictEqual(JSON.parse(fs.readFileSync(tmpLockPath, 'utf-8')).pid, process.pid);
    await releaseMissing();
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
