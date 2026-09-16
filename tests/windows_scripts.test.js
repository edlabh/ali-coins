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
  const psScripts = ['setup_windows.ps1', 'run_all.ps1', 'run.ps1', 'run_tasks.ps1'];

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
