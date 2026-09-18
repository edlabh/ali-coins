const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { credentialsEnvPath, getFromFile, maskUser } = require('./config');
const {
  decryptSession,
  encryptSession,
  validateSessionPayload,
  safeWriteFile,
  safeChmod600
} = require('./security');
const { resolveSessionPaths, getEncryptionConfig } = require('./libs/session');
const { flushAndExit } = require('./libs/exit');
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
    } else if (args[i - 1] === '--from-file' || args[i - 1] === '--account') {
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
    // Tokens reais têm ~300 KB; teto e timeout evitam OOM/travamento com pipe infinito
    // (ex: `yes A | node import_session.js`) ou FIFO sem writer.
    const MAX_STDIN_BYTES = 2 * 1024 * 1024;
    const STDIN_IDLE_TIMEOUT_MS = 60000;

    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      let finished = false;
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        process.stdin.removeListener('data', onData);
        process.stdin.removeListener('end', onEnd);
        process.stdin.removeListener('error', onError);
      };
      const fail = (err) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (typeof process.stdin.destroy === 'function') process.stdin.destroy();
        reject(err);
      };
      const resetTimer = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(
          () => fail(new ImportSessionError('Timeout aguardando o token de sessão via STDIN.')),
          STDIN_IDLE_TIMEOUT_MS
        );
      };
      const onData = (chunk) => {
        total += chunk.length;
        if (total > MAX_STDIN_BYTES) {
          fail(
            new ImportSessionError(
              `Token de sessão via STDIN excede o limite de ${MAX_STDIN_BYTES} bytes.`
            )
          );
          return;
        }
        resetTimer();
        chunks.push(chunk);
      };
      const onEnd = () => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve(Buffer.concat(chunks));
      };
      const onError = (err) => fail(err);

      process.stdin.on('data', onData);
      process.stdin.on('end', onEnd);
      process.stdin.on('error', onError);
      resetTimer();
    });
  }

  return null;
}

