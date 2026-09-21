const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { z } = require('zod');
const logger = require('./logger');

// Salt fixo legado para compatibilidade com tokens v1
const APP_SCRYPT_SALT_V1 = Buffer.from('ali-coins-session-encryption-v1-scrypt-salt', 'utf-8');

// Parâmetros scrypt modernos (v3) e legados (v1/v2)
const SCRYPT_MIN_N = 16384; // 2^14 piso mínimo aceitável de segurança criptográfica
const SCRYPT_DEFAULT_N = 131072; // 2^17 default seguro moderno
// Em hosts com pouca RAM (ex: VPS de 1 GB) o pico de ~128 MB do N=2^17 pode causar OOM
// durante o run com Chromium ativo; 2^15 (~32 MB) mantém margem de segurança confortável.
const SCRYPT_LOW_MEMORY_DEFAULT_N = 32768;
const SCRYPT_LOW_MEMORY_TOTAL_BYTES = 1.5 * 1024 * 1024 * 1024;
const SCRYPT_MAX_N = 1048576; // 2^20 teto individual defensivo (tokens não confiáveis)
const SCRYPT_MAX_R = 16;
const SCRYPT_MAX_P = 16;
// Teto de memória combinada do scrypt (~128 * N * r bytes) contra esgotamento de recursos.
// 256 MB cobre com folga o default (N=2^17, r=8 => 128 MB) e permanece seguro em hosts de 1 GB.
const SCRYPT_MEMORY_CAP_BYTES = 256 * 1024 * 1024;

// Validação do piso criptográfico no boot/carregamento do módulo
if (process.env.SCRYPT_N) {
  const parsedEnvN = parseInt(process.env.SCRYPT_N, 10);
  if (!isNaN(parsedEnvN) && parsedEnvN > 0 && parsedEnvN < SCRYPT_MIN_N) {
    logger.warn(
      { n: parsedEnvN, min: SCRYPT_MIN_N, default: SCRYPT_DEFAULT_N },
      'Variável SCRYPT_N abaixo do piso criptográfico seguro (16384). Aplicando valor padrão seguro (131072).'
    );
  }
}

let customScryptN = null;
let scryptFloorWarned = false;

/**
 * Emite o alerta de piso criptográfico apenas uma vez por processo (evita spam no getter)
 * @param {number} n
 */
function warnScryptFloorOnce(n) {
  if (scryptFloorWarned) return;
  scryptFloorWarned = true;
  logger.warn(
    { n, min: SCRYPT_MIN_N, default: SCRYPT_DEFAULT_N },
    'Valor de SCRYPT_N abaixo do piso criptográfico seguro (16384). Aplicando valor padrão seguro (131072).'
  );
}

let scryptAutoLowMemoryWarned = false;

/**
 * Lê o limite de memória efetivo do cgroup (v2 `memory.max` ou v1 `memory.limit_in_bytes`).
 * Retorna null quando não há limite legível (host comum/sem permissão).
 * @returns {number|null}
 */
function getCgroupMemoryLimitBytes() {
  const candidates = [
    '/sys/fs/cgroup/memory.max', // cgroup v2
    '/sys/fs/cgroup/memory/memory.limit_in_bytes' // cgroup v1
  ];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf-8').trim();
      if (!raw || raw === 'max') continue;
      const value = parseInt(raw, 10);
      // v1 usa um valor gigante (ex.: 9223372036854771712) para "sem limite"
      if (Number.isFinite(value) && value > 0 && value < 1e15) return value;
    } catch {
      // Arquivo inexistente/sem permissão: tenta o próximo
    }
  }
  return null;
}

/**
 * Default de N para NOVAS criptografias quando options.N/SCRYPT_N não são informados.
 * Reduz automaticamente para 2^15 em hosts com pouca RAM total (≤1.5 GB), evitando OOM.
 * Não afeta a leitura de tokens existentes (o N vem embutido no token v3).
 * @param {number} [totalMemBytes] Injetável para testes (default: os.totalmem())
 * @returns {number}
 */
