'use strict';

/**
 * Guarda-chuva de sessão inválida no check-in: indica se faltam dados frescos da
 * execução atual para considerar a sessão viva.
 *
 * O saldo (`totalBalance`) é SEMPRE lido na execução atual — não tem fallback de dias
 * anteriores. Já o `streakDays` pode herdar `previousStreakDays` dos metadados
 * (`resolveStreakDays`, libs/report.js) quando a detecção de hoje falha, mascarando uma
 * sessão morta (bug: execução com saldo "N/D" era reportada como sucesso). Por isso
 * o saldo ausente ("N/D"/null) é o critério confiável.
 *
 * @param {{ totalBalance?: string|number|null }} [checkinData]
 * @returns {boolean} true quando a sessão deve ser tratada como inválida
 */
function isSessionDataMissing(checkinData = {}) {
  const { totalBalance } = checkinData;
  return totalBalance === 'N/D' || totalBalance === null || totalBalance === undefined;
}

/**
 * Monta o `checkinResult` consumido por `renderCheckinReport`, `all.js` e notificações.
 *
 * A função não recalcula decisões: recebe os valores já resolvidos pelo fluxo e apenas
 * garante um contrato único para o resultado (incluindo os sinais `trustDetected` e
 * `checkinCoinsFromLedger`, que distinguem leitura real de estimativa).
 *
 * @param {object} fields
 * @param {string} fields.userEmail
 * @param {boolean} fields.alreadyCollected
 * @param {string} fields.coinsGainedToday
 * @param {boolean} fields.checkinCoinsFromLedger
 * @param {number|null} fields.statementStreakDays
 * @param {string} fields.totalBalance
 * @param {number|string} fields.streakDays
 * @param {number|null} fields.previousStreakDays
 * @param {number|null} fields.longestStreakDays
 * @param {boolean} fields.trustDetected
 * @param {Date} fields.startTime
 * @param {Date} fields.endTime
 * @param {string} fields.duration
 * @param {object|null} fields.sessionData
 * @returns {object}
 */
function buildCheckinResult({
  userEmail,
  alreadyCollected,
  coinsGainedToday,
  checkinCoinsFromLedger,
  statementStreakDays,
  totalBalance,
  streakDays,
  previousStreakDays,
  longestStreakDays,
  trustDetected,
  startTime,
  endTime,
  duration,
  sessionData
}) {
  return {
    userEmail,
    alreadyCollected,
    coinsGainedToday,
    checkinCoinsFromLedger,
    statementStreakDays,
    totalBalance,
    streakDays,
    previousStreakDays,
    longestStreakDays,
    trustDetected,
    startTime,
    endTime,
    duration,
    sessionData
  };
}

module.exports = {
  isSessionDataMissing,
  buildCheckinResult
};
