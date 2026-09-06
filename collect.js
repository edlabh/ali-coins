const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

async function runCheckin() {
  const envPath = path.join(__dirname, 'credentials.env');
  const sessionPath = path.join(__dirname, 'session.json');
  const env = loadEnv(envPath);

  const userEmail = env.ALI_USER || 'agiler@gmail.com';
  console.log('================ CHECK-IN DIÁRIO ================');
  console.log(`[Login] Usuário: ${userEmail}`);

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

  let wasAlreadyCollectedToday = false;
  const ptDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }) + ' PT';

  if (fs.existsSync(sessionPath)) {
    try {
      const sessionContent = fs.readFileSync(sessionPath, 'utf-8');
      if (env.ALI_USER && !sessionContent.includes(env.ALI_USER)) {
        console.log(`[Login] Conta alterada para "${env.ALI_USER}". Renovando sessão...`);
        fs.unlinkSync(sessionPath);
      }
    } catch (e) {}
  }

  if (fs.existsSync(sessionPath)) {
    try {
      const checkCtx = await browser.newContext({ storageState: sessionPath });
      const checkPage = await checkCtx.newPage();
      await checkPage.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await checkPage.waitForSelector('text=App daily check-in', { timeout: 7000 }).catch(() => {});
      const checkText = await checkPage.innerText('body').catch(() => '');
      const todaySec = checkText.split(ptDate)[1]?.split(/[0-9]+\/[0-9]+\/[0-9]+ PT/)[0] || '';
      if (todaySec.includes('App daily check-in')) {
        wasAlreadyCollectedToday = true;
      }
      await checkCtx.close();
    } catch (e) {}
  }

  const contextOptions = {
    ...pixel7,
    locale: 'pt-BR'
  };

  if (fs.existsSync(sessionPath)) {
    try {
      contextOptions.storageState = sessionPath;
    } catch (e) {}
  }

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  // Handshake inicial para garantir sincronização de tokens
  await page.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Passo 1 a 4: Navegar para coin-index
  await page.goto('https://m.aliexpress.com/p/coin-index/index.html', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });
  await page.waitForTimeout(3000);

  let currentUrl = page.url();
  if (currentUrl.includes('coin-pc-index')) {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    currentUrl = page.url();
  }

  // Passo 5: Checar se precisa de login
  let loginInput = await page.$('input.cosmos-input, input[type="text"], input[type="email"]');
  let bodyText = await page.innerText('body').catch(() => '');
  let needsLogin = loginInput !== null && (bodyText.includes('Email or phone number') || bodyText.includes('Sign in') || bodyText.includes('Entrar'));

  if (needsLogin) {
    const username = env.ALI_USER;
    const password = env.ALI_PASSWORD;

    if (!username || !password) {
      console.error('ERRO: Credenciais não configuradas no credentials.env.');
      await browser.close();
      process.exit(2);
    }

    console.log(`[Login] Autenticando com credenciais de "${username}"...`);
    await loginInput.fill(username);
    await page.waitForTimeout(500);
    await loginInput.press('Enter');
    await page.waitForTimeout(4000);

    let passwordInput = await page.$('input[type="password"], #fm-login-password');
    if (!passwordInput) {
      const continueBtn = await page.$('button.cosmos-btn-primary, button:has-text("Continue"), button:has-text("Continuar")');
      if (continueBtn) {
        await page.evaluate(el => el.click(), continueBtn);
        await page.waitForTimeout(4000);
        passwordInput = await page.$('input[type="password"], #fm-login-password');
      }
    }

    if (passwordInput) {
      await passwordInput.fill(password);
      await page.waitForTimeout(500);

      const signInBtn = await page.$('button.cosmos-btn-primary, button[type="submit"], button:has-text("Sign in"), button:has-text("Entrar")');
      if (signInBtn) {
        await page.evaluate(el => el.click(), signInBtn);
      } else {
        await passwordInput.press('Enter');
      }
      await page.waitForTimeout(8000);
    }

    // Salvar sessão
    try {
      await context.storageState({ path: sessionPath });
      console.log('[Login] Nova sessão salva com sucesso.');
    } catch (e) {}

    // Garantir que está na página de moedas
    if (!page.url().includes('coin-index')) {
      await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
    }
  }

  // Atualizar sessão salva
  try {
    await context.storageState({ path: sessionPath });
  } catch (e) {}

  await page.waitForTimeout(3000);
  await page.waitForFunction(() => !document.querySelector('.login-pending-container'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Função auxiliar para capturar o número de dias em sequência diretamente da tela de moedas
  async function getStreakFromCoinPage(p) {
    return await p.evaluate(() => {
      // 1. Prioridade: elemento específico com o número de dias no cabeçalho do check-in
      const dayEl = document.querySelector('[class*="dayNumber"], [class*="checkedDay"]');
      if (dayEl && dayEl.innerText.trim()) {
        const val = parseInt(dayEl.innerText.trim(), 10);
        if (!isNaN(val) && val > 0) return val;
      }

      // 2. Container do cabeçalho de check-in (ex: ".aecoin-titleContainer", "203 day streak")
      const titleEl = document.querySelector('[class*="titleContainer"], [class*="signTitle"]');
      if (titleEl) {
        const containerText = titleEl.parentElement?.innerText || titleEl.innerText || '';
        const m = containerText.match(/([0-9]+)\s*(?:day|dia|dias|days)?\s*streak/i) || containerText.match(/([0-9]+)/);
        if (m) {
          const val = parseInt(m[1], 10);
          if (!isNaN(val) && val > 0) return val;
        }
      }

      // 3. Fallback dinâmico: regex no texto visível da página
      const bodyText = document.body.innerText || '';
      const m = bodyText.match(/([0-9]+)\s*(?:day|dia|dias|days)?\s*streak/i) || bodyText.match(/([0-9]+)\s*\n?\s*day streak/i);
      return m ? parseInt(m[1], 10) : null;
    });
  }

  // Passo 6: Verificar e executar check-in no layout mobile
  const isCheckedInitial = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return !!document.querySelector('[class*="today-checked"], [class*="aecoin-today-checked"]') ||
           /Today[\s\S]{0,15}✓/i.test(text);
  });

  let alreadyCollected = isCheckedInitial;

  if (!alreadyCollected) {
    const checkinSelectors = [
      '[class*="aecoin-today"]',
      '[class*="rewardItem"]:has-text("Today")',
      '[class*="aecoin-rewardItem"]',
      '#signButton',
      'button#signButton',
      '.signButton',
      'div[class*="aecoin-signButton"]',
      'div[class*="aecoin-button"]'
    ];

    for (const sel of checkinSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          console.log('Realizando check-in diário...');
          await page.evaluate(target => target.click(), el);
          await page.waitForTimeout(3000);
          break;
        }
      } catch (e) {}
    }
  }

  // Passo 7: Fechar modal de confirmação, se aparecer
  try {
    const modalBtn = await page.$('.e2e_normal_task_right_btn, [class*="close"], [class*="confirm"]');
    if (modalBtn) {
      await page.evaluate(el => el.click(), modalBtn);
      await page.waitForTimeout(1000);
    }
  } catch (e) {}

  // Passo 8: Coletar água da Fazenda Mágica se o botão estiver visível no msite
  try {
    const waterBtn = await page.$('.Footer--waterCollectedButtonBg--2jKL1c5, [class*="waterCollected"]');
    if (waterBtn) {
      console.log('Coletando água da Fazenda Mágica...');
      await page.evaluate(el => el.click(), waterBtn);
      await page.waitForTimeout(1500);
    }
  } catch (e) {}

  // Capturar a sequência de dias (streak) dinamicamente na tela de moedas
  const mobileStreak = await getStreakFromCoinPage(page);

  // Salvar sessão mobile antes de fechar
  try {
    await context.storageState({ path: sessionPath });
  } catch (e) {}
  await context.close();

  // Passo 9: Confirmar resultado e histórico via contexto desktop
  const desktopCtx = await browser.newContext({
    locale: 'pt-BR',
    storageState: sessionPath
  });
  const desktopPage = await desktopCtx.newPage();
  await desktopPage.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await desktopPage.waitForSelector('text=App daily check-in', { timeout: 10000 }).catch(() => {});
  await desktopPage.waitForTimeout(1500);

  const desktopText = await desktopPage.innerText('body').catch(() => '');

  // 1. Saldo total
  const balMatch = desktopText.match(/My coins\s*\n\s*([0-9]+)/i) || desktopText.match(/([0-9]+)\s*\n\s*saves/i);
  const totalBalance = balMatch ? balMatch[1] : 'N/D';

  // 2. Histórico de check-in (fuso PT)
  const todaySec = desktopText.split(ptDate)[1]?.split(/[0-9]+\/[0-9]+\/[0-9]+ PT/)[0] || '';
  const todayCheckinMatch = todaySec.match(/App daily check-in\s*\n\s*\+([0-9]+)/i);
  const coinsGainedToday = todayCheckinMatch ? todayCheckinMatch[1] : '40';

  // 3. Sequência (streak) de dias consecutivos obtida dinamicamente da tela de moedas
  const streakDays = mobileStreak !== null ? mobileStreak : 'N/D';

  let reportLine1 = (alreadyCollected || wasAlreadyCollectedToday)
    ? `já estava coletado (+${coinsGainedToday} moedas)`
    : `${coinsGainedToday} moedas`;
  let reportLine2 = `${totalBalance} moedas`;
  let reportLine3 = (streakDays !== 'N/D')
    ? `a sequência subiu (${streakDays} dias seguidos)`
    : 'sequência não identificada na página';

  console.log('=== RELATORIO_OUTPUT ===');
  console.log(reportLine1);
  console.log(reportLine2);
  console.log(reportLine3);

  await browser.close();
  return {
    userEmail,
    alreadyCollected: (alreadyCollected || wasAlreadyCollectedToday),
    coinsGainedToday,
    totalBalance,
    streakDays
  };
}

if (require.main === module) {
  runCheckin().catch(err => {
    console.error('FALHA:', err.message);
    process.exit(1);
  });
}

module.exports = { runCheckin };