function getEffectiveDefaultScryptN(totalMemBytes) {
  if (process.env.SCRYPT_N) return SCRYPT_PARAMS_V3.N;
  // Considera o menor entre a RAM total do host e o limite do cgroup (container Docker
  // pode ter --memory bem menor que o host; os.totalmem() reporta o host).
  const total =
    typeof totalMemBytes === 'number'
      ? totalMemBytes
      : Math.min(os.totalmem(), getCgroupMemoryLimitBytes() ?? Infinity);
  if (Number.isFinite(total) && total > 0 && total <= SCRYPT_LOW_MEMORY_TOTAL_BYTES) {
    if (!scryptAutoLowMemoryWarned) {
      scryptAutoLowMemoryWarned = true;
      logger.info(
        { totalMemMB: Math.round(total / (1024 * 1024)), n: SCRYPT_LOW_MEMORY_DEFAULT_N },
        'Host com pouca RAM detectado: usando SCRYPT_N reduzido (2^15) para novas criptografias.'
      );
    }
    return SCRYPT_LOW_MEMORY_DEFAULT_N;
  }
  return SCRYPT_DEFAULT_N;
}

const SCRYPT_PARAMS_V3 = {
  get N() {
    if (customScryptN !== null) {
      if (customScryptN < SCRYPT_MIN_N) {
        warnScryptFloorOnce(customScryptN);
        return SCRYPT_DEFAULT_N;
      }
      return customScryptN;
    }
    if (process.env.SCRYPT_N) {
      const envN = parseInt(process.env.SCRYPT_N, 10);
      if (!isNaN(envN) && envN > 0) {
        if (envN < SCRYPT_MIN_N) {
          warnScryptFloorOnce(envN);
          return SCRYPT_DEFAULT_N;
        }
        return envN;
      }
    }
    return SCRYPT_DEFAULT_N;
  },
  set N(val) {
    if (typeof val === 'number' && Number.isFinite(val) && val >= SCRYPT_MIN_N) {
      customScryptN = Math.floor(val);
    } else {
      customScryptN = null;
    }
  },
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024
}; // 2^17 (ajustável via SCRYPT_N em ambientes com recursos restritos, piso mínimo 16384)
const SCRYPT_PARAMS_LEGACY = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }; // 2^14

/**
 * Sanitiza parâmetros scrypt provenientes de tokens não confiáveis (v3 embute N:r:p).
 * Aplica piso (N >= 16384) e tetos defensivos (N <= 2^20, r/p <= 16), impedindo
 * esgotamento de memória/CPU a partir de um token forjado ou corrompido.
 * Valores fora dos limites são clampeados; entradas inválidas caem no fallback.
 * @param {number} rawN
 * @param {number} rawR
 * @param {number} rawP
 * @param {object} [fallback=SCRYPT_PARAMS_V3]
 * @returns {{ N: number, r: number, p: number, maxmem: number }}
 */
function sanitizeScryptParams(rawN, rawR, rawP, fallback = SCRYPT_PARAMS_V3) {
  const fallbackN = fallback && fallback.N ? fallback.N : SCRYPT_DEFAULT_N;
  const fallbackR = fallback && fallback.r ? fallback.r : 8;
  const fallbackP = fallback && fallback.p ? fallback.p : 1;

  const clampInt = (value, min, max, defaultValue) => {
    if (!Number.isInteger(value) || value <= 0) return defaultValue;
    if (value < min) return defaultValue;
    return Math.min(value, max);
  };

  let N = clampInt(rawN, SCRYPT_MIN_N, SCRYPT_MAX_N, fallbackN);
  let r = clampInt(rawR, 1, SCRYPT_MAX_R, fallbackR);
  const p = clampInt(rawP, 1, SCRYPT_MAX_P, fallbackP);

  // Aplica teto de memória combinada. O OpenSSL usa 128*N*r*p + 128*r*p bytes; reduz
  // N à metade até caber no limite e rejeita (fallback de piso) o que ainda exceder,
  // impedindo esgotamento de memória a partir de token forjado.
  const scryptMemoryBytes = (n, rFactor, pFactor) =>
    128 * n * rFactor * pFactor + 128 * rFactor * pFactor;
  while (N > SCRYPT_MIN_N && scryptMemoryBytes(N, r, p) > SCRYPT_MEMORY_CAP_BYTES) {
    N = N >> 1;
  }
  if (scryptMemoryBytes(N, r, p) > SCRYPT_MEMORY_CAP_BYTES) {
    N = SCRYPT_MIN_N;
    r = 1;
  }

  // maxmem nunca excede o cap e cobre a memória real do scrypt com 2× de headroom
  return { N, r, p, maxmem: Math.min(SCRYPT_MEMORY_CAP_BYTES, scryptMemoryBytes(N, r, p) * 2) };
}

/**
 * Ajusta permissões do arquivo para 0o600 de forma segura entre plataformas
 * @param {string} filePath
 */
