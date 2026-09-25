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
      return resolve(true);
    }
    if (stream.writableLength === 0) {
      return resolve(true);
    }

    let finished = false;
    let timer = null;
    // resolve(true) = flush confirmado; resolve(false) = teto de tempo atingido
    const finish = (flushed) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve(flushed);
    };

    timer = setTimeout(() => finish(false), timeoutMs);
    try {
      stream.write('', () => finish(true));
    } catch {
      finish(true);
    }
  });
}

/**
 * Aguarda o flush de stdout e stderr (e do destino do logger, quando aplicável),
 * garantindo que relatórios não sejam truncados — sem travar indefinidamente.
 * @returns {Promise<void>}
 */
async function flushStdStreams() {
  const flushed = await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
  if (flushed.some((ok) => ok === false)) {
    // Aviso explícito: o teto foi atingido e parte da saída pode ter sido truncada.
    try {
      process.stderr.write(
        `[aviso] timeout de ${FLUSH_TIMEOUT_MS}ms ao liberar stdout/stderr; saída pode ter sido truncada.\n`
      );
    } catch {
      // stderr indisponível: nada a fazer
    }
  }
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
  // Webhooks são fire-and-forget no fluxo de relatório; aguarda os que estiverem em voo
  // (com teto) para não perder notificações no process.exit(). Módulo leve para não
  // carregar Playwright em CLIs que não usam navegador.
  try {
    const { flushWebhooks } = require('./webhooks');
    if (typeof flushWebhooks === 'function') {
      await flushWebhooks(5000);
    }
  } catch {
    // Rastreamento indisponível: ignora
  }
  try {
    await flushStdStreams();
  } catch {
    // Nunca impede o encerramento
  }
  return process.exit(code);
}

/**
 * Código de saída convencional para um sinal (128 + número do sinal). Usado quando o `node`
 * é PID 1 (docker run sem `--init`): o kernel ignora o sinal re-emitido ao próprio processo,
 * então o encerramento precisa ser explícito para não sair com código 0 numa interrupção.
 * @param {string} signal Nome do sinal (ex.: 'SIGINT', 'SIGTERM')
 * @returns {number} 130 para SIGINT, 143 para SIGTERM, 1 para desconhecidos
 */
function signalExitCode(signal) {
  switch (String(signal)) {
    case 'SIGINT':
      return 130;
    case 'SIGTERM':
      return 143;
    default:
      return 1;
  }
}

module.exports = {
  flushStream,
  flushStdStreams,
  flushAndExit,
  signalExitCode,
  FLUSH_TIMEOUT_MS
};
