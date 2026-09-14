const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { sessionPath, sessionMetaPath, credentialsEnvPath, getFromFile } = require('./config');
const {
  decryptSession,
  validateSessionPayload,
  safeWriteFile,
  safeChmod600
} = require('./security');
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
 * Importa a sessão criptografada (v1 ou v2), descriptografa e salva em session.json com 0o600
 * @param {object} [options={}]
 * @param {string} [options.secret]
 * @param {string} [options.fromFile]
 * @param {string} [options.tokenString]
 * @returns {Promise<{ user: string, cookiesCount: number }>}
 */
async function importSession(options = {}) {
  logger.info('===================================================================');
  logger.info('         IMPORTAÇÃO SEGURA DE SESSÃO ALIEXPRESS (AES-256-GCM)');
  logger.info('===================================================================');

  const secret = options.secret || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ImportSessionError(
      'SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres para descriptografia segura.'
    );
  }

  let rawTokenBuffer = null;
  if (options.tokenString) {
    rawTokenBuffer = Buffer.from(options.tokenString.trim(), 'utf-8');
  } else {
    rawTokenBuffer = await readTokenFromInput(options.fromFile);
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
  const metaData = validated.meta || { user: 'importado', savedAt: new Date().toISOString() };

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

  const baseDir = options.baseDir;
  const sPath =
    options.sessionPath || (baseDir ? path.join(baseDir, 'session.json') : sessionPath);
  const mPath =
    options.sessionMetaPath ||
    (baseDir ? path.join(baseDir, 'session_meta.json') : sessionMetaPath);

  await safeWriteFile(sPath, JSON.stringify(sessionData, null, 2), 'utf-8');
  await safeWriteFile(mPath, JSON.stringify(metaData, null, 2), 'utf-8');
  safeChmod600(sPath);
  safeChmod600(mPath);

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
    `[SUCESSO] Arquivo "session.json" gravado com permissão 0o600 (${sessionData.cookies.length} cookies).`
  );
  logger.info('[SUCESSO] Arquivo "session_meta.json" gravado com permissão 0o600.\n');
  logger.info('Automação pronta para execução com: ./run_all.sh (ou npm start)');
  logger.info('===================================================================');

  return { user: metaData.user, cookiesCount: sessionData.cookies.length };
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
  ImportSessionError,
  readTokenFromInput
};
