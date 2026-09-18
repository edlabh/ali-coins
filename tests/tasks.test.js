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

test('tasks - withTimeout aborta o AbortSignal para cancelar ação órfã no browser', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { withTimeout } = require('../libs/tasks/state');

    let aborted = false;
    let signalRef = null;

    await assert.rejects(
      withTimeout(
        (signal) =>
          new Promise(() => {
            signalRef = signal;
            signal.addEventListener('abort', () => {
              aborted = true;
            });
          }),
        40,
        'Timeout de teste cancelável'
      ),
      (err) => err.code === 'TASK_TIMEOUT'
    );

    assert.ok(signalRef, 'withTimeout deve fornecer um AbortSignal para a função');
    assert.strictEqual(signalRef.aborted, true, 'Signal deve estar abortado após o timeout');
    assert.strictEqual(aborted, true, 'Listener de abort deve ter sido disparado');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('browser.js - waitWithScroll encerra imediatamente ao receber abortSignal', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { waitWithScroll } = require('../browser');
    const controller = new AbortController();
    const mockPage = {
      on: () => {},
      off: () => {},
      evaluate: async () => {},
      // Cede o event loop (macrotask) para que o timer de abort possa disparar
      waitForTimeout: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10)))
    };

    setTimeout(() => controller.abort(), 50);

    const t0 = Date.now();
    await waitWithScroll(mockPage, 30, { abortSignal: controller.signal });
    const elapsed = Date.now() - t0;

    assert.ok(elapsed < 1000, `Scroll deveria encerrar ao abortar, levou ${elapsed}ms`);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executeTaskAction com signal já abortado retorna sem acionar o browser', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { executeTaskAction } = require('../libs/tasks/dispatcher');
    const controller = new AbortController();
    controller.abort();

    let touchedPage = false;
    const mockPage = {
      get url() {
        touchedPage = true;
        return () => '';
      },
      evaluate: async () => {
        touchedPage = true;
      },
      $: async () => {
        touchedPage = true;
        return null;
      }
    };

    const res = await executeTaskAction({
      page: mockPage,
      context: null,
      task: { title: 'Tarefa qualquer', desc: '', isActionable: true, btnText: 'GO' },
      config: {},
      signal: controller.signal
    });

    assert.deepStrictEqual(res, {});
    assert.strictEqual(touchedPage, false, 'Nenhuma interação no page deve ocorrer após abort');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - botão desconhecido não é marcado como concluído nem executado às cegas', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { extractTasksFromDrawer } = require('../libs/tasks/verifier');
    const { classifyTaskStatus, findNextPendingTask } = require('../libs/tasks/state');

    const mockPage = {
      $$eval: async (_sel, fn) =>
        fn([
          {
            querySelector: (s) => {
              if (s.includes('title')) return { innerText: 'Nova tarefa A/B' };
              if (s.includes('secondTitle')) return { innerText: '' };
              if (s.includes('btn')) return { innerText: 'VIEW', getAttribute: () => '' };
              if (s.includes('statusText')) return { innerText: '' };
              return null;
            },
            innerText: 'Nova tarefa A/B +5 moedas'
          }
        ])
    };

    const tasks = await extractTasksFromDrawer(mockPage);
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].btnText, 'VIEW');
    assert.strictEqual(
      tasks[0].isDone,
      false,
      'Botão desconhecido não pode ser considerado concluído'
    );

    const status = classifyTaskStatus(tasks[0]);
    assert.ok(
      /não reconhecido|verificação manual/i.test(status),
      `Status deve indicar verificação manual, obtido: ${status}`
    );

    assert.strictEqual(
      findNextPendingTask(tasks, {}, 3),
      null,
      'Tarefa com botão desconhecido não deve ser executada às cegas'
    );

    // Regressão: botões DONE/desabilitados continuam sendo tratados como concluídos
    assert.strictEqual(
      classifyTaskStatus({
        isDone: true,
        btnText: 'DONE',
        isActionable: false,
        isClaimable: false
      }),
      'Concluída'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - estilo "cover" não marca mais tarefa ativa como concluída (regressão)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { extractTasksFromDrawer } = require('../libs/tasks/verifier');

    const buildMock = (btnText, style) => ({
      $$eval: async (_sel, fn) =>
        fn([
          {
            querySelector: (s) => {
              if (s.includes('title')) return { innerText: 'Tarefa ativa' };
              if (s.includes('secondTitle')) return { innerText: '' };
              if (s.includes('btn')) return { innerText: btnText, getAttribute: () => style };
              if (s.includes('statusText')) return { innerText: '' };
              return null;
            },
            innerText: 'Tarefa ativa +5 moedas'
          }
        ])
    });

    const coverTask = (await extractTasksFromDrawer(buildMock('GO', 'background-size: cover')))[0];
    assert.strictEqual(
      coverTask.isDone,
      false,
      'Estilo com "cover" não pode marcar tarefa ativa como concluída'
    );

    const disabledTask = (await extractTasksFromDrawer(buildMock('GO', 'opacity: 0.5')))[0];
    assert.strictEqual(
      disabledTask.isDone,
      true,
      'Botão com opacity: 0.5 continua sendo considerado concluído'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - rótulo explícito de conclusão não cai no aviso de botão desconhecido', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { classifyTaskStatus } = require('../libs/tasks/state');
    const status = classifyTaskStatus({
      isDone: false,
      btnText: 'DONE',
      isActionable: false,
      isClaimable: false
    });
    assert.strictEqual(status, 'Pendente', `DONE não é "desconhecido": ${status}`);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - statusText de progresso tem prioridade sobre aviso de botão desconhecido', () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { classifyTaskStatus } = require('../libs/tasks/state');
    const status = classifyTaskStatus({
      isDone: false,
      btnText: 'VIEW',
      isActionable: false,
      isClaimable: false,
      statusText: '1/3'
    });
    assert.strictEqual(
      status,
      'Executada parcialmente (1/3)',
      `Progresso deve prevalecer sobre botão desconhecido: ${status}`
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - libs/ui.executeTaskAction despacha objeto para executeSurpriseItems (regressão)', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { executeTaskAction: uiExecuteTaskAction } = require('../libs/ui');
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
      url: () => 'https://m.aliexpress.com/p/coin-index/surprise.html',
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

    // Chamada exatamente como feita em do_tasks.js
    const res = await uiExecuteTaskAction({
      page: mockPage,
      context: mockContext,
      task: { title: 'Browse surprise items', desc: 'Tap 3 items', completedRounds: 0 },
      config: {},
      signal: null
    });

    assert.deepStrictEqual(res, {});
    assert.strictEqual(clickedCards, 3, 'Deve tocar em 3 produtos na primeira rodada');
    assert.strictEqual(closedTab, true, 'Deve fechar as abas abertas');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executeSurpriseItems lida com navegação em mesma aba para adclick.html e chama goBack()', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { executeSurpriseItems } = require('../libs/tasks/surprise');
    let currentUrl = 'https://m.aliexpress.com/p/coin-index/surprise.html';
    let clickedCards = 0;
    let goBackCalls = 0;

    const mockCard = {
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        clickedCards++;
        // Simula navegação na mesma aba para página de anúncio (adclick.html)
        currentUrl = `https://ad.aliexpress.com/adclick.html?id=${clickedCards}`;
      }
    };

    const mockPage = {
      waitForSelector: async () => {},
      $$: async () => [mockCard, mockCard, mockCard],
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => currentUrl,
      goBack: async () => {
        goBackCalls++;
        // goBack retorna à página de feed de surpresas
        currentUrl = 'https://m.aliexpress.com/p/coin-index/surprise.html';
      },
      waitForLoadState: async () => {}
    };

    // context sem waitForEvent (navegação em mesma aba)
    const count = await executeSurpriseItems({
      page: mockPage,
      context: null,
      startIndex: 0
    });

    assert.strictEqual(count, 3, 'Deve clicar em todos os 3 produtos');
    assert.strictEqual(clickedCards, 3);
    assert.strictEqual(
      goBackCalls,
      3,
      'Deve ter chamado goBack() para cada navegação em adclick.html'
    );
    assert.strictEqual(currentUrl, 'https://m.aliexpress.com/p/coin-index/surprise.html');
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executeSurpriseItems força goto(feedUrl) caso goBack() não saia de adclick.html', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { executeSurpriseItems } = require('../libs/tasks/surprise');
    const feedUrl = 'https://m.aliexpress.com/p/coin-index/surprise.html';
    let currentUrl = feedUrl;
    let clickedCards = 0;
    const gotoCalls = [];

    const mockCard = {
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        clickedCards++;
        currentUrl = 'https://ad.aliexpress.com/adclick.html';
      }
    };

    const mockPage = {
      waitForSelector: async () => {},
      $$: async () => [mockCard, mockCard, mockCard],
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => currentUrl,
      goBack: async () => {
        // Simula histórico preso onde goBack() não altera o URL (location.replace)
      },
      goto: async (targetUrl) => {
        gotoCalls.push(targetUrl);
        currentUrl = targetUrl;
      },
      waitForLoadState: async () => {}
    };

    const count = await executeSurpriseItems({
      page: mockPage,
      context: null,
      startIndex: 0
    });

    assert.strictEqual(count, 3);
    assert.strictEqual(clickedCards, 3);
    assert.strictEqual(
      gotoCalls.length,
      3,
      'Deve ter forçado goto() para feedUrl em cada falha de goBack()'
    );
    assert.strictEqual(gotoCalls[0], feedUrl);
    assert.strictEqual(currentUrl, feedUrl);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executeSurpriseItems captura nova aba via fallback context.pages() se waitForEvent expirar', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { executeSurpriseItems } = require('../libs/tasks/surprise');
    let clickedCards = 0;
    let closedTabCount = 0;
    let tabOpened = false;

    const mockCard = {
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        clickedCards++;
        tabOpened = true;
      }
    };

    const mockPage = {
      waitForSelector: async () => {},
      $$: async () => [mockCard, mockCard, mockCard],
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => 'https://m.aliexpress.com/p/coin-index/surprise.html',
      goBack: async () => {},
      waitForLoadState: async () => {}
    };

    const mockTab = {
      isClosed: () => false,
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      close: async () => {
        closedTabCount++;
        tabOpened = false;
      }
    };

    const mockContext = {
      // waitForEvent expira com timeout (retorna null)
      waitForEvent: async () => null,
      // Mas a aba existe em context.pages() após o clique
      pages: () => (tabOpened ? [mockPage, mockTab] : [mockPage])
    };

    const count = await executeSurpriseItems({
      page: mockPage,
      context: mockContext,
      startIndex: 0
    });

    assert.strictEqual(count, 3);
    assert.strictEqual(clickedCards, 3);
    assert.strictEqual(
      closedTabCount,
      3,
      'Deve fechar as abas capturadas via fallback context.pages()'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executeSurpriseItems NUNCA fecha a página principal pré-existente (mainPage) via fallback', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { executeSurpriseItems } = require('../libs/tasks/surprise');
    let mainPageClosed = false;
    let surprisePageClosed = false;
    let itemTabClosed = false;
    let tabOpened = false;

    const mockMainPage = {
      isClosed: () => mainPageClosed,
      close: async () => {
        mainPageClosed = true;
      }
    };

    const createMockCard = (id) => ({
      id,
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        tabOpened = true;
      }
    });
    const cardsList = [createMockCard('c1'), createMockCard('c2'), createMockCard('c3')];

    const mockSurprisePage = {
      isClosed: () => surprisePageClosed,
      waitForSelector: async () => {},
      $$: async () => cardsList,
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => 'https://m.aliexpress.com/p/coin-index/adclick.html?componentType=productClick',
      goBack: async () => {},
      waitForLoadState: async () => {},
      close: async () => {
        surprisePageClosed = true;
      }
    };

    const mockItemTab = {
      isClosed: () => itemTabClosed,
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      close: async () => {
        itemTabClosed = true;
        tabOpened = false;
      }
    };

    // context.pages() contém a mainPage e a surprisePage antes do clique
    const mockContext = {
      waitForEvent: async () => null,
      pages: () =>
        tabOpened ? [mockMainPage, mockSurprisePage, mockItemTab] : [mockMainPage, mockSurprisePage]
    };

    const count = await executeSurpriseItems({
      page: mockSurprisePage,
      context: mockContext,
      startIndex: 0
    });

    assert.strictEqual(
      mainPageClosed,
      false,
      'A página principal do runner NUNCA pode ser fechada pelo surprise'
    );
    assert.strictEqual(
      surprisePageClosed,
      false,
      'A página do feed surpresa NÃO deve ser fechada pelo surprise'
    );
    assert.strictEqual(
      itemTabClosed,
      true,
      'Apenas a aba do item aberta pelo clique deve ser fechada'
    );
    assert.strictEqual(count, 3);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - ensureMainPage recupera página fechada ou em URL incorreta criando nova página', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { ensureMainPage } = require('../libs/tasks/verifier');
    const { ensureMainPage: ensureMainPageDoTasks } = require('../do_tasks');

    assert.strictEqual(typeof ensureMainPage, 'function');
    assert.strictEqual(typeof ensureMainPageDoTasks, 'function');

    // Cenário 1: Página fechada -> deve criar nova página via context.newPage() e navegar
    let newPageCreated = false;
    let freshPageNavigated = false;
    const closedPage = {
      isClosed: () => true,
      url: () => 'https://m.aliexpress.com/p/coin-index/index.html'
    };
    const mockFreshPage = {
      isClosed: () => false,
      url: () => 'https://m.aliexpress.com/p/coin-index/index.html',
      goto: async (url) => {
        if (url.includes('coin-index/index.html')) freshPageNavigated = true;
      }
    };
    const mockContext = {
      newPage: async () => {
        newPageCreated = true;
        return mockFreshPage;
      }
    };

    const recoveredPage = await ensureMainPage({
      page: closedPage,
      context: mockContext,
      config: { NAV_TIMEOUT: 5000 }
    });

    assert.strictEqual(
      newPageCreated,
      true,
      'Deve ter chamado context.newPage() para recriar página fechada'
    );
    assert.strictEqual(
      freshPageNavigated,
      true,
      'Deve ter navegado nova página para a central de moedas'
    );
    assert.strictEqual(recoveredPage, mockFreshPage, 'Deve retornar a nova página criada');

    // Cenário 2: Página aberta mas fora da central de moedas -> deve navegar de volta
    let redirected = false;
    const openPageWrongUrl = {
      isClosed: () => false,
      url: () => 'https://m.aliexpress.com/item/1005009999.html',
      goto: async (url) => {
        if (url.includes('coin-index/index.html')) redirected = true;
      }
    };

    const redirectedPage = await ensureMainPage({
      page: openPageWrongUrl,
      context: mockContext,
      config: { NAV_TIMEOUT_SHORT: 3000 }
    });

    assert.strictEqual(redirected, true, 'Deve redirecionar página que saiu da central de moedas');
    assert.strictEqual(redirectedPage, openPageWrongUrl);

    // Cenário 3: Página sã já na central -> não faz goto desnecessário
    let unnecessaryGoto = false;
    const healthyPage = {
      isClosed: () => false,
      url: () => 'https://m.aliexpress.com/p/coin-index/index.html?_immersiveMode=true',
      goto: async () => {
        unnecessaryGoto = true;
      }
    };

    const healthyResult = await ensureMainPage({
      page: healthyPage,
      context: mockContext
    });

    assert.strictEqual(unnecessaryGoto, false, 'Não deve efetuar goto se já estiver na central');
    assert.strictEqual(healthyResult, healthyPage);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - executeSurpriseItems respeita cancelamento cooperativo via AbortSignal', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { executeSurpriseItems } = require('../libs/tasks/surprise');
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
      url: () => 'https://m.aliexpress.com/p/coin-index/surprise.html'
    };

    // Caso 1: Signal já abortado antes de iniciar
    const controller1 = new AbortController();
    controller1.abort();

    const count1 = await executeSurpriseItems({
      page: mockPage,
      signal: controller1.signal
    });

    assert.strictEqual(count1, 0, 'Deve retornar 0 cliques com signal já abortado');
    assert.strictEqual(clickedCards, 0, 'Nenhum clique deve ser efetuado');

    // Caso 2: Abortado cooperativamente durante a execução (após primeiro clique)
    const controller2 = new AbortController();
    const abortingCard = {
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        clickedCards++;
        controller2.abort();
      }
    };

    const mockPage2 = {
      waitForSelector: async () => {},
      $$: async () => [abortingCard, abortingCard, abortingCard],
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => 'https://m.aliexpress.com/p/coin-index/surprise.html'
    };

    const count2 = await executeSurpriseItems({
      page: mockPage2,
      signal: controller2.signal
    });

    assert.strictEqual(count2, 1, 'Deve interromper após o clique que disparou o abort');
    assert.strictEqual(clickedCards, 1);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks - libs/ui preserva assinatura híbrida (posicional e objeto) para todas as funções', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const ui = require('../libs/ui');

    const mockPage = {
      waitForSelector: async () => {},
      $$: async () => [],
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => 'https://m.aliexpress.com/p/coin-index/index.html'
    };

    // executeTaskAction posicional via libs/ui
    const posRes = await ui.executeTaskAction(mockPage, null, { title: 'Merge Boss game' }, {});
    assert.strictEqual(posRes.isSpecialOrAppOnly, true);

    // executeTaskAction por objeto via libs/ui
    const objRes = await ui.executeTaskAction({
      page: mockPage,
      task: { title: 'Merge Boss game' }
    });
    assert.strictEqual(objRes.isSpecialOrAppOnly, true);

    // executeSurpriseItems posicional via libs/ui
    const mockCard = {
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {}
    };
    const mockSurprisePage = {
      waitForSelector: async () => {},
      $$: async () => [mockCard, mockCard, mockCard],
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => 'https://m.aliexpress.com/p/coin-index/surprise.html'
    };
    const surprisePos = await ui.executeSurpriseItems(mockSurprisePage, null, 0);
    assert.strictEqual(surprisePos, 3);

    // executeSurpriseItems por objeto via libs/ui
    const surpriseObj = await ui.executeSurpriseItems({
      page: mockSurprisePage,
      startIndex: 0
    });
    assert.strictEqual(surpriseObj, 3);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

