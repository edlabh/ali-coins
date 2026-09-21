const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  sessionPath: defaultSessionPath,
  sessionMetaPath: defaultSessionMetaPath,
  scratchDir: defaultScratchDir,
  maskUser
} = require('../config');
const {
  validateSession,
  validateSessionPayload,
  safeWriteFile,
  cleanOrphanTmpFiles,
  safeChmod600,
  encryptSessionAsync,
  decryptSessionAsync
} = require('../security');
const { filterStorageState, shouldFilterStorage } = require('./storage_filter');
const logger = require('../logger');

/**
 * Erro de migração de sessão legada (modo estrito, usado pela CLI de importação).
 */
class SessionMigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionMigrationError';
  }
}

// M9: serializa mutações de sessão no MESMO processo por caminho (save/clear/streak).
// O lockfile é inter-processo e não evita que duas operações assíncronas internas
// intercalem (ex.: clearSession apagar o .enc recém-gravado por saveSession).
const sessionMutationQueues = new Map();

/**
 * Executa `fn` em série para um dado caminho de sessão (mutex por caminho).
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withSessionLock(key, fn) {
  const prev = sessionMutationQueues.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  // Mantém a fila viva sem propagar rejeição para o próximo encadeado
  const chained = run.finally(() => {
    if (sessionMutationQueues.get(key) === chained) sessionMutationQueues.delete(key);
  });
  sessionMutationQueues.set(
    key,
    chained.catch(() => {})
  );
  return run;
}

/**
 * Resolve os caminhos dos arquivos de sessão com suporte a injeção via options/baseDir
 * @param {object} [options={}]
 * @returns {{ sPath: string, encPath: string, mPath: string, scratchDir: string }}
 */
function resolveSessionPaths(options = {}) {
  const baseDir = options.baseDir;
  const rawPath =
    options.sessionPath || (baseDir ? path.join(baseDir, 'session.json') : defaultSessionPath);
  const encPath = rawPath.endsWith('.enc') ? rawPath : `${rawPath}.enc`;
  const plainPath = rawPath.endsWith('.enc') ? rawPath.slice(0, -4) : rawPath;

  let mPath = options.sessionMetaPath;
  if (!mPath) {
    if (options.sessionPath) {
      const dir = path.dirname(plainPath);
      const base = path.basename(plainPath);
      if (base.startsWith('session_')) {
        mPath = path.join(dir, base.replace(/^session_/, 'session_meta_'));
      } else if (base === 'session.json') {
        mPath = path.join(dir, 'session_meta.json');
      } else {
        mPath = path.join(dir, `${base.replace(/\.json$/, '')}_meta.json`);
      }
    } else {
      mPath = baseDir ? path.join(baseDir, 'session_meta.json') : defaultSessionMetaPath;
    }
  }
  const targetScratchDir =
    options.scratchDir || (baseDir ? path.join(baseDir, 'scratch') : defaultScratchDir);

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
  return { secret, oldSecret, shouldEncrypt, encryptLocal };
}

/**
 * Carrega de forma segura os arquivos de sessão e metadados se existirem
 * Suporta leitura transparente de .enc (AES-256-GCM) com fallback para .json legado,
 * migração automática para formato criptografado e rotação de chave via SESSION_SECRET_OLD.
 * @param {object} [options={}]
 * @returns {Promise<{ sessionData: object|null, metaData: object|null }>}
 */
