'use strict';

/**
 * Contexto de execução para correlação de logs.
 *
 * Mantido separado do logger e das métricas para evitar ciclos: os runners definem o
 * contexto no início de cada conta e o logger apenas lê. O valor de `account` deve
 * chegar já mascarado; este módulo não conhece dados de sessão.
 */

let current = null;

/**
 * Define o contexto atual.
 * @param {{runId?: string|null, account?: string|null}} [context={}]
 */
function setRunContext({ runId = null, account = null } = {}) {
  current = {
    ...(runId ? { runId: String(runId) } : {}),
    ...(account ? { account: String(account) } : {})
  };
  if (Object.keys(current).length === 0) current = null;
}

/** Limpa o contexto (fim da execução). */
function clearRunContext() {
  current = null;
}

/**
 * Retorna uma cópia do contexto atual ou `null`.
 * @returns {{runId?: string, account?: string}|null}
 */
function getRunContext() {
  return current ? { ...current } : null;
}

module.exports = {
  setRunContext,
  clearRunContext,
  getRunContext
};
