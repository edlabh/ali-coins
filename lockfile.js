const fs = require('fs');
const os = require('os');
const { lockFilePath: defaultLockFilePath } = require('./config');
const { safeChmod600 } = require('./security');
const logger = require('./logger');

const DEFAULT_STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos
const MAX_ACQUIRE_ATTEMPTS = 5; // Tentativas após remoção de locks órfãos/stale/symlink

class LockActiveError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LockActiveError';
    this.code = 'LOCK_ACTIVE';
    this.details = details;
  }
}

/**
 * Verifica se um PID está vivo de forma defensiva (process.kill com sinal 0)
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Adquire lock exclusivo de forma assíncrona para evitar execuções simultâneas ou sobrepostas.
 * A criação utiliza a flag exclusiva 'wx' (O_CREAT|O_EXCL), eliminando a janela TOCTOU
 * (check-then-write) que permitia duas instâncias adquirirem o mesmo lock simultaneamente.
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

  const lockData = {
    pid: process.pid,
    createdAt: new Date().toISOString(),
    host: os.hostname(),
    platform: process.platform
  };
  const serializedLock = JSON.stringify(lockData, null, 2);

  const removeLockFile = async () => {
    await fs.promises.unlink(targetLockPath).catch(() => {});
  };

  const readExistingLock = async () => {
    try {
      const content = await fs.promises.readFile(targetLockPath, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed && parsed.pid ? parsed : null;
    } catch {
      return null;
    }
  };

  let acquired = false;

  for (let attempt = 1; attempt <= MAX_ACQUIRE_ATTEMPTS && !acquired; attempt++) {
    // Criação atômica e exclusiva: nunca segue symlink pré-existente (wx => EEXIST)
    let handle = null;
    try {
      handle = await fs.promises.open(targetLockPath, 'wx', 0o600);
      try {
        await handle.writeFile(serializedLock, 'utf-8');
        await handle.sync().catch(() => {});
      } catch (writeErr) {
        await handle.close().catch(() => {});
        handle = null;
        await removeLockFile();
        throw writeErr;
      }
      await handle.close().catch(() => {});
      handle = null;
      safeChmod600(targetLockPath);
      acquired = true;
      break;
    } catch (err) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      if (err.code !== 'EEXIST') {
        logger.error({ err: err.message }, 'Falha ao criar arquivo de lock.');
        throw err;
      }
    }

    // Defesa contra symlink: nunca tratamos um link como lock válido; removemos apenas o link
    try {
      const stat = await fs.promises.lstat(targetLockPath);
      if (stat.isSymbolicLink()) {
        logger.warn(
          { lockPath: targetLockPath },
          'Lockfile suspeito (symlink) detectado. Removendo apenas o link por segurança.'
        );
        await removeLockFile();
        continue;
      }
    } catch {
      // Arquivo removido concorrentemente; próxima iteração tenta criar novamente
      continue;
    }

    const existingLock = await readExistingLock();

    if (!existingLock) {
      logger.warn(
        { lockPath: targetLockPath },
        'Lockfile ilegível ou inválido detectado. Removendo para recriar com segurança.'
      );
      await removeLockFile();
      continue;
    }

    const lockCreatedAt = existingLock.createdAt ? new Date(existingLock.createdAt).getTime() : 0;
    const lockAge = Date.now() - lockCreatedAt;
    const isStale = !isNaN(lockAge) && lockAge > staleTimeoutMs;
    const isSameHost = existingLock.host === os.hostname();

    if (isStale) {
      logger.warn(
        { pid: existingLock.pid, host: existingLock.host, lockAgeMs: lockAge, staleTimeoutMs },
        'Lockfile expirado (staleTimeout atingido). Removendo lock antigo.'
      );
      await removeLockFile();
      continue;
    }

    if (isSameHost) {
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
      const isProcessAliveOnHost = isProcessAlive(existingLock.pid);

      if (isProcessAliveOnHost && !force) {
        const msg = `O processo já está em execução no host local (PID ativo: ${existingLock.pid}, iniciado em: ${existingLock.createdAt}).`;
        logger.warn({ existingLock }, msg);
        throw new LockActiveError(msg, { existingLock });
      }

      if (!isProcessAliveOnHost) {
        logger.info(
          { pid: existingLock.pid },
          'Removendo lockfile órfão de processo anterior finalizado.'
        );
        await removeLockFile();
        continue;
      }

      logger.warn(
        { pid: existingLock.pid },
        'Flag --force detectada: sobrescrevendo lockfile ativo.'
      );
      await removeLockFile();
      continue;
    }

    // Outro host na mesma rede/diretório compartilhado
    if (!force) {
      const msg = `O processo está ativo em outro host (${existingLock.host}, PID: ${existingLock.pid}, iniciado em: ${existingLock.createdAt}).`;
      logger.warn({ existingLock }, msg);
      throw new LockActiveError(msg, { existingLock });
    }

    logger.warn({ existingLock }, 'Flag --force detectada: sobrescrevendo lockfile de outro host.');
    await removeLockFile();
  }

  if (!acquired) {
    throw new Error(
      `Não foi possível adquirir o lockfile "${targetLockPath}" após ${MAX_ACQUIRE_ATTEMPTS} tentativas concorrentes.`
    );
  }

  let released = false;
  const signalHandlers = new Map();

  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    signalHandlers.clear();
  };

  const release = async () => {
    if (released) return;
    released = true;
    // Restaura o comportamento padrão dos sinais após a liberação do lock
    removeSignalHandlers();
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

  // Libera o lock e reemite o sinal para que o processo encerre com o comportamento padrão
  const handleSignal = (signal) => {
    void release().finally(() => {
      removeSignalHandlers();
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exit(1);
      }
      // Fallback (ex: Windows): garante encerramento mesmo se o sinal não for fatal
      setTimeout(() => process.exit(1), 2000);
    });
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => handleSignal(signal);
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  return release;
}

module.exports = {
  acquireLock,
  LockActiveError,
  lockFilePath: defaultLockFilePath,
  DEFAULT_STALE_TIMEOUT_MS,
  MAX_ACQUIRE_ATTEMPTS
};
