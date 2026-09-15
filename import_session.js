const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { credentialsEnvPath, getFromFile } = require('./config');
const {
  decryptSession,
  encryptSession,
  validateSessionPayload,
  safeWriteFile,
  safeChmod600
} = require('./security');
const { resolveSessionPaths, getEncryptionConfig } = require('./libs/session');
const logger = require('./logger');

// Carregar variáveis de ambiente do credentials.env de forma silenciosa
if (fs.existsSync(credentialsEnvPath)) {
  dotenv.config({ path: credentialsEnvPath, quiet: true });
}

class ImportSessionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportSessionError';
  }
}

async function readTokenFromInput(customFilePath = null) {
  const args = process.argv.slice(2);
  let filePath = customFilePath || getFromFile();

  // 1. Detectar e alertar caso alguém tente passar token via argv direto
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--from-file=') || arg === '--from-file') {
      continue;
    } else if (arg.startsWith('-')) {
      continue;
    } else if (args[i - 1] === '--from-file') {
      continue;
    } else {
      logger.warn(
        { arg: '[REDACTED]' },
        'Argumento posicional detectado no argv foi ignorado por segurança. Não passe tokens sensíveis na linha de comando.'
      );
    }
  }

  // 2. Leitura via arquivo com flag explícita --from-file
  if (filePath) {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new ImportSessionError(
        `Arquivo especificado em --from-file não encontrado: "${resolvedPath}"`
      );
    }
    const content = await fs.promises.readFile(resolvedPath, 'utf-8');
    return Buffer.from(content.trim(), 'utf-8');
  }

  // 3. Leitura via STDIN (pipe ou redirecionamento <)
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      process.stdin.on('data', (chunk) => chunks.push(chunk));
      process.stdin.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        resolve(fullBuffer);
      });
      process.stdin.on('error', reject);
    });
  }

  return null;
}

/**
 * Migra um arquivo session.json legado em texto puro para session.json.enc (AES-256-GCM v2)
 * @param {object} [options={}]
 * @returns {Promise<{ user: string, cookiesCount: number, migrated: boolean, encrypted: boolean }>}
 */
async function migrateLegacySession(options = {}) {
  const { sPath, encPath, mPath } = resolveSessionPaths(options);
  const secret = options.secret !== undefined ? options.secret : process.env.SESSION_SECRET;
  if (!secret || typeof secret !== 'string' || secret.length < 32) {
    throw new ImportSessionError(
      'SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres para migração segura.'
    );
  }

  if (!fs.existsSync(sPath)) {
    throw new ImportSessionError(`Arquivo legado session.json não encontrado em: "${sPath}"`);
  }

  let sessionData;
  try {
    const rawContent = await fs.promises.readFile(sPath, 'utf-8');
    const parsed = JSON.parse(rawContent);
    const validated = validateSessionPayload(parsed.cookies ? { session: parsed } : parsed);
    sessionData = validated.session;
  } catch (err) {
    throw new ImportSessionError(`Conteúdo do session.json legado é inválido: ${err.message}`);
  }

  let metaData = { user: 'legado' };
  if (fs.existsSync(mPath)) {
    try {
      const existing = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
      metaData = { ...metaData, ...existing };
    } catch {}
  }
  metaData.migratedAt = new Date().toISOString();
  metaData.encrypted = true;
  metaData.savedAt = new Date().toISOString();

  const encrypted = encryptSession(JSON.stringify(sessionData, null, 2), secret);
  await safeWriteFile(encPath, encrypted, 'utf-8');
  safeChmod600(encPath);

  // Remover o arquivo em texto claro SOMENTE após gravar e proteger o .enc
  await fs.promises.unlink(sPath).catch(() => {});

  await safeWriteFile(mPath, JSON.stringify(metaData, null, 2), 'utf-8');
  safeChmod600(mPath);

  logger.info(
    `[SUCESSO] Sessão legada "${sPath}" migrada com sucesso para "${encPath}" (AES-256-GCM v2, 0o600).`
  );
  return {
    user: metaData.user,
    cookiesCount: sessionData.cookies.length,
    migrated: true,
    encrypted: true
  };
}

/**
 * Importa a sessão criptografada (v1 ou v2), descriptografa e salva em session.json.enc (ou session.json se --plaintext) com 0o600
 * @param {object} [options={}]
 * @param {string} [options.secret]
 * @param {string} [options.fromFile]
 * @param {string} [options.tokenString]
 * @param {boolean} [options.plaintext]
 * @param {boolean} [options.migrateLegacy]
 * @returns {Promise<{ user: string, cookiesCount: number, encrypted: boolean }>}
 */