// ============================================================================
// TESTES PARA OS 3 RISCOS RESIDUAIS (Risco 1, Risco 2, Risco 3)
// ============================================================================

test('tasks (Risco 1) - extractTasksFromDrawer não engole exceção silenciosamente e suporta throwOnError e .error', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { extractTasksFromDrawer } = require('../libs/tasks/verifier');

    // 1. Chamada com page nula por padrão: retorna [] com .error não-enumerável
    const resNull = await extractTasksFromDrawer(null);
    assert.strictEqual(Array.isArray(resNull), true);
    assert.strictEqual(resNull.length, 0);
    assert.ok(resNull.error, 'Deve conter propriedade .error');
    assert.strictEqual(resNull.error.code, 'PAGE_CLOSED');

    // 2. Chamada com page fechada e throwOnError: true -> deve lançar exceção tipada
    const closedPage = { isClosed: () => true };
    await assert.rejects(
      async () => {
        await extractTasksFromDrawer({ page: closedPage, throwOnError: true });
      },
      (err) => {
        assert.strictEqual(err.code, 'PAGE_CLOSED');
        return true;
      }
    );

    // 3. Chamada com erro no $$eval sem throwOnError -> retorna [] com .error
    const errorPage = {
      isClosed: () => false,
      $$eval: async () => {
        throw new Error('Target page detached during evaluation');
      }
    };
    const resError = await extractTasksFromDrawer(errorPage);
    assert.strictEqual(Array.isArray(resError), true);
    assert.strictEqual(resError.length, 0);
    assert.ok(resError.error);
    assert.strictEqual(resError.error.message, 'Target page detached during evaluation');

    // 4. Chamada de sucesso -> retorna tarefas e .error === null
    const successPage = {
      isClosed: () => false,
      $$eval: async () => [
        {
          title: 'Explore sponsored items',
          desc: '15s',
          btnText: 'GO',
          btnStyle: '',
          statusText: '',
          isDone: false,
          isActionable: true,
          isClaimable: false,
          coins: '+10 moedas'
        }
      ]
    };
    const resSuccess = await extractTasksFromDrawer(successPage);
    assert.strictEqual(resSuccess.length, 1);
    assert.strictEqual(resSuccess.error, null);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks (Risco 2) - normalizeFeedUrl e isFeedUrl diferenciam feed de anúncios e tratam query volátil', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { normalizeFeedUrl, isFeedUrl } = require('../libs/tasks/surprise');

    const feedBase =
      'https://m.aliexpress.com/p/coin-index/adclick.html?componentType=productClick&taskId=1722001';
    const feedWithVolatile = `${feedBase}&_immersiveMode=true&spm=a2g0n.13499126.0.0&aecmd=true`;

    // (c) Feed com query volátil alterada é normalizado e considerado o mesmo feed
    assert.strictEqual(
      normalizeFeedUrl(feedBase),
      normalizeFeedUrl(feedWithVolatile),
      'Parâmetros voláteis não devem alterar URL normalizada'
    );
    assert.strictEqual(
      isFeedUrl(feedWithVolatile, feedBase, 3),
      true,
      'Deve considerar o mesmo feed quando há cards e apenas query volátil mudou'
    );

    // (a) URL adclick com params diferentes e sem cards -> NÃO é o feed
    const adRedirectUrl =
      'https://m.aliexpress.com/p/coin-index/adclick.html?componentType=externalAd&other=999';
    assert.strictEqual(
      isFeedUrl(adRedirectUrl, feedBase, 0),
      false,
      'Destino com params diferentes e sem cards não deve ser reconhecido como feed'
    );

    // (b) URL igual ao feed com cards -> é o feed
    assert.strictEqual(
      isFeedUrl(feedBase, feedBase, 3),
      true,
      'Feed original com cards deve ser reconhecido como feed'
    );

    // Se a contagem de cards for 0, mesmo com URL idêntica, não está no feed
    assert.strictEqual(
      isFeedUrl(feedBase, feedBase, 0),
      false,
      'Se cardCount for 0, deve retornar false para disparar recuperação'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks (Risco 2) - executeSurpriseItems: destino adclick com params diferentes e sem cards dispara goBack/goto', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { executeSurpriseItems } = require('../libs/tasks/surprise');
    const feedUrl =
      'https://m.aliexpress.com/p/coin-index/adclick.html?componentType=productClick&taskId=1722001';
    let currentUrl = feedUrl;
    const createMockCard = (id) => ({
      id,
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        // Ao clicar, navega para outro adclick sem cards de produto
        currentUrl =
          'https://m.aliexpress.com/p/coin-index/adclick.html?componentType=advertiserTarget&adId=888';
        cardsInDom = []; // Página de destino não tem cards de produto
      }
    });

    let cardsInDom = [createMockCard('c1'), createMockCard('c2'), createMockCard('c3')];
    let goBackCalls = 0;
    const gotoCalls = [];

    const mockPage = {
      waitForSelector: async () => {},
      $$: async () => cardsInDom,
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => currentUrl,
      goBack: async () => {
        goBackCalls++;
        // goBack recupera feed
        currentUrl = feedUrl;
        cardsInDom = [createMockCard('c1'), createMockCard('c2'), createMockCard('c3')];
      },
      goto: async (targetUrl) => {
        gotoCalls.push(targetUrl);
        currentUrl = targetUrl;
        cardsInDom = [createMockCard('c1'), createMockCard('c2'), createMockCard('c3')];
      },
      waitForLoadState: async () => {}
    };

    const count = await executeSurpriseItems({
      page: mockPage,
      context: null,
      startIndex: 0
    });

    assert.strictEqual(count, 3);
    assert.strictEqual(
      goBackCalls,
      3,
      'Deve disparar goBack() para cada navegação em destino adclick sem cards'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks (Risco 3) - mock com 6 cards em 2 rodadas toca 6 cards distintos sem repetição', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { executeSurpriseItems } = require('../libs/tasks/surprise');
    const feedUrl =
      'https://m.aliexpress.com/p/coin-index/adclick.html?componentType=productClick&taskId=1722001';

    const clickedCardIds = [];
    const createMockCard = (id) => ({
      id,
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        clickedCardIds.push(id);
      }
    });

    const cardsPool = [
      createMockCard('product-1'),
      createMockCard('product-2'),
      createMockCard('product-3'),
      createMockCard('product-4'),
      createMockCard('product-5'),
      createMockCard('product-6')
    ];

    const mockPage = {
      waitForSelector: async () => {},
      $$: async () => cardsPool,
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => feedUrl,
      goBack: async () => {},
      waitForLoadState: async () => {}
    };

    // Shared Set entre rodadas
    const touchedCards = new Set();

    // Rodada 1: startIndex = 0
    const countR1 = await executeSurpriseItems({
      page: mockPage,
      context: null,
      startIndex: 0,
      touchedCards
    });
    assert.strictEqual(countR1, 3);
    assert.deepStrictEqual(clickedCardIds.slice(0, 3), ['product-1', 'product-2', 'product-3']);

    // Rodada 2: startIndex = 3 com o mesmo touchedCards
    const countR2 = await executeSurpriseItems({
      page: mockPage,
      context: null,
      startIndex: 3,
      touchedCards
    });
    assert.strictEqual(countR2, 3);
    assert.deepStrictEqual(clickedCardIds.slice(3, 6), ['product-4', 'product-5', 'product-6']);

    // Valida que todos os 6 cards foram distintos
    assert.strictEqual(new Set(clickedCardIds).size, 6);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks (Risco 3) - mock com 3 cards na rodada 2 NÃO repete os mesmos cards e encerra com aviso', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { executeSurpriseItems } = require('../libs/tasks/surprise');
    const feedUrl =
      'https://m.aliexpress.com/p/coin-index/adclick.html?componentType=productClick&taskId=1722001';

    const clickedCardIds = [];
    const createMockCard = (id) => ({
      id,
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        clickedCardIds.push(id);
      }
    });

    // Apenas 3 cards existem no DOM
    const cardsPool = [
      createMockCard('product-A'),
      createMockCard('product-B'),
      createMockCard('product-C')
    ];

    const mockPage = {
      waitForSelector: async () => {},
      $$: async () => cardsPool,
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => feedUrl,
      goBack: async () => {},
      waitForLoadState: async () => {}
    };

    const touchedCards = new Set();

    // Rodada 1: toca os 3 cards
    const countR1 = await executeSurpriseItems({
      page: mockPage,
      context: null,
      startIndex: 0,
      touchedCards
    });
    assert.strictEqual(countR1, 3);
    assert.strictEqual(clickedCardIds.length, 3);

    // Rodada 2: startIndex = 3, mas não há cards novos no DOM -> não deve dar wrap
    const countR2 = await executeSurpriseItems({
      page: mockPage,
      context: null,
      startIndex: 3,
      touchedCards
    });

    assert.strictEqual(
      countR2,
      0,
      'Não deve tocar em nenhum card já tocado se não houver novos no DOM'
    );
    assert.strictEqual(
      clickedCardIds.length,
      3,
      'Total de cliques deve permanecer 3 (sem re-toques na rodada 2)'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks (Risco 3) - startIndex explícito é respeitado quando houver cards disponíveis', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { executeSurpriseItems } = require('../libs/tasks/surprise');
    const feedUrl = 'https://m.aliexpress.com/p/coin-index/surprise.html';

    const clickedCardIds = [];
    const createMockCard = (id) => ({
      id,
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        clickedCardIds.push(id);
      }
    });

    const cardsPool = [
      createMockCard('card-0'),
      createMockCard('card-1'),
      createMockCard('card-2'),
      createMockCard('card-3'),
      createMockCard('card-4')
    ];

    const mockPage = {
      waitForSelector: async () => {},
      $$: async () => cardsPool,
      evaluate: async () => {},
      waitForTimeout: async () => {},
      url: () => feedUrl,
      goBack: async () => {},
      waitForLoadState: async () => {}
    };

    // Inicia explicitamente a partir do card 2 (índice 2)
    const count = await executeSurpriseItems({
      page: mockPage,
      context: null,
      startIndex: 2
    });

    assert.strictEqual(count, 3);
    assert.deepStrictEqual(clickedCardIds, ['card-2', 'card-3', 'card-4']);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks (Risco 1) - getDrawerTasksWithRetry recupera falha transitória de abertura e extração via ensureMainPage', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const { getDrawerTasksWithRetry } = require('../libs/tasks/verifier');
    const { getDrawerTasksWithRetry: getFromDoTasks } = require('../do_tasks');

    assert.strictEqual(typeof getDrawerTasksWithRetry, 'function');
    assert.strictEqual(typeof getFromDoTasks, 'function');

    // Cenário 1: Falha na tentativa 1 de abrir a gaveta (gaveta não abre), sucesso na tentativa 2
    let ensureCalls = 0;

    const mockPage = {
      isClosed: () => false,
      url: () => 'https://m.aliexpress.com/p/coin-index/index.html',
      waitForTimeout: async () => {},
      // Na tentativa 1 (ensureCalls === 1), a gaveta não abre. Na tentativa 2 (ensureCalls > 1), abre com sucesso
      $eval: async () => ensureCalls > 1,
      $: async () => ({
        click: async () => {}
      }),
      waitForSelector: async () => {
        if (ensureCalls === 1) throw new Error('Drawer failed to open');
      },
      $$eval: async () => [
        {
          title: 'Task A',
          desc: '',
          btnText: 'GO',
          btnStyle: '',
          statusText: '',
          isDone: false,
          isActionable: true,
          isClaimable: false,
          coins: '+5 moedas'
        }
      ]
    };

    const result = await getDrawerTasksWithRetry({
      page: mockPage,
      maxRetries: 2,
      ensureMainPageFn: async (p) => {
        ensureCalls++;
        return p;
      }
    });

    assert.strictEqual(result.error, null, 'Não deve retornar erro após recuperação');
    assert.strictEqual(result.tasks.length, 1, 'Deve extrair tarefas após abertura na tentativa 2');
    assert.strictEqual(ensureCalls, 2, 'Deve ter chamado ensureMainPage em cada tentativa');

    // Cenário 2: Gaveta aberta legitimamente vazia (sem erros)
    const emptyPage = {
      isClosed: () => false,
      url: () => 'https://m.aliexpress.com/p/coin-index/index.html',
      $eval: async () => true, // Gaveta aberta
      $$eval: async () => [] // Lista de tarefas vazia
    };

    const emptyResult = await getDrawerTasksWithRetry({
      page: emptyPage,
      maxRetries: 2,
      ensureMainPageFn: async (p) => p
    });

    assert.strictEqual(emptyResult.error, null);
    assert.strictEqual(emptyResult.tasks.length, 0);
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});

