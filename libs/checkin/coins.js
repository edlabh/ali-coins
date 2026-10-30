'use strict';

/**
 * Mapeamentos puros do ciclo de check-in (sem Playwright).
 *
 * Extraídos de `libs/ui/balance.js` para que `libs/report.js` (e, por consequência,
 * notificações/crash handler) não carreguem o navegador apenas para converter moedas
 * em dias de streak. `balance.js` continua reexportando as funções para compatibilidade.
 */

/**
 * Mapeia a quantidade de moedas ganhas no check-in para o dia correspondente da sequência.
 * Ciclo oficial do AliExpress Coin Check-in:
 * Dia 1: +10 moedas
 * Dia 2: +15 moedas
 * Dia 3: +20 moedas
 * Dia 4: +25 moedas
 * Dia 5: +30 moedas
 * Dia 6: +35 moedas
 * Dia 7+: +40 moedas
 * @param {string|number|null} coins
 * @returns {number|null}
 */
function getStreakFromCheckinCoins(coins) {
  if (coins === null || coins === undefined) return null;
  const num =
    typeof coins === 'number' ? coins : parseInt(String(coins).replace(/[^0-9]/g, ''), 10);
  if (isNaN(num)) return null;

  switch (num) {
    case 10:
      return 1;
    case 15:
      return 2;
    case 20:
      return 3;
    case 25:
      return 4;
    case 30:
      return 5;
    case 35:
      return 6;
    case 40:
      return 7;
    default:
      return null;
  }
}

/**
 * Mapeia o dia da sequência (streak) para a quantidade esperada de moedas ganhas no check-in.
 * Ciclo oficial do AliExpress Coin Check-in:
 * Dia 1: +10 moedas
 * Dia 2: +15 moedas
 * Dia 3: +20 moedas
 * Dia 4: +25 moedas
 * Dia 5: +30 moedas
 * Dia 6: +35 moedas
 * Dia 7+: +40 moedas
 * @param {string|number|null} streak
 * @returns {number}
 */
function getCheckinCoinsFromStreak(streak) {
  if (streak === null || streak === undefined || streak === 'N/D') return 10;
  const num =
    typeof streak === 'number' ? streak : parseInt(String(streak).replace(/[^0-9]/g, ''), 10);
  if (isNaN(num) || num <= 1) return 10;
  switch (num) {
    case 2:
      return 15;
    case 3:
      return 20;
    case 4:
      return 25;
    case 5:
      return 30;
    case 6:
      return 35;
    default:
      return 40;
  }
}

module.exports = {
  getStreakFromCheckinCoins,
  getCheckinCoinsFromStreak
};
