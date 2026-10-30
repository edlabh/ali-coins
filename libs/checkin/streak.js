'use strict';

/**
 * Decide se a quebra de streak deve ser confirmada pelo extrato desktop antes de alertar.
 *
 * A tela pode mostrar 1 transitoriamente na virada do dia; só vale reler quando a tela
 * lê 1, há histórico anterior > 1, o check-in não constava coletado antes e o extrato
 * disponível ainda não desmentiu (<= 1 ou ausente).
 *
 * @param {{detectedStreak?: number|string|null, previousStreakDays?: number|null, statementStreak?: number|null, alreadyCollected?: boolean}} [params]
 * @returns {boolean} true quando é preciso reler o extrato para confirmar a quebra
 */
function shouldConfirmStreakByStatement({
  detectedStreak = null,
  previousStreakDays = null,
  statementStreak = null,
  alreadyCollected = false
} = {}) {
  const parsed =
    typeof detectedStreak === 'number'
      ? detectedStreak
      : parseInt(String(detectedStreak).replace(/[^0-9]/g, ''), 10);
  const base = typeof previousStreakDays === 'number' ? previousStreakDays : null;
  const statement = typeof statementStreak === 'number' ? statementStreak : null;

  if (alreadyCollected === true) return false;
  if (parsed !== 1) return false;
  if (!(typeof base === 'number' && base > 1)) return false;
  // Extrato já disponível (confirma ou desmente a quebra) -> não precisa de nova leitura.
  return statement === null;
}

/**
 * Segunda verificação do check-in pelo extrato desktop ("Bônus diário" de hoje).
 *
 * A confirmação primária é o marcador da UI após o clique. Quando ele não aparece,
 * o crédito do dia no extrato é prova de que o check-in funcionou — desde que NADA
 * constasse coletado antes desta execução (evita incremento duplo em re-execuções no
 * mesmo dia). A leitura dinâmica da página continua tendo prioridade no streak.
 *
 * @param {{justCollected?: boolean, alreadyCollected?: boolean, hasBonusFromLedger?: boolean}} [params]
 * @returns {boolean} true quando o extrato confirma o check-in desta execução
 */
function shouldConfirmCheckinByLedger({
  justCollected = false,
  alreadyCollected = false,
  hasBonusFromLedger = false
} = {}) {
  return justCollected !== true && alreadyCollected !== true && hasBonusFromLedger === true;
}

/**
 * Decide se a leitura desktop do encerramento da etapa 1 pode reutilizar a checagem inicial.
 * Só quando NADA foi coletado nesta execução (saldo/streak não mudaram) e a leitura inicial
 * trouxe saldo válido — evita reabrir o contexto desktop (~18s na baseline).
 * @param {{justCollected?: boolean, earlyDesktop?: object|null}} [params]
 * @returns {boolean}
 */
function shouldReuseEarlyDesktop({ justCollected = false, earlyDesktop = null } = {}) {
  if (justCollected === true) return false;
  if (!earlyDesktop || typeof earlyDesktop !== 'object') return false;
  const balance = earlyDesktop.totalBalance;
  if (balance === null || balance === undefined) return false;
  const text = String(balance).trim();
  return text !== '' && text !== 'N/D';
}

module.exports = {
  shouldConfirmCheckinByLedger,
  shouldConfirmStreakByStatement,
  shouldReuseEarlyDesktop
};