function safeChmod600(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      // Não alterar a permissão do ALVO de um symlink (poderia virar chmod 0600 em
      // arquivo arbitrário). Aplica só a arquivos regulares.
      const stat = fs.lstatSync(filePath);
      if (!stat.isSymbolicLink()) {
        fs.chmodSync(filePath, 0o600);
      }
    }
  } catch {
    // Windows e alguns sistemas de arquivos ignoram chmod sem erro fatal
  }
}

/**
 * Escrita segura e atômica de arquivo com permissão 0o600.
 * Grava em arquivo temporário (destino.tmp-<pid>-<rand>), força fsync físico no disco,
 * e renomeia atomicamente para o destino final.
 * Em caso de falha durante a escrita, o arquivo de destino original permanece 100% íntegro
 * e o arquivo temporário incompleto é removido.
 * @param {string} filePath Caminho do arquivo de destino
 * @param {string|Buffer} data Conteúdo a gravar
 * @param {string} [encoding='utf-8'] Codificação dos dados se string
 * @param {object} [options={}]
 * @param {boolean} [options.durable=true] Se false, dispensa fsync (metadados descartáveis),
 *   reduzindo I/O em hosts lentos; a atomicidade via rename é preservada.
 */
async function safeWriteFile(filePath, data, encoding = 'utf-8', options = {}) {
  const durable = options.durable !== false;
  const rand = crypto.randomBytes(6).toString('hex');
  const tmpPath = `${filePath}.tmp-${process.pid}-${rand}`;
  let handle = null;

  try {
    handle = await fs.promises.open(tmpPath, 'w', 0o600);
    if (Buffer.isBuffer(data)) {
      await handle.write(data);
    } else {
      await handle.writeFile(data, encoding);
    }
    if (durable) {
      await handle.sync();
    }
    await handle.close();
    handle = null;

    try {
      await fs.promises.rename(tmpPath, filePath);
    } catch (renameErr) {
      // Em bind mounts de arquivo (ex: Docker -v arquivo:/app/arquivo) o rename sobre o
      // ponto de montagem falha com EBUSY/EXDEV/EPERM. Nesse caso escrevemos diretamente
      // no destino (truncate + write + fsync), preservando 0o600; a atomicidade não é
      // possível, mas sem este fallback nenhuma escrita de sessão/metadados acontecia.
      const canFallback =
        renameErr &&
        ['EBUSY', 'EXDEV', 'EPERM', 'EACCES'].includes(renameErr.code) &&
        fs.existsSync(filePath);

      if (!canFallback) throw renameErr;

      // Segurança: NUNCA seguir symlink no fallback. Se o destino for um link simbólico,
      // abrir com 'w' truncaria/gravaria no alvo (arquivo arbitrário) e o chmod
      // alteraria sua permissão. Remove apenas o link e grava no caminho real.
      try {
        const lst = await fs.promises.lstat(filePath);
        if (lst.isSymbolicLink()) {
          logger.warn(
            { filePath },
            'safeWriteFile: destino é symlink; removendo o link para gravar com segurança.'
          );
          await fs.promises.unlink(filePath);
        }
      } catch {
        // lstat falhou (corrida): prossegue; a abertura abaixo usa O_NOFOLLOW quando disponível
      }

      // Backup do conteúdo atual antes de truncar o destino: se o processo for morto
      // (ex.: OOM killer em VPS de 1 GB) no meio da escrita direta, o backup preserva
      // a versão anterior íntegra em vez de deixar o arquivo vazio/parcial.
      const backupPath = `${filePath}.bak-${Date.now()}`;
      let hasBackup = false;
      try {
        await fs.promises.copyFile(filePath, backupPath);
        hasBackup = true;
      } catch {
        // Sem backup: prossegue (melhor escrever do que falhar)
      }

      let direct = null;
      try {
        // O_NOFOLLOW impede seguir symlink que apareça entre o lstat e o open (TOCTOU).
        const openFlags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC;
        const flagsWithNoFollow =
          typeof fs.constants.O_NOFOLLOW === 'number'
            ? openFlags | fs.constants.O_NOFOLLOW
            : openFlags;
        direct = await fs.promises.open(filePath, flagsWithNoFollow, 0o600);
        if (Buffer.isBuffer(data)) {
          // Escrita completa: loop sobre bytesWritten (write pode ser parcial)
          let offset = 0;
          while (offset < data.length) {
            const { bytesWritten } = await direct.write(data, offset, data.length - offset, offset);
            if (!bytesWritten) break;
            offset += bytesWritten;
          }
          if (offset !== data.length) {
            throw new Error('safeWriteFile: escrita direta incompleta (fallback bind mount).');
          }
        } else {
          await direct.writeFile(data, encoding);
        }
        if (durable) {
          await direct.sync();
        }
      } catch (writeErr) {
        // Restaura o backup para não deixar o destino corrompido
        if (hasBackup) {
          await fs.promises.copyFile(backupPath, filePath).catch(() => {});
        }
        throw writeErr;
      } finally {
        if (direct) {
          try {
            await direct.close();
          } catch {
            // Ignora erro ao fechar handle direto
          }
        }
        await fs.promises.unlink(tmpPath).catch(() => {});
      }

      if (hasBackup) {
        await fs.promises.unlink(backupPath).catch(() => {});
      }
      safeChmod600(filePath);
      return;
    }

    safeChmod600(filePath);

    // Durabilidade do rename: fsync do diretório (best-effort; pode não ser suportado
    // em todos os sistemas de arquivos/Windows, por isso é silenciosamente tolerado).
    if (durable) {
      try {
        const dirHandle = await fs.promises.open(path.dirname(filePath), 'r');
        try {
          await dirHandle.sync();
        } finally {
          await dirHandle.close();
        }
      } catch {
        // Diretório não sincronizável neste SO: ignora
      }
    }
  } catch (err) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Ignora erro ao fechar handle
      }
    }
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // Ignora erro se o arquivo temporário já não existir
    }
    throw err;
  }
}

