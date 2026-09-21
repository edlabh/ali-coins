/**
 * Allowlist de chaves do localStorage essenciais para persistência de sessão.
 * Motivo da substituição da denylist:
 * O AliExpress injeta scripts de telemetria, telemetrias analíticas pesadas (APLUS_S_CORE,
 * Batman, Goldlog, Aegis) que poluem o localStorage com mais de 200KB de cache temporário.
 * A allowlist garante que apenas tokens de autenticação, CSRF tokens, identificadores
 * de conta e preferências essenciais de navegação sejam transferidos/persistidos.
 *
 * Compartilhado entre export_session.js (token portável) e libs/session.js (sessão local),
 * evitando divergência de comportamento entre os dois fluxos.
 */
const ALLOWED_STORAGE_KEY_PATTERNS = [
  /login/i,
  /user/i,
  /account/i,
  /token/i,
  /session/i,
  /auth/i,
  /_m_h5_tk/i,
  /currency/i,
  /locale/i,
  /lang/i
];

/**
 * Verifica se uma chave de localStorage deve ser preservada
 * @param {string} keyName
 * @returns {boolean}
 */
function isAllowedStorageKey(keyName) {
  if (!keyName || typeof keyName !== 'string') return false;
  return ALLOWED_STORAGE_KEY_PATTERNS.some((pattern) => pattern.test(keyName));
}

/**
 * Remove do storageState as chaves de localStorage fora da allowlist (telemetria/caches),
 * preservando integralmente os cookies (fonte da autenticação). Reduz o tamanho do payload
 * persistido e o volume reinjetado via CDP em cada novo contexto.
 * @param {object} storageState
 * @returns {object} Novo storageState filtrado (ou o original se não aplicável)
 */
function filterStorageState(storageState) {
  if (!storageState || !Array.isArray(storageState.origins)) return storageState;
  const origins = storageState.origins.map((origin) => {
    // localStorage ausente/não-array: trata como vazio (não devolve cru, o que
    // permitiria entradas fora da allowlist escaparem). Preserva o restante do origin.
    if (!origin) return origin;
    if (!Array.isArray(origin.localStorage)) return { ...origin, localStorage: [] };
    const filtered = origin.localStorage.filter((item) => isAllowedStorageKey(item && item.name));
    return { ...origin, localStorage: filtered };
  });
  return { ...storageState, origins };
}

/**
 * Decide se a filtragem estrita deve ser aplicada. Padrão: ligada; opt-out via
 * `SESSION_STRICT_STORAGE=false` (ou 0) para preservar todo o localStorage.
 * @param {object} [options={}]
 * @returns {boolean}
 */
function shouldFilterStorage(options = {}) {
  if (options.filterStorage === true) return true;
  if (options.filterStorage === false) return false;
  const value = process.env.SESSION_STRICT_STORAGE;
  if (value === undefined || value === null || value === '') return true;
  return !['false', '0', 'off', 'no'].includes(String(value).toLowerCase());
}

module.exports = {
  ALLOWED_STORAGE_KEY_PATTERNS,
  isAllowedStorageKey,
  filterStorageState,
  shouldFilterStorage
};
