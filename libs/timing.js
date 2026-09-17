const { formatDuration } = require('../time_utils');

/**
 * Inicia cronômetro para uma conta ou etapa de execução
 * @param {Date|number|string} [initialStartTime=new Date()]
 * @returns {{
 *   startTime: Date,
 *   end: (labelOrEndTime?: string|Date|number, customEndTime?: Date|number) => { startTime: Date, endTime: Date, duration: string },
 *   getElapsed: (currentTime?: Date|number) => string
 * }}
 */
function startAccountTimer(initialStartTime = new Date()) {
  const startTime =
    initialStartTime instanceof Date
      ? initialStartTime
      : !isNaN(new Date(initialStartTime).getTime())
        ? new Date(initialStartTime)
        : new Date();
  let cached = null;

  return {
    startTime,
    /**
     * Finaliza o cronômetro e retorna o resultado formatado.
     * Idempotente: chamadas subsequentes retornam o mesmo resultado gravado na primeira finalização.
     * @param {string|Date|number} [labelOrEndTime] Rótulo descritivo (ex: 'lock', 'error', 'success') ou data de término mockada
     * @param {Date|number} [customEndTime] Data de término mockada se o 1º argumento for um rótulo string
     * @returns {{ startTime: Date, endTime: Date, duration: string }}
     */
    end(labelOrEndTime = new Date(), customEndTime = null) {
      if (cached) return cached;

      let endTime;
      if (customEndTime instanceof Date || typeof customEndTime === 'number') {
        endTime = customEndTime instanceof Date ? customEndTime : new Date(customEndTime);
      } else if (labelOrEndTime instanceof Date || typeof labelOrEndTime === 'number') {
        endTime = labelOrEndTime instanceof Date ? labelOrEndTime : new Date(labelOrEndTime);
      } else if (
        typeof labelOrEndTime === 'string' &&
        !isNaN(Date.parse(labelOrEndTime)) &&
        /^\d{4}-\d{2}/.test(labelOrEndTime)
      ) {
        endTime = new Date(labelOrEndTime);
      } else {
        endTime = new Date();
      }

      const startMs = !isNaN(startTime.getTime()) ? startTime.getTime() : Date.now();
      const endMs = !isNaN(endTime.getTime()) ? endTime.getTime() : Date.now();
      const elapsedMs = Math.max(0, endMs - startMs);
      cached = {
        startTime,
        endTime,
        duration: formatDuration(elapsedMs)
      };
      return cached;
    },
    /**
     * Retorna a duração decorrida até o momento sem congelar o timer
     * @param {Date|number} [currentTime=new Date()]
     * @returns {string}
     */
    getElapsed(currentTime = new Date()) {
      const now = currentTime instanceof Date ? currentTime : new Date(currentTime);
      const nowMs = !isNaN(now.getTime()) ? now.getTime() : Date.now();
      const startMs = !isNaN(startTime.getTime()) ? startTime.getTime() : Date.now();
      return formatDuration(Math.max(0, nowMs - startMs));
    }
  };
}

/**
 * Finaliza e formata a cronometragem dado um startTime inicial
 * @param {Date|number|string} startTime
 * @param {Date|number|string} [endTimeOrLabel=new Date()]
 * @param {Date|number} [customEndTime]
 * @returns {{ startTime: Date, endTime: Date, duration: string }}
 */
function finishAccountTimer(startTime, endTimeOrLabel = new Date(), customEndTime = null) {
  const timer = startAccountTimer(startTime);
  return timer.end(endTimeOrLabel, customEndTime);
}

module.exports = {
  startAccountTimer,
  finishAccountTimer
};
