const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

async function waitWithScroll(page, seconds) {
  const intervals = Math.floor(seconds / 3);
  for (let i = 0; i < intervals; i++) {
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.scrollBy(0, 300)).catch(() => {});
  }
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[trimmed.slice(0, eqIdx).trim()] = val;
    }
  }
  return env;
}

async function runTasks() {
  const envPath = path.join(__dirname, 'credentials.env');
  const sessionPath = path.join(__dirname, 'session.json');
  const env = loadEnv(envPath);

  console.log('================ EXECUÇÃO DAS TAREFAS DIÁRIAS ================');

  const sessionMetaPath = path.join(__dirname, 'session_meta.json');
  let isAccountMatch = false;

  if (fs.existsSync(sessionPath)) {
    try {
      if (fs.existsSync(sessionMetaPath)) {
        const meta = JSON.parse(fs.readFileSync(sessionMetaPath, 'utf-8'));
        if (meta.user === env.ALI_USER) isAccountMatch = true;
      } else {
        const sessionContent = fs.readFileSync(sessionPath, 'utf-8');
        if (env.ALI_USER && sessionContent.includes(env.ALI_USER)) isAccountMatch = true;
      }
    } catch (e) {}
  }

  if (!isAccountMatch) {
    console.log(`[Aviso] Sessão ausente ou alterada para "${env.ALI_USER}". Inicializando autenticação via check-in...`);
    if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    if (fs.existsSync(sessionMetaPath)) fs.unlinkSync(sessionMetaPath);
    const { runCheckin } = require('./collect');
    await runCheckin();
  }

  const userEmail = env.ALI_USER || 'edelanoali@gmail.com';
  console.log(`[Login] Sessão autenticada para: ${userEmail}`);

  const pixel7 = devices['Pixel 7'];

  const envVars = { ...process.env };
  const localLibPath = path.join(__dirname, 'libs', 'extracted', 'usr', 'lib', 'x86_64-linux-gnu');
  if (process.platform === 'linux' && fs.existsSync(localLibPath)) {
    envVars.LD_LIBRARY_PATH = `${localLibPath}:${envVars.LD_LIBRARY_PATH || ''}`;
  }

  const browser = await chromium.launch({
    headless: true,
    env: envVars,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const contextOptions = {
    ...pixel7,
    locale: 'pt-BR'
  };
  if (fs.existsSync(sessionPath)) {
    contextOptions.storageState = sessionPath;
  }

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  let newPageOpened = null;
  context.on('page', p => {
    newPageOpened = p;
  });

  const page = await context.newPage();

  // Sincronizar cookies e handshake de sessão com o domínio principal antes de abrir a versão mobile
  console.log('Validando sessão e sincronizando cookies...');
  await page.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  console.log('Acessando https://m.aliexpress.com/p/coin-index/index.html ...');
  await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2000);

  if (page.url().includes('coin-pc-index')) {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  // 1. Check-in diário se ainda não tiver sido feito
  const signBtn = await page.$('#signButton, [class*="aecoin-today"]');
  if (signBtn) {
    const text = (await signBtn.innerText().catch(() => '')).trim();
    if (text.toLowerCase() === 'collect' || text.toLowerCase() === 'coletar') {
      console.log('Check-in pendente encontrado. Coletando...');
      await page.evaluate(el => el.click(), signBtn);
      await page.waitForTimeout(3000);
    }
  }

  // Fechar modais ou popups de boas-vindas / check-in
  try {
    const modalBtn = await page.$('[class*="close"], [class*="dialog-close"], [class*="aecoin-close"], .ui-dialog-close, button:has-text("OK"), button:has-text("Confirm")');
    if (modalBtn) {
      await page.evaluate(el => el.click(), modalBtn).catch(() => {});
      await page.waitForTimeout(1000);
    }
  } catch (e) {}

  // 2. Abrir o drawer de "Ganhe mais moedas" com mecanismo resiliente de retry
  async function openDrawer() {
    let isDrawerOpen = await page.$eval('.e2e_task', el => {
      const box = el.getBoundingClientRect();
      return box.height > 100;
    }).catch(() => false);

    if (isDrawerOpen) return true;

    // Aguardar término do login-pending-container se houver
    await page.waitForFunction(() => !document.querySelector('.login-pending-container'), { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    for (let attempt = 1; attempt <= 6; attempt++) {
      // Fechar modal ou popups sobrepostos
      const closePopupBtn = await page.$('[class*="close"], [class*="dialog-close"], [class*="aecoin-close"], .ui-dialog-close, button:has-text("OK"), button:has-text("Confirm")');
      if (closePopupBtn) {
        await page.evaluate(el => el.click(), closePopupBtn).catch(() => {});
        await page.waitForTimeout(1000);
      }

      console.log(`Tentativa ${attempt}/6 de abrir o painel "Ganhe mais moedas"...`);
      const taskBtn = await page.$('button[class*="aecoin-signButton"], .aecoin-signButtonWrapper-3p3NS button, button:has-text("Earn more coins"), button:has-text("Ganhe mais moedas")');
      if (taskBtn) {
        await page.evaluate(el => el.click(), taskBtn);
      } else {
        await page.evaluate(() => window.scrollBy(0, 150)).catch(() => {});
      }

      try {
        await page.waitForSelector('.e2e_normal_task', { timeout: 5000 });
        isDrawerOpen = true;
        break;
      } catch (e) {}

      await page.waitForTimeout(2000);
    }
    return isDrawerOpen;
  }

  await openDrawer();

  // Ler tarefas com suporte a rodadas (ex: 1/2, 2/3)
  async function getTasks() {
    return await page.$$eval('.e2e_normal_task', els => els.map((e, idx) => {
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
          // O contador da rodada em execução inicia no valor 1
          // (ex: se o AliExpress indica 0/2 concluídas, estamos na rodada 1; se 1/2, rodada 2)
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

  function isInteractiveOrAppOnly(task) {
    const text = (task.title + ' ' + task.desc).toLowerCase();
    return text.includes('prize land') || text.includes('0.1') || text.includes('water') || text.includes('regar') ||
           text.includes('merge boss') || text.includes('game') || text.includes('jogo') ||
           text.includes('quiz');
  }

  // Função para executar a tarefa de tocar em itens no adclick
  async function executeSurpriseItems(targetPage, startIndex = 0) {
    console.log(`Executando tarefa: tocar em 3 itens (a partir do card #${startIndex + 1})...`);
    await targetPage.waitForTimeout(2000);
    let cards = await targetPage.$$('.feeds-discount-card');
    console.log(`Encontrados ${cards.length} cards de produtos.`);

    if (startIndex + 3 > cards.length) {
      await targetPage.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
      await targetPage.waitForTimeout(1500);
      cards = await targetPage.$$('.feeds-discount-card');
    }

    const start = (startIndex < cards.length) ? startIndex : 0;
    const countToClick = Math.min(3, Math.max(0, cards.length - start));
    let clickedCount = 0;

    for (let c = start; c < start + (countToClick || 3); c++) {
      if (c >= cards.length) break;
      console.log(`Tocando item ${clickedCount + 1}/3 (card #${c + 1})...`);
      const card = cards[c];
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await targetPage.waitForTimeout(1000);

      const tabPromise = context.waitForEvent('page', { timeout: 4500 }).catch(() => null);
      await card.click({ delay: 100, timeout: 5000 }).catch(async () => {
        await targetPage.evaluate(el => el.click(), card).catch(() => {});
      });

      const itemTab = await tabPromise;
      if (itemTab) {
        console.log(`Aba do produto aberta. Aguardando 3.5s para consolidar tracking...`);
        await itemTab.waitForTimeout(3500);
        await itemTab.close().catch(() => {});
      } else if (!targetPage.url().includes('adclick.html')) {
        await targetPage.waitForTimeout(3500);
        await targetPage.goBack().catch(() => {});
        await targetPage.waitForTimeout(2000);
      }
      clickedCount++;
      await targetPage.waitForTimeout(1500);
    }
    await targetPage.waitForTimeout(3000);
    return clickedCount;
  }

  // Loop de processamento de tarefas resiliente com suporte a múltiplas rodadas
  const taskAttempts = {};
  const maxAttemptsPerTask = 4;
  let totalActions = 0;
  const MAX_TOTAL_ACTIONS = 25;

  while (totalActions < MAX_TOTAL_ACTIONS) {
    await openDrawer();
    const currentTasks = await getTasks();
    if (!currentTasks || currentTasks.length === 0) break;

    // Encontrar próxima tarefa que ainda está pendente de execução
    const pendingTask = currentTasks.find(t => {
      if (t.isDone) return false;
      if (t.btnText !== 'GO') return false;
      const attempts = taskAttempts[t.title] || 0;
      if (attempts >= maxAttemptsPerTask) return false;
      return true;
    });

    if (!pendingTask) {
      console.log('\nTodas as tarefas disponíveis foram concluídas ou verificadas.');
      break;
    }

    const currentAttempt = (taskAttempts[pendingTask.title] || 0) + 1;
    taskAttempts[pendingTask.title] = currentAttempt;
    totalActions++;

    const roundInfo = (pendingTask.currentRound && pendingTask.totalRounds)
      ? ` [Rodada: ${pendingTask.currentRound}/${pendingTask.totalRounds}]`
      : (pendingTask.statusText ? ` [Rodada: ${pendingTask.statusText}]` : '');
    console.log(`\n--- Executando: "${pendingTask.title}"${roundInfo} (${pendingTask.coins}) ---`);

    const titleLower = pendingTask.title.toLowerCase();
    const descLower = pendingTask.desc.toLowerCase();

    // Localizar elemento correspondente no DOM
    const currentTaskEls = await page.$$('.e2e_normal_task');
    let currentTaskEl = currentTaskEls[pendingTask.index];
    const actualTitle = await currentTaskEl?.$eval('.e2e_normal_task_content_title', el => el.innerText.trim()).catch(() => '');
    if (actualTitle !== pendingTask.title) {
      for (const el of currentTaskEls) {
        const t = await el.$eval('.e2e_normal_task_content_title', e => e.innerText.trim()).catch(() => '');
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

    const goBtn = await currentTaskEl.$('.e2e_normal_task_right_btn');
    if (!goBtn) {
      console.log(`Botão GO não encontrado para "${pendingTask.title}".`);
      continue;
    }

    newPageOpened = null;
    console.log('Clicando em GO...');
    await page.evaluate(el => el.click(), goBtn);
    await page.waitForTimeout(4000);

    const activePage = newPageOpened || page;
    const isNewTab = newPageOpened !== null;
    console.log(`Página ativa da tarefa: ${activePage.url()}`);

    try {
      if (titleLower.includes('surprise') || titleLower.includes('surpresa') || descLower.includes('tap 3') || descLower.includes('toque em 3')) {
        // Tocar em 3 itens (usando offset para rodadas subsequentes)
        const startCardIdx = (pendingTask.completedRounds && pendingTask.completedRounds > 0) ? (pendingTask.completedRounds * 3) : 0;
        const clicked = await executeSurpriseItems(activePage, startCardIdx);
        console.log(`Rodada ${pendingTask.currentRound || 1} concluída: ${clicked} itens tocados.`);

      } else if (titleLower.includes('search') || titleLower.includes('pesquisa') || titleLower.includes('buscar') || descLower.includes('keywords') || descLower.includes('palavra')) {
        console.log('Executando tarefa: pesquisa com palavra-chave...');
        const searchInput = await activePage.$('input');
        if (searchInput) {
          await searchInput.fill('fone bluetooth');
          await activePage.waitForTimeout(500);
          await searchInput.press('Enter');
          await waitWithScroll(activePage, 16);
        } else {
          await waitWithScroll(activePage, 16);
        }
        if (pendingTask.totalRounds) {
          console.log(`Rodada ${pendingTask.currentRound || 1} concluída com sucesso.`);
        }

      } else if (titleLower.includes('prize land') || descLower.includes('prize land') || descLower.includes('water') || descLower.includes('regar') || titleLower.includes('0.1') || descLower.includes('0.1')) {
        console.log('Executando tarefa: Prize Land...');
        await activePage.waitForTimeout(3000);
        const waterBtn = await activePage.$('.Footer--waterCollectedButtonBg--2jKL1c5, [class*="waterCollected"], button:has-text("regar"), button:has-text("Water")');
        if (waterBtn) {
          await activePage.evaluate(el => el.click(), waterBtn);
          await activePage.waitForTimeout(3000);
        } else {
          console.log('Prize Land requer app AliExpress nativo.');
        }
        taskAttempts[pendingTask.title] = 999; // Não repetir em novas rodadas

      } else if (titleLower.includes('merge boss') || titleLower.includes('game') || titleLower.includes('jogo') || titleLower.includes('quiz')) {
        console.log(`Tarefa interativa: ${pendingTask.title}`);
        await activePage.waitForTimeout(3000);
        taskAttempts[pendingTask.title] = 999; // Não repetir em novas rodadas

      } else {
        // Tarefas de navegação por 15 segundos (Sponsored, Super discounts, Recap, Cupons, etc.)
        console.log(`Executando tarefa: navegação por 15s com scroll ("${pendingTask.title}")...`);
        await waitWithScroll(activePage, 17);
        if (pendingTask.totalRounds) {
          console.log(`Rodada ${pendingTask.currentRound || 1} concluída com sucesso.`);
        }
      }

    } catch (taskErr) {
      console.error(`Erro ao executar "${pendingTask.title}":`, taskErr.message);
    }

    // Fechar aba criada para a tarefa e voltar à página principal
    if (isNewTab) {
      await activePage.close().catch(() => {});
    } else if (!page.url().includes('coin-index/index.html')) {
      await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(2000);
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

  // 3. Confirmar saldo final de moedas
  console.log('\nConsultando saldo final atualizado...');
  let finalCoins = 'N/D';
  try {
    const desktopCtx = await browser.newContext({
      locale: 'pt-BR',
      storageState: sessionPath
    });
    const desktopPage = await desktopCtx.newPage();
    await desktopPage.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await desktopPage.waitForSelector('text=App daily check-in', { timeout: 8000 }).catch(() => {});
    await desktopPage.waitForTimeout(1500);
    const mycoinBody = await desktopPage.innerText('body').catch(() => '');
    const mycoinMatch = mycoinBody.match(/My coins\s*\n\s*([0-9]+)/i) || mycoinBody.match(/([0-9]+)\s*\n\s*saves/i);
    if (mycoinMatch) {
      finalCoins = `${mycoinMatch[1]} moedas`;
    }
    await desktopCtx.close();
  } catch (e) {}

  console.log('\n================ RESUMO DAS TAREFAS ================');
  for (const r of results) {
    console.log(`- ${r.title}: ${r.status} (${r.coins || ''})`);
  }
  console.log(`\nSaldo total final: ${finalCoins}`);

  await browser.close();
  return { results, finalCoins };
}

if (require.main === module) {
  runTasks().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
}

module.exports = { runTasks };
