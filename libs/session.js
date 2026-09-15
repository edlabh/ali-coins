const fs = require('fs');
const path = require('path');
const {
  sessionPath: defaultSessionPath,
  sessionMetaPath: defaultSessionMetaPath,
  scratchDir: defaultScratchDir
} = require('../config');
const {
  validateSession,
  safeWriteFile,
  safeChmod600,
  encryptSession,
  decryptSession
} = require('../security');
const logger = require('../logger');

/**
 * Resolve os caminhos dos arquivos de sessão com suporte a injeção via options/baseDir
 * @param {object} [options={}]
 * @returns {{ sPath: string, encPath: string, mPath: string, scratchDir: string }}
 */
function resolveSessionPaths(options = {}) {
  const baseDir = options.baseDir;
  let sPath =
    options.sessionPath || (baseDir ? path.join(baseDir, 'session.json') : defaultSessionPath);
  let mPath =
    options.sessionMetaPath ||
    (baseDir ? path.join(baseDir, 'session_meta.json') : defaultSessionMetaPath);
  const targetScratchDir =
    options.scratchDir || (baseDir ? path.join(baseDir, 'scratch') : defaultScratchDir);

  const encPath = sPath.endsWith('.enc') ? sPath : `${sPath}.enc`;
  const plainPath = sPath.endsWith('.enc') ? sPath.slice(0, -4) : sPath;

  return { sPath: plainPath, encPath, mPath, scratchDir: targetScratchDir };
}

/**
 * Determina parâmetros de criptografia at-rest a partir de options ou env
 * @param {object} [options={}]
 * @returns {{ secret: string|null, oldSecret: string|null, shouldEncrypt: boolean }}
 */
function getEncryptionConfig(options = {}) {
  const secret = options.secret || process.env.SESSION_SECRET || null;
  const oldSecret = options.oldSecret || process.env.SESSION_SECRET_OLD || null;

  let encryptLocal = true;
  if (options.encryptLocalSession !== undefined) {
    encryptLocal = Boolean(options.encryptLocalSession);
  } else if (process.env.ENCRYPT_LOCAL_SESSION !== undefined) {
    const v = String(process.env.ENCRYPT_LOCAL_SESSION).toLowerCase();
    encryptLocal = v !== 'false' && v !== '0';
  }

  const shouldEncrypt = Boolean(
    secret && typeof secret === 'string' && secret.length >= 32 && encryptLocal
  );
  return { secret, oldSecret, shouldEncrypt };
}

/**
 * Carrega de forma segura os arquivos de sessão e metadados se existirem
 * Suporta leitura transparente de .enc (AES-256-GCM v2) com fallback para .json legado,
 * migração automática para formato criptografado e rotação de chave via SESSION_SECRET_OLD.
 * @param {object} [options={}]
 * @returns {Promise<{ sessionData: object|null, metaData: object|null }>}
 */
