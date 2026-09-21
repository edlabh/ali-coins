const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { lockFilePath: defaultLockFilePath } = require('./config');
const { safeChmod600 } = require('./security');
const logger = require('./logger');

const DEFAULT_STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos
const MAX_ACQUIRE_ATTEMPTS = 5; // Tentativas após remoção de locks órfãos/stale/symlink
// Carência de leitura: um lock recém-criado pode estar sendo escrito por outro processo
// (fallback em filesystems sem hardlink). Só removemos como "inválido" após esta janela.
const LOCK_READ_GRACE_MS = 900;
const LOCK_READ_RETRY_MS = 150;
// Tolerância de skew de relógio para timestamps de createdAt (acima disso = lock forjado/corrompido)
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
// Códigos de erro que indicam filesystem sem suporte a hardlink (fallback para 'wx')
const LINK_UNSUPPORTED_CODES = new Set([
  'EXDEV',
  'EPERM',
  'ENOSYS',
  'EOPNOTSUPP',
  'ENOTSUP',
  'EMLINK'
]);

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
  } catch (err) {
    // EPERM = o processo existe, mas não temos permissão para sinalizá-lo.
    // Tratar como vivo evita remover o lock de outra instância legítima.
    if (err && err.code === 'EPERM') return true;
    return false;
  }
}

/**
 * Adquire lock exclusivo de forma assíncrona para evitar execuções simultâneas ou sobrepostas.
 * A publicação é feita por hardlink atômico de um arquivo temporário já completo
 * (`link` falha com EEXIST sem sobrescrever), eliminando a janela em que o lock existia
 * vazio entre `open('wx')` e a escrita do conteúdo — cenário que permitia a um concorrente
 * ler um arquivo incompleto, removê-lo e ambos se considerarem donos do lock.
 * Em filesystems sem hardlink, usa fallback `wx` com carência de leitura antes de remover
 * um lock "inválido" (evita destruir o lock de quem ainda está escrevendo).
 * @param {boolean} [force=false] Se true, remove lock existente mesmo que ativo
 * @param {number} [customStaleTimeoutMs] Tempo limite de inatividade para considerar lock órfão
 * @param {string} [customLockFilePath] Caminho customizado para o arquivo de lock
 * @param {number} [customRefreshIntervalMs] Intervalo do refresh de createdAt (default: stale/3, teto 5min)
 * @returns {Promise<() => Promise<void>>} Função assíncrona para liberar o lock
 */