/**
 * Remove arquivos temporários órfãos (.tmp-<pid>-<rand>) deixados por crashes repentinos (kill/OOM)
 * @param {string} [dir=process.cwd()] Diretório onde procurar arquivos temporários
 * @param {number} [maxAgeMs=300000] Idade mínima em ms para considerar órfão (default: 5 minutos)
 * @returns {Promise<Array<string>>} Lista de arquivos removidos
 */
async function cleanOrphanTmpFiles(dir = process.cwd(), maxAgeMs = 300000) {
  const removed = [];
  try {
    if (!fs.existsSync(dir)) return removed;
    const files = await fs.promises.readdir(dir);
    const now = Date.now();
    for (const file of files) {
      if (/\.tmp-\d+-[a-f0-9]+$/i.test(file)) {
        const fullPath = path.join(dir, file);
        try {
          const stat = await fs.promises.stat(fullPath);
          if (now - stat.mtimeMs >= maxAgeMs) {
            await fs.promises.unlink(fullPath);
            removed.push(fullPath);
          }
        } catch {
          // Ignorado se removido concorrentemente
        }
      }
    }
  } catch {
    // Ignora erro de leitura do diretório
  }
  return removed;
}

/**
 * Derivação assíncrona (crypto.scrypt) para não bloquear o event loop enquanto o
 * Chromium/Playwright está ativo. Mesmo custo de memória do scryptSync, mas sem
 * travar I/O e timers do processo durante a derivação (~200ms no N padrão).
 * @returns {Promise<Buffer>}
 */
