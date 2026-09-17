const fs = require('fs');
const os = require('os');
const { lockFilePath: defaultLockFilePath } = require('./config');
const { safeChmod600 } = require('./security');
const logger = require('./logger');

const DEFAULT_STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos

class LockActiveError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LockActiveError';
    this.code = 'LOCK_ACTIVE';
    this.details = details;
  }
}

/**
 * Adquire lock exclusivo de forma assíncrona para evitar execuções simultâneas ou sobrepostas
 * @param {boolean} [force=false] Se true, remove lock existente mesmo que ativo
 * @param {number} [customStaleTimeoutMs] Tempo limite de inatividade para considerar lock órfão
 * @param {string} [customLockFilePath] Caminho customizado para o arquivo de lock
 * @returns {Promise<() => Promise<void>>} Função assíncrona para liberar o lock
 */
async function acquireLock(force = false, customStaleTimeoutMs = null, customLockFilePath = null) {
  const targetLockPath = customLockFilePath || defaultLockFilePath;
  const staleTimeoutMs =
    customStaleTimeoutMs ||
    (process.env.LOCK_STALE_TIMEOUT_MS
      ? parseInt(process.env.LOCK_STALE_TIMEOUT_MS, 10)
      : DEFAULT_STALE_TIMEOUT_MS);

  let lockFileExists = false;
  try {
    await fs.promises.access(targetLockPath);
    lockFileExists = true;
  } catch {
    lockFileExists = false;
  }

  if (lockFileExists) {
    let existingLock = null;
    try {
      const content = await fs.promises.readFile(targetLockPath, 'utf-8');
      existingLock = JSON.parse(content);
    } catch {
      existingLock = null;
    }

    if (existingLock && existingLock.pid) {
      const lockCreatedAt = existingLock.createdAt ? new Date(existingLock.createdAt).getTime() : 0;
      const lockAge = Date.now() - lockCreatedAt;
      const isStale = !isNaN(lockAge) && lockAge > staleTimeoutMs;
      const isSameHost = existingLock.host === os.hostname();

      if (isStale) {
        logger.warn(
          { pid: existingLock.pid, host: existingLock.host, lockAgeMs: lockAge, staleTimeoutMs },
          'Lockfile expirado (staleTimeout atingido). Removendo lock antigo.'
        );
        await fs.promises.unlink(targetLockPath).catch(() => {});
      } else if (isSameHost) {
        // [ANÁLISE DE SEGURANÇA - RACE DE REUSO DE PID]:
        // Em sistemas operacionais (Linux/macOS/Windows), os números de PID são finitos e eventualmente
        // reciclados pelo kernel. Se um processo anterior morrer abruptamente sem remover o lockfile e o
        // kernel posteriormente atribuir o mesmo PID a outro processo aleatório do sistema (ex: editor, banco),
        // `process.kill(pid, 0)` retornará true para esse processo alheio.
        //
        // POR QUE A DIREÇÃO É FAIL-SAFE:
        // A consequência de uma colisão de PID é um falso-positivo (o script assume defensivamente que o lock
        // está ocupado e adia sua própria execução). Essa decisão é estritamente segura (fail-safe): é preferível
        // pular uma rodada do que arriscar duas instâncias simultâneas corrompendo contextos do navegador, cookies
        // e sessões ativas do AliExpress.
        //
        // COMO O STALE-TIMEOUT MITIGA O CENÁRIO:
        // Caso um PID reciclado permaneça ativo por longo período, a condição anterior `isStale`
        // (baseada no tempo de criação do lock vs `staleTimeoutMs`, default 30 min) age como teto máximo de vida.
        // Ao atingir 30 minutos, o lock é considerado expirado e limpo independentemente do estado do PID,
        // garantindo que o sistema nunca entre em deadlock permanente.
        let isProcessAlive = false;
        try {
          // process.kill com sinal 0 apenas verifica se o processo existe
          process.kill(existingLock.pid, 0);
          isProcessAlive = true;
        } catch {
          isProcessAlive = false;
        }

        if (isProcessAlive && !force) {
          const msg = `O processo já está em execução no host local (PID ativo: ${existingLock.pid}, iniciado em: ${existingLock.createdAt}).`;
          logger.warn({ existingLock }, msg);
          throw new LockActiveError(msg, { existingLock });
        } else if (!isProcessAlive) {
          logger.info(
            { pid: existingLock.pid },
            'Removendo lockfile órfão de processo anterior finalizado.'
          );
          await fs.promises.unlink(targetLockPath).catch(() => {});
        } else if (force) {
          logger.warn(
            { pid: existingLock.pid },
            'Flag --force detectada: sobrescrevendo lockfile ativo.'
          );
          await fs.promises.unlink(targetLockPath).catch(() => {});
        }
      } else {
        // Outro host na mesma rede/diretório compartilhado
        if (!force) {
          const msg = `O processo está ativo em outro host (${existingLock.host}, PID: ${existingLock.pid}, iniciado em: ${existingLock.createdAt}).`;
          logger.warn({ existingLock }, msg);
          throw new LockActiveError(msg, { existingLock });
        } else {
          logger.warn(
            { existingLock },
            'Flag --force detectada: sobrescrevendo lockfile de outro host.'
          );
          await fs.promises.unlink(targetLockPath).catch(() => {});
        }
      }
    } else {
      await fs.promises.unlink(targetLockPath).catch(() => {});
    }
  }

  const lockData = {
    pid: process.pid,
    createdAt: new Date().toISOString(),
    host: os.hostname(),
    platform: process.platform
  };

  try {
    await fs.promises.writeFile(targetLockPath, JSON.stringify(lockData, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    });
    safeChmod600(targetLockPath);
  } catch (err) {
    logger.error({ err: err.message }, 'Falha ao criar arquivo de lock.');
    throw err;
  }

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try {
      const content = await fs.promises.readFile(targetLockPath, 'utf-8');
      const currentLock = JSON.parse(content);
      if (currentLock.pid === process.pid) {
        await fs.promises.unlink(targetLockPath).catch(() => {});
      }
    } catch {
      // Ignorar erros na remoção
    }
  };

  const onExit = async () => {
    await release();
  };

  process.once('SIGINT', onExit);
  process.once('SIGTERM', onExit);

  return release;
}

module.exports = {
  acquireLock,
  LockActiveError,
  lockFilePath: defaultLockFilePath,
  DEFAULT_STALE_TIMEOUT_MS
};
