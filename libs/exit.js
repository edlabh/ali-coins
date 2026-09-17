/**
 * Utilitários de encerramento seguro do processo.
 * process.exit() não aguarda o flush de stdout/stderr; em pipes (cron, --json | jq),
 * isso pode truncar relatórios grandes no limite do buffer (~64KB).
 */

// Teto máximo de espera pelo flush: nunca deixa o encerramento travar por um stream entupido
const FLUSH_TIMEOUT_MS = 5000;

/**
 * Aguarda o flush físico de um stream gravável, com teto de tempo
 * @param {import('stream').Writable} stream
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
function flushStream(stream, timeoutMs = FLUSH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!stream || stream.destroyed || stream.writableEnded) {
      return resolve();
    }
    if (stream.writableLength === 0) {
      return resolve();
    }

    let finished = false;
    let timer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve();
    };

    timer = setTimeout(finish, timeoutMs);
    try {
      stream.write('', () => finish());
    } catch {
      finish();
    }
  });
}

/**
 * Aguarda o flush de stdout e stderr (e do destino do logger, quando aplicável),
 * garantindo que relatórios não sejam truncados — sem travar indefinidamente.
 * @returns {Promise<void>}
 */
async function flushStdStreams() {
  await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
  try {
    // Em modo --json o pino escreve direto no fd 2 via sonic-boom, fora do process.stderr
    const logger = require('../logger');
    if (logger && typeof logger.flushLogs === 'function') {
      logger.flushLogs();
    }
  } catch {
    // Logger indisponível: ignora
  }
}

/**
 * Aguarda o flush de stdout/stderr e encerra o processo com o código informado
 * @param {number} [code=0]
 * @returns {Promise<never>}
 */
async function flushAndExit(code = 0) {
  try {
    await flushStdStreams();
  } catch {
    // Nunca impede o encerramento
  }
  return process.exit(code);
}

module.exports = {
  flushStream,
  flushStdStreams,
  flushAndExit,
  FLUSH_TIMEOUT_MS
};