async function importSession(options = {}) {
  logger.info('===================================================================');
  logger.info('         IMPORTAÇÃO SEGURA DE SESSÃO ALIEXPRESS (AES-256-GCM)');
  logger.info('===================================================================');

  const secret = options.secret !== undefined ? options.secret : process.env.SESSION_SECRET;
  if (!secret || typeof secret !== 'string' || secret.length < 32) {
    throw new ImportSessionError(
      'SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres para descriptografia segura.'
    );
  }

  const { sPath, encPath, mPath } = resolveSessionPaths(options);
  const encConfig = getEncryptionConfig(options);
  const isPlaintextOptOut = Boolean(
    options.plaintext ||
    options.plainText ||
    options.encryptLocalSession === false ||
    process.argv.includes('--plaintext')
  );
  const shouldEncrypt = Boolean(encConfig.shouldEncrypt && !isPlaintextOptOut);

  let rawTokenBuffer = null;
  if (options.tokenString) {
    rawTokenBuffer = Buffer.from(options.tokenString.trim(), 'utf-8');
  } else {
    rawTokenBuffer = await readTokenFromInput(options.fromFile);
  }

  if (
    (!rawTokenBuffer || rawTokenBuffer.length === 0) &&
    (options.migrateLegacy || process.argv.includes('--migrate'))
  ) {
    return migrateLegacySession(options);
  }

  if (!rawTokenBuffer || rawTokenBuffer.length === 0) {
    throw new ImportSessionError(
      'Nenhum token de sessão fornecido via STDIN ou --from-file. Use: node import_session.js < session_token.txt'
    );
  }

  const tokenString = rawTokenBuffer.toString('utf-8').trim();

  let decryptedJson;
  try {
    decryptedJson = decryptSession(tokenString, secret);
  } catch (err) {
    throw new ImportSessionError(`Erro ao descriptografar token de sessão: ${err.message}`);
  } finally {
    rawTokenBuffer.fill(0);
  }

  let parsedPayload;
  try {
    parsedPayload = JSON.parse(decryptedJson);
  } catch (err) {
    throw new ImportSessionError(`Conteúdo descriptografado não é um JSON válido: ${err.message}`);
  }

  const validated = validateSessionPayload(parsedPayload);
  const sessionData = validated.session;
  const metaData = {
    ...(validated.meta || {}),
    user: (validated.meta && validated.meta.user) || 'importado',
    isImported: true,
    importedAt: new Date().toISOString(),
    savedAt: new Date().toISOString(),
    encrypted: shouldEncrypt
  };

  if (metaData.exportedAt) {
    const exportedTime = new Date(metaData.exportedAt).getTime();
    if (!isNaN(exportedTime)) {
      const ageDays = (Date.now() - exportedTime) / (1000 * 60 * 60 * 24);
      if (ageDays > 90) {
        logger.warn(
          { ageDays: Math.floor(ageDays) },
          'A sessão importada foi exportada há mais de 90 dias. Os cookies podem estar próximos da expiração.'
        );
      }
    }
  }

  if (shouldEncrypt) {
    const encryptedToken = encryptSession(JSON.stringify(sessionData, null, 2), secret);
    await safeWriteFile(encPath, encryptedToken, 'utf-8');
    safeChmod600(encPath);

    // Se existir session.json legado em texto puro, remover somente após gravação bem-sucedida do .enc
    if (fs.existsSync(sPath)) {
      await fs.promises.unlink(sPath).catch(() => {});
    }

    logger.info(
      `[SUCESSO] Sessão autenticada descriptografada e validada para a conta: "${metaData.user}"!`
    );
    if (metaData.exportedAt) {
      logger.info(`[SUCESSO] Data de exportação original: ${metaData.exportedAt}`);
    }
    if (metaData.expiresAt) {
      logger.info(`[SUCESSO] Validade estimada da sessão: até ${metaData.expiresAt}`);
    }
    logger.info(
      `[SUCESSO] Arquivo "session.json.enc" gravado com permissão 0o600 (${sessionData.cookies.length} cookies, criptografia AES-256-GCM v2 at-rest).`
    );
    logger.info('[SUCESSO] Arquivo "session_meta.json" gravado com permissão 0o600.\n');
  } else {
    await safeWriteFile(sPath, JSON.stringify(sessionData, null, 2), 'utf-8');
    safeChmod600(sPath);

    // Se existir session.json.enc anterior e foi solicitado plaintext, remover .enc
    if (fs.existsSync(encPath)) {
      await fs.promises.unlink(encPath).catch(() => {});
    }

    logger.info(
      `[SUCESSO] Sessão autenticada descriptografada e validada para a conta: "${metaData.user}"!`
    );
    if (metaData.exportedAt) {
      logger.info(`[SUCESSO] Data de exportação original: ${metaData.exportedAt}`);
    }
    if (metaData.expiresAt) {
      logger.info(`[SUCESSO] Validade estimada da sessão: até ${metaData.expiresAt}`);
    }
    logger.info(
      `[SUCESSO] Arquivo "session.json" gravado com permissão 0o600 (${sessionData.cookies.length} cookies, opt-out plaintext at-rest).`
    );
    logger.info('[SUCESSO] Arquivo "session_meta.json" gravado com permissão 0o600.\n');
  }

  await safeWriteFile(mPath, JSON.stringify(metaData, null, 2), 'utf-8');
  safeChmod600(mPath);

  logger.info('Automação pronta para execução com: ./run_all.sh (ou npm start)');
  logger.info('===================================================================');

  return {
    user: metaData.user,
    cookiesCount: sessionData.cookies.length,
    encrypted: shouldEncrypt
  };
}

if (require.main === module) {
  const { checkAndDisplayHelp } = require('./config');
  if (checkAndDisplayHelp()) {
    process.exit(0);
  }
  importSession()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'Falha na importação da sessão.');
      process.exit(1);
    });
}

module.exports = {
  importSession,
  migrateLegacySession,
  ImportSessionError,
  readTokenFromInput
};