/**
 * Migra um arquivo session.json legado em texto puro para session.json.enc (AES-256-GCM)
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

  await safeWriteFile(mPath, JSON.stringify(metaData, null, 2), 'utf-8', { durable: false });
  safeChmod600(mPath);

  logger.info(
    `[SUCESSO] Sessão legada "${sPath}" migrada com sucesso para "${encPath}" (AES-256-GCM, 0o600).`
  );
  return {
    user: metaData.user,
    cookiesCount: sessionData.cookies.length,
    migrated: true,
    encrypted: true
  };
}

/**
 * Importa a sessão criptografada (v1 ou v2), descriptografa e salva no arquivo da conta correspondente com 0o600
 * @param {object} [options={}]
 * @param {string} [options.secret]
 * @param {string} [options.fromFile]
 * @param {string} [options.tokenString]
 * @param {string|number} [options.account]
 * @param {boolean} [options.plaintext]
 * @param {boolean} [options.migrateLegacy]
 * @returns {Promise<{ user: string, cookiesCount: number, encrypted: boolean, accountIndex: number, sessionPath: string }>}
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

  const baseDir = options.baseDir || __dirname;
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
  const tokenUser = (validated.meta && validated.meta.user) || 'importado';

  // Roteamento automático multi-conta
  let targetSessionPath = options.sessionPath;
  let targetSessionMetaPath = options.sessionMetaPath;
  let matchedAccount = null;

  const { loadAccounts } = require('./config');
  const accounts = loadAccounts(process.env, baseDir);

  if (options.account) {
    matchedAccount =
      accounts.find((a) => a.index === Number(options.account)) ||
      accounts.find(
        (a) => a.user && a.user.toLowerCase() === String(options.account).trim().toLowerCase()
      );
    if (!matchedAccount) {
      throw new ImportSessionError(
        `Conta "${options.account}" não encontrada nas contas configuradas.`
      );
    }
    if (!targetSessionPath) {
      targetSessionPath = matchedAccount.sessionPath;
      targetSessionMetaPath = matchedAccount.sessionMetaPath;
    }
  } else if (!targetSessionPath) {
    matchedAccount = accounts.find(
      (a) => a.user && a.user.toLowerCase() === tokenUser.toLowerCase()
    );
    if (matchedAccount) {
      targetSessionPath = matchedAccount.sessionPath;
      targetSessionMetaPath = matchedAccount.sessionMetaPath;
    } else if (accounts.length > 1) {
      throw new ImportSessionError(
        `O e-mail do token ("${tokenUser}") não corresponde a nenhuma conta configurada em ` +
          `credentials.env/accounts.json. Use --account="${tokenUser}" explicitamente se essa conta ` +
          `ainda não foi adicionada, ou verifique se o token é o correto.`
      );
    }
  }

  const { sPath, encPath, mPath } = resolveSessionPaths({
    ...options,
    baseDir,
    sessionPath: targetSessionPath,
    sessionMetaPath: targetSessionMetaPath
  });

  const metaData = {
    ...(validated.meta || {}),
    user: tokenUser,
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

  const accountLabel = matchedAccount ? ` (Conta ${matchedAccount.index})` : '';

  if (shouldEncrypt) {
    const encryptedToken = encryptSession(JSON.stringify(sessionData, null, 2), secret);
    await safeWriteFile(encPath, encryptedToken, 'utf-8');
    safeChmod600(encPath);

    // Se existir arquivo legado em texto puro, remover somente após gravação bem-sucedida do .enc
    if (fs.existsSync(sPath)) {
      await fs.promises.unlink(sPath).catch(() => {});
    }

    logger.info(
      `[SUCESSO] Sessão autenticada descriptografada e validada para a conta: "${maskUser(metaData.user)}"${accountLabel}!`
    );
    if (metaData.exportedAt) {
      logger.info(`[SUCESSO] Data de exportação original: ${metaData.exportedAt}`);
    }
    if (metaData.expiresAt) {
      logger.info(`[SUCESSO] Validade estimada da sessão: até ${metaData.expiresAt}`);
    }
    logger.info(
      `[SUCESSO] Arquivo "${path.basename(encPath)}" gravado com permissão 0o600 (${sessionData.cookies.length} cookies, criptografia AES-256-GCM at-rest).`
    );
    logger.info(`[SUCESSO] Arquivo "${path.basename(mPath)}" gravado com permissão 0o600.\n`);
  } else {
    await safeWriteFile(sPath, JSON.stringify(sessionData, null, 2), 'utf-8');
    safeChmod600(sPath);

    // Se existir arquivo .enc anterior e foi solicitado plaintext, remover .enc
    if (fs.existsSync(encPath)) {
      await fs.promises.unlink(encPath).catch(() => {});
    }

    logger.info(
      `[SUCESSO] Sessão autenticada descriptografada e validada para a conta: "${maskUser(metaData.user)}"${accountLabel}!`
    );
    if (metaData.exportedAt) {
      logger.info(`[SUCESSO] Data de exportação original: ${metaData.exportedAt}`);
    }
    if (metaData.expiresAt) {
      logger.info(`[SUCESSO] Validade estimada da sessão: até ${metaData.expiresAt}`);
    }
    logger.info(
      `[SUCESSO] Arquivo "${path.basename(sPath)}" gravado com permissão 0o600 (${sessionData.cookies.length} cookies, opt-out plaintext at-rest).`
    );
    logger.info(`[SUCESSO] Arquivo "${path.basename(mPath)}" gravado com permissão 0o600.\n`);
  }

  // Metadados DEPOIS da sessão: em crash entre as escritas, o par fica sessão-nova +
  // meta-antigo, que `validateSession` rejeita por divergência de conta (re-login seguro).
  await safeWriteFile(mPath, JSON.stringify(metaData, null, 2), 'utf-8', { durable: false });
  safeChmod600(mPath);

  logger.info('Automação pronta para execução com: ./run_all.sh (ou npm start)');
  logger.info('===================================================================');

  return {
    user: metaData.user,
    cookiesCount: sessionData.cookies.length,
    encrypted: shouldEncrypt,
    accountIndex: matchedAccount ? matchedAccount.index : 1,
    sessionPath: shouldEncrypt ? encPath : sPath
  };
}

/**
 * Importa todas as contas encontradas a partir de tokens (session_token*.txt)
 * @param {object} [options={}]
 * @returns {Promise<Array<{ user: string, cookiesCount: number, encrypted: boolean, accountIndex: number, sessionPath: string, tokenFile: string }>>}
 */
