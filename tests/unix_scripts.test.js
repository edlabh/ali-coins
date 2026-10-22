const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const {
  snapshotRealFiles,
  assertRealFilesUntouched,
  createIsolatedTestDir,
  cleanupIsolatedTestDir
} = require('./test_helper');

test('Unix Scripts - setup_linux.sh and setup_macos.sh syntax and anchoring validation', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const scripts = ['setup_linux.sh', 'setup_macos.sh', 'run.sh', 'run_all.sh', 'run_tasks.sh'];

    for (const script of scripts) {
      const scriptPath = path.join(__dirname, '..', script);
      assert.ok(fs.existsSync(scriptPath), `${script} deve existir`);

      // Validação de sintaxe bash se bash estiver disponível no ambiente
      try {
        execSync(`bash -n "${scriptPath}"`, { stdio: 'ignore' });
      } catch (err) {
        if (err.code !== 'ENOENT' && err.status !== 127) {
          throw err;
        }
      }

      const content = fs.readFileSync(scriptPath, 'utf8');

      // Ancoragem de diretório
      assert.ok(
        content.includes('SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"'),
        `${script} deve possuir ancoragem robusta em SCRIPT_DIR`
      );
    }
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('Unix Scripts - run*.sh usam heap adaptativo e respeitam ALI_HEAP_MB/NODE_OPTIONS', () => {
  // Requer bash; em ambientes sem bash (Windows sem Git Bash/CI) o teste é pulado.
  try {
    execSync('bash --version', { stdio: 'ignore' });
  } catch (err) {
    if (err.code === 'ENOENT' || err.status === 127) return;
    throw err;
  }

  const scripts = ['run.sh', 'run_all.sh', 'run_tasks.sh'];
  for (const script of scripts) {
    const content = fs.readFileSync(path.join(__dirname, '..', script), 'utf8');
    const start = content.indexOf('_ALI_HEAP_MB=256');
    const endMarker = 'export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=$_ALI_HEAP_MB}"';
    const end = content.indexOf(endMarker);
    assert.ok(
      start >= 0 && end > start,
      `${script} deve possuir o bloco de heap adaptativo dos run*.sh`
    );

    const block = content.slice(start, end + endMarker.length);
    const run = (env) => {
      const res = spawnSync('bash', ['-c', `${block}\necho "$_ALI_HEAP_MB|$NODE_OPTIONS"`], {
        env: { ...process.env, ...env },
        encoding: 'utf8'
      });
      assert.strictEqual(res.status, 0, `${script}: bash falhou: ${res.stderr}`);
      return res.stdout.trim();
    };

    assert.strictEqual(
      run({ ALI_HEAP_MB: '320', NODE_OPTIONS: '' }),
      '320|--max-old-space-size=320',
      `${script} deve respeitar ALI_HEAP_MB`
    );
    assert.ok(
      run({ ALI_HEAP_MB: '', NODE_OPTIONS: '--max-old-space-size=777' }).endsWith(
        '|--max-old-space-size=777'
      ),
      `${script} deve preservar NODE_OPTIONS explícito`
    );
  }
});

test('Unix Scripts - setup_linux.sh e setup_macos.sh lógica de geração de SESSION_SECRET', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('unix-setup-test-');

  try {
    const scripts = ['setup_linux.sh', 'setup_macos.sh'];

    for (const script of scripts) {
      const content = fs.readFileSync(path.join(__dirname, '..', script), 'utf8');

      // Deve verificar Node >= 22
      assert.ok(
        content.includes('-lt 22'),
        `${script} deve verificar se a versão do Node é inferior a 22`
      );

      // Deve possuir comando openssl e fallback de node para gerar chave
      assert.ok(
        content.includes('openssl rand -base64 32'),
        `${script} deve tentar gerar chave com openssl rand -base64 32`
      );
      assert.ok(
        content.includes("require('crypto').randomBytes(32).toString('base64')"),
        `${script} deve possuir fallback nativo do Node.js crypto`
      );

      // Deve aplicar chmod 600
      assert.ok(
        content.includes('chmod 600 "$SCRIPT_DIR/credentials.env"'),
        `${script} deve definir permissão 0600 em credentials.env`
      );

      // Deve avisar sobre a chave pré-gerada nos próximos passos
      assert.ok(
        content.includes('A chave SESSION_SECRET já foi gerada e configurada com 32 caracteres'),
        `${script} deve informar na mensagem final que a chave já foi gerada`
      );

      // A chave NUNCA pode ser passada via argv (visível em ps); deve ir por env
      assert.ok(
        content.includes('GEN_KEY="$GEN_KEY" node -e'),
        `${script} deve passar a chave SESSION_SECRET por variável de ambiente`
      );
      assert.strictEqual(
        content.includes('process.argv[2]'),
        false,
        `${script} não deve passar a chave SESSION_SECRET via argumento`
      );
    }

    // Testar execução isolada da rotina de substituição da chave (multiplataforma: Node puro via argumentos)
    const exampleFile = path.join(__dirname, '..', 'credentials.env.example');
    const credFile = path.join(tmpDir, 'credentials.env');
    fs.copyFileSync(exampleFile, credFile);

    const key = execSync(
      "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    )
      .toString()
      .trim();

    assert.ok(key.length >= 32, 'A chave gerada deve ter pelo menos 32 caracteres');

    // Executar substituição equivalente usando process.argv para total compatibilidade multiplataforma (Windows/Linux/macOS)
    execSync(
      `node -e "const fs=require('fs');const p=require('path').join(process.argv[1],'credentials.env');if(fs.existsSync(p)){let c=fs.readFileSync(p,'utf8');if(/SESSION_SECRET=\\"\\"/.test(c)){c=c.replace('SESSION_SECRET=\\"\\"','SESSION_SECRET=\\"' + process.argv[2] + '\\"');fs.writeFileSync(p,c,'utf8');}}" "${tmpDir}" "${key}"`
    );

    const updated = fs.readFileSync(credFile, 'utf8');
    assert.ok(
      updated.includes(`SESSION_SECRET="${key}"`),
      'credentials.env deve ter a chave gerada preenchida'
    );
    assert.ok(
      !updated.includes('SESSION_SECRET=""'),
      'credentials.env não deve mais conter SESSION_SECRET="" vazio'
    );
  } finally {
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