async function loadSessionFiles(options = {}) {
  const { sPath, encPath, mPath } = resolveSessionPaths(options);
  const { secret, oldSecret, shouldEncrypt } = getEncryptionConfig(options);
  let sessionData = null;
  let metaData = null;
  // Quando o chamador já possui a sessão em memória (ex: fluxo unificado check-in -> tarefas),
  // skipSession evita re-descriptografar o .enc (scrypt é caro em CPU/memória) e pula a
  // migração de texto claro; os metadados continuam sendo lidos normalmente.
  const skipSession = options.skipSession === true;

  // 1. Tentar ler arquivo criptografado .enc se existir.
  // Erros de I/O (EACCES/EMFILE/EINTR) NUNCA removem o arquivo: apenas falhas de
  // parse/autenticação são definitivas, pois podem ser transitórias.
  if (!skipSession && fs.existsSync(encPath)) {
    let encryptedContent = null;
    try {
      encryptedContent = await fs.promises.readFile(encPath, 'utf-8');
    } catch (readErr) {
      logger.warn(
        { err: readErr.message },
        'Falha temporária de leitura de session.json.enc. Arquivo preservado para nova tentativa.'
      );
    }

    if (encryptedContent !== null) {
      if (secret && secret.length >= 32) {
        try {
          const decrypted = await decryptSessionAsync(encryptedContent, secret);
          sessionData = JSON.parse(decrypted);
        } catch (decryptErr) {
          // Se falhou com a chave atual e há chave antiga (rotação), tenta SESSION_SECRET_OLD
          if (oldSecret && oldSecret.length >= 32) {
            try {
              const decryptedOld = await decryptSessionAsync(encryptedContent, oldSecret);
              sessionData = JSON.parse(decryptedOld);
              logger.info(
                'Sessão descriptografada com SESSION_SECRET_OLD (rotação detectada). Re-criptografando com a nova chave...'
              );
              // Re-criptografa transparentemente com a chave atual
              const reEncrypted = await encryptSessionAsync(
                JSON.stringify(sessionData, null, 2),
                secret
              );
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
              'Falha ao descriptografar session.json.enc com SESSION_SECRET atual. Arquivo preservado.'
            );
          }
        }
      } else {
        logger.warn(
          'Arquivo session.json.enc detectado mas SESSION_SECRET não configurado (ou < 32 chars). Não é possível descriptografar.'
        );
      }
    }
  }

  // 2. Fallback: ler arquivo legado em texto plano (session.json)
  if (!skipSession && !sessionData && fs.existsSync(sPath)) {
    let plainContent = null;
    try {
      plainContent = await fs.promises.readFile(sPath, 'utf-8');
    } catch (readErr) {
      logger.warn(
        { err: readErr.message },
        'Falha temporária de leitura de session.json. Arquivo preservado para nova tentativa.'
      );
    }

    if (plainContent !== null) {
      let parsedPlain = null;
      try {
        parsedPlain = JSON.parse(plainContent);
      } catch {
        logger.warn(
          'Arquivo session.json inválido (JSON malformado). Arquivo preservado sem exclusão automática.'
        );
      }

      if (parsedPlain) {
        sessionData = parsedPlain;

        // Se criptografia está habilitada e autoMigrate permitida, migrar para .enc
        const autoMigrate = options.autoMigrate !== false;
        if (shouldEncrypt && autoMigrate) {
          // M5: NÃO sobrescrever um .enc existente (pode ser uma sessão válida que não
          // decifrou, ex.: secret rotacionado). Faz backup antes e só então grava.
          if (fs.existsSync(encPath)) {
            const bakPath = `${encPath}.bak-${Date.now()}`;
            try {
              await fs.promises.rename(encPath, bakPath);
              safeChmod600(bakPath);
              logger.warn(
                { backup: bakPath },
                'session.json.enc existente preservado como backup antes da migração do texto claro.'
              );
            } catch (bakErr) {
              logger.warn(
                { err: bakErr.message },
                'Não foi possível fazer backup do .enc existente; migração abortada para não perder a sessão.'
              );
              parsedPlain = null;
            }
          }

          if (parsedPlain) {
            logger.info(
              'Migrando sessão legada em texto claro (session.json) para formato criptografado at-rest (session.json.enc)...'
            );
            try {
              const encrypted = await encryptSessionAsync(
                JSON.stringify(sessionData, null, 2),
                secret
              );
              await safeWriteFile(encPath, encrypted, 'utf-8');
              safeChmod600(encPath);
              // B13: verifica round-trip antes de apagar o único texto claro existente.
              const verify = JSON.parse(await decryptSessionAsync(encrypted, secret));
              if (!verify || !Array.isArray(verify.cookies)) {
                throw new Error('Verificação pós-escrita falhou (conteúdo não reconferido).');
              }
              // Remover o arquivo em texto puro SOMENTE após a migração ser verificada
              await fs.promises.unlink(sPath).catch(() => {});
            } catch (migrateErr) {
              logger.warn(
                { err: migrateErr.message },
                'Falha ao migrar session.json para .enc. Arquivo em texto claro preservado.'
              );
            }
          }
        }
      }
    }
  }

  // 3. Ler metadados (mesma política não-destrutiva para erros de I/O)
  let metaCorrupted = false;
  if (fs.existsSync(mPath)) {
    let metaContent = null;
    try {
      metaContent = await fs.promises.readFile(mPath, 'utf-8');
    } catch (readErr) {
      logger.warn(
        { err: readErr.message },
        'Falha temporária de leitura de session_meta.json. Arquivo preservado para nova tentativa.'
      );
    }

    if (metaContent !== null) {
      try {
        metaData = JSON.parse(metaContent);
      } catch {
        metaCorrupted = true;
        logger.warn(
          'Arquivo session_meta.json inválido (JSON malformado). Arquivo preservado sem exclusão automática.'
        );
      }
    }
  }

  // Reforça permissões dos arquivos de sessão existentes: um .enc restaurado de
  // backup/tar pode estar 0644 e legível por outros usuários.
  if (fs.existsSync(encPath)) safeChmod600(encPath);
  if (fs.existsSync(sPath)) safeChmod600(sPath);
  if (fs.existsSync(mPath)) safeChmod600(mPath);

  return { sessionData, metaData, metaCorrupted };
}

