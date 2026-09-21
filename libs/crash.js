const logger = require('../logger');
const { flushAndExit } = require('./exit');

/**
 * Converte um motivo de crash não-Error em texto útil (evita "[object Object]").
 * @param {unknown} value
 * @returns {string}
 */
function describeNonError(value) {
  if (value === undefined || value === null) return String(value);
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value);
    if (json && json !== '{}') return json;
  } catch {
    // Valor circular: cai no String()
  }
  return String(value);
}
const { sendTelegram } = require('./notify');
const { sendHeartbeat } = require('./heartbeat');

/**
 * Registra listeners globais para capturar uncaughtException e unhandledRejection.
 * Em caso de falha global:
 * 1. Registra log com nível fatal via Pino.
 * 2. Tenta enviar notificação Telegram parcial e heartbeat de falha de forma best-effort (sem nunca lançar erro).
 * 3. Finaliza o processo imediatamente com o código de saída 6 (com teto de 15s para nunca travar).
 *
 * @param {() => { config?: object, account?: object, chatId?: string|number, scriptName?: string }} [getContext]
 * @returns {() => void} Função de cleanup para remoção dos listeners
 */
function setupGlobalCrashHandler(getContext = () => ({})) {
  let isExiting = false;

  const handleCrash = async (error, type) => {
    if (isExiting) {
      process.exit(6);
    }
    isExiting = true;

    // Timeout de emergência: nunca travar, mas com folga para o flush (webhooks + streams
    // podem somar até ~10s). 15s evita cortar o log fatal/relatório no meio do flush.
    // Sem unref(): o timer DEVE manter o processo vivo para garantir o exit code 6 —
    // com unref, se o event loop drenasse, o Node sairia com código 0.
    setTimeout(() => {
      // Garante que as últimas linhas do log fatal cheguem ao stderr antes de sair
      // (o buffer do pino/sonic-boom pode não ter sido drenado).
      try {
        if (logger && typeof logger.flushLogs === 'function') logger.flushLogs();
      } catch {
        // Ignora falha de flush no caminho de emergência
      }
      process.exit(6);
    }, 15000);

    const err = error instanceof Error ? error : new Error(describeNonError(error));
    logger.fatal(
      { err: err.stack || err.message, crashType: type },
      `Falha global não tratada detectada (${type}). Finalizando execução com código 6.`
    );

    try {
      const ctx = typeof getContext === 'function' ? getContext() : {};
      const config = ctx.config || null;
      const scriptName = ctx.scriptName || 'ali-coins';

      if (config && config.HEARTBEAT_ENABLED) {
        await sendHeartbeat('fail', { config, error: err }).catch(() => {});
      }

      if (config && config.TELEGRAM_ENABLED) {
        const chatId = ctx.chatId || ctx.account?.telegramChatId || config.TELEGRAM_CHAT_ID;
        await sendTelegram({
          config,
          chatId,
          event: 'failure',
          error: `[${scriptName} - Falha Global ${type}] ${err.message}`
        }).catch(() => {});
      }
    } catch (e) {
      // Nunca lança erro dentro do handler de crash
      logger.warn(
        { err: e.message },
        'Aviso: falha durante notificação de emergência no crash handler.'
      );
    } finally {
      // Flush best-effort (com teto) para não perder as últimas linhas do log fatal
      await flushAndExit(6);
    }
  };

  const uncaughtListener = (err) => handleCrash(err, 'uncaughtException');
  const rejectionListener = (reason) => handleCrash(reason, 'unhandledRejection');

  process.on('uncaughtException', uncaughtListener);
  process.on('unhandledRejection', rejectionListener);

  return () => {
    process.removeListener('uncaughtException', uncaughtListener);
    process.removeListener('unhandledRejection', rejectionListener);
  };
}

module.exports = {
  setupGlobalCrashHandler
};
