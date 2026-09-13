const fs = require('fs');
const path = require('path');
const { loadConfig, sessionPath, sessionMetaPath, handleDryRun, isForce } = require('./config');
const { formatDate, formatTime, formatDateTime, formatDuration } = require('./time_utils');
const { launchBrowser, newMobileContext, newDesktopContext, retry } = require('./browser');
const { safeWriteFile, safeChmod600, validateSession, readMasked2FACode } = require('./security');
const { acquireLock } = require('./lockfile');
const logger = require('./logger');

/**
 * Tenta resolver o slide captcha em qualquer iframe ou na página principal
 * @param {import('playwright').Page} p
 * @returns {Promise<boolean>}
 */
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
          const steps = 25;
          for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
            const currentX = box.x + box.width / 2 + (distance * ease);
            const jitterY = box.y + box.height / 2 + (Math.random() * 2 - 1);
            await p.mouse.move(currentX, jitterY);
            await p.waitForTimeout(10 + Math.floor(Math.random() * 10));
          }
          await p.waitForTimeout(50);
          await p.mouse.up();
          // Aguarda validação do slide captcha pelo backend anti-bot
          await p.waitForSelector('#nc_1__scale_text, .nc_scale', { state: 'detached', timeout: 2000 }).catch(() => {});
          await p.waitForTimeout(1000);
          return true;
        }
      }
    } catch (_) {}
  }
  return false;
}

/**
 * Captura o número de dias em sequência diretamente da tela de moedas
 * @param {import('playwright').Page} p
 * @returns {Promise<number|null>}
 */
