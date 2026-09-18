const fs = require('fs');
const path = require('path');
const logger = require('../../logger');
const { safeChmod600, safeWriteFile } = require('../../security');

// O modo de baixo consumo do Chromium é habilitado por padrão (mesma semântica de browser.js).
// Nele o tracing fica DESLIGADO por padrão: traces gravam screenshots + snapshots de DOM
// continuamente em todos os contextos, com custo alto de CPU/RAM/disco em hosts de 1 GB.
const LOW_MEMORY_DISABLED_REGEX = /^(0|false|off|no)$/i;

/**
 * Indica se o modo de baixo consumo está habilitado (padrão: true).
 * @returns {boolean}
 */
function isLowMemoryHost() {
  return !LOW_MEMORY_DISABLED_REGEX.test(String(process.env.CHROMIUM_LOW_MEMORY || '').trim());
}

/**
 * Resolve uma opção de diagnóstico: variável de ambiente explícita tem precedência;
 * sem env, aplica o default específico para host de baixa memória.
 * @param {string} name
 * @param {string} lowMemoryDefault
 * @param {string} normalDefault
 * @returns {string}
 */
function resolveDiagnosticOption(name, lowMemoryDefault, normalDefault) {
  const raw = process.env[name];
  if (raw !== undefined && String(raw).trim() !== '') return String(raw).trim();
  return isLowMemoryHost() ? lowMemoryDefault : normalDefault;
}

/**
 * Retorna o diretório de saída para artefatos de diagnóstico (traces, prints, vídeos)
 * @returns {string}
 */
function getDiagnosticsDir() {
  const outDir = process.env.PW_OUTPUT_DIR || path.join(__dirname, '..', '..', 'scratch');
  try {
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
    }
    // Restringe o diretório de artefatos ao dono (independe do umask do host)
    fs.chmodSync(outDir, 0o700);
  } catch {
    // Ignorar falha se não conseguir criar/ajustar a pasta (ex: Windows/volume montado)
  }
  return outDir;
}

/**
 * Configura opções avançadas de diagnóstico (tracing, video, screenshots)
 * @param {object} [baseOptions={}]
 * @returns {object}
 */
function applyDiagnosticOptions(baseOptions = {}) {
  const pwVideo = resolveDiagnosticOption('PW_VIDEO', 'off', 'off');
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
  const pwTrace = resolveDiagnosticOption('PW_TRACE', 'off', 'retain-on-failure');
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
// Páginas que já tiveram screenshot manual de falha: evita captura automática duplicada
const pagesWithManualScreenshot = new WeakSet();

async function closeContextWithDiagnostics(context, { failed = false, name = 'context' } = {}) {
  if (!context) return;
  const pwTrace = resolveDiagnosticOption('PW_TRACE', 'off', 'retain-on-failure');
  const pwScreenshot = resolveDiagnosticOption(
    'PW_SCREENSHOT',
    'only-on-failure',
    'only-on-failure'
  );
  const outDir = getDiagnosticsDir();

  // PW_SCREENSHOT: captura automática no encerramento (sem duplicar prints manuais da mesma página)
  if ((failed && pwScreenshot === 'only-on-failure') || pwScreenshot === 'on') {
    const pages = typeof context.pages === 'function' ? context.pages() : [];
    const page = pages.find((p) => !pagesWithManualScreenshot.has(p));
    if (page && typeof page.screenshot === 'function') {
      const filePath = path.join(outDir, `${name}-screenshot-${Date.now()}.png`);
      try {
        await page.screenshot({ path: filePath, fullPage: true });
        safeChmod600(filePath);
        logger.warn(
          { filePath },
          'Screenshot automático de diagnóstico capturado (PW_SCREENSHOT).'
        );
      } catch (err) {
        logger.debug({ err: err.message }, 'Falha ao capturar screenshot automático.');
      }
    }
  }

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

  // Disparar poda defensiva em background para manter scratch/ dentro da política de retenção
  try {
    const { pruneSessionBackups } = require('../session');
    pruneSessionBackups({ scratchDir: outDir }).catch(() => {});
  } catch {}
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
    pagesWithManualScreenshot.add(page);
    logger.info({ filePath }, `Screenshot de diagnóstico salva: ${path.basename(filePath)}`);

    // Disparar poda defensiva em background
    try {
      const { pruneSessionBackups } = require('../session');
      pruneSessionBackups({ scratchDir: outDir }).catch(() => {});
    } catch {}

    return filePath;
  } catch (err) {
    logger.debug({ err: err.message }, 'Falha ao salvar screenshot de diagnóstico.');
    return null;
  }
}

const crypto = require('crypto');

/**
 * Captura hash SHA-256 do HTML normalizado e screenshot em caso de falha crítica de seletor / gaveta
 * @param {import('playwright').Page} page
 * @param {string} [name='tasks_drawer']
 * @returns {Promise<{ hash: string|null, hashFile: string|null, screenshotFile: string|null }>}
 */
async function captureDomHashAndArtifacts(page, name = 'tasks_drawer') {
  const outDir = getDiagnosticsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let hash = null;
  let hashFile = null;
  let screenshotFile = null;

  if (page) {
    try {
      const rawHtml = await page.evaluate(() => document.documentElement.outerHTML).catch(() => '');
      const normalizedHtml = rawHtml.replace(/\s+/g, ' ').trim();
      hash = crypto.createHash('sha256').update(normalizedHtml).digest('hex');
      hashFile = path.join(outDir, `dom-${timestamp}.hash.txt`);
      // Privacidade: por padrão grava somente o hash (a página autenticada pode conter
      // dados de conta/CSRF). Use PW_DUMP_DOM=true em depuração local para anexar o HTML.
      const shouldDumpHtml = /^(1|true|on)$/i.test(process.env.PW_DUMP_DOM || '');
      const content = [
        `SHA-256: ${hash}`,
        `Timestamp: ${new Date().toISOString()}`,
        `Target: ${name}`,
        `HTML length: ${normalizedHtml.length}`,
        shouldDumpHtml ? `\nHTML:\n${normalizedHtml}` : ''
      ]
        .filter(Boolean)
        .join('\n');
      await safeWriteFile(hashFile, content, 'utf-8');
      safeChmod600(hashFile);
      if (shouldDumpHtml) {
        logger.warn(
          { hashFile },
          '[PW_DUMP_DOM=true] HTML normalizado completo gravado no artefato de diagnóstico.'
        );
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'Falha ao capturar hash do DOM normalizado.');
    }

    try {
      screenshotFile = path.join(outDir, `${name}_failed.png`);
      await page.screenshot({ path: screenshotFile, fullPage: true });
      safeChmod600(screenshotFile);
    } catch (err) {
      logger.debug({ err: err.message }, 'Falha ao capturar screenshot de diagnóstico.');
    }
  }

  logger.warn(
    { domHash: hash, hashFile, screenshotFile },
    `[OBSERVABLE-SELECTORS] Falha detectada em "${name}". Hash do DOM normalizado: ${hash}`
  );

  return { hash, hashFile, screenshotFile };
}

module.exports = {
  getDiagnosticsDir,
  applyDiagnosticOptions,
  startContextTracing,
  closeContextWithDiagnostics,
  saveFailureScreenshot,
  captureDomHashAndArtifacts
};