function scryptAsync(secret, salt, keylen, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(secret, salt, keylen, params, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Valida o segredo de sessão para operações de criptografia.
 * @param {string} secret
 * @param {string} operation
 */
function assertValidSecret(secret, operation) {
  if (!secret || typeof secret !== 'string' || secret.length < 32) {
    throw new Error(
      `SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres para ${operation}.`
    );
  }
}

/**
 * Resolve versão e parâmetros (salt/iv/scrypt) para criptografia.
 * @param {object} [options={}]
 * @returns {{ requestedVersion: string, salt: Buffer, iv: Buffer, params: object }}
 */
function resolveEncryptContext(options = {}) {
  const requestedVersion = options.version === 'v2' ? 'v2' : 'v3';
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);

  let params;
  if (requestedVersion === 'v2') {
    params = { ...SCRYPT_PARAMS_LEGACY };
  } else {
    // Coage strings numéricas (ex: options.N = '16384') antes de aplicar piso/teto
    const coercedN =
      options.N !== undefined && options.N !== null
        ? Number(options.N)
        : getEffectiveDefaultScryptN();
    if (
      options.N !== undefined &&
      options.N !== null &&
      (!Number.isInteger(coercedN) || coercedN < SCRYPT_MIN_N)
    ) {
      logger.warn(
        { n: options.N, min: SCRYPT_MIN_N, default: SCRYPT_DEFAULT_N },
        'options.N inválido ou abaixo do piso criptográfico seguro (16384). Aplicando valor padrão seguro (131072).'
      );
    }
    const rawR =
      options.r !== undefined && options.r !== null ? Number(options.r) : SCRYPT_PARAMS_V3.r;
    const rawP =
      options.p !== undefined && options.p !== null ? Number(options.p) : SCRYPT_PARAMS_V3.p;
    // Mesma sanitização usada na decifragem garante que o token gerado seja decifrável
    params = sanitizeScryptParams(coercedN, rawR, rawP, SCRYPT_PARAMS_V3);
  }

  return { requestedVersion, salt, iv, params };
}

/**
 * Cifra o payload com a chave derivada e serializa o token final.
 * @param {string} payloadJson
 * @param {Buffer} key
 * @param {{ requestedVersion: string, salt: Buffer, iv: Buffer, params: object }} context
 * @returns {string}
 */
function buildEncryptedToken(payloadJson, key, { requestedVersion, salt, iv, params }) {
  let ciphertext;
  let tag;

  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    ciphertext = Buffer.concat([cipher.update(payloadJson, 'utf-8'), cipher.final()]);
    tag = cipher.getAuthTag();
  } finally {
    // Zerar chave da memória
    key.fill(0);
  }

  const saltB64 = salt.toString('base64');
  const ivB64 = iv.toString('base64');
  const tagB64 = tag.toString('base64');
  const cipherB64 = ciphertext.toString('base64');

  if (requestedVersion === 'v2') {
    return `v2:${saltB64}:${ivB64}:${tagB64}:${cipherB64}:base64`;
  }

  return `v3:${params.N}:${params.r}:${params.p}:${saltB64}:${ivB64}:${tagB64}:${cipherB64}:base64`;
}

/**
 * Criptografa o payload da sessão usando scrypt + aes-256-gcm com salt aleatório (v3)
 * @param {string} payloadJson
 * @param {string} secret
 * @param {object} [options={}] Opções adicionais de criptografia ({ version: 'v2'|'v3', N, r, p })
 * @returns {string} Token no formato v3:N:r:p:salt:iv:tag:ciphertext:base64 (ou v2:salt:iv:tag:ciphertext:base64)
 */
function encryptSession(payloadJson, secret, options = {}) {
  assertValidSecret(secret, 'criptografia segura');
  const context = resolveEncryptContext(options);
  const key = crypto.scryptSync(secret, context.salt, 32, context.params);
  return buildEncryptedToken(payloadJson, key, context);
}

/**
 * Versão assíncrona de encryptSession: usa crypto.scrypt sem bloquear o event loop.
 * Mesmo formato e mesmas mensagens de erro; API síncrona permanece para compatibilidade.
 * @param {string} payloadJson
 * @param {string} secret
 * @param {object} [options={}]
 * @returns {Promise<string>}
 */
async function encryptSessionAsync(payloadJson, secret, options = {}) {
  assertValidSecret(secret, 'criptografia segura');
  const context = resolveEncryptContext(options);
  const key = await scryptAsync(secret, context.salt, 32, context.params);
  return buildEncryptedToken(payloadJson, key, context);
}

/**
 * Valida as entradas básicas da descriptografia (mensagens idênticas à versão síncrona).
 */
function assertValidDecryptInputs(tokenString, secret) {
  if (!secret || typeof secret !== 'string' || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres para descriptografia.'
    );
  }
  if (!tokenString || typeof tokenString !== 'string') {
    throw new Error('Token de sessão não fornecido ou inválido.');
  }
}

/**
 * Parseia e sanitiza o token de sessão (v1/v2/v3), decodificando os buffers.
 * Compatível com tokens modernos v3 (marcador de parâmetros e N=2^17), v2 (salt dinâmico, N=16384)
 * e tokens legados v1 (salt fixo, N=16384).
 * @param {string} tokenString
 * @returns {{ salt: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer, scryptParams: object }}
 */
