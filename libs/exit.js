/**
 * Utilitários de encerramento seguro do processo.
 * process.exit() não aguarda o flush de stdout/stderr; em pipes (cron, --json | jq),
 * isso pode truncar relatórios grandes no limite do buffer (~64KB).
 */

/**
 * Aguarda o flush físico de um stream gravável
 * @param {import('stream').Writable} stream
 * @returns {Promise<void>}
 */
function flushStream(stream) {
  return new Promise((resolve) => {
    if (!stream || stream.destroyed || stream.writableEnded) {
      return resolve();
    }
    if (stream.writableLength === 0) {
      return resolve();
    }
    try {
      stream.write('', () => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * Aguarda o flush de stdout e stderr, garantindo que relatórios não sejam truncados
 * @returns {Promise<void>}
 */
async function flushStdStreams() {
  await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
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
  flushAndExit
};
