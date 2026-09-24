const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Windows Scripts - setup_windows.bat syntax and encoding validation', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'setup_windows.bat'), 'utf8');

  // Deve configurar UTF-8 nativo
  assert.ok(content.includes('chcp 65001 >nul'), 'setup_windows.bat deve configurar chcp 65001');

  // Deve ter ancoragem de diretório
  assert.ok(
    content.includes('cd /d "%~dp0"'),
    'setup_windows.bat deve ancorar no diretório do script'
  );

  // Não deve conter operadores de redirecionamento ou pipe condicional dentro do comando node de checagem de versão
  assert.ok(
    !content.includes('< 22'),
    'setup_windows.bat não deve conter "< 22" (provoca erro de parsing do cmd.exe)'
  );
  assert.ok(
    content.includes('%NODE_MAJOR% LSS 22'),
    'setup_windows.bat deve usar operador LSS nativo do batch para checagem da versão'
  );

  // Não deve conter '||' no teste do Chromium
  assert.ok(
    !content.includes('e.message || e'),
    'setup_windows.bat não deve conter "e.message || e" em comando inline de batch'
  );
});

test('Windows Scripts - run_*.bat execution scripts validation', () => {
  const scripts = ['run_all.bat', 'run.bat', 'run_tasks.bat'];

  for (const script of scripts) {
    const content = fs.readFileSync(path.join(__dirname, '..', script), 'utf8');

    assert.ok(
      content.includes('chcp 65001 >nul'),
      `${script} deve conter "chcp 65001 >nul" para renderização correta de UTF-8`
    );
    assert.ok(content.includes('cd /d "%~dp0"'), `${script} deve conter ancoragem "cd /d "%~dp0""`);
    assert.ok(
      content.includes('node "%~dp0'),
      `${script} deve invocar o script node com caminho absoluto ancorado`
    );
    assert.ok(content.includes('%*'), `${script} deve repassar todos os argumentos usando %*`);
    assert.ok(
      content.includes('pause'),
      `${script} deve conter mecanismo de pause para manter a janela aberta em caso de erro`
    );
    assert.ok(
      content.includes('exit /b %EXIT_CODE%'),
      `${script} deve propagar o código de saída com "exit /b %EXIT_CODE%"`
    );
  }
});

test('Windows Scripts - PowerShell scripts UTF-8 encoding validation', () => {
  const psScripts = [
    'setup_windows.ps1',
    'run_all.ps1',
    'run.ps1',
    'run_tasks.ps1',
    'generate_secret.ps1'
  ];

  for (const script of psScripts) {
    const content = fs.readFileSync(path.join(__dirname, '..', script), 'utf8');

    assert.ok(
      content.includes('chcp 65001'),
      `${script} deve acionar "chcp 65001" para configurar code page UTF-8`
    );
    assert.ok(
      content.includes('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8'),
      `${script} deve definir [Console]::OutputEncoding como UTF8 para evitar mojibake nos logs`
    );
    assert.ok(
      content.includes('$OutputEncoding = [System.Text.Encoding]::UTF8'),
      `${script} deve definir $OutputEncoding como UTF8 para comunicação correta com o Node.js`
    );

    // Windows PowerShell 5.1 lê arquivos .ps1 SEM BOM como ANSI (página de código do
    // sistema), quebrando acentuação no script; o BOM UTF-8 força a leitura correta.
    const raw = fs.readFileSync(path.join(__dirname, '..', script));
    assert.ok(
      raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf,
      `${script} deve ter BOM UTF-8 (compatibilidade com Windows PowerShell 5.1)`
    );
  }
});

test('Windows Scripts - run_*.ps1 arguments splatting and exit code propagation', () => {
  const runScripts = ['run_all.ps1', 'run.ps1', 'run_tasks.ps1'];

  for (const script of runScripts) {
    const content = fs.readFileSync(path.join(__dirname, '..', script), 'utf8');

    assert.ok(
      content.includes('@args'),
      `${script} deve usar splatting "@args" para repasse fiel de parâmetros`
    );
    assert.ok(
      content.includes('exit $LASTEXITCODE'),
      `${script} deve propagar o código de retorno com "exit $LASTEXITCODE"`
    );
  }
});

test('Windows Scripts - generate_secret scripts (OpenSSL and native Node.js fallback)', () => {
  const batContent = fs.readFileSync(path.join(__dirname, '..', 'generate_secret.bat'), 'utf8');
  const psContent = fs.readFileSync(path.join(__dirname, '..', 'generate_secret.ps1'), 'utf8');

  // generate_secret.bat
  assert.ok(
    batContent.includes('chcp 65001 >nul'),
    'generate_secret.bat deve configurar chcp 65001'
  );
  assert.ok(
    batContent.includes('openssl rand -base64 32'),
    'generate_secret.bat deve suportar openssl rand -base64 32'
  );
  assert.ok(
    batContent.includes('crypto').toString() && batContent.includes('randomBytes(32)'),
    'generate_secret.bat deve ter fallback nativo Node.js crypto'
  );
  assert.ok(batContent.includes('cd /d "%~dp0"'), 'generate_secret.bat deve ancorar o diretório');

  // generate_secret.ps1
  assert.ok(psContent.includes('chcp 65001'), 'generate_secret.ps1 deve configurar chcp 65001');
  assert.ok(
    psContent.includes('openssl rand -base64 32'),
    'generate_secret.ps1 deve suportar openssl rand -base64 32'
  );
  assert.ok(
    psContent.includes('randomBytes(32)'),
    'generate_secret.ps1 deve ter fallback nativo Node.js crypto'
  );
  assert.ok(
    psContent.includes('RandomNumberGenerator'),
    'generate_secret.ps1 deve ter fallback nativo .NET'
  );

  // Validação da chave gerada pelo método nativo complementar (Node.js crypto)
  const crypto = require('crypto');
  const generated = crypto.randomBytes(32).toString('base64');
  assert.strictEqual(
    Buffer.from(generated, 'base64').length,
    32,
    'Chave deve ter exatamente 32 bytes binários'
  );
  assert.ok(generated.length >= 43, 'Representação base64 deve ter no mínimo 43 caracteres');
});

test('Windows Scripts - setup installers key generation integration', () => {
  const batSetup = fs.readFileSync(path.join(__dirname, '..', 'setup_windows.bat'), 'utf8');
  const psSetup = fs.readFileSync(path.join(__dirname, '..', 'setup_windows.ps1'), 'utf8');

  // setup_windows.bat
  assert.ok(
    batSetup.includes('openssl rand -base64 32'),
    'setup_windows.bat deve suportar openssl rand -base64 32'
  );
  assert.ok(
    batSetup.includes('randomBytes(32)'),
    'setup_windows.bat deve ter fallback nativo Node.js crypto'
  );

  // setup_windows.ps1
  assert.ok(
    psSetup.includes('openssl rand -base64 32'),
    'setup_windows.ps1 deve suportar openssl rand -base64 32'
  );
  assert.ok(
    psSetup.includes('randomBytes(32)'),
    'setup_windows.ps1 deve ter fallback nativo Node.js crypto'
  );
});
