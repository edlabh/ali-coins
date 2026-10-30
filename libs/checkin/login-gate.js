'use strict';

const { isLoginGateText, isLoginGateVisible, isLoginPromptText } = require('./login-signals');

/**
 * Decide se o fluxo deve tentar autenticar nesta execução.
 *
 * Regras:
 *  - **Campo de senha visível → true** (prompt de reautenticação in-page do AliExpress,
 *    que pede só a senha na MESMA URL do coin-index — sem isso o login nunca era tentado);
 *  - Sem sessão válida → true (fluxo completo);
 *  - Coin-index virou a portaria "COINS / Log in" (sessão expirada no servidor, mesma
 *    URL, sem campos) → true;
 *  - URL de login/passport + campo de usuário ou textos clássicos → true (comportamento
 *    histórico, preservado);
 *  - Caso contrário → false (sessão válida em página normal: evita re-login desnecessário).
 *
 * @param {object} [params]
 * @param {boolean} [params.hasValidSession]
 * @param {boolean} [params.passwordVisible]
 * @param {boolean} [params.loginUrl]
 * @param {boolean} [params.usernameVisible]
 * @param {string} [params.bodyText]
 * @param {boolean} [params.gateVisible=false] Portaria detectada por DOM (prioritária)
 * @returns {boolean}
 */
function shouldAttemptLogin({
  hasValidSession = false,
  passwordVisible = false,
  loginUrl = false,
  usernameVisible = false,
  bodyText = '',
  gateVisible = false
} = {}) {
  if (passwordVisible) return true;
  if (!hasValidSession) return true;
  if (gateVisible || isLoginGateText(bodyText)) return true;
  if (loginUrl && usernameVisible) return true;
  if (
    loginUrl &&
    (bodyText.includes('Email or phone number') ||
      bodyText.includes('Sign in') ||
      bodyText.includes('Entrar'))
  ) {
    return true;
  }
  return false;
}

module.exports = {
  shouldAttemptLogin,
  isLoginGateText,
  isLoginGateVisible,
  isLoginPromptText
};
