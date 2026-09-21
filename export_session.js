const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const {
  sessionPath,
  sessionMetaPath,
  sessionTokenPath,
  credentialsEnvPath,
  isShowToken,
  maskUser
} = require('./config');
const { encryptSession, safeWriteFile, safeChmod600, validateSession } = require('./security');
const { flushAndExit } = require('./libs/exit');
const logger = require('./logger');

// Carregar variáveis de ambiente do credentials.env de forma silenciosa
if (fs.existsSync(credentialsEnvPath)) {
  dotenv.config({ path: credentialsEnvPath, quiet: true });
}

// Allowlist compartilhada com libs/session.js (fonte única em libs/storage_filter.js)
const {
  ALLOWED_STORAGE_KEY_PATTERNS,
  isAllowedStorageKey,
  filterStorageState
} = require('./libs/storage_filter');

class ExportSessionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExportSessionError';
  }
}

/**
 * Exporta a sessão atual criptografada com AES-256-GCM (formato v3)
 * @param {object} [options={}]
 * @param {string} [options.secret]
 * @returns {Promise<{ token: string, fingerprint: string, user: string }>}
 */
async function exportSession(options = {}) {
  logger.info('===================================================================');
  logger.info('         EXPORTAÇÃO SEGURA DE SESSÃO ALIEXPRESS (AES-256-GCM v3)');
  logger.info('===================================================================');

  const baseDir = options.baseDir;
  let sPath = options.sessionPath || (baseDir ? path.join(baseDir, 'session.json') : sessionPath);
  let mPath =
    options.sessionMetaPath ||
    (baseDir ? path.join(baseDir, 'session_meta.json') : sessionMetaPath);
  let tPath =
    options.sessionTokenPath ||
    (baseDir ? path.join(baseDir, 'session_token.txt') : sessionTokenPath);

  // Conta esperada para validação real (meta.user precisa corresponder à conta alvo)
  let expectedUser = options.expectedUser || null;

  if (options.account) {
    const { loadAccounts } = require('./config');
    const accounts = loadAccounts(process.env, baseDir || __dirname);
    const target =
      accounts.find((a) => a.index === Number(options.account)) ||
      accounts.find((a) => a.user === String(options.account).trim());
    if (!target) {
      throw new ExportSessionError(
        `Conta "${options.account}" não encontrada nas contas configuradas.`
      );
    }
    expectedUser = target.user;
    // Caminhos explícitos passados pelo chamador têm precedência sobre os da conta alvo
    if (!options.sessionPath) sPath = target.sessionPath;
    if (!options.sessionMetaPath) mPath = target.sessionMetaPath;
    if (!options.sessionTokenPath) {
      tPath =
        target.index === 1
          ? path.join(baseDir || __dirname, 'session_token.txt')
          : path.join(baseDir || __dirname, `session_token_${target.index}.txt`);
    }
  }

  const secret = options.secret || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ExportSessionError(
      'SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres para exportação segura.'
    );
  }

  const { loadSessionFiles } = require('./libs/session');
  const { sessionData: session, metaData: loadedMeta } = await loadSessionFiles({
    ...options,
    sessionPath: sPath,
    sessionMetaPath: mPath,
    secret,
    autoMigrate: false
  });

  if (!session) {
    throw new ExportSessionError(
      'Arquivo de sessão não encontrado ou inválido. Execute o fluxo primeiro (./run_all.sh) para autenticar.'
    );
  }

  let meta = loadedMeta || { user: 'desconhecido' };
  if (meta.user === 'desconhecido' && process.env.ALI_USER) {
    meta.user = process.env.ALI_USER;
  }

  // Contas comparadas sem diferenciar maiúsculas/minúsculas quando os dois lados são o
  // mesmo identificador (e-mails); caso contrário, valida estritamente contra o alvo.
  const sameAccountIgnoringCase =
    Boolean(expectedUser && meta.user) && expectedUser.toLowerCase() === meta.user.toLowerCase();
  const validationUser = sameAccountIgnoringCase ? meta.user : expectedUser || meta.user;

  const validation = validateSession(session, meta, validationUser);
  if (!validation.valid) {
    throw new ExportSessionError(`Sessão inválida para exportação: ${validation.reason}`);
  }

  // Filtragem estrita de localStorage via allowlist compartilhada (null-safe)
  if (session.origins && Array.isArray(session.origins)) {
    session.origins = filterStorageState(session).origins;
  }

  const now = new Date();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + ninetyDaysMs);

  const exportMeta = {
    user: meta.user,
    exportedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    exportedFrom: os.hostname()
  };

  const payloadString = JSON.stringify({ session, meta: exportMeta });
  const encryptedBlob = encryptSession(payloadString, secret);

  // Salvar token criptografado com permissões restritas 0o600
  await safeWriteFile(tPath, encryptedBlob, 'utf-8');
  // O arquivo realmente LIDO é o .enc (o plaintext sPath normalmente não existe):
  // reforça a permissão dele, que pode ter vindo de backup/tar com modo amplo.
  const encPath = `${sPath}.enc`;
  if (fs.existsSync(encPath)) safeChmod600(encPath);
  if (fs.existsSync(sPath)) safeChmod600(sPath);
  if (fs.existsSync(mPath)) safeChmod600(mPath);
  safeChmod600(tPath);

  const fingerprint = crypto.createHash('sha256').update(encryptedBlob).digest('hex').slice(0, 16);
  const blobSize = Buffer.byteLength(encryptedBlob, 'utf-8');

  logger.info(`[OK] Sessão autenticada encontrada para a conta: ${maskUser(meta.user)}`);
  logger.info(`[OK] Cookies de autenticação: VÁLIDOS (${session.cookies.length} cookies)`);
  logger.info(`[OK] Data de exportação: ${exportMeta.exportedAt}`);
  logger.info(`[OK] Expiração estimada: até ${exportMeta.expiresAt} (~90 dias)`);
  logger.info(`[OK] Fingerprint do token (SHA-256): ${fingerprint}`);
  logger.info(`[OK] Tamanho do payload criptografado: ${blobSize} bytes`);
  logger.info('[OK] Permissões 0o600 aplicadas em todos os arquivos de sessão');
  logger.info(`[OK] Token criptografado (v3) salvo em: ${path.basename(tPath)}\n`);

  logger.info('--- COMO IMPORTAR NO SEU SERVIDOR NA NUVEM DE FORMA SEGURA ---');
  logger.info('Opção A (Recomendada via STDIN):');
  logger.info('  node import_session.js < session_token.txt\n');
  logger.info('Opção B (Via arquivo):');
  logger.info('  node import_session.js --from-file=session_token.txt\n');

  const showToken = options.showToken !== undefined ? options.showToken : isShowToken();
  if (showToken) {
    logger.warn('⚠️  [AVISO] Exibição de token em tela solicitada via --show-token.');
    process.stdout.write(
      `\n--- TOKEN CRIPTOGRAFADO (v3) ---\n${encryptedBlob}\n--------------------------------\n`
    );
  } else {
    logger.info(
      '(Dica: O token não é exibido no stdout por padrão para segurança contra vazamento em logs. Use --show-token se necessário).'
    );
  }

  logger.info('===================================================================');
  return { token: encryptedBlob, fingerprint, user: meta.user };
}

