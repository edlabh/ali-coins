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
  const sessionMetaPath = path.join(__dirname, 'session_meta.json');
  let hasValidSession = false;

  if (fs.existsSync(sessionPath)) {
    try {
      let isAccountMatch = false;
      let hasAuthCookie = false;

      const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      hasAuthCookie = (sessionData.cookies || []).some(c => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && c.value);

      if (fs.existsSync(sessionMetaPath)) {
        const meta = JSON.parse(fs.readFileSync(sessionMetaPath, 'utf-8'));
        if (meta.user === env.ALI_USER) isAccountMatch = true;
      } else {
        const sessionContent = JSON.stringify(sessionData);
        if (env.ALI_USER && sessionContent.includes(env.ALI_USER)) isAccountMatch = true;
      }

      if (!hasAuthCookie) {
        console.log('[Login] Arquivo session.json não possui cookies válidos de autenticação.');
        if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
        if (fs.existsSync(sessionMetaPath)) fs.unlinkSync(sessionMetaPath);
      } else if (env.ALI_USER && !isAccountMatch) {
        console.log(`[Login] Conta alterada para "${env.ALI_USER}". Renovando sessão...`);
        if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
        if (fs.existsSync(sessionMetaPath)) fs.unlinkSync(sessionMetaPath);
      } else {
        hasValidSession = true;
      }
    } catch (e) {
      if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    }
  }

  if (hasValidSession && fs.existsSync(sessionPath)) {
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

  if (hasValidSession && fs.existsSync(sessionPath)) {
    try {
      contextOptions.storageState = sessionPath;
    } catch (e) {}
  }

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  // Handshake inicial APENAS se já possuir sessão válida
  if (hasValidSession) {
    await page.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  // Navegar para coin-index
  await page.goto('https://m.aliexpress.com/p/coin-index/index.html', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });

  // Aguardar montagem dos elementos (seja form de login ou tela de moedas)
  await page.waitForSelector('input.cosmos-input, input[type="text"], input[type="email"], #signButton, [class*="aecoin"], button:has-text("Collect"), button:has-text("Coletar")', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(2000);

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
  let needsLogin = loginInput !== null || bodyText.includes('Email or phone number') || bodyText.includes('Sign in') || bodyText.includes('Entrar');

  let attemptedLogin = false;
  if (needsLogin) {
    attemptedLogin = true;
    const username = env.ALI_USER;
    const password = env.ALI_PASSWORD;

    if (!username || !password) {
      console.error('ERRO: Credenciais não configuradas no credentials.env.');
      await browser.close();
      process.exit(2);
    }

    if (!loginInput) {
      loginInput = await page.waitForSelector('input.cosmos-input, input[type="text"], input[type="email"]', { timeout: 10000 }).catch(() => null);
    }

    // Função auxiliar para tentar resolver slide captcha em qualquer frame ou página principal
    async function trySolveSlider(p) {
      const targets = [p, ...p.frames()];
      for (const target of targets) {
        try {
          const sliderHandle = await target.$('#nc_1_n1z, .btn_slide, span[class*="btn_slide"], #nc_1__scale_text .btn_slide, div[id*="nocaptcha"] span');
          if (sliderHandle) {
            console.log('[Login] Verificação de segurança (slide captcha) detectada. Tentando deslizar...');
            const box = await sliderHandle.boundingBox();
            if (box) {
              const trackBox = await target.$eval('#nc_1__scale_text, .nc_scale, div[id*="nocaptcha"]', el => {
                const b = el.getBoundingClientRect();
                return { width: b.width };
              }).catch(() => ({ width: 320 }));
              const distance = (trackBox && trackBox.width > 150) ? (trackBox.width - box.width + 10) : 300;

              await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await p.mouse.down();
              const steps = 30;
              for (let i = 1; i <= steps; i++) {
                const progress = i / steps;
                const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
                const currentX = box.x + box.width / 2 + (distance * ease);
                const jitterY = box.y + box.height / 2 + (Math.random() * 2 - 1);
                await p.mouse.move(currentX, jitterY);
                await p.waitForTimeout(15 + Math.floor(Math.random() * 10));
              }
              await p.waitForTimeout(100);
              await p.mouse.up();
              await p.waitForTimeout(4000);
              return true;
            }
          }
        } catch (e) {}
      }
      return false;
    }

    if (loginInput) {
      console.log(`[Login] Autenticando com credenciais de "${username}"...`);
      await loginInput.fill(username);
      await page.waitForTimeout(500);
      await loginInput.press('Enter');
      await page.waitForTimeout(4000);

      // Checar se apareceu slider logo após digitar o usuário
      await trySolveSlider(page);

      let passwordInput = await page.$('input[type="password"], #fm-login-password');
      if (!passwordInput) {
        const continueBtn = await page.$('button.cosmos-btn-primary, button:has-text("Continue"), button:has-text("Continuar")');
        if (continueBtn) {
          await page.evaluate(el => el.click(), continueBtn);
          await page.waitForTimeout(4000);
          await trySolveSlider(page);
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
        await page.waitForTimeout(6000);

        // Checar se apareceu slider após envio da senha
        await trySolveSlider(page);
      }

      // Checar se há campo de código de verificação 2FA (por e-mail ou SMS)
      const codeInput = await page.$('input[placeholder*="code" i], input[name*="code" i], input[class*="code" i], input[type="tel"][maxlength="6"]').catch(() => null);
      if (codeInput && process.stdin.isTTY) {
        console.log('\n[Segurança AliExpress] Código de verificação requerido pelo AliExpress.');
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const code = await new Promise(resolve => rl.question('>> Digite o código de 6 dígitos enviado para seu e-mail/SMS: ', ans => {
          rl.close();
          resolve(ans.trim());
        }));
        if (code) {
          await codeInput.fill(code);
          await page.waitForTimeout(500);
          const submitCodeBtn = await page.$('button[type="submit"], button.cosmos-btn-primary, button:has-text("Confirm"), button:has-text("Verify"), button:has-text("Confirmar")');
          if (submitCodeBtn) {
            await page.evaluate(el => el.click(), submitCodeBtn);
          } else {
            await codeInput.press('Enter');
          }
          await page.waitForTimeout(6000);
        }
      }

      // Aguardar confirmação e verificar se os cookies reais de autenticação foram gerados
      let cookies = await context.cookies();
      let hasAuthCookie = cookies.some(c => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && c.value);

      if (!hasAuthCookie) {
        for (let waitSec = 0; waitSec < 6; waitSec++) {
          await page.waitForTimeout(2000);
          cookies = await context.cookies();
          hasAuthCookie = cookies.some(c => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && c.value);
          if (hasAuthCookie) break;
        }
      }

      if (hasAuthCookie) {
        try {
          await context.storageState({ path: sessionPath });
          fs.writeFileSync(sessionMetaPath, JSON.stringify({ user: username, savedAt: new Date().toISOString() }, null, 2), 'utf-8');
          console.log('[Login] Nova sessão autenticada e salva com sucesso.');
        } catch (e) {}
      } else {
        const errScreenshot = path.join(__dirname, 'login_failed.png');
        await page.screenshot({ path: errScreenshot, fullPage: true }).catch(() => {});

        console.error('\n' + '='.repeat(65));
        console.error(' [ERRO DE AUTENTICAÇÃO]');
        console.error(` Falha ao autenticar a conta "${username}".`);
        console.error(' O AliExpress bloqueou o login automático exigindo verificação');
        console.error(' de segurança (Slide Captcha / código enviado por e-mail).');
        console.error('');
        console.error(' Uma captura de tela foi salva em: login_failed.png');
        console.error('');
        console.error(' SOLUÇÃO (Recomendada para Oracle Cloud / AWS / VPS):');
        console.error(' 1. Execute em seu computador local (onde o login funciona sem bloqueio):');
        console.error('    node export_session.js');
        console.error(' 2. No servidor na nuvem, execute o comando gerado:');
        console.error('    node import_session.js \'<TOKEN>\'');
        console.error(' 3. A sessão será importada e continuará válida por semanas/meses!');
        console.error('='.repeat(65) + '\n');
        await browser.close();
        throw new Error('Falha de autenticação no AliExpress (desafio de segurança não superado).');
      }
    }
  }

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
        if (!isNaN(val) && val >= 0) return val;
      }

      // 2. Container do cabeçalho de check-in (ex: ".aecoin-titleContainer", "203 day streak")
      const titleEl = document.querySelector('[class*="titleContainer"], [class*="signTitle"]');
      if (titleEl) {
        const containerText = titleEl.parentElement?.innerText || titleEl.innerText || '';
        const m = containerText.match(/([0-9]+)\s*(?:day|dia|dias|days)?\s*streak/i) || containerText.match(/([0-9]+)/);
        if (m) {
          const val = parseInt(m[1], 10);
          if (!isNaN(val) && val >= 0) return val;
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
      'div[class*="aecoin-button"]',
      'button:has-text("Collect")',
      'button:has-text("Coletar")',
      'div:has-text("Collect")',
      'div:has-text("Coletar")'
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
  const isCollected = (alreadyCollected || wasAlreadyCollectedToday);
  const coinsGainedToday = todayCheckinMatch ? todayCheckinMatch[1] : (isCollected ? '10' : '0');

  // 3. Sequência (streak) de dias consecutivos obtida dinamicamente da tela de moedas
  const streakDays = mobileStreak !== null ? mobileStreak : 'N/D';

  // Validação: Se não conseguir obter streak, moedas do check-in diário e total de moedas
  const hasStreak = streakDays !== 'N/D' && streakDays !== null;
  const hasTotalBalance = totalBalance !== 'N/D' && totalBalance !== null;
  const hasCheckinCoins = (todayCheckinMatch !== null) || ((alreadyCollected || wasAlreadyCollectedToday) && coinsGainedToday !== '0');

  if ((!hasStreak && !hasTotalBalance && !hasCheckinCoins) || (attemptedLogin && !hasStreak && !hasTotalBalance)) {
    console.error('\n' + '='.repeat(68));
    console.error(' [ERRO AO EFETUAR O LOGIN]');
    console.error(` Não foi possível obter o streak, as moedas do check-in diário`);
    console.error(` nem o saldo total de moedas para a conta "${userEmail}".`);
    console.error(' O login no AliExpress não foi concluído com sucesso.');
    console.error('');
    console.error(' Diagnóstico da coleta:');
    console.error(' • Streak (sequência): NÃO OBTIDO (N/D)');
    console.error(' • Moedas do check-in: NÃO OBTIDAS (0 moedas)');
    console.error(' • Saldo total: NÃO OBTIDO (N/D)');
    console.error('');
    console.error(' Possíveis causas:');
    console.error(' 1. Credenciais inválidas no credentials.env');
    console.error(' 2. Bloqueio por desafio de segurança (Slide Captcha / verificação por e-mail)');
    console.error(' 3. Bloqueio anti-bot por IP de Datacenter/Nuvem (Oracle Cloud, AWS, VPS)');
    console.error('');
    console.error(' Como resolver:');
    console.error(' • Em computadores pessoais: execute interativamente e resolva o desafio.');
    console.error(' • Em servidores na nuvem: gere a sessão no PC local (./run_all.sh)');
    console.error('   e transfira para a nuvem via: node export_session.js / node import_session.js');
    console.error(' • Consulte o guia detalhado em: CLOUD_SESSIONS.md');
    console.error('='.repeat(68) + '\n');

    // Descartar sessão corrompida/inválida
    if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    if (fs.existsSync(sessionMetaPath)) fs.unlinkSync(sessionMetaPath);

    await desktopCtx.close();
    await browser.close();
    throw new Error(`Erro ao efetuar o login: não foi possível obter o streak, as moedas do check-in diário e o saldo total da conta "${userEmail}".`);
  }

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