function parseSessionToken(tokenString) {
  const trimmed = tokenString.trim();
  const parts = trimmed.split(':');

  const version = parts[0];
  let salt;
  let iv;
  let tag;
  let ciphertext;
  let scryptParams = SCRYPT_PARAMS_LEGACY;

  if (version === 'v3') {
    if (parts.length >= 8) {
      // Formato moderno com marcadores de parâmetros: v3:N:r:p:salt:iv:tag:ciphertext:base64
      const parsedN = parseInt(parts[1], 10);
      const parsedR = parseInt(parts[2], 10);
      const parsedP = parseInt(parts[3], 10);
      // Sanitização defensiva: token é entrada não confiável (pode ser forjado/corrompido)
      scryptParams = sanitizeScryptParams(parsedN, parsedR, parsedP, SCRYPT_PARAMS_V3);
      salt = Buffer.from(parts[4], 'base64');
      iv = Buffer.from(parts[5], 'base64');
      tag = Buffer.from(parts[6], 'base64');
      ciphertext = Buffer.from(parts[7], 'base64');
    } else if (parts.length >= 5) {
      // Formato v3 compacto: v3:salt:iv:tag:ciphertext:base64
      scryptParams = SCRYPT_PARAMS_V3;
      salt = Buffer.from(parts[1], 'base64');
      iv = Buffer.from(parts[2], 'base64');
      tag = Buffer.from(parts[3], 'base64');
      ciphertext = Buffer.from(parts[4], 'base64');
    } else {
      throw new Error(
        'Formato de token v3 inválido. O token deve possuir blocos v3:N:r:p:salt:iv:tag:ciphertext:base64.'
      );
    }
  } else if (version === 'v2') {
    if (parts.length < 5) {
      throw new Error(
        'Formato de token v2 inválido. O token deve possuir blocos v2:salt:iv:tag:ciphertext:base64.'
      );
    }
    scryptParams = SCRYPT_PARAMS_LEGACY;
    salt = Buffer.from(parts[1], 'base64');
    iv = Buffer.from(parts[2], 'base64');
    tag = Buffer.from(parts[3], 'base64');
    ciphertext = Buffer.from(parts[4], 'base64');
  } else if (version === 'v1') {
    if (parts.length < 4) {
      throw new Error(
        'Formato de token v1 inválido. O token deve possuir blocos v1:iv:tag:ciphertext:base64.'
      );
    }
    scryptParams = SCRYPT_PARAMS_LEGACY;
    salt = APP_SCRYPT_SALT_V1;
    iv = Buffer.from(parts[1], 'base64');
    tag = Buffer.from(parts[2], 'base64');
    ciphertext = Buffer.from(parts[3], 'base64');
  } else {
    throw new Error(
      'Formato de token de sessão inválido. O token deve iniciar com "v1:", "v2:" ou "v3:".'
    );
  }

  assertTokenBufferLengths(version, { salt, iv, tag });
  return { salt, iv, tag, ciphertext, scryptParams };
}

// Tamanhos canônicos dos buffers de um token GCM (rejeita tokens malformados cedo,
// antes de derivar a chave com scrypt e consumir CPU/memória).
const TOKEN_IV_LENGTH = 12;
const TOKEN_TAG_LENGTH = 16;
const TOKEN_SALT_LENGTH = 16;

/**
 * Valida os tamanhos de salt/iv/tag do token. Usa a mesma mensagem pública de falha
 * de autenticação para não alterar o contrato observável (prefixo estável).
 * @param {string} version
 * @param {{ salt: Buffer, iv: Buffer, tag: Buffer }} parts
 */
function assertTokenBufferLengths(version, { salt, iv, tag }) {
  const needsSaltCheck = version === 'v2' || version === 'v3';
  const invalid =
    !iv ||
    iv.length !== TOKEN_IV_LENGTH ||
    !tag ||
    tag.length !== TOKEN_TAG_LENGTH ||
    (needsSaltCheck && (!salt || salt.length !== TOKEN_SALT_LENGTH));

  if (invalid) {
    throw new Error(
      'Falha na autenticação/descriptografia do token. Verifique se o SESSION_SECRET está correto.'
    );
  }
}

/**
 * Zera buffers sensíveis do token após o uso.
 */
function zeroDecryptBuffers({ salt, iv, tag, ciphertext }) {
  if (salt && salt !== APP_SCRYPT_SALT_V1) salt.fill(0);
  if (iv) iv.fill(0);
  if (tag) tag.fill(0);
  if (ciphertext) ciphertext.fill(0);
}

/**
 * Decifra com a chave derivada e zera buffers sensíveis no final (sucesso ou falha).
 */
function decryptWithKey(key, parsed) {
  const { iv, tag, ciphertext } = parsed;
  let decryptedStr = null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decryptedBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    decryptedStr = decryptedBuf.toString('utf-8');
    decryptedBuf.fill(0);
  } finally {
    if (key) key.fill(0);
    zeroDecryptBuffers(parsed);
  }
  return decryptedStr;
}

/**
 * Normaliza qualquer falha (scrypt ou autenticação) na mensagem pública de erro.
 */