/**
 * Exporta todas as contas configuradas com sessão ativa
 * @param {object} [options={}]
 * @returns {Promise<{ exported: Array<{ index: number, user: string, maskedUser: string, token: string, fingerprint: string, tokenFile: string }>, failed: Array<{ index: number, error: string }> }>}
 */
async function exportAllSessions(options = {}) {
  const { loadAccounts } = require('./config');
  const baseDir = options.baseDir || __dirname;
  const accounts = loadAccounts(process.env, baseDir);
  const exported = [];
  const failed = [];

  logger.info('===================================================================');
  logger.info(`   EXPORTAÇÃO MULTI-CONTA DE SESSÕES ALIEXPRESS (${accounts.length} CONTAS)`);
  logger.info('===================================================================\n');

  for (const acc of accounts) {
    const encPath = `${acc.sessionPath}.enc`;
    const hasSession = fs.existsSync(acc.sessionPath) || fs.existsSync(encPath);
    if (!hasSession) {
      logger.warn(
        `[Conta ${acc.index}/${accounts.length} - ${acc.maskedUser}] Nenhum arquivo de sessão ativo encontrado. Pulando...`
      );
      continue;
    }

    const tPath =
      acc.index === 1
        ? path.join(baseDir, 'session_token.txt')
        : path.join(baseDir, `session_token_${acc.index}.txt`);

    try {
      const res = await exportSession({
        ...options,
        sessionPath: acc.sessionPath,
        sessionMetaPath: acc.sessionMetaPath,
        sessionTokenPath: tPath,
        expectedUser: acc.user,
        showToken: false
      });
      exported.push({
        index: acc.index,
        user: acc.user,
        maskedUser: acc.maskedUser,
        token: res.token,
        fingerprint: res.fingerprint,
        tokenFile: path.basename(tPath)
      });
    } catch (err) {
      failed.push({ index: acc.index, error: err.message });
      logger.error(
        { account: acc.maskedUser, err: err.message },
        `Falha ao exportar sessão da Conta ${acc.index}.`
      );
    }
  }

  if (exported.length > 0) {
    logger.info('===================================================================');
    logger.info(`   EXPORTAÇÃO CONCLUÍDA: ${exported.length} CONTA(S) EXPORTADA(S)`);
    logger.info('===================================================================');
    for (const exp of exported) {
      logger.info(` • [Conta ${exp.index}] ${exp.maskedUser} -> ${exp.tokenFile}`);
    }
    logger.info('\n--- COMO IMPORTAR NO SEU SERVIDOR REMOTO ---');
    logger.info('Opção A (Importar todas as contas no servidor remoto):');
    logger.info('  node import_session.js --all\n');
    logger.info('Opção B (Importar individualmente via STDIN):');
    for (const exp of exported) {
      logger.info(`  node import_session.js < ${exp.tokenFile}`);
    }
    logger.info('===================================================================');
  }

  return { exported, failed };
}

