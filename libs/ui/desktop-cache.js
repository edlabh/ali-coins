'use strict';

/**
 * Cache opcional de contexto/página desktop (opt-in via `reuseContext`).
 *
 * Vive em um módulo sem Playwright para que runners/CLI possam fechar o cache no fim da
 * conta sem carregar `libs/ui` inteiro (e, por consequência, o navegador) apenas para isso.
 * O estado é do processo; não contém cookies nem dados de sessão.
 */

let cachedDesktopContext = null;
let cachedDesktopPage = null;

/**
 * Decide se o contexto desktop deve ser reutilizado entre leituras de saldo do mesmo run.
 *
 * Padrão: DESLIGADO. Medições na VM mostraram que manter o contexto desktop vivo durante
 * o fluxo mobile eleva o pico de RAM/PIDs (contextos mobile e desktop concorrentes), o que
 * é pior em host restrito. Reutilizar só compensa em cenários sem mobilização concorrente;
 * habilite com DESKTOP_REUSE_CONTEXT=true se o host tiver folga e quiser priorizar tempo.
 * @returns {boolean}
 */
function shouldReuseDesktopContext() {
  const value = process.env.DESKTOP_REUSE_CONTEXT;
  if (value === undefined || value === null || value === '') return false;
  return /^(1|true|on|yes)$/i.test(String(value).trim());
}

/** @returns {object|null} */
function getCachedDesktopContext() {
  return cachedDesktopContext;
}

/** @returns {object|null} */
function getCachedDesktopPage() {
  return cachedDesktopPage;
}

/** @param {object|null} context */
function setCachedDesktopContext(context) {
  cachedDesktopContext = context || null;
}

/** @param {object|null} page */
function setCachedDesktopPage(page) {
  cachedDesktopPage = page || null;
}

/**
 * Fecha o contexto desktop eventualmente cacheado (chamar ao fim da conta/processo).
 * @returns {Promise<void>}
 */
async function closeCachedDesktopContext() {
  cachedDesktopPage = null;
  if (cachedDesktopContext) {
    const ctx = cachedDesktopContext;
    cachedDesktopContext = null;
    await ctx.close().catch(() => {});
  }
}

module.exports = {
  shouldReuseDesktopContext,
  getCachedDesktopContext,
  getCachedDesktopPage,
  setCachedDesktopContext,
  setCachedDesktopPage,
  closeCachedDesktopContext
};