function toDecryptAuthError(err) {
  // Detalhe interno (params/crypto) vai apenas para debug; a mensagem pública permanece
  // estável para não expor implementação a logs/CLI.
  if (err && err.message) {
    logger.debug({ err: err.message }, 'Detalhe interno da falha de descriptografia do token.');
  }
  return new Error(
    'Falha na autenticação/descriptografia do token. Verifique se o SESSION_SECRET está correto.'
  );
}

/**
 * Descriptografa o token de sessão usando scrypt + aes-256-gcm (síncrono).
 * @param {string} tokenString
 * @param {string} secret
 * @returns {string} Payload JSON descriptografado
 */
function decryptSession(tokenString, secret) {
  assertValidDecryptInputs(tokenString, secret);
  const parsed = parseSessionToken(tokenString);
  try {
    // scryptSync dentro do try: parâmetros inválidos (ex: token compacto + SCRYPT_N alto)
    // são reportados como falha de autenticação, não como erro cru de parâmetros
    const key = crypto.scryptSync(secret, parsed.salt, 32, parsed.scryptParams);
    return decryptWithKey(key, parsed);
  } catch (err) {
    zeroDecryptBuffers(parsed);
    throw toDecryptAuthError(err);
  }
}

/**
 * Versão assíncrona de decryptSession: usa crypto.scrypt sem bloquear o event loop.
 * Mesmo formato, mesmas mensagens de erro e mesma limpeza de buffers.
 * @param {string} tokenString
 * @param {string} secret
 * @returns {Promise<string>}
 */
async function decryptSessionAsync(tokenString, secret) {
  assertValidDecryptInputs(tokenString, secret);
  const parsed = parseSessionToken(tokenString);
  try {
    const key = await scryptAsync(secret, parsed.salt, 32, parsed.scryptParams);
    return decryptWithKey(key, parsed);
  } catch (err) {
    zeroDecryptBuffers(parsed);
    throw toDecryptAuthError(err);
  }
}

// Schemas Zod para validação rigorosa da sessão
const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.string().optional()
});

const sessionPayloadSchema = z.object({
  session: z.object({
    cookies: z.array(cookieSchema).min(1, 'A sessão deve conter ao menos um cookie.'),
    origins: z.array(z.any()).optional()
  }),
  meta: z
    .object({
      user: z.string().min(1, 'O usuário no metadado da sessão não pode ser vazio.'),
      exportedAt: z.string().optional(),
      expiresAt: z.string().optional(),
      savedAt: z.string().optional(),
      exportedFrom: z.string().optional(),
      isImported: z.boolean().optional(),
      importedAt: z.string().optional()
    })
    .passthrough()
    .optional()
});

/**
 * Valida o schema dos dados de sessão importados
 * @param {object} rawPayload
 * @returns {object} Dados validados
 */
