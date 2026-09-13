const fs = require('fs');
const path = require('path');
const { loadConfig, sessionPath, sessionMetaPath, handleDryRun, isForce } = require('./config');
const { formatDate, formatTime, formatDateTime, formatDuration } = require('./time_utils');
const { launchBrowser, newMobileContext, newDesktopContext, waitWithScroll } = require('./browser');
const { safeChmod600, validateSession } = require('./security');
const { acquireLock } = require('./lockfile');
const logger = require('./logger');

// Cache de seletores recorrentes do DOM
const SELECTORS = {
  drawerContainer: '.e2e_task',
  taskItem: '.e2e_normal_task',
  taskTitle: '.e2e_normal_task_content_title',
  taskSecondTitle: '.e2e_normal_task_content_secondTitle',
  taskBtn: '.e2e_normal_task_right_btn',
  taskStatus: '.statusText',
  taskRight: '.e2e_normal_task_right',
  openDrawerBtn: 'button[class*="aecoin-signButton"], .aecoin-signButtonWrapper-3p3NS button, button:has-text("Earn more coins"), button:has-text("Ganhe mais moedas")',
  popupCloseBtn: '[class*="close"], [class*="dialog-close"], [class*="aecoin-close"], .ui-dialog-close, button:has-text("OK"), button:has-text("Confirm")',
  checkinBtn: '#signButton, [class*="aecoin-today"]',
  productCard: '.feeds-discount-card',
  waterBtn: '.Footer--waterCollectedButtonBg--2jKL1c5, [class*="waterCollected"], button:has-text("regar"), button:has-text("Water")',
  mycoinCheckin: 'text=App daily check-in'
};

/**
 * Identifica se a tarefa exige interação direta no App nativo AliExpress
 * @param {object} task
 * @returns {boolean}
 */
function isInteractiveOrAppOnly(task) {
  const text = (task.title + ' ' + task.desc).toLowerCase();
  return text.includes('prize land') || text.includes('0.1') || text.includes('water') || text.includes('regar') ||
         text.includes('merge boss') || text.includes('game') || text.includes('jogo') ||
         text.includes('quiz');
}

/**
 * Toca em 3 produtos na página de anúncios
 * @param {import('playwright').Page} targetPage
 * @param {import('playwright').BrowserContext} context
 * @param {number} startIndex
 * @returns {Promise<number>}
 */
async function executeSurpriseItems(targetPage, context, startIndex = 0) {
  console.log(`Executando tarefa: tocar em 3 itens (a partir do card #${startIndex + 1})...`);
  await targetPage.waitForSelector(SELECTORS.productCard, { timeout: 4000 }).catch(() => {});
  let cards = await targetPage.$$(SELECTORS.productCard);
  console.log(`Encontrados ${cards.length} cards de produtos.`);

  if (startIndex + 3 > cards.length) {
    await targetPage.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
    await targetPage.waitForTimeout(1000);
    cards = await targetPage.$$(SELECTORS.productCard);
  }

  const start = (startIndex < cards.length) ? startIndex : 0;
  const countToClick = Math.min(3, Math.max(0, cards.length - start));
  let clickedCount = 0;

  for (let c = start; c < start + (countToClick || 3); c++) {
    if (c >= cards.length) break;
    console.log(`Tocando item ${clickedCount + 1}/3 (card #${c + 1})...`);
    const card = cards[c];
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await targetPage.waitForTimeout(400);

    const tabPromise = context.waitForEvent('page', { timeout: 3500 }).catch(() => null);
    await card.click({ delay: 50, timeout: 4000 }).catch(async () => {
      await targetPage.evaluate(el => el.click(), card).catch(() => {});
    });

    const itemTab = await tabPromise;
    if (itemTab) {
      console.log('Aba do produto aberta. Consolidando tracking...');
      await itemTab.waitForLoadState('domcontentloaded').catch(() => {});
      // Aguarda registro de telemetria de visualização do produto (1500ms)
      await itemTab.waitForTimeout(1500);
      await itemTab.close().catch(() => {});
    } else if (!targetPage.url().includes('adclick.html')) {
      // Aguarda consolidação do clique antes de retroceder (1500ms)
      await targetPage.waitForTimeout(1500);
      await targetPage.goBack().catch(() => {});
      await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
    }
    clickedCount++;
    await targetPage.waitForTimeout(500);
  }
  await targetPage.waitForTimeout(1000);
  return clickedCount;
}

