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

// Política de saneamento do ambiente repassado aos subprocessos do Chromium:
// herda o ambiente do host (compatibilidade cross-platform), exceto segredos.
// Segredos (SESSION_SECRET, ALI_PASSWORD, TELEGRAM_BOT_TOKEN, GITHUB_TOKEN, etc.)
// NUNCA devem chegar ao navegador (zygote/network service/crashpad).
const SENSITIVE_ENV_KEY_REGEX =
  /(secret|password|passwd|token|cookie|credential|authorization|api[_-]?key)/i;
const SENSITIVE_ENV_KEY_PREFIX_REGEX = /^(TELEGRAM_|NOTIFY_|ALI_|SESSION_|GITHUB_|HEARTBEAT_)/i;

/**
 * Configura as variáveis de ambiente necessárias para o Chromium encontrar as bibliotecas do sistema,
 * deliberadamente sem propagar segredos da aplicação ao navegador.
 * @returns {Record<string, string>}
 */
function getChromiumEnv() {
  const envVars = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_KEY_REGEX.test(key) || SENSITIVE_ENV_KEY_PREFIX_REGEX.test(key)) continue;
    envVars[key] = value;
  }
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
 * Executa scroll gradual na página garantindo permanência pelo tempo solicitado
 * @param {import('playwright').Page} page
 * @param {number} [maxSeconds=15] Tempo total de permanência/scroll em segundos
 * @param {object} [options={}] Opções adicionais de scroll e monitoramento
 * @param {boolean} [options.earlyExitOnNoProgress=false] (Canônico) Se true, encerra antecipadamente se nenhum tracking for detectado
 * @param {number} [options.noProgressTimeoutMs=10000] (Canônico) Tempo limite para saída antecipada sem tracking em ms
 * @param {number} [options.taskScrollMaxMs=30000] (Canônico) Teto máximo de permanência/scroll em ms (padrão: 30000)
 * @param {boolean} [options.earlyExitOnTracking=false] Se true, permite saída antecipada quando tracking for detectado após minSeconds
 * @param {number} [options.minSeconds=15] Tempo mínimo de permanência antes de permitir saída antecipada por tracking
 * @param {boolean} [options.earlyExitOnNoTracking=false] @deprecated Use options.earlyExitOnNoProgress
 * @param {number} [options.noTrackingTimeoutMs=10000] @deprecated Use options.noProgressTimeoutMs
 */
async function waitWithScroll(page, maxSeconds = 15, options = {}) {
  // Nomes canônicos com suporte retrocompatível a aliases legados (depreciados)
  const earlyExitOnNoProgress = Boolean(
    options.earlyExitOnNoProgress ?? options.earlyExitOnNoTracking ?? false
  );
  const noProgressTimeoutMs = options.noProgressTimeoutMs ?? options.noTrackingTimeoutMs ?? 10000;
  const earlyExit = options.earlyExitOnTracking === true;
  const minMs = (typeof options.minSeconds === 'number' ? options.minSeconds : 15) * 1000;
  const abortSignal = options.abortSignal || null;

  const envScrollMaxMs = process.env.TASK_SCROLL_MAX_MS
    ? parseInt(process.env.TASK_SCROLL_MAX_MS, 10)
    : 30000;
  const scrollMaxCap =
    typeof options.taskScrollMaxMs === 'number'
      ? options.taskScrollMaxMs
      : isNaN(envScrollMaxMs)
        ? 30000
        : envScrollMaxMs;

  const startTime = Date.now();
  const requestedMs = Math.max(0, maxSeconds) * 1000;
  const maxMs = Math.min(requestedMs, scrollMaxCap);
  let trackingDetected = false;

  const responseHandler = (res) => {
    try {
      const url = typeof res.url === 'function' ? res.url() : '';
      if (
        url.includes('/track') ||
        url.includes('/trace') ||
        url.includes('adclick') ||
        url.includes('ae-')
      ) {
        trackingDetected = true;
      }
    } catch {
      // Ignorar erros em response listener
    }
  };

  if (page && typeof page.on === 'function') {
    page.on('response', responseHandler);
  }

  try {
    while (Date.now() - startTime < maxMs) {
      if (abortSignal && abortSignal.aborted) break;
      if (page && typeof page.evaluate === 'function') {
        await page.evaluate(() => window.scrollBy(0, 300)).catch(() => {});
      }
      if (page && typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(1500).catch(() => {});
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (abortSignal && abortSignal.aborted) break;

      const elapsed = Date.now() - startTime;
      if (earlyExit && trackingDetected && elapsed >= minMs) {
        break;
      }
      if (earlyExitOnNoProgress && !trackingDetected && elapsed >= noProgressTimeoutMs) {
        break;
      }
    }
  } finally {
    if (page && typeof page.off === 'function') {
      page.off('response', responseHandler);
    }
  }
}

module.exports = {
  launchBrowser,
  getChromiumEnv,
  SENSITIVE_ENV_KEY_REGEX,
  SENSITIVE_ENV_KEY_PREFIX_REGEX,
  newMobileContext,
  newDesktopContext,
  resolveStorageState,
  setupResourceBlocking,
  retry,
  waitWithScroll,
  closeContextWithDiagnostics,
  getDiagnosticsDir
};