async function acquireLock(
  force = false,
  customStaleTimeoutMs = null,
  customLockFilePath = null,
  customRefreshIntervalMs = null
) {
  const targetLockPath = customLockFilePath || defaultLockFilePath;
  const rawStaleTimeout =
    customStaleTimeoutMs ||
    (process.env.LOCK_STALE_TIMEOUT_MS
      ? parseInt(process.env.LOCK_STALE_TIMEOUT_MS, 10)
      : DEFAULT_STALE_TIMEOUT_MS);
  // Valida o valor: `0`/negativo removeria lock vivo (dupla execução) e `NaN`
  // desativaria o stale-timeout e tornaria o intervalo de refresh inválido.
  const staleTimeoutMs =
    Number.isFinite(rawStaleTimeout) && rawStaleTimeout > 0
      ? rawStaleTimeout
      : DEFAULT_STALE_TIMEOUT_MS;

  const lockData = {
    pid: process.pid,
    // Identidade única da geração deste lock: o release só remove o arquivo se o
    // lockId ainda for o nosso (evita apagar o lock de outra instância que o
    // substituiu entre a leitura e o unlink).
    lockId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    host: os.hostname(),
    platform: process.platform
  };
  const serializedLock = JSON.stringify(lockData, null, 2);

  /**
   * Remove o lockfile de forma CONDICIONAL (anti-TOCTOU). Entre a leitura que decidiu
   * "stale/órfão/inválido" e a remoção, outro processo pode ter removido o lock antigo
   * e publicado o dele — apagar por caminho destruiria o lock do novo dono e permitiria
   * duas execuções concorrentes na mesma conta.
   *
   * @param {object|null|undefined} expected
   *   - `undefined`: remoção simples (symlinks, que não têm geração JSON);
   *   - `null`: espera-se conteúdo inválido (só remove se continuar inválido);
   *   - objeto do lock lido: só remove se a geração (lockId/pid+createdAt) ainda bater.
   */
  const removeLockFile = async (expected = undefined) => {
    if (expected === undefined) {
      await fs.promises.unlink(targetLockPath).catch(() => {});
      return;
    }
    const claimPath = `${targetLockPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
    try {
      await fs.promises.rename(targetLockPath, claimPath);
    } catch {
      return; // já removido/substituído por outro processo
    }

    let matches = false;
    try {
      const current = JSON.parse(await fs.promises.readFile(claimPath, 'utf-8'));
      if (expected === null) {
        matches = false; // esperávamos inválido, mas agora é JSON válido: outro dono assumiu
      } else {
        matches = current.lockId
          ? current.lockId === expected.lockId
          : current.pid === expected.pid &&
            (expected.createdAt === undefined || current.createdAt === expected.createdAt);
      }
    } catch {
      // Conteúdo inválido/ilegível: corresponde à expectativa de "inválido" (null) —
      // exceto quando o caminho é um DIRETÓRIO (lock ocupado por algo não removível):
      // devolvemos ao lugar para o chamador falhar rápido com mensagem clara.
      const isDir = await fs.promises
        .lstat(claimPath)
        .then((s) => s.isDirectory())
        .catch(() => false);
      matches = expected === null && !isDir;
    }

    if (matches) {
      await fs.promises.unlink(claimPath).catch(() => {});
    } else {
      // Outra geração assumiu: devolve o lock alheio em vez de destruí-lo.
      await fs.promises.rename(claimPath, targetLockPath).catch(() => {});
    }
  };

  // Lê o lock existente. Com allowGrace, tolera arquivos em escrita (vazio/parcial)
  // por até LOCK_READ_GRACE_MS antes de considerá-lo definitivamente inválido.
  const readExistingLock = async ({ allowGrace = false } = {}) => {
    const deadline = Date.now() + (allowGrace ? LOCK_READ_GRACE_MS : 0);
    let ioError = null;

    for (;;) {
      try {
        const content = await fs.promises.readFile(targetLockPath, 'utf-8');
        if (content.trim()) {
          try {
            const parsed = JSON.parse(content);
            if (parsed && parsed.pid) return { lock: parsed, status: 'ok' };
          } catch {
            // JSON inválido: aguarda a carência antes de decidir
          }
        }
      } catch (err) {
        if (err.code === 'ENOENT') return { lock: null, status: 'missing' };
        // Diretório no caminho: cai no fluxo de remoção/falha clara
        if (err.code === 'EISDIR') return { lock: null, status: 'invalid' };
        // Erro transitório de I/O (EBUSY/EPERM/EACCES em Windows/AV): NUNCA remover
        ioError = err;
      }

      if (Date.now() >= deadline) {
        return { lock: null, status: ioError ? 'io-error' : 'invalid' };
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_READ_RETRY_MS));
    }
  };

  // Publica o lock via hardlink de um temp já completo (atômico, nunca sobrescreve)
  const publishLockViaLink = async () => {
    const tmpPath = `${targetLockPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    let handle = null;
    try {
      handle = await fs.promises.open(tmpPath, 'wx', 0o600);
      await handle.writeFile(serializedLock, 'utf-8');
      await handle.sync().catch(() => {});
      await handle.close();
      handle = null;

      try {
        await fs.promises.link(tmpPath, targetLockPath);
        safeChmod600(targetLockPath);
        return 'created';
      } catch (linkErr) {
        if (linkErr.code === 'EEXIST') return 'exists';
        if (LINK_UNSUPPORTED_CODES.has(linkErr.code)) return 'unsupported';
        throw linkErr;
      }
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  };

  // Fallback para filesystems sem hardlink (FAT/alguns mounts de rede)
  const publishLockViaWx = async () => {
    const handle = await fs.promises.open(targetLockPath, 'wx', 0o600);
    try {
      await handle.writeFile(serializedLock, 'utf-8');
      await handle.sync().catch(() => {});
    } catch (writeErr) {
      await handle.close().catch(() => {});
      await removeLockFile();
      throw writeErr;
    }
    await handle.close().catch(() => {});
    safeChmod600(targetLockPath);
  };

  let acquired = false;

  for (let attempt = 1; attempt <= MAX_ACQUIRE_ATTEMPTS && !acquired; attempt++) {
    let publishResult;
    try {
      publishResult = await publishLockViaLink();
    } catch (err) {
      logger.error({ err: err.message }, 'Falha ao criar arquivo de lock.');
      throw err;
    }

    if (publishResult === 'unsupported') {
      try {
        await publishLockViaWx();
        publishResult = 'created';
      } catch (err) {
        if (err.code !== 'EEXIST') {
          logger.error({ err: err.message }, 'Falha ao criar arquivo de lock.');
          throw err;
        }
        publishResult = 'exists';
      }
    }

    if (publishResult === 'created') {
      acquired = true;
      break;
    }

    // 'exists': inspecionar o lock vigente
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

    const readResult = await readExistingLock({ allowGrace: true });
    const existingLock = readResult.lock;

    if (!existingLock) {
      if (readResult.status === 'missing') {
        // Removido concorrentemente: tenta criar novamente
        continue;
      }

      if (readResult.status === 'io-error') {
        // Erro transitório de I/O (ex: antivírus/indexador no Windows segurando o arquivo):
        // tratar como lock ativo é fail-safe — nunca remover um lock que pode ser válido.
        const msg = `Não foi possível ler o lockfile "${targetLockPath}" (erro de I/O transitório). Tratando como lock ativo por segurança.`;
        logger.warn({ lockPath: targetLockPath }, msg);
        throw new LockActiveError(msg, { ioError: true });
      }

      logger.warn(
        { lockPath: targetLockPath },
        'Lockfile ilegível ou inválido detectado após carência de leitura. Removendo para recriar com segurança.'
      );
      await removeLockFile(null);
      // Falha rápida e clara se o caminho está ocupado por algo não removível
      // (ex: diretório deixado por outro usuário), em vez de repetir 5 rodadas
      const stillOccupied = await fs.promises
        .lstat(targetLockPath)
        .then(() => true)
        .catch(() => false);
      if (stillOccupied) {
        throw new Error(
          `Não foi possível remover o lockfile inválido em "${targetLockPath}". ` +
            'O caminho está ocupado por um arquivo/diretório não removível (verifique permissões).'
        );
      }
      continue;
    }

    // createdAt não confiável (lock forjado/corrompido): datas inválidas/ausentes ou
    // "no futuro" além da tolerância de clock são tratadas como stale — impedindo
    // bloqueio permanente por um lock com timestamp malicioso (o lock agora é por
    // usuário em diretório temporário local, então não há cenário multihost a preservar).
    const rawCreatedAt = existingLock.createdAt ? new Date(existingLock.createdAt).getTime() : NaN;
    const isFutureTimestamp = rawCreatedAt > Date.now() + CLOCK_SKEW_TOLERANCE_MS;
    const isInvalidTimestamp = Number.isNaN(rawCreatedAt) || isFutureTimestamp;
    const lockCreatedAt = isInvalidTimestamp ? 0 : rawCreatedAt;
    const lockAge = Math.max(0, Date.now() - lockCreatedAt);
    const isStale = isInvalidTimestamp || lockAge > staleTimeoutMs;
    const isSameHost = existingLock.host === os.hostname();

    if (isStale) {
      logger.warn(
        { pid: existingLock.pid, host: existingLock.host, lockAgeMs: lockAge, staleTimeoutMs },
        'Lockfile expirado (staleTimeout atingido). Removendo lock antigo.'
      );
      await removeLockFile(existingLock);
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
        await removeLockFile(existingLock);
        continue;
      }

      logger.warn(
        { pid: existingLock.pid },
        'Flag --force detectada: sobrescrevendo lockfile ativo.'
      );
      await removeLockFile(existingLock);
      continue;
    }

    // Outro host na mesma rede/diretório compartilhado
    if (!force) {
      const msg = `O processo está ativo em outro host (${existingLock.host}, PID: ${existingLock.pid}, iniciado em: ${existingLock.createdAt}).`;
      logger.warn({ existingLock }, msg);
      throw new LockActiveError(msg, { existingLock });
    }

    logger.warn({ existingLock }, 'Flag --force detectada: sobrescrevendo lockfile de outro host.');
    await removeLockFile(existingLock);
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

  // Refresh periódico do createdAt: um run longo (ex: loop de tarefas pode chegar a
  // ~75 min) nunca deve ser considerado stale por outra instância, o que permitiria
  // duas execuções concorrentes sobre a mesma conta.
  const refreshIntervalMs =
    typeof customRefreshIntervalMs === 'number' && customRefreshIntervalMs > 0
      ? customRefreshIntervalMs
      : Math.max(50, Math.min(Math.floor(staleTimeoutMs / 3), 5 * 60 * 1000));

  let refreshInFlight = null;
  let refreshFailures = 0;
  const refreshLock = () => {
    if (released || refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      let tmpPath = null;
      try {
        // Renova somente se o lock ainda for nosso. Lê e confere a posse ANTES de
        // sobrescrever, e grava num arquivo temporário renomeado por cima (overwrite
        // atômico). Diferente de mover o lock para um claim, o caminho final NUNCA fica
        // ausente durante a renovação — evita que terceiros (ou um check de stale)
        // observem o lock como inexistente (regressão observada no Windows).
        if (!fs.existsSync(targetLockPath)) return;
        let isOurs = false;
        try {
          const current = JSON.parse(await fs.promises.readFile(targetLockPath, 'utf-8'));
          isOurs = current.lockId
            ? current.lockId === lockData.lockId
            : current.pid === process.pid;
        } catch {
          isOurs = false;
        }
        if (!isOurs || released) return;

        lockData.createdAt = new Date().toISOString();
        tmpPath = `${targetLockPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
        await fs.promises.writeFile(tmpPath, JSON.stringify(lockData, null, 2), { mode: 0o600 });
        await fs.promises.rename(tmpPath, targetLockPath);
        tmpPath = null;
        refreshFailures = 0;
      } catch (err) {
        // Erro transitório (lock substituído, permissão, AV): avisa sem travar o run.
        // Falhas persistentes são perigosas: o lock pode ser considerado stale por outra
        // instância após staleTimeoutMs, permitindo execução concorrente.
        refreshFailures++;
        if (refreshFailures === 1 || refreshFailures % 10 === 0) {
          logger.warn(
            { err: err.message, refreshFailures, lockPath: targetLockPath },
            'Falha ao renovar o lock; outra instância pode considerá-lo obsoleto e assumir a execução.'
          );
        }
      } finally {
        // Se o temp foi criado mas a rename não concluiu, remove o resíduo.
        if (tmpPath) await fs.promises.unlink(tmpPath).catch(() => {});
      }
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  };

  const refreshTimer = setInterval(() => {
    void refreshLock();
  }, refreshIntervalMs);
  if (refreshTimer.unref) refreshTimer.unref();

  const release = async () => {
    if (released) return;
    released = true;
    clearInterval(refreshTimer);
    // Aguarda um refresh em andamento antes de remover o arquivo (evita recriação pós-unlink)
    if (refreshInFlight) {
      await refreshInFlight.catch(() => {});
    }
    // Restaura o comportamento padrão dos sinais após a liberação do lock
    removeSignalHandlers();
    try {
      // Remoção atômica condicional: move o lock para um caminho privado (rename atômico),
      // confere se ainda é o nosso e só então apaga. Se outro dono assumiu entre a leitura
      // e a remoção, restaura o lock alheio em vez de apagá-lo (elimina o TOCTOU).
      const claimPath = `${targetLockPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
      try {
        await fs.promises.rename(targetLockPath, claimPath);
      } catch {
        return; // lock já não existe
      }

      let isOurs = false;
      try {
        const content = await fs.promises.readFile(claimPath, 'utf-8');
        const currentLock = JSON.parse(content);
        // lockId identifica a geração do lock; locks legados (sem lockId) usam o PID
        isOurs = currentLock.lockId
          ? currentLock.lockId === lockData.lockId
          : currentLock.pid === process.pid;
      } catch {
        isOurs = false;
      }

      if (isOurs) {
        await fs.promises.unlink(claimPath).catch(() => {});
      } else {
        await fs.promises.rename(claimPath, targetLockPath).catch(() => {});
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
  isProcessAlive,
  LockActiveError,
  lockFilePath: defaultLockFilePath,
  DEFAULT_STALE_TIMEOUT_MS,
  MAX_ACQUIRE_ATTEMPTS
};
