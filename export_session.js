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
  isShowToken
} = require('./config');
const { encryptSession, safeWriteFile, safeChmod600, validateSession } = require('./security');
const logger = require('./logger');

// Carregar variáveis de ambiente do credentials.env de forma silenciosa
if (fs.existsSync(credentialsEnvPath)) {
  dotenv.config({ path: credentialsEnvPath, quiet: true });
}

/**
 * Allowlist de chaves do localStorage essenciais para persistência de sessão.
 * Motivo da substituição da denylist:
 * O AliExpress injeta scripts de telemetria, telemetrias analíticas pesadas (APLUS_S_CORE,
 * Batman, Goldlog, Aegis) que poluem o localStorage com mais de 200KB de cache temporário.
 * A allowlist garante que apenas tokens de autenticação, CSRF tokens, identificadores
 * de conta e preferências essenciais de navegação sejam transferidos no token criptografado.
 */
const ALLOWED_STORAGE_KEY_PATTERNS = [
  /login/i,
  /user/i,
  /account/i,
  /token/i,
  /session/i,
  /auth/i,
  /_m_h5_tk/i,
  /currency/i,
  /locale/i,
  /lang/i
];

function isAllowedStorageKey(keyName) {
  if (!keyName || typeof keyName !== 'string') return false;
  return ALLOWED_STORAGE_KEY_PATTERNS.some((pattern) => pattern.test(keyName));
}

class ExportSessionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExportSessionError';
  }
}

/**
 * Exporta a sessão atual criptografada com AES-256-GCM (formato v2)
 * @param {object} [options={}]
 * @param {string} [options.secret]
 * @returns {Promise<{ token: string, fingerprint: string, user: string }>}
 */
async function exportSession(options = {}) {
  logger.info('===================================================================');
  logger.info('         EXPORTAÇÃO SEGURA DE SESSÃO ALIEXPRESS (AES-256-GCM v2)');
  logger.info('===================================================================');

  const baseDir = options.baseDir;
  const sPath = options.sessionPath || (baseDir ? path.join(baseDir, 'session.json') : sessionPath);
  const mPath =
    options.sessionMetaPath ||
    (baseDir ? path.join(baseDir, 'session_meta.json') : sessionMetaPath);
  const tPath =
    options.sessionTokenPath ||
    (baseDir ? path.join(baseDir, 'session_token.txt') : sessionTokenPath);

  const secret = options.secret || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ExportSessionError(
      'SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres para exportação segura.'
    );
  }

  const { loadSessionFiles } = require('./libs/session');
  const { sessionData: session, metaData: loadedMeta } = await loadSessionFiles({
    ...options,
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

  const validation = validateSession(session, meta, meta.user);
  if (!validation.valid) {
    throw new ExportSessionError(`Sessão inválida para exportação: ${validation.reason}`);
  }

  // Filtragem estrita de localStorage via allowlist
  if (session.origins && Array.isArray(session.origins)) {
    session.origins.forEach((o) => {
      if (o.localStorage && Array.isArray(o.localStorage)) {
        o.localStorage = o.localStorage.filter((i) => isAllowedStorageKey(i.name));
      }
    });
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
  safeChmod600(sPath);
  if (fs.existsSync(mPath)) safeChmod600(mPath);
  safeChmod600(tPath);

  const fingerprint = crypto.createHash('sha256').update(encryptedBlob).digest('hex').slice(0, 16);
  const blobSize = Buffer.byteLength(encryptedBlob, 'utf-8');

  logger.info(`[OK] Sessão autenticada encontrada para a conta: ${meta.user}`);
  logger.info(`[OK] Cookies de autenticação: VÁLIDOS (${session.cookies.length} cookies)`);
  logger.info(`[OK] Data de exportação: ${exportMeta.exportedAt}`);
  logger.info(`[OK] Expiração estimada: até ${exportMeta.expiresAt} (~90 dias)`);
  logger.info(`[OK] Fingerprint do token (SHA-256): ${fingerprint}`);
  logger.info(`[OK] Tamanho do payload criptografado: ${blobSize} bytes`);
  logger.info('[OK] Permissões 0o600 aplicadas em todos os arquivos de sessão');
  logger.info(`[OK] Token criptografado (v2) salvo em: ${path.basename(tPath)}\n`);

  logger.info('--- COMO IMPORTAR NO SEU SERVIDOR NA NUVEM DE FORMA SEGURA ---');
  logger.info('Opção A (Recomendada via STDIN):');
  logger.info('  node import_session.js < session_token.txt\n');
  logger.info('Opção B (Via arquivo):');
  logger.info('  node import_session.js --from-file=session_token.txt\n');

  const showToken = options.showToken !== undefined ? options.showToken : isShowToken();
  if (showToken) {
    logger.warn('⚠️  [AVISO] Exibição de token em tela solicitada via --show-token.');
    process.stdout.write(
      `\n--- TOKEN CRIPTOGRAFADO (v2) ---\n${encryptedBlob}\n--------------------------------\n`
    );
  } else {
    logger.info(
      '(Dica: O token não é exibido no stdout por padrão para segurança contra vazamento em logs. Use --show-token se necessário).'
    );
  }

  logger.info('===================================================================');
  return { token: encryptedBlob, fingerprint, user: meta.user };
}

if (require.main === module) {
  const { checkAndDisplayHelp } = require('./config');
  if (checkAndDisplayHelp()) {
    process.exit(0);
  }

  const args = process.argv.slice(2);
  const isRotate = args.includes('--rotate');

  if (isRotate) {
    const { rotateSessionSecret } = require('./libs/session');
    let newEnvVar = 'SESSION_SECRET_NEW';
    const envArg = args.find((a) => a.startsWith('--new-secret-from-env='));
    if (envArg) {
      newEnvVar = envArg.split('=')[1].trim();
    }
    const newSecret =
      process.env[newEnvVar] ||
      (process.env.SESSION_SECRET_OLD ? process.env.SESSION_SECRET : null);
    const oldSecret = process.env.SESSION_SECRET_OLD || process.env.SESSION_SECRET;

    rotateSessionSecret({ oldSecret, newSecret })
      .then((res) => {
        logger.info(res, '[SUCESSO] Rotação de chave de sessão concluída com sucesso!');
        process.exit(0);
      })
      .catch((err) => {
        logger.error({ err: err.message }, 'Falha na rotação de chave de sessão.');
        process.exit(1);
      });
  } else {
    exportSession()
      .then(() => {
        process.exit(0);
      })
      .catch((err) => {
        logger.error({ err: err.message }, 'Falha na exportação da sessão.');
        process.exit(1);
      });
  }
}

module.exports = {
  exportSession,
  ExportSessionError,
  isAllowedStorageKey,
  ALLOWED_STORAGE_KEY_PATTERNS
};
