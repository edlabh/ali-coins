const fs = require('fs');
const os = require('os');
const { lockFilePath } = require('./config');
const { safeChmod600 } = require('./security');
const logger = require('./logger');

/**
 * Adquire lock exclusivo de forma assíncrona para evitar execuções simultâneas ou sobrepostas
 * @param {boolean} [force=false] Se true, remove lock existente mesmo que ativo
 * @returns {Promise<() => Promise<void>>} Função assíncrona para liberar o lock
 */
async function acquireLock(force = false) {
  let lockFileExists = false;
  try {
    await fs.promises.access(lockFilePath);
    lockFileExists = true;
  } catch (_) {
    lockFileExists = false;
  }

  if (lockFileExists) {
    let existingLock = null;
    try {
      const content = await fs.promises.readFile(lockFilePath, 'utf-8');
      existingLock = JSON.parse(content);
    } catch (_) {}

    if (existingLock && existingLock.pid) {
      let isProcessAlive = false;
      try {
        // process.kill com sinal 0 apenas verifica se o processo com o PID existe
        process.kill(existingLock.pid, 0);
        isProcessAlive = true;
      } catch (err) {
        isProcessAlive = false;
      }

      if (isProcessAlive && !force) {
        console.warn(`\n[LOCK] O script já está em execução (PID ativo: ${existingLock.pid}, iniciado em: ${existingLock.createdAt}).`);
        console.warn('[LOCK] Para destravar e forçar uma nova execução, utilize a flag: --force\n');
        process.exit(0);
      } else if (!isProcessAlive) {
        logger.info({ pid: existingLock.pid }, 'Removendo lockfile órfão de processo anterior finalizado.');
        await fs.promises.unlink(lockFilePath).catch(() => {});
      } else if (force) {
        logger.warn({ pid: existingLock.pid }, 'Flag --force detectada: sobrescrevendo lockfile ativo.');
        await fs.promises.unlink(lockFilePath).catch(() => {});
      }
    } else {
      await fs.promises.unlink(lockFilePath).catch(() => {});
    }
  }

  const lockData = {
    pid: process.pid,
    createdAt: new Date().toISOString(),
    host: os.hostname(),
    platform: process.platform
  };

  try {
    await fs.promises.writeFile(lockFilePath, JSON.stringify(lockData, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    });
    safeChmod600(lockFilePath);
  } catch (err) {
    logger.error({ err: err.message }, 'Falha ao criar arquivo de lock.');
  }

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try {
      const content = await fs.promises.readFile(lockFilePath, 'utf-8');
      const currentLock = JSON.parse(content);
      if (currentLock.pid === process.pid) {
        await fs.promises.unlink(lockFilePath).catch(() => {});
      }
    } catch (_) {}
  };

  process.once('SIGINT', async () => {
    await release();
    process.exit(130);
  });
  process.once('SIGTERM', async () => {
    await release();
    process.exit(143);
  });

  return release;
}

module.exports = {
  acquireLock,
  lockFilePath
};
