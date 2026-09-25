/**
 * Funções utilitárias de formatação de data, hora e duração
 */

function pad(num, size = 2) {
  return num.toString().padStart(size, '0');
}

// Fuso do negócio (o "dia" da AliExpress reinicia em Pacific Time). Os relatórios usam
// este fuso em vez do fuso local do host, evitando divergência na virada do dia em VPS UTC.
// Configurável via REPORT_TIMEZONE (ex.: America/Sao_Paulo) mantendo o mesmo formato.
const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'America/Los_Angeles';

/**
 * Extrai as partes de data/hora de um Date no fuso do relatório.
 * @param {Date} date
 * @returns {{ day: string, month: string, year: string, hour: string, minute: string, second: string }}
 */
function partsInReportTimezone(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return parts;
}

/**
 * Retorna a data no formato DD/MM/AAAA (no fuso do relatório)
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
function formatDate(date = new Date()) {
  const p = partsInReportTimezone(date);
  // en-GB hour "24" aparece à meia-noite em alguns engines; normaliza
  return `${p.day}/${p.month}/${p.year}`;
}

/**
 * Retorna a hora no formato HH:mm:ss (no fuso do relatório)
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
function formatTime(date = new Date()) {
  const p = partsInReportTimezone(date);
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${hh}:${p.minute}:${p.second}`;
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
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
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

  // Endurecimento: attempt não-finito (NaN/Infinity) não deve propagar NaN
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, attempt) : 0;
  const exponentialMs = effectiveBase * Math.pow(2, safeAttempt);
  const cappedMs = Math.min(exponentialMs, maxMs);
  // Jitter entre 80% e 120%
  const jitterFactor = 0.8 + 0.4 * jitterFraction;
  return Math.min(Math.round(cappedMs * jitterFactor), maxMs);
}

/**
 * Sorteia uma pausa (ms) uniforme e inclusiva entre `minMs` e `maxMs`.
 * Valores inválidos/negativos viram 0; se `maxMs < minMs`, usa `minMs`. Com `maxMs` 0 retorna 0
 * (pausa desligada). `random` é injetável para testes determinísticos.
 * @param {number} [minMs=0]
 * @param {number} [maxMs=0]
 * @param {() => number} [random=Math.random]
 * @returns {number}
 */
function pickPauseMs(minMs = 0, maxMs = 0, random = Math.random) {
  const min = Math.max(0, Math.floor(Number(minMs) || 0));
  const max = Math.max(min, Math.floor(Number(maxMs) || 0));
  if (max === 0) return 0;
  return min + Math.floor(random() * (max - min + 1));
}

module.exports = {
  formatDate,
  formatTime,
  formatDateTime,
  formatDuration,
  calculateAccountBackoff,
  pickPauseMs
};
