'use strict';

const { getCaptchaCooldown } = require('../session');

/**
 * Verifica se o login deve ser bloqueado pelo cooldown pós-captcha (lê o meta da conta).
 * Wrapper assíncrono testável: garante o `await` do lock de sessão usado por
 * `getCaptchaCooldown` — sem isso o `active` vinha `undefined` e a pausa não bloqueava.
 * `force: true` (flag `--force`) ignora a pausa e permite a tentativa de login.
 * @param {object} sessionOpts Opções da conta (sessionPath/sessionMetaPath/account)
 * @param {number} hours Janela de cooldown em horas
 * @param {{force?: boolean}} [options]
 * @returns {Promise<{blocked: boolean, forced: boolean, cooldown: object, manualRequired: boolean}>}
 */
async function checkCaptchaCooldownForLogin(sessionOpts, hours, { force = false } = {}) {
  const cooldown = await getCaptchaCooldown(sessionOpts, hours);
  return {
    blocked: !force && cooldown.active === true,
    forced: Boolean(force),
    cooldown,
    manualRequired: cooldown.requireManualLogin === true
  };
}

module.exports = { checkCaptchaCooldownForLogin };
