'use strict';

/**
 * Métricas estruturadas por execução (Frente 4).
 *
 * O coletor é puro (não importa o logger) para ser testável e para garantir que apenas
 * campos selecionados saiam no evento final. Nunca inclui cookies, storageState, tokens,
 * e-mails ou mensagens de erro cruas — somente a conta mascarada e classes de resultado.
 */

const crypto = require('node:crypto');
const { maskUser } = require('../core/config');
const { formatDuration } = require('../core/time_utils');

const METRICS_SCHEMA_VERSION = 1;

/** @param {unknown} value @returns {number} */
function parseCoins(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = parseInt(String(value ?? '').replace(/[^0-9]/g, ''), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** @param {Date|string|number|null|undefined} value @returns {number|null} */
function toTimestamp(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** @param {object|null|undefined} result @returns {number|null} */
function durationFromResult(result) {
  if (!result) return null;
  const start = toTimestamp(result.startTime);
  const end = toTimestamp(result.endTime);
  if (start === null || end === null) return null;
  return Math.max(0, end - start);
}

/** @param {object|null|undefined} account @returns {string} */
function accountLabel(account) {
  if (!account) return '***';
  if (account.maskedUser) return String(account.maskedUser);
  return maskUser(account.user || '');
}

/**
 * Cria o contexto de métricas de uma execução.
 * @param {{mode?: 'single'|'multi', accounts?: object[], now?: Date, runId?: string}} [options={}]
 * @returns {object}
 */
function createRunMetrics({ mode = 'single', accounts = [], now = new Date(), runId } = {}) {
  const startedAt = new Date(now);
  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    runId: runId || crypto.randomUUID(),
    mode,
    startedAt: startedAt.toISOString(),
    startedAtMs: startedAt.getTime(),
    endedAt: null,
    durationMs: null,
    exitCode: null,
    accounts: accounts.map((account, index) => ({
      account: accountLabel(account),
      index: Number.isInteger(account?.index) ? account.index : index + 1,
      checkin: null,
      tasks: null,
      streakBroken: false
    })),
    totals: null
  };
}

/**
 * Localiza (ou cria) a entrada de uma conta no contexto.
 * @param {object} metrics
 * @param {{index?: number, account?: object}} params
 * @returns {object}
 */
function ensureAccount(metrics, { index, account } = {}) {
  const label = accountLabel(account);
  const resolvedIndex = Number.isInteger(index)
    ? index
    : Number.isInteger(account?.index)
      ? account.index
      : null;
  let entry = metrics.accounts.find(
    (item) =>
      (resolvedIndex !== null && item.index === resolvedIndex) ||
      (label !== '***' && item.account === label)
  );
  if (!entry) {
    entry = {
      account: label,
      index: resolvedIndex ?? metrics.accounts.length + 1,
      checkin: null,
      tasks: null,
      streakBroken: false
    };
    metrics.accounts.push(entry);
  }
  return entry;
}

/** @param {object|null|undefined} error @returns {boolean} */
function isBlockedError(error) {
  if (!error) return false;
  return Boolean(
    error.isCaptchaChallenge ||
    error.isCaptchaCooldown ||
    error.isManualLoginRequired ||
    error.is2FARequired ||
    error.isRiskControl ||
    error.name === 'TwoFactorRequiredNonInteractive'
  );
}

/** @param {object|null|undefined} error @returns {string|null} */
function classifyError(error) {
  if (!error) return null;
  if (error.isRiskControl) return 'risk_control';
  if (error.isCaptchaCooldown) return 'captcha_cooldown';
  if (error.isCaptchaChallenge) return 'captcha';
  if (error.isManualLoginRequired) return 'manual_login';
  if (error.is2FARequired || error.name === 'TwoFactorRequiredNonInteractive') return '2fa';
  if (error.isImportedSessionExpired) return 'session_expired';
  if (error.name === 'LockActiveError' || error.code === 'LOCK_ACTIVE') return 'lock_active';
  return 'unknown';
}

/** @param {{result?: object|null, error?: object|null}} params @returns {string} */
function classifyCheckin({ result, error } = {}) {
  if (error) return isBlockedError(error) ? 'blocked' : 'error';
  if (!result) return 'skipped';
  if (result.alreadyCollected === true) {
    const coins = parseCoins(result.coinsGainedToday);
    return result.checkinCoinsFromLedger === true && coins > 0 ? 'success' : 'already';
  }
  return 'success';
}

/** @param {{result?: object|null, error?: object|null}} params @returns {string} */
function classifyTasks({ result, error } = {}) {
  if (error) return 'error';
  if (!result) return 'skipped';
  return 'success';
}

/**
 * Registra o resultado do check-in de uma conta.
 * @param {object} metrics
 * @param {object} params
 * @param {number} [params.index]
 * @param {object} [params.account]
 * @param {object|null} [params.result]
 * @param {object|null} [params.error]
 * @param {number|null} [params.durationMs]
 * @param {boolean} [params.streakBroken]
 * @returns {object}
 */
function recordCheckin(
  metrics,
  { index, account, result = null, error = null, durationMs = null, streakBroken = false } = {}
) {
  const entry = ensureAccount(metrics, { index, account });
  entry.checkin = {
    outcome: classifyCheckin({ result, error }),
    durationMs:
      typeof durationMs === 'number'
        ? Math.max(0, durationMs)
        : (durationFromResult(result) ?? null),
    streakBefore: typeof result?.previousStreakDays === 'number' ? result.previousStreakDays : null,
    streakAfter:
      typeof result?.streakDays === 'number'
        ? result.streakDays
        : parseCoins(result?.streakDays) || null,
    longestStreak: typeof result?.longestStreakDays === 'number' ? result.longestStreakDays : null,
    coins: parseCoins(result?.coinsGainedToday),
    alreadyCollected: result?.alreadyCollected === true,
    reusedContext: result?.reusedEarlyDesktop === true,
    loginAttempted: result?.loginAttempted === true,
    captcha: isBlockedError(error) && (error?.isCaptchaChallenge || error?.isRiskControl) === true,
    errorClass: classifyError(error)
  };
  if (streakBroken === true) entry.streakBroken = true;
  return entry;
}

/**
 * Registra o resultado das tarefas de uma conta.
 * @param {object} metrics
 * @param {object} params
 * @param {number} [params.index]
 * @param {object} [params.account]
 * @param {object|null} [params.result]
 * @param {object|null} [params.error]
 * @param {number|null} [params.durationMs]
 * @returns {object}
 */
function recordTasks(
  metrics,
  { index, account, result = null, error = null, durationMs = null } = {}
) {
  const entry = ensureAccount(metrics, { index, account });
  entry.tasks = {
    outcome: classifyTasks({ result, error }),
    durationMs:
      typeof durationMs === 'number'
        ? Math.max(0, durationMs)
        : (durationFromResult(result) ?? null),
    coinsGained: parseCoins(result?.coinsGained),
    tasksCount: Array.isArray(result?.results) ? result.results.length : 0,
    errorClass: classifyError(error)
  };
  return entry;
}

/**
 * Marca quebra de streak sem sobrescrever o resultado do check-in.
 * @param {object} metrics
 * @param {{index?: number, account?: object}} params
 */
function markStreakBroken(metrics, params = {}) {
  ensureAccount(metrics, params).streakBroken = true;
}

/** @param {object} metrics @returns {object} */
function computeTotals(metrics) {
  const totals = {
    accounts: metrics.accounts.length,
    checkin: { success: 0, already: 0, blocked: 0, error: 0, skipped: 0 },
    tasks: { success: 0, error: 0, skipped: 0 },
    streakBroken: 0,
    coinsGained: 0
  };
  for (const entry of metrics.accounts) {
    if (entry.checkin) totals.checkin[entry.checkin.outcome] += 1;
    if (entry.tasks) totals.tasks[entry.tasks.outcome] += 1;
    if (entry.streakBroken) totals.streakBroken += 1;
    totals.coinsGained += (entry.checkin?.coins || 0) + (entry.tasks?.coinsGained || 0);
  }
  return totals;
}

/**
 * Finaliza a execução. Idempotente: chamadas repetidas devolvem o mesmo snapshot.
 * @param {object} metrics
 * @param {{exitCode?: number|null, now?: Date}} [options={}]
 * @returns {object}
 */
function finalizeRun(metrics, { exitCode = null, now = new Date() } = {}) {
  if (metrics.endedAt) return metrics;
  const endedAt = new Date(now);
  metrics.endedAt = endedAt.toISOString();
  metrics.durationMs = Math.max(0, endedAt.getTime() - metrics.startedAtMs);
  metrics.exitCode = typeof exitCode === 'number' ? exitCode : null;
  metrics.totals = computeTotals(metrics);
  return metrics;
}

/** @param {object} totals @returns {string} */
function formatCounts(totals) {
  return (
    Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${key}:${value}`)
      .join(',') || '0'
  );
}

/**
 * Payload seguro para log/JSON: allowlist explícita, sem dados de sessão.
 * @param {object} metrics
 * @returns {object}
 */
function toLogPayload(metrics) {
  const totals = metrics.totals || computeTotals(metrics);
  return {
    event: 'run_metrics',
    schemaVersion: METRICS_SCHEMA_VERSION,
    runId: metrics.runId,
    mode: metrics.mode,
    startedAt: metrics.startedAt,
    endedAt: metrics.endedAt,
    durationMs: metrics.durationMs,
    exitCode: metrics.exitCode,
    accounts: metrics.accounts.map((entry) => ({
      account: entry.account,
      index: entry.index,
      checkin: entry.checkin ? { ...entry.checkin } : null,
      tasks: entry.tasks ? { ...entry.tasks } : null,
      streakBroken: entry.streakBroken === true
    })),
    totals: {
      ...totals,
      checkin: { ...totals.checkin },
      tasks: { ...totals.tasks }
    }
  };
}

/**
 * Resumo legível (PT) usado como fallback do log estruturado.
 * @param {object} metrics
 * @returns {string}
 */
function formatSummary(metrics) {
  const totals = metrics.totals || computeTotals(metrics);
  return (
    `Métricas run=${metrics.runId} modo=${metrics.mode} duração=${formatDuration(metrics.durationMs || 0)} ` +
    `contas=${totals.accounts} check-in=${formatCounts(totals.checkin)} tarefas=${formatCounts(totals.tasks)} ` +
    `streak-quebrado=${totals.streakBroken} moedas=${totals.coinsGained} saída=${metrics.exitCode ?? 'N/D'}`
  );
}

/**
 * Parâmetros posicionais do template `observability.metrics.summary`.
 * @param {object} metrics
 * @returns {Array<unknown>}
 */
function summaryParams(metrics) {
  const totals = metrics.totals || computeTotals(metrics);
  return [
    metrics.runId,
    metrics.mode,
    formatDuration(metrics.durationMs || 0),
    totals.accounts,
    formatCounts(totals.checkin),
    formatCounts(totals.tasks),
    totals.streakBroken,
    totals.coinsGained,
    metrics.exitCode ?? 'N/D'
  ];
}

/**
 * Emite o evento estruturado + resumo legível no logger informado.
 * @param {object} metrics
 * @param {object} logger
 * @param {{exitCode?: number|null, now?: Date}} [options={}]
 * @returns {object} payload emitido
 */
function logRunMetrics(metrics, logger, options = {}) {
  finalizeRun(metrics, options);
  const payload = toLogPayload(metrics);
  logger.info(
    {
      ...payload,
      msgId: 'observability.metrics.summary',
      msgParams: summaryParams(metrics)
    },
    formatSummary(metrics)
  );
  return payload;
}

module.exports = {
  METRICS_SCHEMA_VERSION,
  createRunMetrics,
  recordCheckin,
  recordTasks,
  markStreakBroken,
  finalizeRun,
  computeTotals,
  toLogPayload,
  formatSummary,
  summaryParams,
  logRunMetrics,
  classifyCheckin,
  classifyTasks,
  classifyError,
  isBlockedError
};