/**
 * Executa as tarefas diárias do painel "Ganhe mais moedas"
 * @param {object} [options={}]
 * @param {import('playwright').Browser} [options.browser] Navegador compartilhado
 * @param {object} [options.sessionData] Sessão em cache
 * @param {boolean} [options.skipAutoLogin=false] Se true, evita chamada recursiva a runCheckin
 * @returns {Promise<object>}
 */
async function runTasks(options = {}) {
  const tasksStartTime = new Date();
  const config = loadConfig(true);
  const userEmail = config.ALI_USER;

  console.log('================ EXECUÇÃO DAS TAREFAS DIÁRIAS ================');
  console.log(`[Dia e Hora]: ${formatDateTime(tasksStartTime)}`);

  let sessionData = options.sessionData || null;
  let metaData = null;

  // 1. Carregar e validar sessão
  if (!sessionData && fs.existsSync(sessionPath)) {
    try {
      sessionData = JSON.parse(await fs.promises.readFile(sessionPath, 'utf-8'));
    } catch (_) {
      await fs.promises.unlink(sessionPath).catch(() => {});
    }
  }

  if (fs.existsSync(sessionMetaPath)) {
    try {
      metaData = JSON.parse(await fs.promises.readFile(sessionMetaPath, 'utf-8'));
    } catch (_) {
      await fs.promises.unlink(sessionMetaPath).catch(() => {});
    }
  }

  const validation = validateSession(sessionData, metaData, userEmail);

  if (!validation.valid) {
    if (options.skipAutoLogin) {
      console.error('\n' + '='.repeat(68));
      console.error(' [ERRO DE LOGIN - SESSÃO INVÁLIDA]');
      console.error(` ${validation.reason}`);
      console.error(' Interrompendo tarefas (skipAutoLogin ativo).');
      console.error('='.repeat(68) + '\n');
      throw new Error(`Sessão inválida para execução de tarefas: ${validation.reason}`);
    }

    console.log(`[Aviso] ${validation.reason}. Inicializando autenticação via check-in...`);
    await fs.promises.unlink(sessionPath).catch(() => {});
    await fs.promises.unlink(sessionMetaPath).catch(() => {});

    const { runCheckin } = require('./collect');
    try {
      const checkinRes = await runCheckin({ browser: options.browser });
      sessionData = checkinRes.sessionData;
    } catch (authErr) {
      console.error('\n' + '='.repeat(68));
      console.error(' [ERRO DE LOGIN - TAREFAS INTERROMPIDAS]');
      console.error(` O login da conta "${userEmail}" falhou durante o check-in.`);
      console.error(` Motivo: ${authErr.message}`);
      console.error(' A execução das tarefas foi interrompida.');
      console.error('='.repeat(68) + '\n');
      throw authErr;
    }
  }

  console.log(`[Login] Sessão autenticada para: ${userEmail}`);

  let browser = options.browser;
  const isInternalBrowser = !browser;

  if (isInternalBrowser) {
    browser = await launchBrowser({ headless: config.HEADLESS });
  }

  try {
    const context = await newMobileContext(
      browser,
      sessionPath,
      { allowMedia: config.ALLOW_MEDIA }
    );

    let newPageOpened = null;
    context.on('page', p => {
      newPageOpened = p;
    });

    const page = await context.newPage();

    // Sincronizar cookies e handshake de sessão com domínio principal
    console.log('Validando sessão e sincronizando cookies...');
    await page.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    console.log('Acessando https://m.aliexpress.com/p/coin-index/index.html ...');
    await page.goto('https://m.aliexpress.com/p/coin-index/index.html', {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    });
    await page.waitForLoadState('domcontentloaded');

    if (page.url().includes('coin-pc-index')) {
      await page.setViewportSize({ width: 412, height: 915 });
      await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForLoadState('domcontentloaded');
    }

    // Verificar se a página solicitou login
    const loginInput = await page.$('input.cosmos-input, input[type="text"], input[type="email"], #fm-login-id');
    const bodyText = await page.innerText('body').catch(() => '');
    if (loginInput !== null || bodyText.includes('Email or phone number') || bodyText.includes('Sign in')) {
      console.error('\n' + '='.repeat(68));
      console.error(' [ERRO DE LOGIN - TAREFAS INTERROMPIDAS]');
      console.error(' A página de moedas exigiu login. A sessão expirou ou é inválida.');
      console.error(' A execução das tarefas diárias foi interrompida imediatamente.');
      console.error('='.repeat(68) + '\n');
      await context.close();
      if (isInternalBrowser) await browser.close();
      throw new Error('Execução de tarefas interrompida: sessão não autenticada no AliExpress.');
    }

    // 1. Check-in diário se ainda não tiver sido feito
    const signBtn = await page.$(SELECTORS.checkinBtn);
    if (signBtn) {
      const text = (await signBtn.innerText().catch(() => '')).trim();
      if (text.toLowerCase() === 'collect' || text.toLowerCase() === 'coletar') {
        console.log('Check-in pendente encontrado. Coletando...');
        await page.evaluate(el => el.click(), signBtn);
        await page.waitForTimeout(1500);
      }
    }

    // Fechar modais de boas-vindas
    try {
      const modalBtn = await page.$(SELECTORS.popupCloseBtn);
      if (modalBtn) {
        await page.evaluate(el => el.click(), modalBtn).catch(() => {});
        await page.waitForTimeout(500);
      }
    } catch (_) {}

    // 2. Abrir o drawer de tarefas com retry resiliente
    async function openDrawer() {
      let isDrawerOpen = await page.$eval(SELECTORS.drawerContainer, el => {
        const box = el.getBoundingClientRect();
        return box.height > 100;
      }).catch(() => false);

      if (isDrawerOpen) return true;

      await page.waitForFunction(() => !document.querySelector('.login-pending-container'), { timeout: 8000 }).catch(() => {});

      for (let attempt = 1; attempt <= 5; attempt++) {
        const closePopupBtn = await page.$(SELECTORS.popupCloseBtn);
        if (closePopupBtn) {
          await page.evaluate(el => el.click(), closePopupBtn).catch(() => {});
          await page.waitForTimeout(500);
        }

        console.log(`Tentativa ${attempt}/5 de abrir o painel "Ganhe mais moedas"...`);
        const taskBtn = await page.$(SELECTORS.openDrawerBtn);
        if (taskBtn) {
          await page.evaluate(el => el.click(), taskBtn);
        } else {
          await page.evaluate(() => window.scrollBy(0, 150)).catch(() => {});
        }

        try {
          await page.waitForSelector(SELECTORS.taskItem, { timeout: 4000 });
          isDrawerOpen = true;
          break;
        } catch (_) {}

        await page.waitForTimeout(1000);
      }
      return isDrawerOpen;
    }

    const drawerOpened = await openDrawer();
    if (!drawerOpened) {
      console.error('\n' + '='.repeat(68));
      console.error(' [ERRO - TAREFAS INTERROMPIDAS]');
      console.error(' Não foi possível abrir o painel "Ganhe mais moedas" após 5 tentativas.');
      console.error(' A execução das tarefas foi cancelada (possível bloqueio temporário).');
      console.error('='.repeat(68) + '\n');
      const errShot = path.join(__dirname, 'tasks_drawer_failed.png');
      await page.screenshot({ path: errShot, fullPage: true }).catch(() => {});
      safeChmod600(errShot);
      await context.close();
      if (isInternalBrowser) await browser.close();
      throw new Error('Execução de tarefas interrompida: painel "Ganhe mais moedas" inacessível.');
    }

    // Ler tarefas da gaveta
    async function getTasks() {
      return await page.$$eval(SELECTORS.taskItem, els => els.map((e, idx) => {
        const title = e.querySelector('.e2e_normal_task_content_title')?.innerText?.trim() || '';
        const desc = e.querySelector('.e2e_normal_task_content_secondTitle')?.innerText?.trim() || '';
        const btn = e.querySelector('.e2e_normal_task_right_btn');
        const btnText = btn?.innerText?.trim() || '';
        const btnStyle = btn?.getAttribute('style') || '';
        const statusText = e.querySelector('.statusText')?.innerText?.trim() || '';

        let completedRounds = null;
        let currentRound = null;
        let totalRounds = null;
        if (statusText) {
          const sm = statusText.match(/^([0-9]+)\/([0-9]+)$/);
          if (sm) {
            completedRounds = parseInt(sm[1], 10);
            totalRounds = parseInt(sm[2], 10);
            currentRound = Math.min(completedRounds + 1, totalRounds);
          }
        }

        const isDone = btnStyle.includes('opacity: 0.5') ||
                       btnStyle.includes('cover') ||
                       btnText !== 'GO' ||
                       (totalRounds !== null && completedRounds !== null && completedRounds >= totalRounds);

        const groupId = e.querySelector('.e2e_normal_task_right')?.getAttribute('data-groupid') || '';
        const allText = e.innerText?.replace(/\n+/g, ' ') || '';
        const coinMatch = allText.match(/\+([0-9]+(?:～[0-9]+)?)/);
        const coins = coinMatch ? `+${coinMatch[1]} moedas` : '+5 moedas';
        return { index: idx, title, desc, btnText, btnStyle, statusText, completedRounds, currentRound, totalRounds, isDone, groupId, coins, allText };
      }));
    }

    // Loop de processamento de tarefas
    const taskAttempts = {};
    const maxAttemptsPerTask = 4;
    let totalActions = 0;
    const MAX_TOTAL_ACTIONS = 25;

    while (totalActions < MAX_TOTAL_ACTIONS) {
      await openDrawer();
      const currentTasks = await getTasks();
      if (!currentTasks || currentTasks.length === 0) break;

      const pendingTask = currentTasks.find(t => {
        if (t.isDone) return false;
        if (t.btnText !== 'GO') return false;
        const attempts = taskAttempts[t.title] || 0;
        return attempts < maxAttemptsPerTask;
      });

      if (!pendingTask) {
        console.log('\nTodas as tarefas disponíveis foram concluídas ou verificadas.');
        break;
      }

      const currentAttempt = (taskAttempts[pendingTask.title] || 0) + 1;
      taskAttempts[pendingTask.title] = currentAttempt;
      totalActions++;

      const taskStartTime = new Date();
      const roundInfo = (pendingTask.currentRound && pendingTask.totalRounds)
        ? ` [Rodada: ${pendingTask.currentRound}/${pendingTask.totalRounds}]`
        : (pendingTask.statusText ? ` [Rodada: ${pendingTask.statusText}]` : '');
      console.log(`\n--- Executando: "${pendingTask.title}"${roundInfo} (${pendingTask.coins}) ---`);
      console.log(`    Dia e Hora de Início: ${formatDateTime(taskStartTime)}`);

      const titleLower = pendingTask.title.toLowerCase();
      const descLower = pendingTask.desc.toLowerCase();

      const currentTaskEls = await page.$$(SELECTORS.taskItem);
      let currentTaskEl = currentTaskEls[pendingTask.index];
      const actualTitle = await currentTaskEl?.$eval(SELECTORS.taskTitle, el => el.innerText.trim()).catch(() => '');
      if (actualTitle !== pendingTask.title) {
        for (const el of currentTaskEls) {
          const t = await el.$eval(SELECTORS.taskTitle, e => e.innerText.trim()).catch(() => '');
          if (t === pendingTask.title) {
            currentTaskEl = el;
            break;
          }
        }
      }

      if (!currentTaskEl) {
        console.log(`Tarefa "${pendingTask.title}" não encontrada no DOM.`);
        continue;
      }

      const goBtn = await currentTaskEl.$(SELECTORS.taskBtn);
      if (!goBtn) {
        console.log(`Botão GO não encontrado para "${pendingTask.title}".`);
        continue;
      }

      newPageOpened = null;
      console.log('Clicando em GO...');
      await page.evaluate(el => el.click(), goBtn);
      // Aguarda abertura de nova aba ou carregamento da URL da tarefa
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1000);

      const activePage = newPageOpened || page;
      const isNewTab = newPageOpened !== null;
      console.log(`Página ativa da tarefa: ${activePage.url()}`);

      try {
        if (titleLower.includes('surprise') || titleLower.includes('surpresa') || descLower.includes('tap 3') || descLower.includes('toque em 3')) {
          const startCardIdx = (pendingTask.completedRounds && pendingTask.completedRounds > 0) ? (pendingTask.completedRounds * 3) : 0;
          const clicked = await executeSurpriseItems(activePage, context, startCardIdx);
          console.log(`Rodada ${pendingTask.currentRound || 1} concluída: ${clicked} itens tocados.`);

        } else if (titleLower.includes('search') || titleLower.includes('pesquisa') || titleLower.includes('buscar') || descLower.includes('keywords') || descLower.includes('palavra')) {
          console.log('Executando tarefa: pesquisa com palavra-chave...');
          const searchInput = await activePage.$('input');
          if (searchInput) {
            await searchInput.fill('fone bluetooth');
            await searchInput.press('Enter');
            await waitWithScroll(activePage, 10);
          } else {
            await waitWithScroll(activePage, 10);
          }
          if (pendingTask.totalRounds) {
            console.log(`Rodada ${pendingTask.currentRound || 1} concluída com sucesso.`);
          }

        } else if (titleLower.includes('prize land') || descLower.includes('prize land') || descLower.includes('water') || descLower.includes('regar') || titleLower.includes('0.1') || descLower.includes('0.1')) {
          console.log('Executando tarefa: Prize Land...');
          await activePage.waitForTimeout(1500);
          const waterBtn = await activePage.$(SELECTORS.waterBtn);
          if (waterBtn) {
            await activePage.evaluate(el => el.click(), waterBtn);
            await activePage.waitForTimeout(1500);
          } else {
            console.log('Prize Land requer app AliExpress nativo.');
          }
          taskAttempts[pendingTask.title] = 999;

        } else if (titleLower.includes('merge boss') || titleLower.includes('game') || titleLower.includes('jogo') || titleLower.includes('quiz')) {
          console.log(`Tarefa interativa: ${pendingTask.title}`);
          await activePage.waitForTimeout(1500);
          taskAttempts[pendingTask.title] = 999;

        } else {
          console.log(`Executando tarefa: navegação com scroll ("${pendingTask.title}")...`);
          await waitWithScroll(activePage, 10);
          if (pendingTask.totalRounds) {
            console.log(`Rodada ${pendingTask.currentRound || 1} concluída com sucesso.`);
          }
        }

      } catch (taskErr) {
        console.error(`Erro ao executar "${pendingTask.title}":`, taskErr.message);
      }

      if (isNewTab) {
        await activePage.close().catch(() => {});
      } else if (!page.url().includes('coin-index/index.html')) {
        await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('domcontentloaded');
      }
      await page.waitForTimeout(1000);

      const taskEndTime = new Date();
      const taskDuration = formatDuration(taskEndTime - taskStartTime);
      console.log(`    Concluída em: ${formatTime(taskEndTime)} | Duração: ${taskDuration}`);
    }

    // Obter status consolidado de todas as tarefas
    await openDrawer();
    const finalTasks = await getTasks();
    const results = [];
    for (const t of finalTasks) {
      let status = 'Pendente';
      if (t.isDone) {
        status = t.totalRounds ? `Concluída (${t.totalRounds}/${t.totalRounds})` : (t.statusText ? `Concluída (${t.statusText})` : 'Concluída');
      } else if (isInteractiveOrAppOnly(t)) {
        status = (t.title.toLowerCase().includes('quiz') || t.title.toLowerCase().includes('merge boss'))
          ? 'Requer interação direta no App AliExpress (minigame/quiz)'
          : 'Exclusiva do App AliExpress (requer rega no app móvel)';
      } else if (t.statusText) {
        status = `Executada parcialmente (${t.statusText})`;
      }
      results.push({ title: t.title, status, coins: t.coins });
    }

    await context.close();

    // 3. Confirmar saldo final de moedas via contexto desktop
    console.log('\nConsultando saldo final atualizado...');
    let finalCoins = 'N/D';
    try {
      const desktopCtx = await newDesktopContext(browser, sessionPath, { allowMedia: config.ALLOW_MEDIA });
      const desktopPage = await desktopCtx.newPage();
      await desktopPage.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
      await desktopPage.waitForSelector(SELECTORS.mycoinCheckin, { timeout: 6000 }).catch(() => {});
      const mycoinBody = await desktopPage.innerText('body').catch(() => '');
      const mycoinMatch = mycoinBody.match(/My coins\s*\n\s*([0-9]+)/i) || mycoinBody.match(/([0-9]+)\s*\n\s*saves/i);
      if (mycoinMatch) {
        finalCoins = `${mycoinMatch[1]} moedas`;
      }
      await desktopCtx.close();
    } catch (_) {}

    const tasksEndTime = new Date();
    const tasksDuration = formatDuration(tasksEndTime - tasksStartTime);

    console.log('\n================ RESUMO DAS TAREFAS ================');
    for (const r of results) {
      console.log(`- ${r.title}: ${r.status} (${r.coins || ''})`);
    }
    console.log(`\nSaldo total final: ${finalCoins}`);
    console.log('----------------------------------------------------');
    console.log(`Data:                ${formatDate(tasksStartTime)}`);
    console.log(`Hora de Início:      ${formatTime(tasksStartTime)}`);
    console.log(`Hora de Finalização: ${formatTime(tasksEndTime)}`);
    console.log(`Duração Total:       ${tasksDuration}`);
    console.log('====================================================\n');

    return { results, finalCoins, startTime: tasksStartTime, endTime: tasksEndTime, duration: tasksDuration };
  } finally {
    if (isInternalBrowser && browser) {
      await browser.close().catch(() => {});
    }
  }
}

if (require.main === module) {
  handleDryRun();
  (async () => {
    const releaseLock = await acquireLock(isForce());
    try {
      await runTasks();
    } catch (err) {
      console.error('Erro fatal:', err);
      process.exit(1);
    } finally {
      if (releaseLock) await releaseLock();
    }
  })();
}

module.exports = { runTasks };
