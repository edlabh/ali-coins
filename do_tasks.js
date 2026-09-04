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

async function main() {
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

  const context = await browser.newContext({
    ...pixel7,
    storageState: 'session.json',
    locale: 'pt-BR'
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  let newPageOpened = null;
  context.on('page', p => {
    newPageOpened = p;
  });

  const page = await context.newPage();
  console.log('Acessando https://m.aliexpress.com/p/coin-index/index.html ...');
  await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  // 1. Check-in diário se ainda não tiver sido feito
  const signBtn = await page.$('#signButton');
  if (signBtn) {
    const text = (await signBtn.innerText().catch(() => '')).trim();
    if (text.toLowerCase() === 'collect' || text.toLowerCase() === 'coletar') {
      console.log('Check-in pendente encontrado. Coletando...');
      await page.evaluate(el => el.click(), signBtn);
      await page.waitForTimeout(3000);
    }
  }

  // Fechar modal de confirmação se houver
  const modalBtn = await page.$('.e2e_normal_task_right_btn');
  if (modalBtn) {
    await page.evaluate(el => el.click(), modalBtn).catch(() => {});
    await page.waitForTimeout(1000);
  }

  // 2. Abrir o drawer de "Ganhe mais moedas"
  async function openDrawer() {
    const isDrawerOpen = await page.$eval('.e2e_task', el => {
      const box = el.getBoundingClientRect();
      return box.height > 100;
    }).catch(() => false);

    if (!isDrawerOpen) {
      console.log('Abrindo painel "Ganhe mais moedas"...');
      const taskBtn = await page.$('button#signButton, .aecoin-taskButton-3V41b, button:has-text("Earn more coins"), button:has-text("Ganhe mais moedas")');
      if (taskBtn) {
        await page.evaluate(el => el.click(), taskBtn);
        await page.waitForTimeout(2500);
      }
    }
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
      return { index: idx, title, desc, btnText, isDone, groupId };
    }));
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

    console.log(`\n--- Tarefa [${i + 1}/${tasks.length}]: "${task.title}" ---`);
    if (task.isDone) {
      console.log(`Status: Já concluída anteriormente.`);
      results.push({ title: task.title, status: 'Já concluída' });
      continue;
    }

    // Identificar tipo de tarefa
    const titleLower = task.title.toLowerCase();
    const descLower = task.desc.toLowerCase();

    // Re-buscar o botão no DOM atual
    const taskElements = await page.$$('.e2e_normal_task');
    const currentTaskEl = taskElements[i];
    if (!currentTaskEl) {
      results.push({ title: task.title, status: 'Não encontrada no DOM' });
      continue;
    }
    const goBtn = await currentTaskEl.$('.e2e_normal_task_right_btn');
    if (!goBtn) {
      results.push({ title: task.title, status: 'Botão não encontrado' });
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
        // Tocar em 3 itens
        console.log('Executando tarefa: tocar em 3 itens...');
        await activePage.waitForTimeout(2000);
        const cards = await activePage.$$('.feeds-discount-card, .ad-product, a[href*="/item/"]');
        console.log(`Encontrados ${cards.length} itens.`);
        let clickedCount = 0;
        for (let c = 0; c < Math.min(3, cards.length); c++) {
          console.log(`Tocando item ${c + 1}...`);
          await activePage.evaluate(el => {
            el.scrollIntoView();
            el.click();
          }, cards[c]);
          await activePage.waitForTimeout(3000);
          clickedCount++;

          // Se abriu página de detalhe em nova aba, fechar
          const allPages = context.pages();
          if (allPages.length > (isNewTab ? 2 : 1)) {
            const lastPage = allPages[allPages.length - 1];
            if (lastPage !== activePage && lastPage !== page) {
              await lastPage.close().catch(() => {});
            }
          }
        }
        await activePage.waitForTimeout(3000);
        results.push({ title: task.title, status: `Concluída (tocou em ${clickedCount} itens)` });

      } else if (titleLower.includes('search') || descLower.includes('keywords')) {
        // Tarefa de pesquisa
        console.log('Executando tarefa: pesquisa com palavra-chave...');
        const searchInput = await activePage.$('input');
        if (searchInput) {
          await searchInput.fill('fone bluetooth');
          await activePage.waitForTimeout(500);
          await searchInput.press('Enter');
          await waitWithScroll(activePage, 16);
          results.push({ title: task.title, status: 'Concluída (pesquisa realizada e aguardou 15s)' });
        } else {
          await waitWithScroll(activePage, 16);
          results.push({ title: task.title, status: 'Concluída (aguardou 15s na página de busca)' });
        }

      } else if (descLower.includes('15s') || descLower.includes('15 seconds') || titleLower.includes('recap') || titleLower.includes('recently viewed') || titleLower.includes('sponsored') || titleLower.includes('super discounts') || titleLower.includes('coupons')) {
        // Tarefas de navegação por 15 segundos
        console.log('Executando tarefa: navegação por 15s com scroll...');
        await waitWithScroll(activePage, 17);
        results.push({ title: task.title, status: 'Concluída (aguardou 15s)' });

      } else if (titleLower.includes('prize land') || descLower.includes('prize land') || descLower.includes('water')) {
        // Fazenda Mágica / Prize land água
        console.log('Executando tarefa: regar no Prize Land...');
        await activePage.waitForTimeout(4000);
        const waterBtn = await activePage.$('.Footer--waterCollectedButtonBg--2jKL1c5, [class*="waterCollected"], button:has-text("regar"), button:has-text("Water")');
        if (waterBtn) {
          await activePage.evaluate(el => el.click(), waterBtn);
          await activePage.waitForTimeout(3000);
          results.push({ title: task.title, status: 'Concluída (água adicionada)' });
        } else {
          await waitWithScroll(activePage, 10);
          results.push({ title: task.title, status: 'Acessada (botão de regar não disponível ou já regado hoje)' });
        }

      } else if (titleLower.includes('merge boss') || titleLower.includes('game') || titleLower.includes('quiz')) {
        // Minigames / Quiz
        console.log(`Tarefa de minigame/quiz: ${task.title}`);
        await activePage.waitForTimeout(5000);
        results.push({ title: task.title, status: 'Não suportada automaticamente (requer gameplay interativo / responder quiz manualmente)' });

      } else {
        // Genérico: aguardar 15s navegando
        console.log('Executando tarefa genérica: aguardando 15s com scroll...');
        await waitWithScroll(activePage, 16);
        results.push({ title: task.title, status: 'Concluída (aguardou 15s)' });
      }

    } catch (taskErr) {
      console.error(`Erro ao executar "${task.title}":`, taskErr.message);
      results.push({ title: task.title, status: `Falhou: ${taskErr.message}` });
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
  await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const finalBody = await page.innerText('body').catch(() => '');
  const balanceMatch = finalBody.match(/([0-9.,]+)\s*(?:Worth|no valor de|moedas|coins)/i);
  let finalCoins = balanceMatch ? balanceMatch[1] : 'Consultar extrato';

  // Buscar saldo no mycoin
  await page.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const mycoinBody = await page.innerText('body').catch(() => '');
  const mycoinMatch = mycoinBody.match(/([0-9.,]+)\s*(?:moedas|coins)/i) ||
                      mycoinBody.match(/(?:Saldo total|Total coins|Saldo)[\s:]*([0-9.,]+)/i);
  if (mycoinMatch) {
    finalCoins = `${mycoinMatch[1]} moedas`;
  }

  console.log('\n================ RESUMO DAS TAREFAS ================');
  for (const r of results) {
    console.log(`- ${r.title}: ${r.status}`);
  }
  console.log(`\nSaldo total final: ${finalCoins}`);

  await browser.close();
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
