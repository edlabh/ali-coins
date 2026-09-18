/**
 * Rastreamento de notificações webhook em voo.
 *
 * Módulo deliberadamente sem dependências (não importa report/balance/browser) para
 * que `libs/exit.js` possa aguardar o flush sem carregar o Playwright em CLIs leves
 * (import_session/export_session/--help/--dry-run).
 */

const pendingWebhooks = new Set();

/**
 * Registra uma promessa de webhook para ser aguardada no encerramento.
 * @template T
 * @param {Promise<T>} promise
 * @returns {Promise<T>}
 */
function trackWebhook(promise) {
  if (!promise || typeof promise.then !== 'function') return promise;
  pendingWebhooks.add(promise);
  // remove do set ao liquidar; o catch evita rejeição não tratada do handler interno
  promise.finally(() => pendingWebhooks.delete(promise)).catch(() => {});
  return promise;
}

/**
 * Aguarda os webhooks em voo (com teto) antes do encerramento do processo.
 * O timer é intencionalmente referenciado (não `.unref()`): o encerramento deve
 * esperar o flush curto, não sair antes por falta de handles ativos.
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<void>}
 */
async function flushWebhooks(timeoutMs = 5000) {
  if (pendingWebhooks.size === 0) return;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([Promise.allSettled([...pendingWebhooks]), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Quantidade de webhooks atualmente em voo (para diagnóstico/testes).
 * @returns {number}
 */
function pendingWebhooksCount() {
  return pendingWebhooks.size;
}

module.exports = {
  trackWebhook,
  flushWebhooks,
  pendingWebhooksCount
};
