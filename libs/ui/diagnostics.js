const fs = require('fs');
const path = require('path');
const logger = require('../../logger');
const { safeChmod600 } = require('../../security');

/**
 * Retorna o diretório de saída para artefatos de diagnóstico (traces, prints, vídeos)
 * @returns {string}
 */
function getDiagnosticsDir() {
  const outDir = process.env.PW_OUTPUT_DIR || path.join(__dirname, '..', '..', 'scratch');
  try {
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
  } catch {
    // Ignorar falha se não conseguir criar pasta
  }
  return outDir;
}

/**
 * Configura opções avançadas de diagnóstico (tracing, video, screenshots)
 * @param {object} [baseOptions={}]
 * @returns {object}
 */
function applyDiagnosticOptions(baseOptions = {}) {
  const pwVideo = process.env.PW_VIDEO || 'off';
  const outDir = getDiagnosticsDir();

  const options = { ...baseOptions };

  if (pwVideo !== 'off') {
    const videosDir = path.join(outDir, 'videos');
    if (!fs.existsSync(videosDir)) {
      try {
        fs.mkdirSync(videosDir, { recursive: true });
      } catch {}
    }
    options.recordVideo = { dir: videosDir };
  }

  return options;
}

/**
 * Inicia tracing no contexto se habilitado
 * @param {import('playwright').BrowserContext} context
 */
async function startContextTracing(context) {
  const pwTrace = process.env.PW_TRACE || 'retain-on-failure';
  if (pwTrace !== 'off') {
    await context.tracing.start({ screenshots: true, snapshots: true }).catch(() => {});
  }
}

/**
 * Finaliza contexto com tratamento seguro de tracing em falha
 * @param {import('playwright').BrowserContext} context
 * @param {object} [options={}]
 * @param {boolean} [options.failed=false]
 * @param {string} [options.name='context']
 */
async function closeContextWithDiagnostics(context, { failed = false, name = 'context' } = {}) {
  if (!context) return;
  const pwTrace = process.env.PW_TRACE || 'retain-on-failure';
  const outDir = getDiagnosticsDir();

  if (pwTrace !== 'off') {
    if (failed && (pwTrace === 'retain-on-failure' || pwTrace === 'on')) {
      const traceFile = path.join(outDir, `${name}-trace-${Date.now()}.zip`);
      await context.tracing.stop({ path: traceFile }).catch(() => {});
      logger.warn({ traceFile }, 'Playwright trace capturado e salvo após falha.');
    } else if (pwTrace === 'on') {
      const traceFile = path.join(outDir, `${name}-trace-${Date.now()}.zip`);
      await context.tracing.stop({ path: traceFile }).catch(() => {});
    } else {
      await context.tracing.stop().catch(() => {});
    }
  }

  await context.close().catch(() => {});
}

/**
 * Salva screenshot de depuração em caso de erro na pasta scratch com permissão 0600
 * @param {import('playwright').Page} page
 * @param {string} name Prefixo do arquivo
 * @returns {Promise<string|null>} Caminho da screenshot salva
 */
async function saveFailureScreenshot(page, name = 'failure') {
  if (!page) return null;
  const outDir = getDiagnosticsDir();
  const filePath = path.join(outDir, `${name}-${Date.now()}.png`);
  try {
    await page.screenshot({ path: filePath, fullPage: true });
    safeChmod600(filePath);
    logger.info({ filePath }, `Screenshot de diagnóstico salva: ${path.basename(filePath)}`);
    return filePath;
  } catch (err) {
    logger.debug({ err: err.message }, 'Falha ao salvar screenshot de diagnóstico.');
    return null;
  }
}

module.exports = {
  getDiagnosticsDir,
  applyDiagnosticOptions,
  startContextTracing,
  closeContextWithDiagnostics,
  saveFailureScreenshot
};