function validateSessionPayload(rawPayload) {
  const result = sessionPayloadSchema.safeParse(rawPayload);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Estrutura de sessão inválida: ${issues}`);
  }
  return result.data;
}

/**
 * Verifica se um cookie está expirado
 * @param {object} cookie
 * @returns {boolean}
 */
function isCookieExpired(cookie) {
  if (typeof cookie.expires === 'number' && cookie.expires > 0) {
    // Playwright armazena expires em segundos Unix
    return cookie.expires * 1000 <= Date.now();
  }
  return false;
}

/**
 * Validação rigorosa de sessão: correspondência exata de conta e validade dos cookies
 * @param {object} sessionData
 * @param {object} metaData
 * @param {string} expectedUser
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateSession(sessionData, metaData, expectedUser) {
  if (!sessionData || !Array.isArray(sessionData.cookies)) {
    return { valid: false, reason: 'Dados da sessão ausentes ou sem lista de cookies.' };
  }

  // 1. Verificação exata da conta
  if (expectedUser) {
    if (!metaData || !metaData.user) {
      return {
        valid: false,
        reason: 'Metadados de sessão ausentes ou sem identificação da conta vinculada.'
      };
    }
    // Comparação case-insensitive: e-mails/IDs não diferenciam maiúsculas de minúsculas
    const normalizeUser = (value) => String(value).trim().toLowerCase();
    if (normalizeUser(metaData.user) !== normalizeUser(expectedUser)) {
      return {
        valid: false,
        reason: `Conta da sessão ativa ("${metaData.user}") não corresponde à conta configurada ("${expectedUser}").`
      };
    }
  }

  // 2. Verificação da presença dos cookies de autenticação
  const authCookies = sessionData.cookies.filter(
    (c) => (c.name === 'xman_us_t' || c.name === 'login_aliyunid_ticket') && c.value
  );

  if (authCookies.length === 0) {
    return {
      valid: false,
      reason: 'Nenhum cookie de autenticação válido (xman_us_t / login_aliyunid_ticket) encontrado.'
    };
  }

  // 3. Verificação de expiração dos cookies de autenticação
  const validUnexpiredAuthCookies = authCookies.filter((c) => !isCookieExpired(c));
  if (validUnexpiredAuthCookies.length === 0) {
    return {
      valid: false,
      reason: 'Todos os cookies de autenticação do AliExpress estão expirados.'
    };
  }

  // 4. Verificação de idade da sessão exportada
  if (metaData && metaData.exportedAt) {
    const exportedTime = new Date(metaData.exportedAt).getTime();
    if (!isNaN(exportedTime)) {
      const ageDays = (Date.now() - exportedTime) / (1000 * 60 * 60 * 24);
      if (ageDays > 90) {
        logger.warn(
          { ageDays: Math.floor(ageDays) },
          'A sessão exportada foi gerada há mais de 90 dias. Recomendado renovar com export_session.js.'
        );
      }
    }
  }

  if (metaData && metaData.expiresAt) {
    const expiryTime = new Date(metaData.expiresAt).getTime();
    if (!isNaN(expiryTime) && Date.now() > expiryTime) {
      logger.warn(
        { expiresAt: metaData.expiresAt },
        'A sessão ultrapassou a data estimada de expiração.'
      );
    }
  }

  return { valid: true };
}

/**
 * Erro lançado quando verificação 2FA é solicitada em ambiente não-interativo (sem TTY, como cron/CI)
 */
class TwoFactorRequiredNonInteractive extends Error {
  constructor(message) {
    super(
      message ||
        'Execução não-interativa detectada (sem TTY). O AliExpress solicitou verificação de código 2FA.\n' +
          'Solução: Execute localmente em terminal interativo (./run_all.sh), resolva o desafio, ' +
          'e use "node export_session.js" / "node import_session.js" para transferir a sessão autenticada para o servidor.'
    );
    this.name = 'TwoFactorRequiredNonInteractive';
    this.code = 'TWO_FACTOR_REQUIRED_NON_INTERACTIVE';
    this.is2FARequired = true;
  }
}

/**
 * Solicita código 2FA mascarado no terminal com timeout configurável
 * Falha se não for TTY
 * @param {string} promptText
 * @param {number} [timeoutMs=120000]
 * @returns {Promise<string>}
 */
function readMasked2FACode(
  promptText = '>> Digite o código de 6 dígitos enviado para seu e-mail/SMS: ',
  timeoutMs = 120000
) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      return reject(new TwoFactorRequiredNonInteractive());
    }

    process.stdout.write(promptText);
    let input = '';
    let timer = null;

    const wasRaw = process.stdin.isRaw;
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(wasRaw || false);
      }
      process.stdin.pause();
    };

    timer = setTimeout(() => {
      cleanup();
      process.stdout.write('\n');
      reject(new Error(`Tempo esgotado (${timeoutMs / 1000}s) aguardando o código 2FA.`));
    }, timeoutMs);

    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          return resolve(input.trim());
        } else if (char === '\u0003') {
          // Ctrl+C
          cleanup();
          process.stdout.write('\n');
          return reject(new Error('Entrada de 2FA cancelada pelo usuário (SIGINT).'));
        } else if (char === '\u0008' || char === '\x7f') {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char.charCodeAt(0) >= 32) {
          input += char;
          process.stdout.write('*');
        }
      }
    };

    process.stdin.on('data', onData);
  });
}

module.exports = {
  APP_SCRYPT_SALT_V1,
  SCRYPT_MIN_N,
  SCRYPT_DEFAULT_N,
  SCRYPT_LOW_MEMORY_DEFAULT_N,
  getEffectiveDefaultScryptN,
  SCRYPT_MAX_N,
  SCRYPT_MAX_R,
  SCRYPT_MAX_P,
  sanitizeScryptParams,
  SCRYPT_PARAMS_V3,
  SCRYPT_PARAMS_LEGACY,
  safeChmod600,
  safeWriteFile,
  cleanOrphanTmpFiles,
  encryptSession,
  encryptSessionAsync,
  decryptSession,
  decryptSessionAsync,
  validateSessionPayload,
  validateSession,
  isCookieExpired,
  readMasked2FACode,
  TwoFactorRequiredNonInteractive
};
