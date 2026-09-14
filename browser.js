const os = require('os');
const path = require('path');
const fs = require('fs');
const { chromium, devices } = require('playwright');
const logger = require('./logger');
const {
  getDiagnosticsDir,
  applyDiagnosticOptions,
  startContextTracing,
  closeContextWithDiagnostics
} = require('./libs/ui/diagnostics');

/**
 * Verifica se a sandbox deve ser desativada (--no-sandbox).
 * Condições: execução como root (UID 0), ambiente CI, ou configuração explícita NO_SANDBOX=true.
 */
function isNoSandboxRequired() {
  const isRoot = typeof os.userInfo === 'function' && os.userInfo().uid === 0;
  const isCI = Boolean(process.env.CI);
  const isExplicitNoSandbox = Boolean(
    process.env.NO_SANDBOX &&
    (process.env.NO_SANDBOX.toLowerCase() === 'true' || process.env.NO_SANDBOX === '1')
  );
  return {
    isRoot,
    isCI,
    isExplicitNoSandbox,
    shouldDisable: isRoot || isCI || isExplicitNoSandbox
  };
}

/**
 * Retorna os argumentos de inicialização do Chromium respeitando os requisitos de segurança.
 */
function getChromiumArgs() {
  const { isRoot, isCI, isExplicitNoSandbox, shouldDisable } = isNoSandboxRequired();
  const args = ['--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'];

  if (shouldDisable) {
    logger.warn(
      { isRoot, isCI, isExplicitNoSandbox },
      'Aplicando --no-sandbox (--disable-setuid-sandbox) ao Chromium.'
    );
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  return args;
}

/**
 * Configura as variáveis de ambiente necessárias para o Chromium encontrar as bibliotecas do sistema
 */
function getChromiumEnv() {
  const envVars = { ...process.env };
  const localLibPath = path.join(__dirname, 'libs', 'extracted', 'usr', 'lib', 'x86_64-linux-gnu');
  if (process.platform === 'linux' && fs.existsSync(localLibPath)) {
    envVars.LD_LIBRARY_PATH = `${localLibPath}:${envVars.LD_LIBRARY_PATH || ''}`;
  }
  return envVars;
}

/**
 * Factory única para inicialização do navegador Chromium
 * @param {object} [options={}]
 * @returns {Promise<import('playwright').Browser>}
 */
async function launchBrowser(options = {}) {
  const { shouldDisable } = isNoSandboxRequired();
  const defaultArgs = getChromiumArgs();
  const defaultEnv = getChromiumEnv();

  const launchOptions = {
    headless: options.headless !== undefined ? options.headless : true,
    chromiumSandbox:
      options.chromiumSandbox !== undefined ? options.chromiumSandbox : !shouldDisable,
    args: [...defaultArgs, ...(options.args || [])],
    env: { ...defaultEnv, ...(options.env || {}) },
    ...options
  };

  return await chromium.launch(launchOptions);
}

/**
 * Configura interceptação de requisições para bloquear mídias e telemetrias pesadas
 * @param {import('playwright').BrowserContext} context
 * @param {boolean} [allowMedia=false]
 */
async function setupResourceBlocking(context, allowMedia = false) {
  if (allowMedia) return;

  await context.route('**/*', (route) => {
    const req = route.request();
    const resourceType = req.resourceType();
    const url = req.url().toLowerCase();

    // Bloquear imagens, mídias pesadas e fontes
    if (['image', 'media', 'font'].includes(resourceType)) {
      return route.abort();
    }

    if (/\.(png|jpg|jpeg|webp|gif|svg|mp4|webm|woff2|woff|ttf)(\?.*)?$/i.test(url)) {
      return route.abort();
    }

    // Bloquear domínios pesados de telemetria externa desnecessários para a tarefa
    if (
      url.includes('umeng.com') ||
      url.includes('google-analytics.com') ||
      url.includes('googletagmanager.com') ||
      url.includes('doubleclick.net')
    ) {
      return route.abort();
    }

    return route.continue();
  });
}

/**
 * Resolve e normaliza o storageState para uso no Playwright.
 * Aceita objeto em memória, caminho para arquivo .json existente,
 * ou caminho para arquivo .enc que é descriptografado automaticamente.
 * Evita passar caminhos inexistentes ao Playwright (prevenindo ENOENT).
 * @param {string|object} storageState
 * @returns {Promise<string|object|null>}
 */
async function resolveStorageState(storageState) {
  if (!storageState) return null;
  if (typeof storageState === 'object') return storageState;
  if (typeof storageState === 'string') {
    if (storageState.endsWith('.enc') && fs.existsSync(storageState)) {
      try {
        const { loadSessionFiles } = require('./libs/session');
        const loaded = await loadSessionFiles({ sessionPath: storageState });
        return loaded.sessionData || null;
      } catch {
        return null;
      }
    }
    if (fs.existsSync(storageState)) {
      return storageState;
    }
    const encCandidate = storageState.endsWith('.enc') ? storageState : `${storageState}.enc`;
    if (fs.existsSync(encCandidate)) {
      try {
        const { loadSessionFiles } = require('./libs/session');
        const loaded = await loadSessionFiles({ sessionPath: storageState });
        return loaded.sessionData || null;
      } catch {
        return null;
      }
    }
    return null;
  }
  return null;
}

/**
 * Cria um contexto mobile emulando o Pixel 7 com idioma pt-BR
 * @param {import('playwright').Browser} browser
 * @param {string|object} [storageState] Caminho para session.json ou objeto de sessão
 * @param {object} [options={}]
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function newMobileContext(browser, storageState = null, options = {}) {
  const pixel7 = devices['Pixel 7'];
  const resolvedStorage = await resolveStorageState(storageState);
  let contextOptions = {
    ...pixel7,
    locale: 'pt-BR',
    ...(resolvedStorage ? { storageState: resolvedStorage } : {}),
    ...options
  };

  contextOptions = applyDiagnosticOptions(contextOptions);

  const context = await browser.newContext(contextOptions);

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  await setupResourceBlocking(context, options.allowMedia);
  await startContextTracing(context);
  return context;
}

/**
 * Cria um contexto desktop com idioma pt-BR
 * @param {import('playwright').Browser} browser
 * @param {string|object} [storageState] Caminho para session.json ou objeto de sessão
 * @param {object} [options={}]
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function newDesktopContext(browser, storageState = null, options = {}) {
  const resolvedStorage = await resolveStorageState(storageState);
  let contextOptions = {
    locale: 'pt-BR',
    ...(resolvedStorage ? { storageState: resolvedStorage } : {}),
    ...options
  };

  contextOptions = applyDiagnosticOptions(contextOptions);

  const context = await browser.newContext(contextOptions);
  await setupResourceBlocking(context, options.allowMedia);
  await startContextTracing(context);
  return context;
}

/**
 * Helper de retry com backoff exponencial e jitter
 * @param {Function} fn Função assíncrona a ser executada
 * @param {object} [options={}]
 * @param {number} [options.retries=3]
 * @param {number} [options.minTimeout=1000]
 * @param {number} [options.maxTimeout=8000]
 * @param {number} [options.factor=2]
 * @param {boolean} [options.jitter=true]
 */
async function retry(
  fn,
  { retries = 3, minTimeout = 1000, maxTimeout = 8000, factor = 2, jitter = true } = {}
) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      let delay = Math.min(minTimeout * Math.pow(factor, attempt - 1), maxTimeout);
      if (jitter) {
        delay += Math.floor(Math.random() * 400);
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * Executa scroll gradual na página e monitora requisições de tracking
 * @param {import('playwright').Page} page
 * @param {number} [maxSeconds=10]
 */
async function waitWithScroll(page, maxSeconds = 10) {
  const startTime = Date.now();
  const maxMs = maxSeconds * 1000;
  let trackingDetected = false;

  const responseHandler = (res) => {
    const url = res.url();
    if (
      url.includes('/track') ||
      url.includes('/trace') ||
      url.includes('adclick') ||
      url.includes('ae-')
    ) {
      trackingDetected = true;
    }
  };

  page.on('response', responseHandler);

  try {
    while (Date.now() - startTime < maxMs) {
      await page.evaluate(() => window.scrollBy(0, 300)).catch(() => {});
      await page.waitForTimeout(1500);

      if (trackingDetected && Date.now() - startTime >= 5000) {
        break;
      }
    }
  } finally {
    page.off('response', responseHandler);
  }
}

module.exports = {
  launchBrowser,
  newMobileContext,
  newDesktopContext,
  resolveStorageState,
  setupResourceBlocking,
  retry,
  waitWithScroll,
  closeContextWithDiagnostics,
  getDiagnosticsDir
};
