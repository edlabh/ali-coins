const test = require('node:test');
const assert = require('node:assert/strict');
const { closeModals } = require('../libs/ui/navigation');

function createMockPage({ evaluateThrows = false, evaluateResult = true } = {}) {
  const evaluateCalls = [];
  const dollarCalls = [];
  const page = {
    evaluate: async (fn, arg) => {
      evaluateCalls.push({ fn, arg });
      if (evaluateThrows) throw new Error('evaluate indisponível');
      return evaluateResult;
    },
    $: async (sel) => {
      dollarCalls.push(sel);
      return sel.includes(':has-text(') ? { click: async () => {} } : { click: async () => {} };
    },
    waitForTimeout: async () => {}
  };
  return { page, evaluateCalls, dollarCalls };
}

test('navigation.js - closeModals consolida seletores CSS em um único evaluate', async () => {
  const { page, evaluateCalls, dollarCalls } = createMockPage();

  const closed = await closeModals(page);

  assert.strictEqual(closed, true);
  const arrayCalls = evaluateCalls.filter((call) => Array.isArray(call.arg));
  assert.strictEqual(arrayCalls.length, 1, 'CSS deve ser resolvido em um único round-trip');

  const cssArg = arrayCalls[0].arg;
  assert.ok(Array.isArray(cssArg));
  assert.ok(cssArg.includes('.ui-dialog-close'), 'seletor CSS deve ir para o evaluate');
  assert.ok(cssArg.includes('[class*="close"]'), 'seletor CSS amplo deve ir para o evaluate');
  assert.strictEqual(
    cssArg.some((sel) => sel.includes(':has-text(')),
    false,
    'seletores :has-text não podem ir para querySelector'
  );

  assert.ok(
    dollarCalls.includes('button:has-text("OK")'),
    'seletor textual deve continuar via Playwright ($)'
  );
  assert.strictEqual(
    dollarCalls.some((sel) => sel === '.ui-dialog-close'),
    false,
    'seletores CSS não devem mais gerar round-trip por $'
  );
});

test('navigation.js - closeModals usa fallback por $ quando evaluate não está disponível', async () => {
  const { page, dollarCalls } = createMockPage({ evaluateThrows: true });

  const closed = await closeModals(page);

  assert.strictEqual(closed, true);
  assert.ok(
    dollarCalls.includes('.ui-dialog-close'),
    'fallback deve consultar seletores CSS via $'
  );
  assert.ok(dollarCalls.includes('button:has-text("OK")'));
});

test('navigation.js - closeModals respeita seletores customizados e retorna false sem matches', async () => {
  const { page, evaluateCalls } = createMockPage({ evaluateResult: false });

  const closed = await closeModals(page, ['.meu-modal-close']);

  assert.strictEqual(closed, false, 'sem clique efetivo não deve reportar fechamento');
  assert.strictEqual(evaluateCalls.length, 1);
  assert.deepStrictEqual(evaluateCalls[0].arg, ['.meu-modal-close']);
});

test('navigation.js - closeModals não clica em botão textual fora de container de modal', async () => {
  let clicked = false;
  const mockButton = {
    click: async () => {
      clicked = true;
    }
  };

  const page = {
    evaluate: async (fn, arg) => {
      // Se for a verificação CSS inicial de lote, retorna false (nenhum fechado)
      if (Array.isArray(arg)) return false;
      // Se for a verificação inDialog do elemento, simula que está fora do diálogo (retorna false)
      if (arg === mockButton) {
        if (fn.toString().includes('closest')) return false;
        clicked = true;
        return true;
      }
      return false;
    },
    $: async (sel) => {
      if (sel.includes(':has-text(')) return mockButton;
      return null;
    },
    waitForTimeout: async () => {}
  };

  const closed = await closeModals(page, ['button:has-text("OK")']);
  assert.strictEqual(
    closed,
    false,
    'botão fora de diálogo não deve ser considerado fechamento de modal'
  );
  assert.strictEqual(clicked, false, 'botão fora de diálogo não deve receber clique');
});
