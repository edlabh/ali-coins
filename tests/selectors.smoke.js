/**
 * ==============================================================================
 * SELECTORS SMOKE TEST (SEM BROWSER REAL)
 * ==============================================================================
 *
 * Objetivo:
 * Validar que todos os seletores CSS e semânticos definidos em libs/selectors.js
 * mantêm casamento perfeito com as fixtures mínimas dos painéis do AliExpress
 * (Autenticação, Check-in Diário, Painel "Ganhe mais moedas" e Desktop My Coin).
 *
 * COMO ATUALIZAR AS FIXTURES QUANDO O ALIEXPRESS MUDAR O DOM (OBSERVABLE SELECTORS):
 * Quando o painel/drawer ou seletor falha em runtime, o sistema gera automaticamente:
 *   - scratch/dom-<timestamp>.hash.txt (hash SHA-256 e metadados; HTML completo somente com PW_DUMP_DOM=true)
 *   - scratch/tasks_drawer_failed.png (screenshot da tela no momento exato do erro)
 *   - Log de WARN com o hash SHA-256 para auditoria e rastreabilidade
 *
 * Passos para atualizar as fixtures a partir do dump:
 * 1. Reexecute com PW_DUMP_DOM=true e abra o scratch/dom-<timestamp>.hash.txt gerado na falha.
 * 2. Localize no HTML normalizado a nova estrutura das tags/classes do painel alterado.
 * 3. Copie o trecho relevante de HTML e atualize a constante FIXTURE_HTML abaixo.
 * 4. Ajuste os seletores correspondentes em libs/selectors.js para casar com a nova estrutura.
 * 5. Execute 'npm test' ou 'node --test tests/selectors.smoke.js' para garantir que 100% dos testes passam.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { SELECTORS } = require('../libs/selectors');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

// Fixture HTML representativa dos painéis mobile e desktop do AliExpress
const FIXTURE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <!-- 1. Painel de Login e Segurança -->
  <div class="login-wrapper">
    <div class="login-pending-container" style="display: none;"></div>
    <input class="cosmos-input" id="fm-login-id" type="email" placeholder="Email or phone number" />
    <input id="fm-login-password" type="password" placeholder="Password" />
    <button class="cosmos-btn-primary" type="submit">Sign in</button>
    <button class="cosmos-btn-primary">Continue</button>
    <div id="nocaptcha">
      <div id="nc_1__scale_text" class="nc_scale">
        <span id="nc_1_n1z" class="btn_slide"></span>
      </div>
    </div>
    <input class="check-code-input" name="code" type="tel" maxlength="6" placeholder="Enter verification code" />
    <button class="cosmos-btn-primary" type="submit">Confirm</button>
  </div>

  <!-- 2. Painel Check-in Diário Mobile -->
  <div class="coin-index-wrapper">
    <div class="header">
      <div class="titleContainer">
        <div class="signTitle">15 days streak</div>
      </div>
      <span class="dayNumber checkedDay">15</span>
    </div>
    <div class="checkin-container">
      <button id="signButton" class="aecoin-today-checked aecoin-today">Today ✓</button>
      <button class="Footer--waterCollectedButtonBg--2jKL1c5 waterCollected">regar</button>
    </div>
    <div class="aecoin-signButtonWrapper-3p3NS">
      <button class="aecoin-signButton">Earn more coins</button>
    </div>

    <!-- 3. Gaveta de Tarefas ("Ganhe mais moedas") -->
    <div class="e2e_task" style="height: 500px;">
      <div class="e2e_normal_task">
        <div class="e2e_normal_task_content_title">Explore sponsored items</div>
        <div class="e2e_normal_task_content_secondTitle">Browse for 15 seconds</div>
        <div class="statusText">0/1</div>
        <div class="e2e_normal_task_right" data-groupid="task_101">
          <button class="e2e_normal_task_right_btn">GO</button>
        </div>
      </div>
      <div class="feeds-discount-card">Item 1</div>
    </div>

    <!-- 4. Modais e Diálogos -->
    <div class="dialog">
      <button class="ui-dialog-close aecoin-close">Fechar</button>
      <button class="dialog-close">Confirmar</button>
    </div>

    <!-- 5. Desktop My Coin -->
    <div class="mycoin-page">
      <div class="checkin-status">App daily check-in</div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Avalia se um seletor composto Playwright / CSS casa com o HTML fornecido
 * @param {string} html
 * @param {string} selector
 * @returns {boolean}
 */