/**
 * Remove os arquivos de sessão do disco criando antes um backup versionado em scratch/
 * @param {object} [options={}]
 * @returns {Promise<void>}
 */
async function clearSessionUnlocked(options = {}) {
  const { sPath, encPath, mPath, scratchDir: targetScratchDir } = resolveSessionPaths(options);
  const { secret } = getEncryptionConfig(options);

  // Backup versionado antes de remover se houver sessão
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = path.basename(sPath, '.json');
    const tag = baseName === 'session' ? '' : `-${baseName}`;
    // Segurança destrutiva/exportação: o backup só é gravado dentro do scratch esperado
    // (mesma barreira do pruneSessionBackups) — `scratchDir` é injetável.
    const defaultScratch = resolveSessionPaths({ ...options, scratchDir: undefined }).scratchDir;
    const allowedRoot = path.resolve(
      options.baseDir ? path.join(options.baseDir, 'scratch') : defaultScratch
    );
    const relToScratch = path.relative(allowedRoot, path.resolve(targetScratchDir));
    const scratchAllowed = !relToScratch.startsWith('..') && !path.isAbsolute(relToScratch);
    if (!scratchAllowed) {
      logger.warn(
        { targetScratchDir, allowedRoot },
        'Backup da sessão ignorado: diretório fora do scratch do projeto.'
      );
    } else if (fs.existsSync(encPath)) {
      await fs.promises.mkdir(targetScratchDir, { recursive: true });
      const bakPath = path.join(targetScratchDir, `session.bak${tag}-${timestamp}.json.enc`);
      const data = await fs.promises.readFile(encPath, 'utf-8');
      await safeWriteFile(bakPath, data, 'utf-8');
      safeChmod600(bakPath);
      logger.info({ backup: bakPath }, 'Backup versionado da sessão (.enc) criado com sucesso.');
    } else if (fs.existsSync(sPath)) {
      await fs.promises.mkdir(targetScratchDir, { recursive: true });
      const raw = await fs.promises.readFile(sPath, 'utf-8');
      if (secret && secret.length >= 32) {
        const bakPath = path.join(targetScratchDir, `session.bak${tag}-${timestamp}.json.enc`);
        const encData = await encryptSessionAsync(raw, secret);
        await safeWriteFile(bakPath, encData, 'utf-8');
        safeChmod600(bakPath);
        logger.info({ backup: bakPath }, 'Backup versionado da sessão (.enc) criado com sucesso.');
      } else {
        const bakPath = path.join(targetScratchDir, `session.bak${tag}-${timestamp}.json`);
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
  const loaded = await loadSessionFiles({
    ...options,
    skipSession: Boolean(existingSessionData) || options.skipSession === true
  });
  const sessionData = existingSessionData || loaded.sessionData;
  const metaData = loaded.metaData;

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
    let shouldClear = true;
    if (loaded.metaCorrupted) {
      // Meta ilegível NÃO é motivo para apagar a sessão: sem isto, uma corrupção do
      // session_meta.json (ou um JSON truncado) destruía um .enc válido.
      shouldClear = false;
      logger.warn(
        'session_meta.json ilegível (JSON malformado): sessão preservada sem exclusão automática para não perder credencial válida.'
      );
    } else if (
      metaData &&
      metaData.user &&
      String(metaData.user).trim().toLowerCase() !== String(userEmail).trim().toLowerCase()
    ) {
      try {
        const { loadAccounts } = require('../config');
        const baseDir = options.baseDir || path.dirname(resolveSessionPaths(options).sPath);
        const configuredAccounts = loadAccounts(process.env, baseDir);
        const isKnownUser =
          configuredAccounts.some((a) => a.user === metaData.user) ||
          (process.env.ALI_USER && process.env.ALI_USER.trim() === metaData.user) ||
          Object.keys(process.env).some(
            (k) =>
              k.startsWith('ALI_USER_') && process.env[k] && process.env[k].trim() === metaData.user
          );
        if (isKnownUser) {
          shouldClear = false;
          logger.warn(
            { activeUser: maskUser(metaData.user), expectedUser: maskUser(userEmail) },
            'Sessão em cache pertence a outra conta configurada. Preservando arquivos sem exclusão.'
          );
        }
      } catch {
        // Ignora erros no loadAccounts e procede normalmente
      }
    }
    if (shouldClear) {
      await clearSession(options);
    }
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
async function saveSessionUnlocked(storageState, user, options = {}) {
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
  const { secret, shouldEncrypt, encryptLocal } = getEncryptionConfig(options);

  // Segurança at-rest: NÃO gravar a sessão em texto puro quando a criptografia foi pedida
  // (ENCRYPT_LOCAL_SESSION=true, padrão) sem um SESSION_SECRET válido. Gravar em claro
  // expõe os cookies de autenticação. Para permitir plaintext, use opt-out explícito
  // (ENCRYPT_LOCAL_SESSION=false ou --plaintext no import).
  if (encryptLocal && !shouldEncrypt) {
    logger.error(
      'ENCRYPT_LOCAL_SESSION está ativo, mas SESSION_SECRET está ausente ou tem menos de 32 caracteres. ' +
        'Gravação em texto puro evitada por segurança; defina SESSION_SECRET (>= 32 chars) ou use ENCRYPT_LOCAL_SESSION=false explicitamente.'
    );
    return null;
  }

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

  // Login novo (senha/2FA resolvidos neste host) deixa de ser uma "sessão importada":
  // limpa os marcadores para não emitir alertas falsos de sessão remota expirada.
  if (options.freshLogin) {
    delete metaData.isImported;
    delete metaData.importedAt;
  }

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

  // Filtra localStorage de telemetria (centenas de KB) antes de persistir/injetar.
  // Cookies de autenticação são preservados integralmente.
  const persistedState = shouldFilterStorage(options)
    ? filterStorageState(storageState)
    : storageState;
  const payloadStr = JSON.stringify(persistedState);

  if (shouldEncrypt) {
    const encryptedToken = await encryptSessionAsync(payloadStr, secret);
    await safeWriteFile(encPath, encryptedToken, 'utf-8');
    safeChmod600(encPath);
    // Remove o arquivo legado sem criptografia se ainda existir
    if (fs.existsSync(sPath)) {
      await fs.promises.unlink(sPath).catch(() => {});
    }
    logger.info(
      { user: maskUser(user) },
      'Sessão autenticada criptografada at-rest salva com sucesso (.enc, 0o600).'
    );
  } else {
    await safeWriteFile(sPath, payloadStr, 'utf-8');
    safeChmod600(sPath);
    // Remove o .enc caso o usuário tenha desativado a criptografia
    if (fs.existsSync(encPath)) {
      await fs.promises.unlink(encPath).catch(() => {});
    }
    logger.info(
      { user: maskUser(user) },
      'Sessão autenticada e metadados salvos com sucesso (permissão 0o600).'
    );
  }

  // Metadados são gravados DEPOIS da sessão: em crash entre as escritas, o par fica
  // sessão-nova + meta-antigo, que `validateSession` rejeita por divergência de conta
  // (re-login seguro). A ordem inversa poderia aprovar cookies antigos com meta novo.
  // Metadados são descartáveis/recuperáveis: dispensa fsync para reduzir I/O.
  await safeWriteFile(mPath, JSON.stringify(metaData), 'utf-8', { durable: false });
  safeChmod600(mPath);

  // Limpeza de backups antigos segundo retenção
  await pruneSessionBackups(options).catch(() => {});

  return { sessionData: persistedState, metaData };
}

/**
 * Atualiza lastStreakDays e lastCheckinDate em session_meta.json de forma segura (0o600)
 * @param {number|string} streakDays Quantidade de dias da sequência
 * @param {object} [options={}] Opções de caminho de sessão
 * @returns {Promise<object|null>} Metadados atualizados ou null
 */
async function updateSessionStreakUnlocked(streakDays, options = {}) {
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
      await safeWriteFile(mPath, JSON.stringify(meta, null, 2), 'utf-8', { durable: false });
      safeChmod600(mPath);
      return meta;
    }
  } catch (err) {
    // warn (e não debug): falha ao persistir o streak deve ser visível, pois impacta
    // diretamente o alerta de quebra de sequência na próxima execução.
    logger.warn({ err: err.message }, 'Falha ao persistir streak em session_meta.json');
  }
  return null;
}

/**
 * Determina se um arquivo em scratch/ é elegível para expiração/remoção por antiguidade.
 * NUNCA remove sessões ativas (session.json*), metadados de sessão ou cron.log.
 * @param {string} file Nome do arquivo (basename)
 * @returns {boolean}
 */
function isPrunableArtifact(file) {
  // 1. Arquivos críticos estritamente protegidos
  if (
    file === 'session.json' ||
    file === 'session.json.enc' ||
    file.startsWith('session.json') ||
    file === 'session_meta.json' ||
    file.startsWith('session_meta') ||
    file === 'session_token.txt' ||
    file === 'cron.log' ||
    file.startsWith('cron.log') ||
    file.startsWith('credentials.env') ||
    file === '.gitkeep'
  ) {
    return false;
  }

  // 2. Backups versionados de sessão (session.bak-*)
  if (file.startsWith('session.bak-') && (file.endsWith('.json.enc') || file.endsWith('.json'))) {
    return true;
  }

  // 3. Playwright Traces de falhas (*-trace-*.zip)
  if (file.endsWith('.zip') && file.includes('-trace-')) {
    return true;
  }

  // 4. Screenshots e imagens de diagnóstico (*.png, *.jpeg, *.jpg)
  if (file.endsWith('.png') || file.endsWith('.jpeg') || file.endsWith('.jpg')) {
    return true;
  }

  // 5. Dumps de hash normalizado de falhas e artefatos HTML
  if ((file.startsWith('dom-') && file.endsWith('.hash.txt')) || file === 'mobile_body.html') {
    return true;
  }

  // 6. Arquivos temporários órfãos de escritas atômicas interrompidas
  if (file.includes('.tmp-')) {
    return true;
  }

  return false;
}

/**
 * Remove backups e artefatos de diagnóstico antigos em scratch/ com base na política de retenção
 * @param {object} [options={}]
 * @param {number} [options.retentionDays=7] Número de dias de retenção (default: 7, ou DIAGNOSTICS_RETENTION_DAYS / SESSION_BACKUP_RETENTION_DAYS)
 * @param {boolean} [options.dryRun=false] Se true, não remove fisicamente os arquivos
 * @param {string} [options.scratchDir] Diretório de backups / diagnósticos
 * @returns {Promise<Array<string>>} Lista de caminhos de arquivos removidos (ou que seriam)
 */
async function pruneSessionBackups(options = {}) {
  const { scratchDir: defaultScratchDir, encPath } = resolveSessionPaths(options);
  const targetScratchDir = options.scratchDir || defaultScratchDir;

  // Segurança destrutiva: a poda só pode ocorrer dentro do diretório scratch esperado.
  // `scratchDir` é injetável (ex.: PW_OUTPUT_DIR via diagnostics.js); sem esta barreira,
  // apontá-lo para dados reais apagaria silenciosamente arquivos do usuário.
  // A raiz permitida é <baseDir>/scratch quando baseDir é informado (testes/isolamento),
  // senão o scratch padrão do projeto.
  const allowedRoot = path.resolve(
    options.baseDir ? path.join(options.baseDir, 'scratch') : defaultScratchDir
  );
  const resolvedTarget = path.resolve(targetScratchDir);
  const relToScratch = path.relative(allowedRoot, resolvedTarget);
  if (relToScratch.startsWith('..') || path.isAbsolute(relToScratch)) {
    logger.warn(
      { targetScratchDir: resolvedTarget, allowedRoot },
      'Poda de artefatos ignorada: diretório fora do scratch do projeto.'
    );
    return [];
  }

  const envDays = Number(
    process.env.DIAGNOSTICS_RETENTION_DAYS || process.env.SESSION_BACKUP_RETENTION_DAYS
  );
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
      if (isPrunableArtifact(file)) {
        const fullPath = path.join(targetScratchDir, file);
        try {
          const stat = await fs.promises.stat(fullPath);
          const ageMs = now - stat.mtimeMs;
          if (ageMs > maxAgeMs) {
            if (dryRun) {
              logger.info(
                { file: fullPath, ageDays: (ageMs / (1000 * 60 * 60 * 24)).toFixed(1) },
                '[DRY-RUN] Artefato antigo em scratch/ seria removido pela política de retenção.'
              );
              pruned.push(fullPath);
            } else {
              await fs.promises.unlink(fullPath);
              logger.info(
                { file: fullPath },
                'Artefato antigo em scratch/ removido pela política de retenção.'
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
    logger.debug(
      { err: err.message },
      'Falha ao inspecionar diretório para limpeza de backups e diagnósticos.'
    );
  }

  // Só limpa temporários órfãos do diretório de sessão quando há alvo explícito;
  // evita tocar o diretório padrão do projeto quando o chamador só passou scratchDir
  // (ex: poda de diagnósticos).
  if (options.sessionPath || options.sessionMetaPath) {
    try {
      const orphanTmp = await cleanOrphanTmpFiles(path.dirname(encPath));
      if (orphanTmp.length > 0) {
        pruned.push(...orphanTmp);
      }
    } catch {
      // Ignora erro ao limpar temporários órfãos
    }
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
async function rotateSessionSecretUnlocked(options = {}) {
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

  if (secretsEqual(oldSecret, newSecret)) {
    throw new Error(
      'A nova chave de sessão deve ser diferente da chave atual para efetuar a rotação.'
    );
  }

  let sessionData = null;
  let rawJson = null;

  if (fs.existsSync(encPath)) {
    try {
      const encryptedContent = await fs.promises.readFile(encPath, 'utf-8');
      rawJson = await decryptSessionAsync(encryptedContent, oldSecret);
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
  const oldEncrypted = await encryptSessionAsync(rawJson, oldSecret);
  await safeWriteFile(backupPath, oldEncrypted, 'utf-8');
  safeChmod600(backupPath);

  // Criptografar com a nova chave e validar roundtrip
  const newEncrypted = await encryptSessionAsync(JSON.stringify(sessionData, null, 2), newSecret);
  try {
    const verifiedJson = await decryptSessionAsync(newEncrypted, newSecret);
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
    { user: maskUser(metaData.user), backupPath },
    '[ROTAÇÃO] Chave de sessão rotacionada com sucesso.'
  );
  return { success: true, user: metaData.user, backupPath };
}

/**
 * Migra um arquivo de sessão legado em texto claro (session.json) para formato criptografado (.enc).
 *
 * Implementação canônica única, usada tanto pela biblioteca (`libs/session.js`) quanto pela
 * CLI de importação (`import_session.js`). O modo de falha é controlado por `strict`:
 * - `strict: false` (biblioteca): retorna `{ migrated: false }` quando não há o que migrar
 *   ou quando o JSON é inválido (não lança).
 * - `strict: true` (CLI): lança `SessionMigrationError` com mensagem acionável.
 *
 * @param {object} [options={}]
 * @param {string} [options.baseDir] Diretório base dos arquivos de sessão
 * @param {string} [options.secret] SESSION_SECRET (>= 32 chars)
 * @param {boolean} [options.strict=false] Lança erro em vez de retornar `migrated: false`
 * @param {boolean} [options.validate=false] Valida o payload antes de gravar (modo CLI)
 * @returns {Promise<{ migrated: boolean, user?: string, cookiesCount?: number, encrypted?: boolean }>}
 */
async function migrateLegacySession(options = {}) {
  const { sPath, encPath, mPath } = resolveSessionPaths(options);
  const { secret, shouldEncrypt } = getEncryptionConfig(options);
  const strict = Boolean(options.strict);

  const fail = (message, cause) => {
    if (strict) throw new SessionMigrationError(message);
    if (cause) logger.warn({ err: cause.message }, message);
    return { migrated: false };
  };

  if (!shouldEncrypt) {
    return fail(
      'SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres para migração segura.'
    );
  }

  if (!fs.existsSync(sPath)) {
    return fail(`Arquivo legado session.json não encontrado em: "${sPath}"`);
  }

  let sessionData;
  try {
    const content = await fs.promises.readFile(sPath, 'utf-8');
    const parsed = JSON.parse(content);
    // A CLI aceita tanto `{ cookies, origins }` quanto `{ session: {...} }` e valida o schema.
    if (options.validate) {
      const validated = validateSessionPayload(parsed.cookies ? { session: parsed } : parsed);
      sessionData = validated.session;
    } else {
      sessionData = parsed;
    }
  } catch (err) {
    // Não interpolar err.message: o JSON.parse do V8 inclui um trecho do input
    // (poderia expor cookies do session.json legado em logs/notificações).
    return fail(
      options.validate
        ? 'Conteúdo do session.json legado é inválido (JSON malformado).'
        : 'Falha ao analisar JSON da sessão legada.',
      err
    );
  }

  let metaData = { user: 'legado' };
  if (fs.existsSync(mPath)) {
    try {
      const existing = JSON.parse(await fs.promises.readFile(mPath, 'utf-8'));
      metaData = { ...metaData, ...existing };
    } catch {}
  }
  metaData.encrypted = true;
  metaData.migratedAt = new Date().toISOString();
  if (options.validate) metaData.savedAt = new Date().toISOString();

  // Nunca sobrescrever um .enc existente sem backup: se session.json legado e
  // session.json.enc coexistirem (migração interrompida/cópia manual), o .enc válido
  // seria destruído e o plaintext apagado em seguida (perda de sessão).
  if (fs.existsSync(encPath)) {
    const bakPath = `${encPath}.bak-${Date.now()}`;
    try {
      await fs.promises.rename(encPath, bakPath);
      safeChmod600(bakPath);
      logger.warn(
        { backup: bakPath },
        'session.json.enc existente preservado como backup antes da migração do texto claro.'
      );
    } catch (bakErr) {
      return fail(
        `Falha ao preservar backup do .enc existente antes da migração: ${bakErr.message}`,
        bakErr
      );
    }
  }

  const encrypted = await encryptSessionAsync(JSON.stringify(sessionData, null, 2), secret);
  await safeWriteFile(encPath, encrypted, 'utf-8');
  safeChmod600(encPath);

  // B13: verifica o round-trip ANTES de remover o único texto claro existente. Se a
  // escrita/criptografia falhar, o plaintext permanece para nova tentativa.
  try {
    const verify = JSON.parse(await decryptSessionAsync(encrypted, secret));
    if (!verify || !Array.isArray(verify.cookies)) {
      throw new Error('conteúdo não reconferido');
    }
  } catch (verifyErr) {
    logger.warn(
      { err: verifyErr.message },
      'Verificação pós-escrita da migração falhou. Texto claro preservado; .enc pode estar inválido.'
    );
    return fail('Falha na verificação da migração para .enc.');
  }

  // Remover o arquivo em texto claro SOMENTE após gravar e proteger o .enc
  await fs.promises.unlink(sPath).catch(() => {});

  await safeWriteFile(mPath, JSON.stringify(metaData, null, 2), 'utf-8');
  safeChmod600(mPath);

  logger.info(
    { user: maskUser(metaData.user) },
    'Sessão legada migrada com sucesso para formato criptografado at-rest.'
  );

  const result = { migrated: true, user: metaData.user };
  if (options.validate) {
    result.cookiesCount = Array.isArray(sessionData.cookies) ? sessionData.cookies.length : 0;
    result.encrypted = true;
  }
  return result;
}

/**
 * Compara dois segredos em tempo constante (evita timing attack em rotação de chaves).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function secretsEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return a === b;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Wrappers serializados por caminho de sessão (M9). Evitam corrida entre
 * save/clear/updateStreak no mesmo processo (o lockfile cobre só entre processos).
 */
function saveSession(storageState, user, options = {}) {
  const { sPath } = resolveSessionPaths(options);
  return withSessionLock(sPath, () => saveSessionUnlocked(storageState, user, options));
}

function clearSession(options = {}) {
  const { sPath } = resolveSessionPaths(options);
  return withSessionLock(sPath, () => clearSessionUnlocked(options));
}

function updateSessionStreak(streakDays, options = {}) {
  const { sPath } = resolveSessionPaths(options);
  return withSessionLock(sPath, () => updateSessionStreakUnlocked(streakDays, options));
}

function rotateSessionSecret(options = {}) {
  const { sPath } = resolveSessionPaths(options);
  return withSessionLock(sPath, () => rotateSessionSecretUnlocked(options));
}

module.exports = {
  loadSessionFiles,
  clearSession,
  validateAndRefresh,
  saveSession,
  resolveSessionPaths,
  getEncryptionConfig,
  isImportedSession,
  isPrunableArtifact,
  pruneSessionBackups,
  rotateSessionSecret,
  updateSessionStreak,
  migrateLegacySession,
  SessionMigrationError
};