/**
 * Rotaciona a chave de criptografia at-rest de TODAS as contas com sessão em disco.
 * Antes (<= 0.9.5) o `--rotate` girava apenas a conta primária, deixando as sessões
 * secundárias presas à SESSION_SECRET_OLD indefinidamente.
 * @param {object} [options={}]
 * @param {string} [options.baseDir]
 * @param {string} [options.oldSecret]
 * @param {string} [options.newSecret]
 * @returns {Promise<Array<{ success: boolean, skipped?: boolean, user?: string, error?: string, sessionPath: string }>>}
 */
async function rotateAllSessions(options = {}) {
  const { loadAccounts } = require('./config');
  const { rotateSessionSecret } = require('./libs/session');
  const baseDir = options.baseDir || __dirname;
  const accounts = loadAccounts(process.env, baseDir);
  const targets =
    accounts.length > 0
      ? accounts
      : [
          {
            sessionPath: path.join(baseDir, 'session.json'),
            sessionMetaPath: path.join(baseDir, 'session_meta.json'),
            maskedUser: 'conta primária'
          }
        ];

  logger.info('===================================================================');
  logger.info(`   ROTAÇÃO DE CHAVE DE SESSÃO (${targets.length} CONTA(S))`);
  logger.info('===================================================================');

  const results = [];
  for (const acc of targets) {
    const encPath = `${acc.sessionPath}.enc`;
    const hasSession = fs.existsSync(acc.sessionPath) || fs.existsSync(encPath);

    if (!hasSession) {
      logger.warn(`[${acc.maskedUser}] Nenhuma sessão ativa encontrada. Pulando...`);
      results.push({
        success: false,
        skipped: true,
        user: acc.maskedUser,
        sessionPath: acc.sessionPath
      });
      continue;
    }

    try {
      const res = await rotateSessionSecret({
        // baseDir garante que backups de rotação caiam no scratch do diretório alvo,
        // nunca no scratch real do projeto
        baseDir,
        sessionPath: acc.sessionPath,
        sessionMetaPath: acc.sessionMetaPath,
        oldSecret: options.oldSecret,
        newSecret: options.newSecret
      });
      results.push({ ...res, user: maskUser(res.user), sessionPath: acc.sessionPath });
    } catch (err) {
      logger.error(
        { account: acc.maskedUser, err: err.message },
        'Falha ao rotacionar a chave de sessão da conta.'
      );
      results.push({
        success: false,
        error: err.message,
        user: acc.maskedUser,
        sessionPath: acc.sessionPath
      });
    }
  }

  return results;
}

