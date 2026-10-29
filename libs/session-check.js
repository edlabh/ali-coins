const path = require('path');
const { loadSessionFiles } = require('./session');
const { validateSession } = require('../security');
const { getBalanceDesktop } = require('./ui/balance');
const { maskUser } = require('../config');
const logger = require('../logger');

const SESSION_CHECK_SCHEMA_VERSION = 1;

/**
 * Classifica o resultado de uma checagem somente leitura da sessão.
 *
 * Não confunde "layout mudou" com "sessão expirada": só considera inválida quando há
 * evidência de login gate/prompt ou quando o saldo não pôde ser lido de forma alguma.
 * @param {{sessionValid?: boolean, sessionReason?: string, desktop?: object|null}} [params]
 * @returns {{ok: boolean, reason: string|null, balance: string|null, streak: number|null}}
 */
function classifySessionCheck({ sessionValid = true, sessionReason = '', desktop = null } = {}) {
  if (sessionValid !== true) {
    return {
      ok: false,
      reason: sessionReason || 'Sessão local inválida ou ausente.',
      balance: null,
      streak: null
    };
  }
  if (!desktop || typeof desktop !== 'object') {
    return {
      ok: false,
      reason: 'Não foi possível ler a central de moedas (sem resposta do navegador).',
      balance: null,
      streak: null
    };
  }
  if (desktop.loginPromptDetected === true) {
    return {
      ok: false,
      reason: 'Prompt de login/reautenticação exibido pelo AliExpress.',
      balance: null,
      streak: null
    };
  }

  const balance =
    desktop.totalBalance === undefined || desktop.totalBalance === null
      ? ''
      : String(desktop.totalBalance).trim();
  if (!balance || balance === 'N/D') {
    return {
      ok: false,
      reason: 'Saldo não detectado na central de moedas (layout alterado ou sessão bloqueada).',
      balance: null,
      streak: null
    };
  }

  return {
    ok: true,
    reason: null,
    balance,
    streak: typeof desktop.desktopStreak === 'number' ? desktop.desktopStreak : null
  };
}

/**
 * Executa uma checagem somente leitura de uma conta: valida os arquivos locais e abre a
 * central de moedas no desktop sem clicar em check-in nem executar tarefas.
 * @param {{browser: import('playwright').Browser, account: object, config: object}} params
 * @returns {Promise<{user: string, ok: boolean, reason: string|null, balance: string|null, streak: number|null}>}
 */
async function checkSessionReadOnly({ browser, account, config }) {
  const user = account?.user || '';
  const displayUser = maskUser(user);

  let loaded;
  try {
    loaded = await loadSessionFiles({
      sessionPath: account?.sessionPath,
      sessionMetaPath: account?.sessionMetaPath
    });
  } catch (err) {
    return {
      user: displayUser,
      ...classifySessionCheck({ sessionValid: false, sessionReason: err.message })
    };
  }

  const validation = validateSession(loaded.sessionData, loaded.metaData, user);
  if (!validation.valid) {
    return {
      user: displayUser,
      ...classifySessionCheck({ sessionValid: false, sessionReason: validation.reason })
    };
  }

  let desktop = null;
  try {
    desktop = await getBalanceDesktop(browser, loaded.sessionData, {
      allowMedia: Boolean(config?.ALLOW_MEDIA),
      timeout: config?.NAV_TIMEOUT_SHORT || 20000
    });
  } catch {
    return {
      user: displayUser,
      ...classifySessionCheck({ sessionValid: true, desktop: null })
    };
  }

  return {
    user: displayUser,
    ...classifySessionCheck({ sessionValid: true, desktop })
  };
}

/**
 * CLI de `--check-session`: valida uma ou todas as contas e imprime um resumo PT/EN.
 * Nunca executa check-in, tarefas, notificações ou heartbeat.
 * @param {{allAccounts?: boolean}} [options={}]
 * @returns {Promise<number>} Código de saída (0 = todas válidas; 1 = alguma inválida)
 */
async function runSessionCheckCli({ allAccounts = false } = {}) {
  const { loadConfig, loadAccounts, getAccountArg, isJson } = require('../config');
  const { launchBrowser } = require('../browser');

  const config = loadConfig(true);
  const accounts = loadAccounts(process.env, path.join(__dirname, '..'));
  const requested = getAccountArg();
  let selected = accounts;
  if (requested) {
    selected = accounts.filter(
      (a) =>
        a.index === Number(requested) || a.user.toLowerCase() === String(requested).toLowerCase()
    );
    if (selected.length === 0) {
      logger.error({ account: requested }, 'Conta não encontrada para --check-session.');
      return 1;
    }
  } else if (!allAccounts && accounts.length > 1) {
    selected = [accounts[0]];
  }

  const browser = await launchBrowser();
  const results = [];
  try {
    for (const account of selected) {
      const result = await checkSessionReadOnly({ browser, account, config });
      results.push(result);
      if (result.ok) {
        logger.info(
          {
            account: result.user,
            balance: result.balance,
            streak: result.streak
          },
          'Sessão válida (somente leitura).'
        );
      } else {
        logger.error(
          { account: result.user, reason: result.reason },
          '[Sessão Inválida] A checagem somente leitura falhou.'
        );
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const ok = results.length > 0 && results.every((r) => r.ok);
  if (isJson()) {
    process.stdout.write(
      JSON.stringify(
        {
          type: 'session_check',
          schemaVersion: SESSION_CHECK_SCHEMA_VERSION,
          ok,
          accounts: results
        },
        null,
        2
      ) + '\n'
    );
  } else {
    for (const r of results) {
      const detail = r.ok
        ? `saldo=${r.balance}; streak=${r.streak ?? 'N/D'}`
        : `motivo=${r.reason}`;
      logger.info(`[${r.ok ? 'OK' : 'FALHA'}] ${r.user} — ${detail}`);
    }
  }

  return ok ? 0 : 1;
}

module.exports = {
  SESSION_CHECK_SCHEMA_VERSION,
  classifySessionCheck,
  checkSessionReadOnly,
  runSessionCheckCli
};
