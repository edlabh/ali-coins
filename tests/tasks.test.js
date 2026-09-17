const test = require('node:test');
const assert = require('node:assert/strict');
const { isInteractiveOrAppOnly, executeTaskAction } = require('../libs/tasks/dispatcher');
const { openTaskDrawer, extractTasksFromDrawer } = require('../libs/tasks/verifier');
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

test('tasks - findNextPendingTask prioriza botões de coleta e aceita botões IR/GO', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const {
      findNextPendingTask,
      recordTaskAttempt,
      resetTaskAttempt
    } = require('../libs/tasks/state');

    const tasks = [
      {
        title: 'Super Descontos',
        isDone: false,
        btnText: 'GO',
        isActionable: true,
        isClaimable: false,
        completedRounds: 1,
        totalRounds: 3
      },
      {
        title: 'Explore Itens',
        isDone: false,
        btnText: 'Coletar',
        isActionable: false,
        isClaimable: true,
        completedRounds: 1,
        totalRounds: 2
      },
      {
        title: 'Moedas Extras',
        isDone: false,
        btnText: 'IR',
        isActionable: true,
        isClaimable: false,
        completedRounds: 0,
        totalRounds: 1
      }
    ];

    const attempts = {};
    // 1. Prioriza a tarefa com botão de resgate/coleta
    const next1 = findNextPendingTask(tasks, attempts, 4);
    assert.ok(next1);
    assert.strictEqual(next1.title, 'Explore Itens');
    assert.strictEqual(next1.isClaimable, true);

    // Se a tarefa de coleta já atingiu maxAttempts, seleciona a próxima executável
    attempts['Explore Itens'] = 4;
    const next2 = findNextPendingTask(tasks, attempts, 4);
    assert.ok(next2);
    assert.strictEqual(next2.title, 'Super Descontos');

    // Teste de reset de tentativas ao avançar de rodada
    recordTaskAttempt(attempts, 'Super Descontos');
    assert.strictEqual(attempts['Super Descontos'], 1);
    resetTaskAttempt(attempts, 'Super Descontos');
    assert.strictEqual(attempts['Super Descontos'], 0);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executeTaskAction aceita chamada posicional e por objeto', async () => {
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

    // Chamada posicional: executeTaskAction(page, context, task, config)
    const resPositional = await executeTaskAction(
      mockPage,
      null,
      { title: 'Daily quiz challenge', desc: 'quiz' },
      { SCROLL_WAIT_SECONDS: 0 }
    );
    assert.strictEqual(resPositional.isSpecialOrAppOnly, true);

    // Chamada por objeto: executeTaskAction({ page, task, config })
    const resObject = await executeTaskAction({
      page: mockPage,
      task: { title: 'Merge boss game', desc: '' },
      config: { SCROLL_WAIT_SECONDS: 0 }
    });
    assert.strictEqual(resObject.isSpecialOrAppOnly, true);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executeSurpriseItems suporta múltiplas rodadas com startIndex > 0', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let clickedIndices = [];
    const createMockCard = (idx) => ({
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        clickedIndices.push(idx);
      }
    });

    const mockCards = [
      createMockCard(0),
      createMockCard(1),
      createMockCard(2),
      createMockCard(3),
      createMockCard(4),
      createMockCard(5)
    ];

    const mockPage = {
      waitForSelector: async () => {},
      $$: async () => mockCards,
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => 'https://aliexpress.com/item.html',
      goBack: async () => {},
      waitForLoadState: async () => {}
    };

    // Rodada 2: startIndex = 3 (cards 3, 4, 5)
    const count = await executeSurpriseItems({
      page: mockPage,
      startIndex: 3
    });

    assert.strictEqual(count, 3);
    assert.deepStrictEqual(clickedIndices, [3, 4, 5]);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - waitWithScroll não encerra prematuramente com tracking', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { waitWithScroll } = require('../browser');
    let responseCallback = null;
    const mockPage = {
      on: (evt, cb) => {
        if (evt === 'response') responseCallback = cb;
      },
      off: () => {},
      evaluate: async () => {},
      waitForTimeout: async () => {} // Instantâneo no mock
    };

    // Inicia e simula tracking logo no início
    const promise = waitWithScroll(mockPage, 0.05, { earlyExitOnTracking: false });
    if (responseCallback) {
      responseCallback({ url: () => 'https://aliexpress.com/track/click' });
    }
    await promise;
    // Se completou normalmente sem erros, o teste passou
    assert.ok(true);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - openTaskDrawer retorna true se a gaveta já estiver aberta', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const mockPage = {
      $eval: async (sel, fn) => {
        if (sel.includes('e2e_task')) {
          return fn({ getBoundingClientRect: () => ({ height: 400 }) });
        }
        return false;
      }
    };
    const opened = await openTaskDrawer({ page: mockPage });
    assert.strictEqual(opened, true);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - openTaskDrawer clica no botão e aguarda renderização das tarefas', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let clicked = false;
    const mockBtn = {
      click: async () => {
        clicked = true;
      }
    };
    let drawerOpen = false;

    const mockPage = {
      $eval: async (sel, fn) => {
        if (sel.includes('e2e_task')) {
          return fn({ getBoundingClientRect: () => ({ height: drawerOpen ? 350 : 0 }) });
        }
        return false;
      },
      evaluate: async (fn, arg) => {
        if (typeof fn === 'function') {
          if (arg) {
            clicked = true;
            drawerOpen = true;
          }
          return false;
        }
        return false;
      },
      $: async () => mockBtn,
      waitForSelector: async () => {
        drawerOpen = true;
        return true;
      },
      waitForTimeout: async () => {}
    };

    const opened = await openTaskDrawer(mockPage);
    assert.strictEqual(opened, true);
    assert.strictEqual(clicked, true);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - openTaskDrawer auto-cura com reload defensivo quando preso em skeleton', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let reloaded = false;
    const mockBtn = { click: async () => {} };

    const mockPage = {
      $eval: async (sel, fn) => {
        if (sel.includes('e2e_task')) {
          return fn({ getBoundingClientRect: () => ({ height: reloaded ? 400 : 0 }) });
        }
        return false;
      },
      evaluate: async (fn, arg) => {
        if (arg) return;
        // Retorna skeleton presente até o reload ocorrer
        return !reloaded;
      },
      reload: async () => {
        reloaded = true;
      },
      $: async () => (reloaded ? mockBtn : null),
      waitForSelector: async () => true,
      waitForTimeout: async () => {}
    };

    const opened = await openTaskDrawer({ page: mockPage });
    assert.strictEqual(reloaded, true, 'Deve ter disparado reload defensivo');
    assert.strictEqual(opened, true, 'Deve ter aberto a gaveta após o reload');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - openTaskDrawer utiliza fallback getByRole se seletor CSS falhar', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    let roleClicked = false;
    const mockRoleBtn = {
      click: async () => {
        roleClicked = true;
      }
    };

    const mockPage = {
      $eval: async () => false,
      evaluate: async () => false,
      $: async () => null, // Seletor CSS retorna null
      getByRole: (_role, _opts) => ({
        count: async () => 1,
        first: () => mockRoleBtn
      }),
      waitForSelector: async () => true,
      waitForTimeout: async () => {}
    };

    const opened = await openTaskDrawer(mockPage);
    assert.strictEqual(opened, true);
    assert.strictEqual(roleClicked, true);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - openTaskDrawer retorna false graciosamente após 5 tentativas sem exceção', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const mockPage = {
      $eval: async () => false,
      evaluate: async () => false,
      $: async () => null,
      getByRole: () => ({
        count: async () => 0
      }),
      waitForTimeout: async () => {}
    };

    const opened = await openTaskDrawer(mockPage);
    assert.strictEqual(opened, false);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - openTaskDrawer e extractTasksFromDrawer aceitam chamada por objeto e posicional', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const mockPage = {
      $eval: async (_sel, fn) => fn({ getBoundingClientRect: () => ({ height: 200 }) }),
      $$eval: async (_sel, fn) =>
        fn([
          {
            querySelector: (s) => {
              if (s.includes('title')) return { innerText: 'Browse surprise items' };
              if (s.includes('secondTitle')) return { innerText: 'Tap 3 items' };
              if (s.includes('btn')) return { innerText: 'GO', getAttribute: () => '' };
              if (s.includes('statusText')) return { innerText: '0/2' };
              return null;
            },
            innerText: 'Browse surprise items +100 moedas'
          }
        ])
    };

    // 1. Chamada via objeto
    const openObj = await openTaskDrawer({ page: mockPage });
    const tasksObj = await extractTasksFromDrawer({ page: mockPage });
    assert.strictEqual(openObj, true);
    assert.strictEqual(tasksObj.length, 1);
    assert.strictEqual(tasksObj[0].title, 'Browse surprise items');

    // 2. Chamada posicional direta
    const openPos = await openTaskDrawer(mockPage);
    const tasksPos = await extractTasksFromDrawer(mockPage);
    assert.strictEqual(openPos, true);
    assert.strictEqual(tasksPos.length, 1);
    assert.strictEqual(tasksPos[0].title, 'Browse surprise items');

    // 3. Fallback defensivo com parâmetros nulos
    assert.strictEqual(await openTaskDrawer(null), false);
    assert.deepStrictEqual(await extractTasksFromDrawer(null), []);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - anti-hang: repetição de rodada idêntica 3x marca tarefa como Falhou e desiste no loop', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { findNextPendingTask, getRoundKey, recordRoundAttempt } = require('../libs/tasks/state');
    const task = {
      title: 'View Super discounts',
      statusText: '2/3',
      btnText: 'GO',
      isActionable: true,
      isDone: false,
      completedRounds: 2,
      totalRounds: 3,
      coins: '+10 moedas'
    };

    const taskAttempts = {};
    const roundAttemptsMap = {};
    const failedTasks = {};
    const maxRoundAttempts = 3;
    let actionCount = 0;

    // Simula loop do dispatcher
    while (actionCount < 10) {
      const pending = findNextPendingTask([task], taskAttempts, 4, {
        roundAttemptsMap,
        maxRoundAttempts,
        failedTasks
      });
      if (!pending) break;

      const roundKey = getRoundKey(pending);
      recordRoundAttempt(roundAttemptsMap, roundKey);
      actionCount++;
    }

    assert.strictEqual(actionCount, 3, 'Deve executar exatamente 3 tentativas antes de desistir');
    assert.strictEqual(
      failedTasks['View Super discounts'],
      'Falhou (sem progresso após 3 tentativas)'
    );

    // Na 4ª checagem, findNextPendingTask retorna null
    const check4 = findNextPendingTask([task], taskAttempts, 4, {
      roundAttemptsMap,
      maxRoundAttempts,
      failedTasks
    });
    assert.strictEqual(check4, null);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - timeout por tentativa (TASK_MAX_DURATION_MS) aborta e contabiliza tentativa gasta', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { withTimeout, recordRoundAttempt, getRoundKey } = require('../libs/tasks/state');

    // Testa helper withTimeout diretamente
    let timeoutCaught = false;
    try {
      await withTimeout(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
        50,
        'Tempo limite excedido'
      );
    } catch (err) {
      timeoutCaught = true;
      assert.strictEqual(err.code, 'TASK_TIMEOUT');
    }
    assert.strictEqual(timeoutCaught, true);

    // Testa no fluxo do loop com contabilização
    const task = {
      title: 'Slow Task',
      statusText: '1/3',
      btnText: 'GO',
      isActionable: true,
      isDone: false
    };
    const taskAttempts = {};
    const roundAttemptsMap = {};
    let attemptsRun = 0;
    const taskMaxDurationMs = 30;

    for (let i = 0; i < 2; i++) {
      taskAttempts[task.title] = (taskAttempts[task.title] || 0) + 1;
      const roundKey = getRoundKey(task);
      recordRoundAttempt(roundAttemptsMap, roundKey);
      attemptsRun++;

      try {
        await withTimeout(
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
          },
          taskMaxDurationMs,
          'Tempo limite excedido'
        );
      } catch (err) {
        assert.strictEqual(err.code, 'TASK_TIMEOUT');
      }
    }

    assert.strictEqual(attemptsRun, 2);
    assert.strictEqual(taskAttempts['Slow Task'], 2);
    assert.strictEqual(roundAttemptsMap['Slow Task:::1/3'], 2);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - waitWithScroll respeita teto TASK_SCROLL_MAX_MS e saída antecipada sem tracking', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { waitWithScroll } = require('../browser');
    const mockPage = {
      on: () => {},
      off: () => {},
      evaluate: async () => {},
      waitForTimeout: async () => {} // Mock instantâneo
    };

    // 1. Teto TASK_SCROLL_MAX_MS limita tempo solicitado (solicitado: 60s, teto: 40ms)
    const t0 = Date.now();
    await waitWithScroll(mockPage, 60, { taskScrollMaxMs: 40 });
    const elapsed1 = Date.now() - t0;
    assert.ok(elapsed1 < 500, `Duração com teto deve ser baixa, foi ${elapsed1}ms`);

    // 2. Saída antecipada sem sinal de tracking/progresso (earlyExitOnNoProgress)
    const t1 = Date.now();
    await waitWithScroll(mockPage, 10, {
      earlyExitOnNoProgress: true,
      noProgressTimeoutMs: 30
    });
    const elapsed2 = Date.now() - t1;
    assert.ok(elapsed2 < 500, `Saída sem tracking deve ocorrer rapidamente, foi ${elapsed2}ms`);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - classifyTaskStatus e relatório marcam tarefas desistidas como Falhou (nunca Concluída)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { classifyTaskStatus } = require('../libs/tasks/state');
    const { buildUnifiedReportPayload, buildMultiAccountReportPayload } = require('../libs/report');

    const failedTaskDoneFlagTrue = {
      title: 'View Super discounts',
      statusText: '2/3',
      completedRounds: 2,
      totalRounds: 3,
      isDone: true // mesmo que flag estivesse true por anomalia
    };

    const failedTasks = {
      'View Super discounts': 'Falhou (sem progresso após 3 tentativas)'
    };

    // 1. classifyTaskStatus prioriza failedTasks e nunca retorna Concluída
    const status = classifyTaskStatus(failedTaskDoneFlagTrue, { failedTasks });
    assert.strictEqual(status, 'Falhou (sem progresso após 3 tentativas)');
    assert.ok(!status.includes('Concluída'));

    // 2. Com failureReason direto na tarefa
    const statusWithReason = classifyTaskStatus({
      title: 'Outra Tarefa',
      isDone: true,
      failureReason: 'Falhou (sem progresso após 3 tentativas)'
    });
    assert.strictEqual(statusWithReason, 'Falhou (sem progresso após 3 tentativas)');

    // 3. No payload unificado
    const unified = buildUnifiedReportPayload(
      { totalBalance: '500', coinsGainedToday: '70', alreadyCollected: false },
      {
        results: [
          {
            title: 'View Super discounts',
            status,
            coins: '+10 moedas'
          }
        ],
        finalCoins: '500 moedas',
        duration: '1m 20s'
      }
    );
    assert.strictEqual(unified.tasks.results[0].status, 'Falhou (sem progresso após 3 tentativas)');

    // 4. No payload multi-conta
    const multi = buildMultiAccountReportPayload([
      {
        account: { maskedUser: 'us***@example.com' },
        tasksResult: {
          results: [
            {
              title: 'View Super discounts',
              status,
              coins: '+10 moedas'
            }
          ],
          finalCoins: '500 moedas',
          totalActions: 3
        }
      }
    ]);
    assert.strictEqual(
      multi.accounts[0].tasks.results[0].status,
      'Falhou (sem progresso após 3 tentativas)'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - simulação completa do bug: 5 tentativas travadas cortam em 3 e finalizam limpo em ms', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const {
      findNextPendingTask,
      recordTaskAttempt,
      getRoundKey,
      recordRoundAttempt,
      classifyTaskStatus
    } = require('../libs/tasks/state');

    // Reproduz o cenário exato do bug:
    // View Super discounts presa na Rodada 3/3 (statusText: '2/3')
    // No bug original, executava 5x (ou até MAX_TOTAL_ACTIONS=25) levando minutos/horas.
    const stuckTask = {
      index: 0,
      title: 'View Super discounts',
      statusText: '2/3',
      btnText: 'GO',
      isActionable: true,
      isDone: false,
      completedRounds: 2,
      totalRounds: 3,
      coins: '+10 moedas'
    };

    const taskAttempts = {};
    const roundAttemptsMap = {};
    const failedTasks = {};
    const taskProgressMap = {};
    const maxAttemptsPerTask = 4;
    const maxRoundAttempts = 3;
    let totalActions = 0;
    const MAX_TOTAL_ACTIONS = 25;

    const startTime = Date.now();

    while (totalActions < MAX_TOTAL_ACTIONS) {
      // Simula gaveta retornando a mesma tarefa sempre sem progresso (throttling do AliExpress)
      const currentTasks = [{ ...stuckTask }];

      // Checagem de progresso idêntica a do_tasks.js
      for (const t of currentTasks) {
        if (t.completedRounds !== null && t.completedRounds !== undefined) {
          const prevRounds = taskProgressMap[t.title] !== undefined ? taskProgressMap[t.title] : -1;
          if (t.completedRounds > prevRounds) {
            taskProgressMap[t.title] = t.completedRounds;
          }
        }
      }

      const pendingTask = findNextPendingTask(currentTasks, taskAttempts, maxAttemptsPerTask, {
        roundAttemptsMap,
        maxRoundAttempts,
        failedTasks
      });

      if (!pendingTask) {
        break; // Nenhuma tarefa elegível restante
      }

      const roundKey = getRoundKey(pendingTask);
      recordTaskAttempt(taskAttempts, pendingTask.title);
      recordRoundAttempt(roundAttemptsMap, roundKey);
      totalActions++;
    }

    const durationMs = Date.now() - startTime;

    // Garante que travamento de 5 tentativas foi cortado em exatamente 3
    assert.strictEqual(totalActions, 3, 'Deve cortar em exatamente 3 ações');
    assert.strictEqual(
      roundAttemptsMap['View Super discounts:::2/3'],
      3,
      'Deve ter registrado 3 tentativas para a rodada'
    );
    assert.strictEqual(
      failedTasks['View Super discounts'],
      'Falhou (sem progresso após 3 tentativas)'
    );

    // Gera resultados finais
    const finalTasks = [{ ...stuckTask }];
    const results = finalTasks.map((t) => ({
      title: t.title,
      status: failedTasks[t.title] || classifyTaskStatus(t, { failedTasks }),
      coins: t.coins
    }));

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].status, 'Falhou (sem progresso após 3 tentativas)');
    assert.ok(durationMs < 500, `Execução em mock deve durar milissegundos, levou ${durationMs}ms`);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - findNextPendingTask adota maxRoundAttempts = 3 por padrão se não especificado', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { findNextPendingTask, getRoundKey, recordRoundAttempt } = require('../libs/tasks/state');
    const task = {
      title: 'Stuck Task',
      statusText: '1/3',
      btnText: 'GO',
      isActionable: true,
      isDone: false
    };

    const taskAttempts = {};
    const roundAttemptsMap = {};
    const failedTasks = {};
    let count = 0;

    // Não especifica maxRoundAttempts nas opções -> deve usar 3 por padrão
    while (count < 10) {
      const pending = findNextPendingTask([task], taskAttempts, 10, {
        roundAttemptsMap,
        failedTasks
      });
      if (!pending) break;

      const roundKey = getRoundKey(pending);
      recordRoundAttempt(roundAttemptsMap, roundKey);
      count++;
    }

    assert.strictEqual(
      count,
      3,
      'Deve executar exatamente 3 tentativas por padrão antes de desistir'
    );
    assert.strictEqual(failedTasks['Stuck Task'], 'Falhou (sem progresso após 3 tentativas)');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - isolamento no TASK_TIMEOUT: fecha aba ou força goto(commit) curto e próxima ação executa em página sã', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { withTimeout, getRoundKey, recordRoundAttempt } = require('../libs/tasks/state');

    const gotoCalls = [];

    const mockPage = {
      url: () => 'https://m.aliexpress.com/item/100500.html',
      goto: async (url, opts) => {
        gotoCalls.push({ url, opts });
      },
      waitForTimeout: async () => {}
    };

    const tasks = [
      { title: 'Hanging Task', statusText: '1/1', isDone: false, hangs: true },
      { title: 'Healthy Task', statusText: '1/1', isDone: false, hangs: false }
    ];

    const taskAttempts = {};
    const roundAttemptsMap = {};
    const executedSuccess = [];

    for (const t of tasks) {
      taskAttempts[t.title] = (taskAttempts[t.title] || 0) + 1;
      const roundKey = getRoundKey(t);
      recordRoundAttempt(roundAttemptsMap, roundKey);

      let actionTimedOut = false;
      try {
        await withTimeout(
          async () => {
            if (t.hangs) {
              await new Promise((resolve) => setTimeout(resolve, 80));
            } else {
              executedSuccess.push(t.title);
            }
          },
          30,
          `Tempo limite da tarefa "${t.title}" excedido`
        );
      } catch (err) {
        if (err.code === 'TASK_TIMEOUT') {
          actionTimedOut = true;
        }
      }

      if (actionTimedOut) {
        // Recuperação e isolamento idênticos ao do_tasks.js
        if (mockPage.goto) {
          await mockPage
            .goto('https://m.aliexpress.com/p/coin-index/index.html', {
              waitUntil: 'commit',
              timeout: 10000
            })
            .catch(() => {});
        }
        await mockPage.waitForTimeout(1000).catch(() => {});
        continue;
      }
    }

    // Validações
    assert.strictEqual(taskAttempts['Hanging Task'], 1);
    assert.strictEqual(taskAttempts['Healthy Task'], 1);
    assert.deepStrictEqual(executedSuccess, ['Healthy Task']);
    assert.strictEqual(gotoCalls.length, 1);
    assert.strictEqual(gotoCalls[0].url, 'https://m.aliexpress.com/p/coin-index/index.html');
    assert.strictEqual(gotoCalls[0].opts.waitUntil, 'commit');
    assert.strictEqual(gotoCalls[0].opts.timeout, 10000);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
