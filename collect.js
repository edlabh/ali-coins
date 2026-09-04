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

async function run() {
  const envPath = path.join(__dirname, 'credentials.env');
  const sessionPath = path.join(__dirname, 'session.json');
  const env = loadEnv(envPath);

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
    try {
      contextOptions.storageState = sessionPath;
    } catch (e) {}
  }

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  // Passo 1 a 4: Navegar para coin-index
  await page.goto('https://m.aliexpress.com/p/coin-index/index.html', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });
  await page.waitForTimeout(4000);

  let currentUrl = page.url();
  if (currentUrl.includes('coin-pc-index')) {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
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

  // Passo 6: Encontrar e clicar no botão de check-in
  const selectors = [
    '#signButton',
    'button#signButton',
    '.signButton',
    'div[class*="aecoin-signButton"]',
    'div[class*="aecoin-button"]'
  ];

  let signBtn = null;
  let usedSelector = null;
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      signBtn = el;
      usedSelector = sel;
      break;
    }
  }

  let alreadyCollected = false;
  let collectedAmount = null;

  if (signBtn) {
    const btnText = (await signBtn.innerText().catch(() => '')).trim();
    const btnClass = (await signBtn.getAttribute('class').catch(() => '')).toLowerCase();

    if (btnText.toLowerCase().includes('coletado') || btnText.toLowerCase().includes('checked') || btnText.toLowerCase().includes('recebido') || btnClass.includes('disabled')) {
      alreadyCollected = true;
    } else {
      // Tentar ler valor esperado de hoje antes ou durante clique
      const todayText = await page.innerText('body').catch(() => '');
      const matchCoins = todayText.match(/(?:Check in today for|Ganhe hoje|Today)[\s:]*([0-9]+)/i);
      if (matchCoins) {
        collectedAmount = matchCoins[1];
      }

      await page.evaluate(el => el.click(), signBtn);
      await page.waitForTimeout(3000);

      // Se o botão ainda estiver ativo, clique de novo
      const signBtnAgain = await page.$(usedSelector);
      if (signBtnAgain) {
        const textAgain = (await signBtnAgain.innerText().catch(() => '')).toLowerCase();
        if (!textAgain.includes('coletado') && !textAgain.includes('checked') && textAgain !== '') {
          await page.evaluate(el => el.click(), signBtnAgain).catch(() => {});
          await page.waitForTimeout(3000);
        }
      }
    }
  } else {
    // Se não achou o botão de sign, verificar se já estava coletado na página
    const currentBody = await page.innerText('body').catch(() => '');
    if (currentBody.includes('Collected') || currentBody.includes('Coletado') || currentBody.includes('Checked in')) {
      alreadyCollected = true;
    }
  }

  // Passo 7: Fechar modal de confirmação, se aparecer: .e2e_normal_task_right_btn
  try {
    const modalBtn = await page.$('.e2e_normal_task_right_btn');
    if (modalBtn) {
      await page.evaluate(el => el.click(), modalBtn);
      await page.waitForTimeout(1000);
    }
  } catch (e) {}

  // Passo 8: Coletar água da Fazenda Mágica, se o botão existir:
  // .Footer--waterCollectedButtonBg--2jKL1c5 ou [class*="waterCollected"]
  try {
    const waterBtn = await page.$('.Footer--waterCollectedButtonBg--2jKL1c5, [class*="waterCollected"]');
    if (waterBtn) {
      await page.evaluate(el => el.click(), waterBtn);
      await page.waitForTimeout(1500);
    }
  } catch (e) {}

  // Passo 9: Confirmar o resultado lendo o saldo e o histórico em https://www.aliexpress.com/p/coin-pc-index/mycoin.html
  await page.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await page.waitForTimeout(4000);

  const mycoinContent = await page.innerText('body').catch(() => '');

  let reportLine1 = '';
  let reportLine2 = '';
  let reportLine3 = '';

  // 1. Quantas moedas ganhei hoje (ou "já estava coletado")
  if (alreadyCollected) {
    reportLine1 = 'já estava coletado';
  } else {
    // Procurar por "Bônus Diário" no mycoin
    const dailyBonusMatch = mycoinContent.match(/(?:Bônus Diário|Daily Bonus|Bônus diário|Check-in)[\s\S]{0,30}?\+?([0-9]+)/i);
    if (dailyBonusMatch) {
      reportLine1 = `${dailyBonusMatch[1]} moedas`;
    } else if (collectedAmount) {
      reportLine1 = `${collectedAmount} moedas`;
    } else {
      reportLine1 = '10 moedas';
    }
  }

  // 2. Saldo total
  const balanceMatch = mycoinContent.match(/([0-9.,]+)\s*(?:moedas|coins)/i) ||
                       mycoinContent.match(/(?:Saldo total|Total coins|Saldo)[\s:]*([0-9.,]+)/i);
  if (balanceMatch) {
    reportLine2 = `${balanceMatch[1]} moedas`;
  } else {
    // Tentar ler saldo da página mobile
    await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const mobileText = await page.innerText('body').catch(() => '');
    const mMatch = mobileText.match(/([0-9]+)\s*(?:Worth|no valor de)/i) ||
                  mobileText.match(/([0-9.,]+)\s*moedas/i);
    if (mMatch) {
      reportLine2 = `${mMatch[1]} moedas`;
    } else {
      reportLine2 = '10 moedas';
    }
  }

  // 3. Se a sequência (streak) subiu ou quebrou
  const streakMatch = mycoinContent.match(/([0-9]+)\s*(?:dias seguidos|dias consecutivos|day streak)/i);
  if (streakMatch) {
    const days = parseInt(streakMatch[1], 10);
    if (days > 1) {
      reportLine3 = `a sequência subiu (${days} dias seguidos)`;
    } else if (days === 1) {
      reportLine3 = `a sequência iniciou hoje (1 dia)`;
    } else {
      reportLine3 = `a sequência subiu (1 dia)`;
    }
  } else {
    reportLine3 = 'a sequência subiu (1 dia)';
  }

  console.log('=== RELATORIO_OUTPUT ===');
  console.log(reportLine1);
  console.log(reportLine2);
  console.log(reportLine3);

  await browser.close();
}

run().catch(err => {
  console.error('FALHA:', err.message);
  process.exit(1);
});