async function getStreakFromCoinPage(p) {
  return await p.evaluate(() => {
    // 1. Elemento específico com o número de dias no cabeçalho do check-in
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

/**
 * Executa o fluxo de check-in diário do AliExpress
 * @param {object} [options={}]
 * @param {import('playwright').Browser} [options.browser] Instância compartilhada de navegador
 * @param {object} [options.sessionData] Dados de sessão em cache
 * @returns {Promise<object>}
 */
async function runCheckin(options = {}) {
  const checkinStartTime = new Date();
  const config = loadConfig(true);
  const userEmail = config.ALI_USER;

  console.log('================ CHECK-IN DIÁRIO ================');
  console.log(`[Dia e Hora]: ${formatDateTime(checkinStartTime)}`);
  console.log(`[Login] Usuário: ${userEmail}`);

  let browser = options.browser;
  const isInternalBrowser = !browser;

  if (isInternalBrowser) {
    browser = await launchBrowser({ headless: config.HEADLESS });
  }

  let wasAlreadyCollectedToday = false;
  const ptDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }) + ' PT';
  let hasValidSession = false;
  let sessionData = options.sessionData || null;
  let metaData = null;

  try {
    // 1. Carregar sessão e metadados de forma assíncrona
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

    // 2. Validação rigorosa: correspondência exata de conta e validade dos cookies
    if (sessionData) {
      const validation = validateSession(sessionData, metaData, userEmail);
      if (!validation.valid) {
        console.log(`[Login] Renovando sessão: ${validation.reason}`);
        await fs.promises.unlink(sessionPath).catch(() => {});
        await fs.promises.unlink(sessionMetaPath).catch(() => {});
        sessionData = null;
      } else {
        hasValidSession = true;
      }
    }

    // 3. Checagem prévia rápida no desktop se já foi coletado hoje
    if (hasValidSession && fs.existsSync(sessionPath)) {
      try {
        const checkCtx = await newDesktopContext(browser, sessionPath, { allowMedia: config.ALLOW_MEDIA });
        const checkPage = await checkCtx.newPage();
        await checkPage.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        });
        await checkPage.waitForSelector('text=App daily check-in', { timeout: 5000 }).catch(() => {});
        const checkText = await checkPage.innerText('body').catch(() => '');
        const todaySec = checkText.split(ptDate)[1]?.split(/[0-9]+\/[0-9]+\/[0-9]+ PT/)[0] || '';
        if (todaySec.includes('App daily check-in')) {
          wasAlreadyCollectedToday = true;
        }
        await checkCtx.close();
      } catch (_) {}
    }

    // 4. Inicializar contexto mobile para o fluxo de moedas
    const context = await newMobileContext(
      browser,
      hasValidSession ? sessionPath : null,
      { allowMedia: config.ALLOW_MEDIA }
    );
    const page = await context.newPage();

    // Handshake inicial se já possuir sessão válida
    if (hasValidSession) {
      await page.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      }).catch(() => {});
      await page.waitForLoadState('domcontentloaded');
    }

    // Navegar para central de moedas mobile
    await page.goto('https://m.aliexpress.com/p/coin-index/index.html', {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    });

    // Aguardar montagem dos elementos (seja formulário de login ou tela de moedas)
    await page.waitForSelector('input.cosmos-input, input[type="text"], input[type="email"], #signButton, [class*="aecoin"], button:has-text("Collect"), button:has-text("Coletar")', {
      timeout: 8000
    }).catch(() => {});

    let currentUrl = page.url();
    if (currentUrl.includes('coin-pc-index')) {
      await page.setViewportSize({ width: 412, height: 915 });
      await page.goto('https://m.aliexpress.com/p/coin-index/index.html', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForLoadState('domcontentloaded');
    }

    // Checar se precisa de login
    let loginInput = await page.$('input.cosmos-input, input[type="text"], input[type="email"]');
    const bodyText = await page.innerText('body').catch(() => '');
    const needsLogin = loginInput !== null || bodyText.includes('Email or phone number') || bodyText.includes('Sign in') || bodyText.includes('Entrar');

    let attemptedLogin = false;
    if (needsLogin) {
      attemptedLogin = true;
      const username = config.ALI_USER;
      const password = config.ALI_PASSWORD;

      if (!loginInput) {
        loginInput = await page.waitForSelector('input.cosmos-input, input[type="text"], input[type="email"]', { timeout: 8000 }).catch(() => null);
      }

      if (loginInput) {
        console.log(`[Login] Autenticando com credenciais de "${username}"...`);
        await loginInput.fill(username);
        await loginInput.press('Enter');
        await page.waitForSelector('input[type="password"], #fm-login-password, button.cosmos-btn-primary, #nc_1_n1z', { timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);

        // Checar slide captcha logo após usuário
        await trySolveSlider(page);

        let passwordInput = await page.$('input[type="password"], #fm-login-password');
        if (!passwordInput) {
          const continueBtn = await page.$('button.cosmos-btn-primary, button:has-text("Continue"), button:has-text("Continuar")');
          if (continueBtn) {
            await page.evaluate(el => el.click(), continueBtn);
            await page.waitForSelector('input[type="password"], #fm-login-password, #nc_1_n1z', { timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(500);
            await trySolveSlider(page);
            passwordInput = await page.$('input[type="password"], #fm-login-password');
          }
        }

        if (passwordInput) {
          await passwordInput.fill(password);
          const signInBtn = await page.$('button.cosmos-btn-primary, button[type="submit"], button:has-text("Sign in"), button:has-text("Entrar")');
          if (signInBtn) {
            await page.evaluate(el => el.click(), signInBtn);
          } else {
            await passwordInput.press('Enter');
          }
          // Aguarda submissão do formulário de login e resposta do servidor
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await page.waitForSelector('input[placeholder*="code" i], input[type="tel"], [class*="dayNumber"], [class*="aecoin"], #nc_1_n1z', { timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(1000);

          // Checar slide captcha após envio da senha
          await trySolveSlider(page);
        }

        // Checar código de verificação 2FA (por e-mail ou SMS)
        const codeInput = await page.$('input[placeholder*="code" i], input[name*="code" i], input[class*="code" i], input[type="tel"][maxlength="6"]').catch(() => null);
        if (codeInput) {
          console.log('\n[Segurança AliExpress] Código de verificação 2FA requerido pelo AliExpress.');
          const code = await readMasked2FACode('>> Digite o código de 6 dígitos enviado para seu e-mail/SMS: ', 120000);
          if (code) {
            await codeInput.fill(code);
            const submitCodeBtn = await page.$('button[type="submit"], button.cosmos-btn-primary, button:has-text("Confirm"), button:has-text("Verify"), button:has-text("Confirmar")');
            if (submitCodeBtn) {
              await page.evaluate(el => el.click(), submitCodeBtn);
            } else {
              await codeInput.press('Enter');
            }
            // Aguarda processamento do código 2FA e redirecionamento de sessão
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(1000);
          }
        }

        // Aguardar confirmação e verificar geração de cookies reais de autenticação
        let cookies = await context.cookies();
        let hasAuthCookie = cookies.some(c => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && c.value);

        if (!hasAuthCookie) {
          for (let waitSec = 0; waitSec < 5; waitSec++) {
            await page.waitForTimeout(1000);
            cookies = await context.cookies();
            hasAuthCookie = cookies.some(c => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && c.value);
            if (hasAuthCookie) break;
          }
        }

        if (hasAuthCookie) {
          try {
            const rawStorage = await context.storageState();
            sessionData = rawStorage;
            await safeWriteFile(sessionPath, JSON.stringify(rawStorage, null, 2), 'utf-8');
            await safeWriteFile(sessionMetaPath, JSON.stringify({ user: username, savedAt: new Date().toISOString() }, null, 2), 'utf-8');
            safeChmod600(sessionPath);
            safeChmod600(sessionMetaPath);
            console.log('[Login] Nova sessão autenticada e salva com sucesso (modo 0o600).');
          } catch (_) {}
        } else {
          const errScreenshot = path.join(__dirname, 'login_failed.png');
          await page.screenshot({ path: errScreenshot, fullPage: true }).catch(() => {});
          safeChmod600(errScreenshot);

          console.error('\n' + '='.repeat(65));
          console.error(' [ERRO DE AUTENTICAÇÃO]');
          console.error(` Falha ao autenticar a conta "${username}".`);
          console.error(' O AliExpress bloqueou o login automático exigindo verificação');
          console.error(' de segurança (Slide Captcha / código enviado por e-mail).');
          console.error('');
          console.error(' Uma captura de tela foi salva em: login_failed.png');
          console.error('');
          console.error(' SOLUÇÃO (Recomendada para servidores na nuvem / Oracle Cloud / VPS):');
          console.error(' 1. Execute em seu computador pessoal (onde o login funciona sem bloqueio):');
          console.error('    node export_session.js');
          console.error(' 2. No servidor na nuvem, importe o token de forma segura:');
          console.error('    node import_session.js < session_token.txt');
          console.error(' 3. A sessão será importada e continuará válida por semanas/meses!');
          console.error('='.repeat(65) + '\n');

          if (isInternalBrowser) await browser.close();
          throw new Error('Falha de autenticação no AliExpress (desafio de segurança não superado).');
        }
      }
    }

    await page.waitForFunction(() => !document.querySelector('.login-pending-container'), { timeout: 10000 }).catch(() => {});

    // Checagem de check-in mobile
    const isCheckedInitial = await page.evaluate(() => {
      const text = document.body.innerText || '';
      return Boolean(document.querySelector('[class*="today-checked"], [class*="aecoin-today-checked"]')) ||
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
            await page.waitForSelector('[class*="today-checked"], [class*="aecoin-today-checked"], .e2e_normal_task_right_btn', { timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(800);
            break;
          }
        } catch (_) {}
      }
    }

    // Fechar modal de confirmação, se aparecer
    try {
      const modalBtn = await page.$('.e2e_normal_task_right_btn, [class*="close"], [class*="confirm"]');
      if (modalBtn) {
        await page.evaluate(el => el.click(), modalBtn);
        await page.waitForTimeout(500);
      }
    } catch (_) {}

    // Coletar água da Fazenda Mágica se o botão estiver visível no msite
    try {
      const waterBtn = await page.$('.Footer--waterCollectedButtonBg--2jKL1c5, [class*="waterCollected"]');
      if (waterBtn) {
        console.log('Coletando água da Fazenda Mágica...');
        await page.evaluate(el => el.click(), waterBtn);
        await page.waitForTimeout(1000);
      }
    } catch (_) {}

    // Capturar streak mobile
    const mobileStreak = await getStreakFromCoinPage(page);

    // Salvar sessão mobile antes de fechar contexto
    try {
      const updatedStorage = await context.storageState();
      sessionData = updatedStorage;
      await safeWriteFile(sessionPath, JSON.stringify(updatedStorage, null, 2), 'utf-8');
      safeChmod600(sessionPath);
    } catch (_) {}
    await context.close();

    // Confirmar resultado e histórico via contexto desktop
    const desktopCtx = await newDesktopContext(browser, sessionPath, { allowMedia: config.ALLOW_MEDIA });
    const desktopPage = await desktopCtx.newPage();
    await desktopPage.goto('https://www.aliexpress.com/p/coin-pc-index/mycoin.html', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    await desktopPage.waitForSelector('text=App daily check-in', { timeout: 6000 }).catch(() => {});

    const desktopText = await desktopPage.innerText('body').catch(() => '');

    // 1. Saldo total
    const balMatch = desktopText.match(/My coins\s*\n\s*([0-9]+)/i) || desktopText.match(/([0-9]+)\s*\n\s*saves/i);
    const totalBalance = balMatch ? balMatch[1] : 'N/D';

    // 2. Histórico de check-in
    const todaySec = desktopText.split(ptDate)[1]?.split(/[0-9]+\/[0-9]+\/[0-9]+ PT/)[0] || '';
    const todayCheckinMatch = todaySec.match(/App daily check-in\s*\n\s*\+([0-9]+)/i);
    const isCollected = (alreadyCollected || wasAlreadyCollectedToday);
    const coinsGainedToday = todayCheckinMatch ? todayCheckinMatch[1] : (isCollected ? '10' : '0');

    // 3. Sequência de streak
    const streakDays = mobileStreak !== null ? mobileStreak : 'N/D';

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
      console.error(' Solução recomendada:');
      console.error(' • Transfira uma sessão autenticada: node export_session.js / import_session.js');
      console.error(' • Consulte o guia: CLOUD_SESSIONS.md');
      console.error('='.repeat(68) + '\n');

      await fs.promises.unlink(sessionPath).catch(() => {});
      await fs.promises.unlink(sessionMetaPath).catch(() => {});

      await desktopCtx.close();
      if (isInternalBrowser) await browser.close();
      throw new Error(`Erro ao efetuar o login: não foi possível obter o streak, as moedas do check-in e o saldo da conta "${userEmail}".`);
    }

    await desktopCtx.close();

    const reportLine1 = (alreadyCollected || wasAlreadyCollectedToday)
      ? `já estava coletado (+${coinsGainedToday} moedas)`
      : `${coinsGainedToday} moedas`;
    const reportLine2 = `${totalBalance} moedas`;
    const reportLine3 = (streakDays !== 'N/D')
      ? `a sequência subiu (${streakDays} dias seguidos)`
      : 'sequência não identificada na página';

    const checkinEndTime = new Date();
    const checkinDuration = formatDuration(checkinEndTime - checkinStartTime);

    console.log('=== RELATORIO_OUTPUT ===');
    console.log(reportLine1);
    console.log(reportLine2);
    console.log(reportLine3);
    console.log('---------------------------------------------------------------');
    console.log(`Data:                ${formatDate(checkinStartTime)}`);
    console.log(`Hora de Início:      ${formatTime(checkinStartTime)}`);
    console.log(`Hora de Finalização: ${formatTime(checkinEndTime)}`);
    console.log(`Duração Total:       ${checkinDuration}`);
    console.log('===============================================================\n');

    return {
      userEmail,
      alreadyCollected: (alreadyCollected || wasAlreadyCollectedToday),
      coinsGainedToday,
      totalBalance,
      streakDays,
      startTime: checkinStartTime,
      endTime: checkinEndTime,
      duration: checkinDuration,
      sessionData
    };
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
      await runCheckin();
    } catch (err) {
      console.error('FALHA:', err.message);
      process.exit(1);
    } finally {
      if (releaseLock) await releaseLock();
    }
  })();
}

module.exports = { runCheckin };