async function importAllSessions(options = {}) {
  const baseDir = options.baseDir || __dirname;
  const { loadAccounts } = require('./config');
  const accounts = loadAccounts(process.env, baseDir);
  const imported = [];
  const keepTokens = Boolean(
    options.keepTokens ||
    process.argv.includes('--keep-tokens') ||
    /^(1|true|on)$/i.test(process.env.KEEP_SESSION_TOKENS || '')
  );

  logger.info('===================================================================');
  logger.info('   IMPORTAÇÃO MULTI-CONTA DE SESSÕES ALIEXPRESS');
  logger.info('===================================================================\n');

  const tokenFiles = new Set();
  for (const acc of accounts) {
    const tName = acc.index === 1 ? 'session_token.txt' : `session_token_${acc.index}.txt`;
    const tPath = path.join(baseDir, tName);
    if (fs.existsSync(tPath)) tokenFiles.add(tPath);
    if (acc.index === 1) {
      const alt1 = path.join(baseDir, 'session_token_1.txt');
      if (fs.existsSync(alt1)) tokenFiles.add(alt1);
    }
  }

  try {
    const entries = fs.readdirSync(baseDir);
    for (const entry of entries) {
      if (/^session_token.*\.txt$/i.test(entry)) {
        tokenFiles.add(path.join(baseDir, entry));
      }
    }
  } catch {}

  if (tokenFiles.size === 0) {
    throw new ImportSessionError(
      'Nenhum arquivo de token de sessão ("session_token*.txt") encontrado para importação multi-conta.'
    );
  }

  for (const tPath of tokenFiles) {
    try {
      logger.info(`Processando arquivo de token: ${path.basename(tPath)}...`);
      const res = await importSession({
        ...options,
        baseDir,
        fromFile: tPath,
        sessionPath: undefined,
        sessionMetaPath: undefined
      });
      imported.push({
        ...res,
        tokenFile: path.basename(tPath)
      });

      // Higiene operacional: o token é de uso único; remove após importação bem-sucedida
      if (!keepTokens) {
        try {
          await fs.promises.unlink(tPath);
          logger.info(
            { file: path.basename(tPath) },
            'Token de sessão removido após importação bem-sucedida (use --keep-tokens para preservar).'
          );
        } catch (unlinkErr) {
          logger.warn(
            { file: path.basename(tPath), err: unlinkErr.message },
            'Não foi possível remover o arquivo de token após a importação.'
          );
        }
      }
    } catch (err) {
      logger.error(
        { file: path.basename(tPath), err: err.message },
        'Falha ao importar arquivo de token.'
      );
    }
  }

  if (imported.length > 0) {
    logger.info('===================================================================');
    logger.info(`   IMPORTAÇÃO CONCLUÍDA: ${imported.length} CONTA(S) IMPORTADA(S)`);
    logger.info('===================================================================');
    for (const imp of imported) {
      logger.info(
        ` • [Conta ${imp.accountIndex}] ${maskUser(imp.user)} <- ${imp.tokenFile} (salvo em ${path.basename(imp.sessionPath)})`
      );
    }
    logger.info('===================================================================');
  }

  return imported;
}

if (require.main === module) {
  const { checkAndDisplayHelp, isAll, getAccountArg } = require('./config');
  if (checkAndDisplayHelp()) {
    flushAndExit(0);
    return;
  }

  const allFlag = isAll();
  const accountArg = getAccountArg();

  const runPromise = allFlag ? importAllSessions() : importSession({ account: accountArg });

  runPromise
    .then(() => {
      flushAndExit(0);
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'Falha na importação da sessão.');
      flushAndExit(1);
    });
}

module.exports = {
  importSession,
  importAllSessions,
  migrateLegacySession,
  ImportSessionError,
  readTokenFromInput
};