if (require.main === module) {
  const { checkAndDisplayHelp, isAll, getAccountArg, loadAccounts } = require('./config');
  if (checkAndDisplayHelp()) {
    flushAndExit(0);
    return;
  }

  const args = process.argv.slice(2);
  const isRotate = args.includes('--rotate');

  if (isRotate) {
    let newEnvVar = 'SESSION_SECRET_NEW';
    const envArg = args.find((a) => a.startsWith('--new-secret-from-env='));
    if (envArg) {
      newEnvVar = envArg.split('=').slice(1).join('=').trim();
    }
    const newSecret =
      process.env[newEnvVar] ||
      (process.env.SESSION_SECRET_OLD ? process.env.SESSION_SECRET : null);
    const oldSecret = process.env.SESSION_SECRET_OLD || process.env.SESSION_SECRET;

    rotateAllSessions({ oldSecret, newSecret })
      .then((results) => {
        const rotated = results.filter((r) => r.success).length;
        const failed = results.filter((r) => r.success === false && !r.skipped).length;
        if (rotated === 0) {
          logger.error({ results }, 'Nenhuma conta foi rotacionada com sucesso.');
          flushAndExit(1);
          return;
        }
        logger.info(
          { rotated, failed },
          failed > 0
            ? '[PARCIAL] Rotação concluída com falhas em algumas contas.'
            : '[SUCESSO] Rotação de chave concluída para todas as contas.'
        );
        flushAndExit(failed > 0 ? 1 : 0);
      })
      .catch((err) => {
        logger.error({ err: err.message }, 'Falha na rotação de chave de sessão.');
        flushAndExit(1);
      });
  } else {
    const accounts = loadAccounts(process.env, __dirname);
    const accountArg = getAccountArg();
    const allFlag = isAll();

    if (accountArg) {
      exportSession({ account: accountArg })
        .then(() => {
          flushAndExit(0);
        })
        .catch((err) => {
          logger.error({ err: err.message }, 'Falha na exportação da sessão.');
          flushAndExit(1);
        });
    } else if (allFlag || accounts.length > 1) {
      exportAllSessions()
        .then(({ exported, failed }) => {
          if (exported.length === 0) {
            logger.warn('Nenhuma sessão ativa encontrada para exportar.');
            return flushAndExit(1);
          }
          if (failed.length > 0) {
            logger.error(
              { failed: failed.map((f) => f.index) },
              'Exportação parcial: algumas contas não foram exportadas.'
            );
            return flushAndExit(1);
          }
          return flushAndExit(0);
        })
        .catch((err) => {
          logger.error({ err: err.message }, 'Falha na exportação multi-conta.');
          flushAndExit(1);
        });
    } else {
      exportSession()
        .then(() => {
          flushAndExit(0);
        })
        .catch((err) => {
          logger.error({ err: err.message }, 'Falha na exportação da sessão.');
          flushAndExit(1);
        });
    }
  }
}

module.exports = {
  exportSession,
  exportAllSessions,
  rotateAllSessions,
  ExportSessionError,
  isAllowedStorageKey,
  ALLOWED_STORAGE_KEY_PATTERNS
};
