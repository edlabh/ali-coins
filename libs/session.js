const fs = require('fs');
const path = require('path');
const { sessionPath: defaultSessionPath, sessionMetaPath: defaultSessionMetaPath } = require('../config');
const { validateSession, safeWriteFile, safeChmod600 } = require('../security');
const logger = require('../logger');

/**
 * Resolve os caminhos dos arquivos de sessão com suporte a injeção via options/baseDir
 * @param {object} [options={}]
 * @returns {{ sPath: string, mPath: string }}
 */
function resolveSessionPaths(options = {}) {
  const baseDir = options.baseDir;
  const sPath =
    options.sessionPath || (baseDir ? path.join(baseDir, 'session.json') : defaultSessionPath);
  const mPath =
    options.sessionMetaPath ||
    (baseDir ? path.join(baseDir, 'session_meta.json') : defaultSessionMetaPath);
  return { sPath, mPath };
}

/**
 * Carrega de forma segura os arquivos de sessão e metadados se existirem
 * @param {object} [options={}]
 * @returns {Promise<{ sessionData: object|null, metaData: object|null }>}
 */
async function loadSessionFiles(options = {}) {
  const { sPath, mPath } = resolveSessionPaths(options);
  let sessionData = null;
  let metaData = null;

  if (fs.existsSync(sPath)) {
    try {
      const content = await fs.promises.readFile(sPath, 'utf-8');
      sessionData = JSON.parse(content);
    } catch {
      logger.warn('Arquivo session.json corrompido ou inválido. Removendo...');
      await fs.promises.unlink(sPath).catch(() => {});
    }
  }

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
 * Remove os arquivos de sessão do disco
 * @param {object} [options={}]
 * @returns {Promise<void>}
 */
async function clearSession(options = {}) {
  const { sPath, mPath } = resolveSessionPaths(options);
  await fs.promises.unlink(sPath).catch(() => {});
  await fs.promises.unlink(mPath).catch(() => {});
}

/**
 * Valida a sessão em cache contra a conta configurada e a validade dos cookies.
 * Remove os arquivos caso a sessão esteja expirada ou pertença a outra conta.
 * @param {string} userEmail
 * @param {object} [existingSessionData=null]
 * @param {object} [options={}]
 * @returns {Promise<{ valid: boolean, reason?: string, sessionData: object|null, metaData: object|null }>}
 */
async function validateAndRefresh(userEmail, existingSessionData = null, options = {}) {
  let { sessionData, metaData } = await loadSessionFiles(options);
  if (existingSessionData) {
    sessionData = existingSessionData;
  }

  if (!sessionData) {
    return {
      valid: false,
      reason: 'Nenhuma sessão ativa encontrada em disco.',
      sessionData: null,
      metaData: null
    };
  }

  const validation = validateSession(sessionData, metaData, userEmail);
  if (!validation.valid) {
    logger.info({ reason: validation.reason }, 'Sessão anterior inválida ou expirada. Limpando...');
    await clearSession(options);
    return {
      valid: false,
      reason: validation.reason,
      sessionData: null,
      metaData: null
    };
  }

  return {
    valid: true,
    sessionData,
    metaData
  };
}

/**
 * Salva a sessão autenticada e metadados no disco com permissão 0o600
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

  const metaData = {
    user,
    savedAt: new Date().toISOString()
  };

  const { sPath, mPath } = resolveSessionPaths(options);

  await safeWriteFile(sPath, JSON.stringify(storageState, null, 2), 'utf-8');
  await safeWriteFile(mPath, JSON.stringify(metaData, null, 2), 'utf-8');

  safeChmod600(sPath);
  safeChmod600(mPath);

  logger.info({ user }, 'Sessão autenticada e metadados salvos com sucesso (permissão 0o600).');
  return { sessionData: storageState, metaData };
}

module.exports = {
  loadSessionFiles,
  clearSession,
  validateAndRefresh,
  saveSession,
  resolveSessionPaths
};
