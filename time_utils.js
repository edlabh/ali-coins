/**
 * Funções utilitárias de formatação de data, hora e duração
 */

function pad(num, size = 2) {
  return num.toString().padStart(size, '0');
}

/**
 * Retorna a data no formato DD/MM/AAAA
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
function formatDate(date = new Date()) {
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

/**
 * Retorna a hora no formato HH:mm:ss
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
function formatTime(date = new Date()) {
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${hh}:${mm}:${ss}`;
}

/**
 * Retorna data e hora no formato DD/MM/AAAA HH:mm:ss
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
function formatDateTime(date = new Date()) {
  return `${formatDate(date)} ${formatTime(date)}`;
}

/**
 * Formata duração em milissegundos para formato legível (ex: "45s", "1m 20s", "1h 05m 12s")
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (!ms || ms < 0 || isNaN(ms)) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${pad(seconds)}s`;
  }
  return `${seconds}s`;
}

/**
 * Calcula tempo de backoff exponencial com jitter por tentativa de falha
 * @param {number} attempt Índice da tentativa de falha (0-based)
 * @param {number} [baseMs] Base em ms (default: process.env.ACCOUNT_BACKOFF_BASE_MS ou 2000)
 * @param {number} [maxMs=30000] Teto máximo em ms (default: 30000)
 * @param {number} [jitterFraction] Fração para cálculo de jitter previsível (0.0 a 1.0)
 * @returns {number} Tempo em ms
 */
function calculateAccountBackoff(
  attempt = 0,
  baseMs = null,
  maxMs = 30000,
  jitterFraction = Math.random()
) {
  const envBase = Number(process.env.ACCOUNT_BACKOFF_BASE_MS);
  const effectiveBase =
    typeof baseMs === 'number' && baseMs > 0
      ? baseMs
      : !isNaN(envBase) && envBase > 0
        ? envBase
        : 2000;

  const exponentialMs = effectiveBase * Math.pow(2, Math.max(0, attempt));
  const cappedMs = Math.min(exponentialMs, maxMs);
  // Jitter entre 80% e 120%
  const jitterFactor = 0.8 + 0.4 * jitterFraction;
  return Math.min(Math.round(cappedMs * jitterFactor), maxMs);
}

module.exports = {
  formatDate,
  formatTime,
  formatDateTime,
  formatDuration,
  calculateAccountBackoff
};