function matchesSelector(html, selector) {
  if (!selector || typeof selector !== 'string') return false;

  const parts = selector.split(',').map((s) => s.trim());
  for (const part of parts) {
    if (part.startsWith('text=')) {
      const text = part.slice(5).trim();
      if (html.includes(text)) return true;
    }

    const hasTextMatch = part.match(/:has-text\(\"([^\"]+)\"\)/);
    if (hasTextMatch) {
      const text = hasTextMatch[1];
      if (html.includes(text)) return true;
    }

    const classMatch = part.match(/\.([a-zA-Z0-9_-]+)/);
    if (classMatch && html.includes(classMatch[1])) return true;

    const idMatch = part.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch && html.includes(idMatch[1])) return true;

    const attrMatch = part.match(/\[([a-zA-Z0-9_-]+)\*?=\"?([^\"]+)\"?\]/);
    if (attrMatch && html.includes(attrMatch[2])) return true;
  }
  return false;
}

/**
 * Cria mock de Page do Playwright operando sobre a fixture HTML sem browser
 * @param {string} html
 * @returns {object} Mock de Page
 */
function createMockPage(html) {
  return {
    $: async (selector) => {
      const matched = matchesSelector(html, selector);
      return matched
        ? {
            innerText: async () => 'mock text',
            getAttribute: async (_attr) => 'mock-attr',
            click: async () => {}
          }
        : null;
    },
    $$: async (selector) => {
      const matched = matchesSelector(html, selector);
      return matched
        ? [
            {
              innerText: async () => 'mock item 1',
              getAttribute: async () => 'mock-attr',
              click: async () => {}
            }
          ]
        : [];
    },
    $eval: async (selector, fn) => {
      if (!matchesSelector(html, selector)) {
        throw new Error(`Selector not found: ${selector}`);
      }
      return fn({
        getBoundingClientRect: () => ({ height: 200, width: 300 }),
        innerText: 'mock eval'
      });
    },
    $$eval: async (selector, fn) => {
      if (!matchesSelector(html, selector)) {
        return [];
      }
      return fn([
        {
          querySelector: (_sub) => ({ innerText: 'mock title', getAttribute: () => 'style' }),
          innerText: '+5 moedas'
        }
      ]);
    }
  };
}

test('selectors.smoke - seletores de autenticação casam com fixture HTML', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const page = createMockPage(FIXTURE_HTML);

    assert.ok(await page.$(SELECTORS.login.usernameInput), 'usernameInput deve casar com fixture');
    assert.ok(await page.$(SELECTORS.login.passwordInput), 'passwordInput deve casar com fixture');
    assert.ok(await page.$(SELECTORS.login.continueBtn), 'continueBtn deve casar com fixture');
    assert.ok(await page.$(SELECTORS.login.signInBtn), 'signInBtn deve casar com fixture');
    assert.ok(
      await page.$(SELECTORS.login.twoFactorInput),
      'twoFactorInput deve casar com fixture'
    );
    assert.ok(
      await page.$(SELECTORS.login.twoFactorSubmitBtn),
      'twoFactorSubmitBtn deve casar com fixture'
    );
    assert.ok(
      await page.$(SELECTORS.login.loginPendingContainer),
      'loginPendingContainer deve casar'
    );
    assert.ok(await page.$(SELECTORS.login.sliderHandle), 'sliderHandle deve casar com fixture');
    assert.ok(await page.$(SELECTORS.login.sliderTrack), 'sliderTrack deve casar com fixture');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('selectors.smoke - seletores de check-in mobile casam com fixture HTML', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const page = createMockPage(FIXTURE_HTML);

    // Pelo menos um seletor da lista de coleta deve casar
    let matchedCollect = false;
    for (const sel of SELECTORS.checkin.collectButtonList) {
      if (await page.$(sel)) {
        matchedCollect = true;
        break;
      }
    }
    assert.ok(
      matchedCollect,
      'Pelo menos um seletor de collectButtonList deve casar com a fixture'
    );

    assert.ok(await page.$(SELECTORS.checkin.todayChecked), 'todayChecked deve casar com fixture');
    assert.ok(
      await page.$(SELECTORS.checkin.streakDayNumber),
      'streakDayNumber deve casar com fixture'
    );
    assert.ok(
      await page.$(SELECTORS.checkin.streakTitleContainer),
      'streakTitleContainer deve casar com fixture'
    );
    assert.ok(await page.$(SELECTORS.checkin.waterBtn), 'waterBtn de rega deve casar com fixture');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('selectors.smoke - seletores do painel de tarefas casam com fixture HTML', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const page = createMockPage(FIXTURE_HTML);

    assert.ok(
      await page.$(SELECTORS.tasks.drawerContainer),
      'drawerContainer deve casar com fixture'
    );
    assert.ok(await page.$(SELECTORS.tasks.taskItem), 'taskItem deve casar com fixture');
    assert.ok(await page.$(SELECTORS.tasks.taskTitle), 'taskTitle deve casar com fixture');
    assert.ok(
      await page.$(SELECTORS.tasks.taskSecondTitle),
      'taskSecondTitle deve casar com fixture'
    );
    assert.ok(await page.$(SELECTORS.tasks.taskBtn), 'taskBtn deve casar com fixture');
    assert.ok(await page.$(SELECTORS.tasks.taskStatus), 'taskStatus deve casar com fixture');
    assert.ok(await page.$(SELECTORS.tasks.taskRight), 'taskRight deve casar com fixture');
    assert.ok(await page.$(SELECTORS.tasks.openDrawerBtn), 'openDrawerBtn deve casar com fixture');
    assert.ok(await page.$(SELECTORS.tasks.productCard), 'productCard deve casar com fixture');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('selectors.smoke - seletores de desktop My Coin casam com fixture HTML', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const page = createMockPage(FIXTURE_HTML);

    assert.ok(
      await page.$(SELECTORS.desktop.mycoinCheckin),
      'mycoinCheckin deve casar com fixture desktop'
    );
    assert.strictEqual(
      SELECTORS.desktop.mycoinUrl,
      'https://www.aliexpress.com/p/coin-pc-index/mycoin.html'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