async function loadSessionFiles(options = {}) {
  const { sPath, encPath, mPath } = resolveSessionPaths(options);
  const { secret, oldSecret, shouldEncrypt } = getEncryptionConfig(options);
  let sessionData = null;
  let metaData = null;

  // 1. Tentar ler arquivo criptografado .enc se existir
  if (fs.existsSync(encPath)) {
    try {
      const encryptedContent = await fs.promises.readFile(encPath, 'utf-8');
      if (secret && secret.length >= 32) {
        try {
          const decrypted = decryptSession(encryptedContent, secret);
          sessionData = JSON.parse(decrypted);
        } catch (decryptErr) {
          // Se falhou com a chave atual e há chave antiga (rotação), tenta SESSION_SECRET_OLD
          if (oldSecret && oldSecret.length >= 32) {
            try {
              const decryptedOld = decryptSession(encryptedContent, oldSecret);
              sessionData = JSON.parse(decryptedOld);
              logger.info(
                'Sessão descriptografada com SESSION_SECRET_OLD (rotação detectada). Re-criptografando com a nova chave...'
              );
              // Re-criptografa transparentemente com a chave atual
              const reEncrypted = encryptSession(JSON.stringify(sessionData, null, 2), secret);
              await safeWriteFile(encPath, reEncrypted, 'utf-8');
              safeChmod600(encPath);
            } catch {
              logger.warn(
                'Falha ao descriptografar sessão com SESSION_SECRET_OLD durante rotação de chaves.'
              );
            }
          } else {
            logger.warn(
              { err: decryptErr.message },
              'Falha ao descriptografar session.json.enc com SESSION_SECRET atual.'
            );
          }
        }
      } else {
        logger.warn(
          'Arquivo session.json.enc detectado mas SESSION_SECRET não configurado (ou < 32 chars). Não é possível descriptografar.'
        );
      }
    } catch {
      logger.warn('Arquivo session.json.enc corrompido ou ilegível. Removendo...');
      await fs.promises.unlink(encPath).catch(() => {});
    }
  }

  // 2. Fallback: ler arquivo legado em texto plano (session.json)
  if (!sessionData && fs.existsSync(sPath)) {
    try {
      const content = await fs.promises.readFile(sPath, 'utf-8');
      sessionData = JSON.parse(content);

      // Se criptografia está habilitada e autoMigrate permitida, migrar para .enc
      const autoMigrate = options.autoMigrate !== false;
      if (shouldEncrypt && sessionData && autoMigrate) {
        logger.info(
          'Migrando sessão legada em texto claro (session.json) para formato criptografado at-rest (session.json.enc)...'
        );
        const encrypted = encryptSession(JSON.stringify(sessionData, null, 2), secret);
        await safeWriteFile(encPath, encrypted, 'utf-8');
        safeChmod600(encPath);
        // Remover o arquivo em texto puro após migração segura
        await fs.promises.unlink(sPath).catch(() => {});
      }
    } catch {
      logger.warn('Arquivo session.json corrompido ou inválido. Removendo...');
      await fs.promises.unlink(sPath).catch(() => {});
    }
  }

  // 3. Ler metadados
  if (fs.existsSync(mPath)) {
    try {
      const content = await fs.promises.readFile(mPath, 'utf-8');
      metaData = JSON.parse(content);
    } catch {
      logger.warn('Arquivo session_meta.json corrompido ou inválido. Removendo...');
      await fs.promises.unlink(mPath).catch(() => {});
    }
  }

  return { sessionData, metaData };
}

/**
 * Remove os arquivos de sessão do disco criando antes um backup versionado em scratch/
 * @param {object} [options={}]
 * @returns {Promise<void>}
 */