test('tasks (Risco 3) - clique falho não marca o card como tocado e permite retry', async () => {
  const realFilesSnapshot = snapshotRealFiles();
  try {
    const feedUrl = 'https://m.aliexpress.com/p/coin-index/adclick.html?taskId=retry';

    // Caso 1: click nativo e fallback via evaluate falham -> card NÃO entra em touchedCards
    const alwaysFailCard = {
      id: 'card-sempre-falha',
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        throw new Error('elemento coberto');
      }
    };

    const failPage = {
      waitForSelector: async () => {},
      $$: async () => [alwaysFailCard],
      evaluate: async () => {
        throw new Error('evaluate indisponível');
      },
      waitForTimeout: async () => {},
      url: () => feedUrl,
      goBack: async () => {},
      waitForLoadState: async () => {}
    };

    const touchedFail = new Set();
    await executeSurpriseItems({
      page: failPage,
      context: null,
      startIndex: 0,
      touchedCards: touchedFail
    });
    assert.strictEqual(
      touchedFail.size,
      0,
      'Card com clique falho nas duas vias não deve ser marcado como tocado'
    );

    // Caso 2: click nativo falha mas o fallback via evaluate dispara -> card é marcado
    let clickCalls = 0;
    const fallbackCard = {
      id: 'card-fallback',
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {
        clickCalls++;
        if (clickCalls === 1) throw new Error('elemento coberto');
      }
    };

    const fallbackPage = {
      waitForSelector: async () => {},
      $$: async () => [fallbackCard],
      evaluate: async (fn, el) => fn(el),
      waitForTimeout: async () => {},
      url: () => feedUrl,
      goBack: async () => {},
      waitForLoadState: async () => {}
    };

    const touchedFallback = new Set();
    await executeSurpriseItems({
      page: fallbackPage,
      context: null,
      startIndex: 0,
      touchedCards: touchedFallback
    });
    assert.strictEqual(
      touchedFallback.size,
      1,
      'Clique disparado via fallback deve marcar o card como tocado'
    );
  } finally {
    assertRealFilesUntouched(realFilesSnapshot);
  }
});
