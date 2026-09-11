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

module.exports = {
  formatDate,
  formatTime,
  formatDateTime,
  formatDuration
};
