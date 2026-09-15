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
    assert.ok(
      savedContent.includes('<html> <body> <div class="test">Hello World</div> </body></html>')
    );
  } finally {
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
