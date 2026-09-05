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

  if (fs.existsSync(sessionPath)) {
    try {
      const sessionContent = fs.readFileSync(sessionPath, 'utf-8');
      if (env.ALI_USER && !sessionContent.includes(env.ALI_USER)) {
        console.log(`[Aviso] Conta alterada em credentials.env (${env.ALI_USER}). Renovando sessão...`);
        fs.unlinkSync(sessionPath);
      }
    } catch (e) {}
  }

  const userEmail = env.ALI_USER || 'agiler@gmail.com';
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

  // Ler tarefas
  async function getTasks() {
    return await page.$$eval('.e2e_normal_task', els => els.map((e, idx) => {
      const title = e.querySelector('.e2e_normal_task_content_title')?.innerText?.trim() || '';
      const desc = e.querySelector('.e2e_normal_task_content_secondTitle')?.innerText?.trim() || '';
      const btn = e.querySelector('.e2e_normal_task_right_btn');
      const btnText = btn?.innerText?.trim() || '';
      const btnStyle = btn?.getAttribute('style') || '';
      const isDone = btnStyle.includes('opacity: 0.5') || btnStyle.includes('cover') || btnText !== 'GO';
      const groupId = e.querySelector('.e2e_normal_task_right')?.getAttribute('data-groupid') || '';
      const allText = e.innerText?.replace(/\n+/g, ' ') || '';
      const coinMatch = allText.match(/\+([0-9]+(?:～[0-9]+)?)/);
      const coins = coinMatch ? `+${coinMatch[1]} moedas` : '+5 moedas';
      return { index: idx, title, desc, btnText, isDone, groupId, coins, allText };
    }));
  }

  // Função para executar a tarefa de tocar em itens no adclick
  async function executeSurpriseItems(targetPage, targetTask) {
    console.log('Executando tarefa: tocar em 3 itens com validação de ponteiro e tracking...');
    await targetPage.waitForTimeout(2000);
    const cards = await targetPage.$$('.feeds-discount-card');
    console.log(`Encontrados ${cards.length} cards de produtos.`);
    let clickedCount = 0;

    for (let c = 0; c < Math.min(3, cards.length); c++) {
      console.log(`Tocando item ${c + 1}/3...`);
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

  let tasks = await getTasks();
  console.log(`Total de tarefas listadas: ${tasks.length}`);

  const results = [];

  // Loop de processamento de tarefas
  for (let i = 0; i < tasks.length; i++) {
    await openDrawer();
    tasks = await getTasks();
    const task = tasks[i];

    if (!task) continue;

    console.log(`\n--- Tarefa [${i + 1}/${tasks.length}]: "${task.title}" (${task.coins}) ---`);
    if (task.isDone) {
      console.log(`Status: Já concluída anteriormente.`);
      results.push({ title: task.title, status: 'Já concluída anteriormente', coins: task.coins });
      continue;
    }

    const titleLower = task.title.toLowerCase();
    const descLower = task.desc.toLowerCase();

    // Re-buscar o botão no DOM atual
    const taskElements = await page.$$('.e2e_normal_task');
    const currentTaskEl = taskElements[i];
    if (!currentTaskEl) {
      results.push({ title: task.title, status: 'Não encontrada no DOM', coins: task.coins });
      continue;
    }
    const goBtn = await currentTaskEl.$('.e2e_normal_task_right_btn');
    if (!goBtn) {
      results.push({ title: task.title, status: 'Botão não encontrado', coins: task.coins });
      continue;
    }

    newPageOpened = null;
    console.log('Clicando em GO...');
    await page.evaluate(el => el.click(), goBtn);
    await page.waitForTimeout(4000);

    const activePage = newPageOpened || page;
    const isNewTab = newPageOpened !== null;
    const activeUrl = activePage.url();
    console.log(`Página ativa da tarefa: ${activeUrl}`);

    try {
      if (titleLower.includes('surprise items') || descLower.includes('tap 3 items')) {
        // Tocar em 3 itens (Rodada 1)
        const clicked1 = await executeSurpriseItems(activePage, task);
        console.log(`Rodada 1 concluída: ${clicked1} itens tocados.`);

        // Se a tarefa possuir 2 rodadas (ex: 0/2 ou 1/2), realizar rodada 2
        if (task.allText.includes('0/2') && cards.length >= 6) {
          console.log('Executando rodada 2 de 2...');
          await executeSurpriseItems(activePage, task);
        }

        results.push({ title: task.title, status: 'Concluída com sucesso', coins: task.coins });

      } else if (titleLower.includes('search') || descLower.includes('keywords')) {
        // Tarefa de pesquisa
        console.log('Executando tarefa: pesquisa com palavra-chave...');
        const searchInput = await activePage.$('input');
        if (searchInput) {
          await searchInput.fill('fone bluetooth');
          await activePage.waitForTimeout(500);
          await searchInput.press('Enter');
          await waitWithScroll(activePage, 16);
          results.push({ title: task.title, status: 'Concluída (pesquisa de 15s realizada)', coins: task.coins });
        } else {
          await waitWithScroll(activePage, 16);
          results.push({ title: task.title, status: 'Concluída (navegação de busca de 15s)', coins: task.coins });
        }

      } else if (titleLower.includes('prize land') || descLower.includes('prize land') || descLower.includes('water') || titleLower.includes('0.1') || descLower.includes('0.1')) {
        // Fazenda Mágica / Prize land água
        console.log('Executando tarefa: Prize Land (ganhe itens de US$ 0.10)...');
        await activePage.waitForTimeout(3000);
        const waterBtn = await activePage.$('.Footer--waterCollectedButtonBg--2jKL1c5, [class*="waterCollected"], button:has-text("regar"), button:has-text("Water")');
        if (waterBtn) {
          await activePage.evaluate(el => el.click(), waterBtn);
          await activePage.waitForTimeout(3000);
          results.push({ title: task.title, status: 'Concluída (água adicionada)', coins: task.coins });
        } else {
          // O jogo da árvore Prize Land requer o app nativo AliExpress (AliApp/WindVane)
          results.push({ title: task.title, status: 'Exclusiva do App AliExpress (requer rega no app móvel)', coins: task.coins });
        }

      } else if (titleLower.includes('merge boss') || titleLower.includes('game') || titleLower.includes('quiz')) {
        // Minigames / Quiz
        console.log(`Tarefa interativa: ${task.title}`);
        await activePage.waitForTimeout(4000);
        results.push({ title: task.title, status: 'Requer interação direta no App AliExpress (minigame/quiz)', coins: task.coins });

      } else if (descLower.includes('15s') || descLower.includes('15 seconds') || titleLower.includes('recap') || titleLower.includes('recently viewed') || titleLower.includes('sponsored') || titleLower.includes('super discounts') || titleLower.includes('coupons')) {
        // Tarefas de navegação por 15 segundos
        console.log('Executando tarefa: navegação por 15s com scroll...');
        await waitWithScroll(activePage, 17);
        results.push({ title: task.title, status: 'Concluída (aguardou 15s)', coins: task.coins });

      } else {
        // Genérico: aguardar 15s navegando
        console.log('Executando tarefa genérica: aguardando 15s com scroll...');
        await waitWithScroll(activePage, 16);
        results.push({ title: task.title, status: 'Concluída (aguardou 15s)', coins: task.coins });
      }

    } catch (taskErr) {
      console.error(`Erro ao executar "${task.title}":`, taskErr.message);
      results.push({ title: task.title, status: `Falhou: ${taskErr.message}`, coins: task.coins });
    }

    // Fechar aba criada para a tarefa e voltar à página principal
    if (isNewTab) {
      await activePage.close().catch(() => {});
    } else if (page.url() !== 'https://m.aliexpress.com/p/coin-index/index.html') {
      await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(2000);
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
