'use strict';

/**
 * Sinais de login/gate que não dependem do Playwright.
 *
 * Extraídos de `libs/ui/balance.js` para que `libs/checkin/login-gate.js` (e o boot de
 * `collect.js`) não carreguem o navegador só para decisões de texto/DOM.
 */

/**
 * Indica se o texto da página é um prompt de login/reautenticação do AliExpress —
 * inclusive o fluxo in-page que reconhece a conta e pede APENAS a senha sem mudar a URL,
 * e a tela "Register/Sign in" que o mycoin.html desktop passou a exibir (out/2026) com
 * sessão expirada.
 * @param {string} text
 * @returns {boolean}
 */
function isLoginPromptText(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  return (
    t.includes('sign in with email code') ||
    t.includes('switch account') ||
    t.includes('trocar de conta') ||
    t.includes('register/sign in') ||
    t.includes('trouble signing in') ||
    t.includes('email or phone number') ||
    ((t.includes('forgot password') || t.includes('esqueci minha senha')) &&
      (t.includes('password') || t.includes('senha')))
  );
}

/**
 * Indica se o coin-index mobile virou a "portaria" de login (out/2026): com a sessão
 * expirada no servidor, a MESMA URL mostra só o título "COINS" e um botão "Log in", sem
 * campo de usuário/senha. Exige a linha isolada do botão E nenhum dígito na página — o
 * coin-index autenticado sempre exibe saldo/sequência, então não há falso positivo nele.
 * @param {string} text
 * @returns {boolean}
 */
function isLoginGateText(text) {
  if (!text || typeof text !== 'string') return false;
  return /^\s*(?:log in|sign in|entrar)\s*$/im.test(text) && !/[0-9]/.test(text);
}

/**
 * Detecta a portaria de login priorizando o DOM (botão visível) em vez de heurística de
 * texto. Só considera páginas da central de moedas e exige ausência do saldo: um link
 * "Log in" no rodapé de uma página autenticada não pode disparar re-login.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function isLoginGateVisible(page) {
  if (!page || typeof page.$ !== 'function') return false;
  let url = '';
  try {
    url = typeof page.url === 'function' ? page.url() : '';
  } catch {
    return false;
  }
  if (!/coin-index|mycoin/i.test(String(url))) return false;

  try {
    const loginButton = await page.$(
      'a:has-text("Log in"), button:has-text("Log in"), a:has-text("Entrar"), button:has-text("Entrar"), button:has-text("Sign in"), a:has-text("Sign in")'
    );
    if (!loginButton) return false;
    const balance = await page.$('text=/My coins|Minhas moedas/i');
    return balance === null;
  } catch {
    return false;
  }
}

module.exports = {
  isLoginPromptText,
  isLoginGateText,
  isLoginGateVisible
};
