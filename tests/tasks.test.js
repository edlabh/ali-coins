const test = require('node:test');
const assert = require('node:assert/strict');
const { isInteractiveOrAppOnly, executeTaskAction } = require('../libs/tasks/dispatcher');
const { executeSearchTask } = require('../libs/tasks/search');
const { executePrizeLandTask } = require('../libs/tasks/prizeland');
const { executeSurpriseItems } = require('../libs/tasks/surprise');
const { snapshotRealFiles, assertRealFilesUntouched } = require('./test_helper');

test('tasks - isInteractiveOrAppOnly identifica tarefas que requerem app', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    assert.strictEqual(
      isInteractiveOrAppOnly({ title: 'Complete 1 Merge Boss game order', desc: '' }),
      true
    );
    assert.strictEqual(
      isInteractiveOrAppOnly({ title: 'Daily quiz challenge', desc: 'Responda quiz' }),
      true
    );
    assert.strictEqual(
      isInteractiveOrAppOnly({ title: 'Prize land', desc: 'Regar plantas' }),
      true
    );
    assert.strictEqual(isInteractiveOrAppOnly({ title: 'Water plant', desc: '0.1 deal' }), true);
    assert.strictEqual(
      isInteractiveOrAppOnly({ title: 'Write reviews to get coins', desc: 'Avalie produtos' }),
      true
    );
    assert.strictEqual(
      isInteractiveOrAppOnly({ title: 'Avaliação de itens', desc: 'Deixe seu feedback' }),
      true
    );
    assert.strictEqual(
      isInteractiveOrAppOnly({ title: 'Search for what you love', desc: 'Search keywords' }),
      false
    );
    assert.strictEqual(
      isInteractiveOrAppOnly({ title: 'Browse surprise items', desc: 'Tap 3 items' }),
      false
    );
    assert.strictEqual(isInteractiveOrAppOnly(null), false);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executeSearchTask preenche termo de busca com mock page', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let filledText = '';
    let pressedKey = '';
    const mockInput = {
      fill: async (text) => {
        filledText = text;
      },
      press: async (key) => {
        pressedKey = key;
      }
    };

    const mockPage = {
      $: async (selector) => (selector === 'input' ? mockInput : null),
      evaluate: async () => {},
      waitForTimeout: async () => {},
      on: () => {},
      off: () => {}
    };

    const result = await executeSearchTask({
      page: mockPage,
      query: 'fone bluetooth gamer',
      scrollWaitSeconds: 0
    });

    assert.strictEqual(result, true);
    assert.strictEqual(filledText, 'fone bluetooth gamer');
    assert.strictEqual(pressedKey, 'Enter');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executePrizeLandTask clica no botão de rega se presente', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let clicked = false;
    const mockWaterBtn = {
      click: async () => {
        clicked = true;
      }
    };

    const mockPage = {
      $: async () => mockWaterBtn,
      evaluate: async (fn, el) => {
        if (el && el.click) el.click();
      },
      waitForTimeout: async () => {}
    };

    const result = await executePrizeLandTask({ page: mockPage });
    assert.strictEqual(result, true);
    assert.strictEqual(clicked, true);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executeSurpriseItems simula toques em produtos', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let clickedCards = 0;
    const mockCard = {
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        clickedCards++;
      }
    };

    const mockPage = {
      waitForSelector: async () => {},
      $$: async () => [mockCard, mockCard, mockCard],
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => 'https://aliexpress.com/item.html',
      goBack: async () => {},
      waitForLoadState: async () => {}
    };

    let closedTab = false;
    const mockTab = {
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      close: async () => {
        closedTab = true;
      }
    };

    const mockContext = {
      waitForEvent: async () => mockTab
    };

    const count = await executeSurpriseItems({
      page: mockPage,
      context: mockContext,
      startIndex: 0
    });

    assert.strictEqual(count, 3);
    assert.strictEqual(clickedCards, 3);
    assert.strictEqual(closedTab, true);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executeTaskAction despacha corretamente conforme tipo de tarefa', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const mockPage = {
      $: async () => null,
      $$: async () => [],
      waitForSelector: async () => {},
      evaluate: async () => {},
      waitForTimeout: async () => {},
      on: () => {},
      off: () => {}
    };

    // 1. Minigame / Quiz -> retorna isSpecialOrAppOnly imediatamente
    const res1 = await executeTaskAction({
      page: mockPage,
      task: { title: 'Daily quiz challenge', desc: 'Quiz' }
    });
    assert.strictEqual(res1.isSpecialOrAppOnly, true);

    // 2. Prize Land -> retorna isSpecialOrAppOnly
    const res2 = await executeTaskAction({
      page: mockPage,
      task: { title: 'Prize land', desc: 'regar água' }
    });
    assert.strictEqual(res2.isSpecialOrAppOnly, true);

    // 3. Write Reviews -> retorna isSpecialOrAppOnly imediatamente
    const resReviews = await executeTaskAction({
      page: mockPage,
      task: { title: 'Write reviews to get coins', desc: 'Avalie produtos' }
    });
    assert.strictEqual(resReviews.isSpecialOrAppOnly, true);

    // 4. Tarefa regular -> navegação normal
    const res3 = await executeTaskAction({
      page: mockPage,
      task: { title: 'Explore sponsored items', desc: 'Browse' },
      config: { SCROLL_WAIT_SECONDS: 0 }
    });
    assert.strictEqual(res3.isSpecialOrAppOnly, undefined);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - máquina de estados (pending -> GO -> verify) e classifyTaskStatus', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const {
      findNextPendingTask,
      recordTaskAttempt,
      markSpecialOrAppOnly,
      classifyTaskStatus
    } = require('../libs/tasks/state');

    const tasks = [
      { title: 'Task 1 (Done)', isDone: true, btnText: 'GO', statusText: '1/1' },
      { title: 'Task 2 (Not GO)', isDone: false, btnText: 'DONE', statusText: '' },
      { title: 'Task 3 (Pending)', isDone: false, btnText: 'GO', statusText: '0/1' },
      { title: 'Task 4 (Pending 2)', isDone: false, btnText: 'GO', statusText: '0/1' }
    ];

    const attempts = {};
    const next1 = findNextPendingTask(tasks, attempts, 2);
    assert.strictEqual(next1.title, 'Task 3 (Pending)');

    recordTaskAttempt(attempts, 'Task 3 (Pending)');
    assert.strictEqual(attempts['Task 3 (Pending)'], 1);

    markSpecialOrAppOnly(attempts, 'Task 3 (Pending)');
    assert.strictEqual(attempts['Task 3 (Pending)'], 999);

    const next2 = findNextPendingTask(tasks, attempts, 2);
    assert.strictEqual(next2.title, 'Task 4 (Pending 2)');

    // Classificações de status
    assert.strictEqual(classifyTaskStatus({ isDone: true, totalRounds: 3 }), 'Concluída (3/3)');
    assert.strictEqual(
      classifyTaskStatus({ title: 'Write reviews to get coins', isDone: false }),
      'Requer pedido entregue elegível para avaliação'
    );
    assert.strictEqual(
      classifyTaskStatus({ title: 'Daily quiz', isDone: false }),
      'Requer interação direta no App AliExpress (minigame/quiz)'
    );
    assert.strictEqual(
      classifyTaskStatus({ title: 'Water tree', isDone: false }),
      'Exclusiva do App AliExpress (requer rega no app móvel)'
    );
    assert.strictEqual(
      classifyTaskStatus({ isDone: false, statusText: '1/3' }),
      'Executada parcialmente (1/3)'
    );
    assert.strictEqual(classifyTaskStatus({ isDone: false }), 'Pendente');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
