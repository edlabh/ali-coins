const test = require('node:test');
const assert = require('node:assert/strict');
const { SELECTORS } = require('../libs/selectors');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('libs/selectors.js - integridade e estrutura dos seletores', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    assert.ok(SELECTORS, 'SELECTORS deve estar definido');

    // Namespaces obrigatórios
    assert.ok(SELECTORS.login, 'login selectors devem existir');
    assert.ok(SELECTORS.checkin, 'checkin selectors devem existir');
    assert.ok(SELECTORS.tasks, 'tasks selectors devem existir');
    assert.ok(SELECTORS.modals, 'modals selectors devem existir');
    assert.ok(SELECTORS.desktop, 'desktop selectors devem existir');

    // Seletores críticos de login
    assert.ok(typeof SELECTORS.login.usernameInput === 'string');
    assert.ok(typeof SELECTORS.login.passwordInput === 'string');
    assert.ok(typeof SELECTORS.login.continueBtn === 'string');
    assert.ok(typeof SELECTORS.login.signInBtn === 'string');
    assert.ok(typeof SELECTORS.login.sliderHandle === 'string');
    assert.ok(typeof SELECTORS.login.sliderTrack === 'string');

    // Seletores críticos de check-in
    assert.ok(Array.isArray(SELECTORS.checkin.collectButtonList));
    assert.ok(SELECTORS.checkin.collectButtonList.length > 0);
    assert.ok(typeof SELECTORS.checkin.todayChecked === 'string');
    assert.ok(typeof SELECTORS.checkin.streakDayNumber === 'string');
    assert.ok(typeof SELECTORS.checkin.streakTitleContainer === 'string');

    // Seletores de tarefas
    assert.ok(typeof SELECTORS.tasks.drawerContainer === 'string');
    assert.ok(typeof SELECTORS.tasks.taskItem === 'string');
    assert.ok(typeof SELECTORS.tasks.openDrawerBtn === 'string');
    assert.ok(typeof SELECTORS.tasks.productCard === 'string');

    // Modais e Desktop
    assert.ok(Array.isArray(SELECTORS.modals.closeButtons));
    assert.ok(
      !SELECTORS.modals.closeButtons.includes('.e2e_normal_task_right_btn'),
      'modals.closeButtons não deve conter botão de tarefas da gaveta'
    );
    assert.ok(typeof SELECTORS.desktop.mycoinCheckin === 'string');
    assert.ok(typeof SELECTORS.desktop.mycoinUrl === 'string');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/ui/diagnostics.js - captureDomHashAndArtifacts gera hash SHA-256 e screenshot', async () => {
  const fs = require('node:fs');
  const { captureDomHashAndArtifacts } = require('../libs/ui');
  const { createIsolatedTestDir, cleanupIsolatedTestDir } = require('./test_helper');

  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('diag-dom-hash-');
  const prevOutDir = process.env.PW_OUTPUT_DIR;
  process.env.PW_OUTPUT_DIR = tmpDir;

  try {
    const mockPage = {
      evaluate: async () => '<html>  <body>  <div class="test">Hello World</div> </body></html>',
      screenshot: async ({ path: filePath }) => {
        fs.writeFileSync(filePath, 'fake-png-content');
      }
    };

    const res = await captureDomHashAndArtifacts(mockPage, 'tasks_drawer');
    assert.ok(res.hash, 'Hash deve estar presente');
    assert.strictEqual(typeof res.hash, 'string');
    assert.strictEqual(res.hash.length, 64, 'Deve ser SHA-256 de 64 caracteres');
    assert.ok(res.hashFile && fs.existsSync(res.hashFile), 'Arquivo de hash deve ter sido criado');
    assert.ok(
      res.screenshotFile && fs.existsSync(res.screenshotFile),
      'Arquivo de print deve ter sido criado'
    );

    const savedContent = fs.readFileSync(res.hashFile, 'utf-8');
    assert.ok(savedContent.includes(res.hash));
    assert.ok(savedContent.includes('tasks_drawer'));
    assert.ok(savedContent.includes('HTML length:'));
    assert.strictEqual(
      savedContent.includes('<html>'),
      false,
      'Por padrão o artefato NÃO deve conter o HTML completo (privacidade)'
    );

    // Opt-in explícito via PW_DUMP_DOM=true anexa o HTML normalizado para depuração
    process.env.PW_DUMP_DOM = 'true';
    const resDump = await captureDomHashAndArtifacts(mockPage, 'tasks_drawer_dump');
    const savedDump = fs.readFileSync(resDump.hashFile, 'utf-8');
    assert.ok(
      savedDump.includes('<html> <body> <div class="test">Hello World</div> </body></html>')
    );
    delete process.env.PW_DUMP_DOM;
  } finally {
    delete process.env.PW_DUMP_DOM;
    if (prevOutDir !== undefined) {
      process.env.PW_OUTPUT_DIR = prevOutDir;
    } else {
      delete process.env.PW_OUTPUT_DIR;
    }
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('libs/selectors.js - todos os seletores CSS são válidos e parseáveis no Chromium', async () => {
  const { launchBrowser } = require('../browser');
  const realFilesSnapshot = snapshotRealFiles();
  let browser;
  try {
    browser = await launchBrowser({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<html><body><div id="root"></div></body></html>');

    async function validateSelectors(obj, path = '') {
      for (const [key, val] of Object.entries(obj)) {
        const curPath = path ? `${path}.${key}` : key;
        if (typeof val === 'string' && !val.startsWith('http') && !curPath.includes('Url')) {
          await page.$(val);
        } else if (Array.isArray(val)) {
          for (let idx = 0; idx < val.length; idx++) {
            await page.$(val[idx]);
          }
        } else if (typeof val === 'object' && val !== null) {
          await validateSelectors(val, curPath);
        }
      }
    }

    await validateSelectors(SELECTORS);
    assert.ok(true, 'Todos os seletores foram parseados com sucesso');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test(
  'libs/ui/diagnostics.js - getDiagnosticsDir restringe diretório de artefatos a 0700',
  { skip: process.platform === 'win32' },
  async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { getDiagnosticsDir } = require('../libs/ui');
    const { createIsolatedTestDir, cleanupIsolatedTestDir } = require('./test_helper');

    const realFilesSnapshot = snapshotRealFiles();
    const tmpDir = createIsolatedTestDir('diag-dir-perm-');
    const sharedDir = path.join(tmpDir, 'shared');
    const prevOutDir = process.env.PW_OUTPUT_DIR;

    try {
      fs.mkdirSync(sharedDir, { mode: 0o755 });
      process.env.PW_OUTPUT_DIR = sharedDir;

      const resolved = getDiagnosticsDir();
      assert.strictEqual(resolved, sharedDir);

      const mode = fs.statSync(sharedDir).mode & 0o777;
      assert.strictEqual(mode, 0o700, `Diretório deve ser 0700, obtido 0${mode.toString(8)}`);
    } finally {
      if (prevOutDir !== undefined) {
        process.env.PW_OUTPUT_DIR = prevOutDir;
      } else {
        delete process.env.PW_OUTPUT_DIR;
      }
      cleanupIsolatedTestDir(tmpDir);
      assertRealFilesUntouched(realFilesSnapshot);
    }
  }
);

test('libs/ui/diagnostics.js - PW_SCREENSHOT captura screenshot automático apenas quando configurado', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { closeContextWithDiagnostics } = require('../libs/ui');
  const { createIsolatedTestDir, cleanupIsolatedTestDir } = require('./test_helper');

  const realFilesSnapshot = snapshotRealFiles();
  const tmpDir = createIsolatedTestDir('pw-screenshot-');
  const prevOut = process.env.PW_OUTPUT_DIR;
  const prevShot = process.env.PW_SCREENSHOT;
  const prevTrace = process.env.PW_TRACE;

  const makeContext = (shots) => ({
    pages: () => [
      {
        screenshot: async ({ path: filePath }) => {
          shots.push(filePath);
          fs.writeFileSync(filePath, 'fake-png');
        }
      }
    ],
    tracing: { stop: async () => {} },
    close: async () => {}
  });

  try {
    process.env.PW_OUTPUT_DIR = tmpDir;
    process.env.PW_TRACE = 'off';

    // 1. only-on-failure + failed=true -> captura
    process.env.PW_SCREENSHOT = 'only-on-failure';
    const shots1 = [];
    await closeContextWithDiagnostics(makeContext(shots1), { failed: true, name: 'pw-shot' });
    assert.strictEqual(shots1.length, 1, 'Deve capturar 1 screenshot em falha');
    assert.ok(fs.existsSync(shots1[0]), 'Arquivo de screenshot deve existir');
    assert.ok(path.basename(shots1[0]).startsWith('pw-shot-screenshot-'));

    // 2. only-on-failure + failed=false -> não captura
    const shots2 = [];
    await closeContextWithDiagnostics(makeContext(shots2), { failed: false, name: 'pw-shot-ok' });
    assert.strictEqual(shots2.length, 0, 'Não deve capturar screenshot em sucesso');

    // 3. off -> nunca captura
    process.env.PW_SCREENSHOT = 'off';
    const shots3 = [];
    await closeContextWithDiagnostics(makeContext(shots3), { failed: true, name: 'pw-shot-off' });
    assert.strictEqual(shots3.length, 0, 'PW_SCREENSHOT=off não deve capturar');
  } finally {
    if (prevOut !== undefined) process.env.PW_OUTPUT_DIR = prevOut;
    else delete process.env.PW_OUTPUT_DIR;
    if (prevShot !== undefined) process.env.PW_SCREENSHOT = prevShot;
    else delete process.env.PW_SCREENSHOT;
    if (prevTrace !== undefined) process.env.PW_TRACE = prevTrace;
    else delete process.env.PW_TRACE;
    cleanupIsolatedTestDir(tmpDir);
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