async function clearSession(options = {}) {
  const { sPath, encPath, mPath, scratchDir: targetScratchDir } = resolveSessionPaths(options);
  const { secret } = getEncryptionConfig(options);

  // Backup versionado antes de remover se houver sessão
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (fs.existsSync(encPath)) {
      await fs.promises.mkdir(targetScratchDir, { recursive: true });
      const bakPath = path.join(targetScratchDir, `session.bak-${timestamp}.json.enc`);
      const data = await fs.promises.readFile(encPath, 'utf-8');
      await safeWriteFile(bakPath, data, 'utf-8');
      safeChmod600(bakPath);
      logger.info({ backup: bakPath }, 'Backup versionado da sessão (.enc) criado com sucesso.');
    } else if (fs.existsSync(sPath)) {
      await fs.promises.mkdir(targetScratchDir, { recursive: true });
      const raw = await fs.promises.readFile(sPath, 'utf-8');
      if (secret && secret.length >= 32) {
        const bakPath = path.join(targetScratchDir, `session.bak-${timestamp}.json.enc`);
        const encData = encryptSession(raw, secret);
        await safeWriteFile(bakPath, encData, 'utf-8');
        safeChmod600(bakPath);
        logger.info({ backup: bakPath }, 'Backup versionado da sessão (.enc) criado com sucesso.');
      } else {
        const bakPath = path.join(targetScratchDir, `session.bak-${timestamp}.json`);
        await safeWriteFile(bakPath, raw, 'utf-8');
        safeChmod600(bakPath);
        logger.info({ backup: bakPath }, 'Backup versionado da sessão (.json) criado com sucesso.');
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Aviso: falha ao criar backup versionado da sessão.');
  }

  await fs.promises.unlink(encPath).catch(() => {});
  await fs.promises.unlink(sPath).catch(() => {});
  await fs.promises.unlink(mPath).catch(() => {});

  // Limpeza de backups antigos segundo retenção
  await pruneSessionBackups(options).catch(() => {});
}

/**
 * Verifica se os metadados indicam que a sessão foi importada de outro host
 * @param {object} metaData
 * @returns {boolean}
 */
function isImportedSession(metaData) {
  if (!metaData) return false;
  return Boolean(metaData.isImported || metaData.importedAt);
}

/**
 * Valida a sessão em cache contra a conta configurada e a validade dos cookies.
 * Remove os arquivos caso a sessão esteja expirada ou pertença a outra conta.
 * @param {string} userEmail
 * @param {object} [existingSessionData=null]
 * @param {object} [options={}]
 * @returns {Promise<{ valid: boolean, reason?: string, sessionData: object|null, metaData: object|null, isImported: boolean }>}
 */
async function validateAndRefresh(userEmail, existingSessionData = null, options = {}) {
  let { sessionData, metaData } = await loadSessionFiles(options);
  if (existingSessionData) {
    sessionData = existingSessionData;
  }

  const wasImported = isImportedSession(metaData);

  if (!sessionData) {
    return {
      valid: false,
      reason: 'Nenhuma sessão ativa encontrada em disco.',
      sessionData: null,
      metaData: null,
      isImported: wasImported,
      previousMeta: metaData
    };
  }

  const validation = validateSession(sessionData, metaData, userEmail);
  if (!validation.valid) {
    logger.info({ reason: validation.reason }, 'Sessão anterior inválida ou expirada. Limpando...');
    if (wasImported) {
      logger.warn(
        '[Sessão Remota Expirada] A sessão foi importada de outro host (via import_session.js) e está expirada ou inválida. ' +
          'Gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".'
      );
    }
    const prevMeta = metaData;
    await clearSession(options);
    return {
      valid: false,
      reason: validation.reason,
      sessionData: null,
      metaData: null,
      isImported: wasImported,
      previousMeta: prevMeta
    };
  }

  return {
    valid: true,
    sessionData,
    metaData,
    isImported: wasImported
  };
}

/**
 * Salva a sessão autenticada e metadados no disco com permissão 0o600
 * Salva em formato criptografado (.enc) se SESSION_SECRET presente e ENCRYPT_LOCAL_SESSION!=false
 * @param {object} storageState Objeto de storage state retornado pelo context.storageState()
 * @param {string} user Identificador da conta (e-mail ou telefone)
 * @param {object} [options={}]
 * @returns {Promise<{ sessionData: object, metaData: object }>}
 */
async function saveSession(storageState, user, options = {}) {
  if (!storageState || !Array.isArray(storageState.cookies)) {
    return null;
  }

  const hasAuth = storageState.cookies.some(
    (c) => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && Boolean(c.value)
  );

  if (!hasAuth) {
    logger.debug('Ignorando tentativa de salvar storageState sem cookies de autenticação válidos.');
    return null;
  }

  const { sPath, encPath, mPath } = resolveSessionPaths(options);
  const { secret, shouldEncrypt } = getEncryptionConfig(options);

  let prevMeta = {};
  if (fs.existsSync(mPath)) {
    try {
      prevMeta = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
    } catch {
      // Ignorar
    }
  }

  const metaData = {
    ...prevMeta,
    user,
    savedAt: new Date().toISOString(),
    encrypted: shouldEncrypt
  };

  if (
    options.streakDays !== undefined &&
    options.streakDays !== null &&
    options.streakDays !== 'N/D'
  ) {
    const num =
      typeof options.streakDays === 'number'
        ? options.streakDays
        : parseInt(String(options.streakDays).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(num) && num >= 0) {
      metaData.lastStreakDays = num;
      metaData.lastCheckinDate = new Date().toISOString();
    }
  }

  const payloadStr = JSON.stringify(storageState, null, 2);

  if (shouldEncrypt) {
    const encryptedToken = encryptSession(payloadStr, secret);
    await safeWriteFile(encPath, encryptedToken, 'utf-8');
    safeChmod600(encPath);
    // Remove o arquivo legado sem criptografia se ainda existir
    if (fs.existsSync(sPath)) {
      await fs.promises.unlink(sPath).catch(() => {});
    }
    logger.info(
      { user },
      'Sessão autenticada criptografada at-rest salva com sucesso (.enc, 0o600).'
    );
  } else {
    await safeWriteFile(sPath, payloadStr, 'utf-8');
    safeChmod600(sPath);
    // Remove o .enc caso o usuário tenha desativado a criptografia
    if (fs.existsSync(encPath)) {
      await fs.promises.unlink(encPath).catch(() => {});
    }
    logger.info({ user }, 'Sessão autenticada e metadados salvos com sucesso (permissão 0o600).');
  }

  await safeWriteFile(mPath, JSON.stringify(metaData, null, 2), 'utf-8');
  safeChmod600(mPath);

  // Limpeza de backups antigos segundo retenção
  await pruneSessionBackups(options).catch(() => {});

  return { sessionData: storageState, metaData };
}

/**
 * Atualiza lastStreakDays e lastCheckinDate em session_meta.json de forma segura (0o600)
 * @param {number|string} streakDays Quantidade de dias da sequência
 * @param {object} [options={}] Opções de caminho de sessão
 * @returns {Promise<object|null>} Metadados atualizados ou null
 */
async function updateSessionStreak(streakDays, options = {}) {
  const { mPath } = resolveSessionPaths(options);
  if (!fs.existsSync(mPath)) return null;

  try {
    const raw = await fs.promises.readFile(mPath, 'utf-8');
    const meta = JSON.parse(raw);
    const num =
      typeof streakDays === 'number'
        ? streakDays
        : parseInt(String(streakDays).replace(/[^0-9]/g, ''), 10);

    if (!isNaN(num) && num >= 0) {
      meta.lastStreakDays = num;
      meta.lastCheckinDate = new Date().toISOString();
      await safeWriteFile(mPath, JSON.stringify(meta, null, 2), 'utf-8');
      safeChmod600(mPath);
      return meta;
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Aviso ao persistir streak em session_meta.json');
  }
  return null;
}

/**
 * Remove backups antigos em scratch/session.bak-* com base na política de retenção
 * @param {object} [options={}]
 * @param {number} [options.retentionDays=7] Número de dias de retenção (default: 7 ou SESSION_BACKUP_RETENTION_DAYS)
 * @param {boolean} [options.dryRun=false] Se true, não remove fisicamente os arquivos
 * @param {string} [options.scratchDir] Diretório de backups
 * @returns {Promise<Array<string>>} Lista de caminhos de arquivos removidos (ou que seriam)
 */
async function pruneSessionBackups(options = {}) {
  const { scratchDir: defaultScratchDir } = resolveSessionPaths(options);
  const targetScratchDir = options.scratchDir || defaultScratchDir;
  const envDays = Number(process.env.SESSION_BACKUP_RETENTION_DAYS);
  const retentionDays =
    typeof options.retentionDays === 'number'
      ? options.retentionDays
      : !isNaN(envDays) && envDays > 0
        ? envDays
        : 7;
  const dryRun = Boolean(options.dryRun);

  const pruned = [];
  if (!fs.existsSync(targetScratchDir)) {
    return pruned;
  }

  try {
    const files = await fs.promises.readdir(targetScratchDir);
    const now = Date.now();
    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (
        file.startsWith('session.bak-') &&
        (file.endsWith('.json.enc') || file.endsWith('.json'))
      ) {
        const fullPath = path.join(targetScratchDir, file);
        try {
          const stat = await fs.promises.stat(fullPath);
          const ageMs = now - stat.mtimeMs;
          if (ageMs > maxAgeMs) {
            if (dryRun) {
              logger.info(
                { file: fullPath, ageDays: (ageMs / (1000 * 60 * 60 * 24)).toFixed(1) },
                '[DRY-RUN] Backup antigo de sessão seria removido.'
              );
              pruned.push(fullPath);
            } else {
              await fs.promises.unlink(fullPath);
              logger.info(
                { file: fullPath },
                'Backup antigo de sessão removido pela política de retenção.'
              );
              pruned.push(fullPath);
            }
          }
        } catch {
          // Ignora erro em arquivo individual
        }
      }
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Falha ao inspecionar diretório para limpeza de backups.');
  }

  return pruned;
}

/**
 * Rotaciona a chave de criptografia at-rest de session.json.enc
 * @param {object} [options={}]
 * @param {string} [options.oldSecret] Chave antiga (ou SESSION_SECRET_OLD)
 * @param {string} [options.newSecret] Nova chave (ou SESSION_SECRET_NEW / SESSION_SECRET)
 * @returns {Promise<{ success: boolean, user: string, backupPath: string }>}
 */
async function rotateSessionSecret(options = {}) {
  const { encPath, sPath, mPath, scratchDir: targetScratchDir } = resolveSessionPaths(options);

  const oldSecret =
    options.oldSecret || process.env.SESSION_SECRET_OLD || options.currentSecret || null;
  const newSecret =
    options.newSecret ||
    process.env.SESSION_SECRET_NEW ||
    (process.env.SESSION_SECRET_OLD ? process.env.SESSION_SECRET : null);

  if (!oldSecret || typeof oldSecret !== 'string' || oldSecret.length < 32) {
    throw new Error(
      'SESSION_SECRET_OLD é obrigatório e deve ter no mínimo 32 caracteres para descriptografar a sessão atual durante a rotação.'
    );
  }

  if (!newSecret || typeof newSecret !== 'string' || newSecret.length < 32) {
    throw new Error(
      'SESSION_SECRET_NEW (ou nova SESSION_SECRET) é obrigatório e deve ter no mínimo 32 caracteres para re-criptografar a sessão.'
    );
  }

  if (oldSecret === newSecret) {
    throw new Error(
      'A nova chave de sessão deve ser diferente da chave atual para efetuar a rotação.'
    );
  }

  let sessionData = null;
  let rawJson = null;

  if (fs.existsSync(encPath)) {
    try {
      const encryptedContent = await fs.promises.readFile(encPath, 'utf-8');
      rawJson = decryptSession(encryptedContent, oldSecret);
      sessionData = JSON.parse(rawJson);
    } catch (err) {
      throw new Error(
        `Falha ao descriptografar session.json.enc com SESSION_SECRET_OLD: ${err.message}`
      );
    }
  } else if (fs.existsSync(sPath)) {
    try {
      rawJson = await fs.promises.readFile(sPath, 'utf-8');
      sessionData = JSON.parse(rawJson);
    } catch (err) {
      throw new Error(`Falha ao ler session.json legado: ${err.message}`);
    }
  } else {
    throw new Error(
      'Nenhum arquivo de sessão existente (session.json ou session.json.enc) encontrado para rotação.'
    );
  }

  if (!sessionData || !Array.isArray(sessionData.cookies)) {
    throw new Error('Estrutura de sessão inválida: array de cookies ausente.');
  }

  // Criar backup versionado antes da re-criptografia
  await fs.promises.mkdir(targetScratchDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(targetScratchDir, `session.bak-${timestamp}.json.enc`);
  const oldEncrypted = encryptSession(rawJson, oldSecret);
  await safeWriteFile(backupPath, oldEncrypted, 'utf-8');
  safeChmod600(backupPath);

  // Criptografar com a nova chave e validar roundtrip
  const newEncrypted = encryptSession(JSON.stringify(sessionData, null, 2), newSecret);
  try {
    const verifiedJson = decryptSession(newEncrypted, newSecret);
    const parsed = JSON.parse(verifiedJson);
    if (!parsed || !Array.isArray(parsed.cookies)) {
      throw new Error('Verificação roundtrip falhou: cookies inválidos.');
    }
  } catch (verifyErr) {
    throw new Error(
      `Falha na validação roundtrip pós-criptografia com nova chave: ${verifyErr.message}`
    );
  }

  await safeWriteFile(encPath, newEncrypted, 'utf-8');
  safeChmod600(encPath);

  // Remover arquivo não criptografado se existia
  if (fs.existsSync(sPath)) {
    await fs.promises.unlink(sPath).catch(() => {});
  }

  // Atualizar metadados
  let metaData = { user: 'desconhecido' };
  if (fs.existsSync(mPath)) {
    try {
      metaData = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
    } catch {}
  }
  metaData.lastRotatedAt = new Date().toISOString();
  metaData.encrypted = true;
  await safeWriteFile(mPath, JSON.stringify(metaData, null, 2), 'utf-8');
  safeChmod600(mPath);

  // Executar prune de backups após criar um novo
  await pruneSessionBackups({ ...options, scratchDir: targetScratchDir }).catch(() => {});

  logger.info(
    { user: metaData.user, backupPath },
    '[ROTAÇÃO] Chave de sessão rotacionada com sucesso.'
  );
  return { success: true, user: metaData.user, backupPath };
}

/**
 * Migra um arquivo de sessão legado em texto claro (session.json) para formato criptografado (.enc)
 * @param {object} [options={}]
 * @returns {Promise<{ migrated: boolean, user?: string }>}
 */
async function migrateLegacySession(options = {}) {
  const { sPath, encPath, mPath } = resolveSessionPaths(options);
  const { secret, shouldEncrypt } = getEncryptionConfig(options);

  if (!shouldEncrypt || !fs.existsSync(sPath)) {
    return { migrated: false };
  }

  let sessionData;
  try {
    const content = await fs.promises.readFile(sPath, 'utf-8');
    sessionData = JSON.parse(content);
  } catch (err) {
    logger.warn({ err: err.message }, 'Falha ao analisar JSON da sessão legada.');
    return { migrated: false };
  }

  const encrypted = encryptSession(JSON.stringify(sessionData, null, 2), secret);
  await safeWriteFile(encPath, encrypted, 'utf-8');
  safeChmod600(encPath);

  // Remover o arquivo em texto claro após migração segura
  await fs.promises.unlink(sPath).catch(() => {});

  let metaData = { user: 'legado' };
  if (fs.existsSync(mPath)) {
    try {
      metaData = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
    } catch {}
  }
  metaData.encrypted = true;
  metaData.migratedAt = new Date().toISOString();
  await safeWriteFile(mPath, JSON.stringify(metaData, null, 2), 'utf-8');
  safeChmod600(mPath);

  logger.info(
    { user: metaData.user },
    'Sessão legada migrada com sucesso para formato criptografado at-rest.'
  );
  return { migrated: true, user: metaData.user };
}

module.exports = {
  loadSessionFiles,
  clearSession,
  validateAndRefresh,
  saveSession,
  resolveSessionPaths,
  getEncryptionConfig,
  isImportedSession,
  pruneSessionBackups,
  rotateSessionSecret,
  updateSessionStreak,
  migrateLegacySession
};
