const fs = require('fs');
const os = require('os');
const { formatDate, formatDateTime, formatDuration } = require('../time_utils');
const { maskUser } = require('../config');
const logger = require('../logger');

const TELEGRAM_MAX_LENGTH = 4096;
const TELEGRAM_SAFE_LIMIT = 3900;

/**
 * Escapa caracteres especiais para HTML do Telegram (<, >, &)
 * @param {*} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Verifica se a falha está associada a uma sessão importada de outro host que expirou
 * @param {Error|object|string} [error]
 * @param {object} [report]
 * @returns {boolean}
 */
function checkIfImportedSessionExpired(error = null, report = null) {
  if (error && error.isImportedSessionExpired) return true;
  if (report && report.isImportedSessionExpired) return true;
  if (report && Array.isArray(report.accounts)) {
    if (
      report.accounts.some(
        (a) => a && (a.isImportedSessionExpired || a.error?.isImportedSessionExpired)
      )
    ) {
      return true;
    }
  }

  const errMsg = error && error.message ? error.message : typeof error === 'string' ? error : '';
  if (
    /sessão.*(importada|remota).*expir/i.test(errMsg) ||
    /node export_session\.js/i.test(errMsg)
  ) {
    return true;
  }

  // Fallback: verificar se session_meta.json indica sessão importada e o erro foi de login/autenticação
  try {
    const { sessionMetaPath } = require('../config');
    if (sessionMetaPath && fs.existsSync(sessionMetaPath)) {
      const meta = JSON.parse(fs.readFileSync(sessionMetaPath, 'utf-8'));
      if (meta && (meta.isImported || meta.importedAt)) {
        if (/login|autentic|sess[aã]o|streak|saldo|desafio|challenge/i.test(errMsg)) {
          return true;
        }
      }
    }
  } catch {
    // Ignorar falha de leitura de fallback
  }

  return false;
}

/**
 * Extrai a mensagem de erro mais relevante e concisa para notificação do Telegram,
 * priorizando a mensagem principal e a causa raiz em vez de logs de encerramento/cleanup.
 * @param {Error|object|string} error
 * @returns {string}
 */
function extractRelevantErrorMessage(error) {
  if (!error) return 'Erro desconhecido durante o processamento.';

  let raw = '';
  if (typeof error === 'string') {
    raw = error;
  } else if (error instanceof Error || (typeof error === 'object' && error.message)) {
    raw = error.message;
  } else {
    raw = String(error);
  }

  raw = raw.trim();
  if (!raw) return 'Erro desconhecido durante o processamento.';

  // Se o erro contém delimitador de logs do Playwright (ex: =========================== logs ===========================),
  // a causa raiz real está ANTES dos logs de cleanup do processo!
  if (/={5,}\s*logs?\s*={5,}/i.test(raw)) {
    const parts = raw.split(/={5,}\s*logs?\s*={5,}/i);
    const beforeLogs = parts[0]?.trim();
    if (beforeLogs) {
      const topLines = beforeLogs
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (topLines.length > 0) {
        return topLines.slice(0, 3).join('\n');
      }
    }
  }

  // Se tem seção "Call log:", a mensagem principal antecede o log de chamadas
  if (/Call log:/i.test(raw)) {
    const parts = raw.split(/Call log:/i);
    const beforeCall = parts[0]?.trim();
    if (beforeCall) {
      const topLines = beforeCall
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (topLines.length > 0) {
        return topLines.slice(0, 3).join('\n');
      }
    }
  }

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length <= 3) {
    return lines.join('\n');
  }

  // Filtrar linhas irrelevantes de cleanup de processos e stack traces internos
  const irrelevantRegex = /^(at\s+|-\s*\[pid=|<\s*gracefully|\(?node:internal)/i;
  const meaningfulLines = lines.filter((l) => !irrelevantRegex.test(l));

  // Priorizar linhas que contenham termos críticos de erro
  const errorIndicatorRegex =
    /(error|fatal|fail|sandboxing|timeout|recusad|inválid|expirad|bloque|crash|exception)/i;
  const errorLines = meaningfulLines.filter((l) => errorIndicatorRegex.test(l));
  if (errorLines.length > 0) {
    return errorLines.slice(0, 3).join('\n');
  }

  if (meaningfulLines.length > 0) {
    return meaningfulLines.slice(0, 3).join('\n');
  }

  return lines.slice(0, 3).join('\n');
}

/**
 * Constrói mensagem formatada em HTML para o Telegram a partir do relatório e evento
 * @param {object} params
 * @param {object} [params.report] Objeto de relatório (--json) de libs/report.js
 * @param {'success'|'already_collected'|'failure'|'lock_active'|'dry_run'|'manual_test'|'streak_break'|'2fa_required'} [params.event='success']
 * @param {Error|object|string} [params.error]
 * @param {string} [params.customMessage]
 * @param {string} [params.hostname]
 * @returns {string} Mensagem formatada em HTML para Telegram
 */
function buildMessage({
  report = null,
  event = 'success',
  error = null,
  customMessage = null,
  hostname = process.env.NOTIFY_HOST_LABEL || os.hostname()
} = {}) {
  const now = formatDateTime(new Date());
  const safeHost = escapeHtml(hostname);

  const resolveUser = (rep) => {
    if (!rep || rep.type === 'multi_account_report') return null; // evita falso-atribuir à conta 1
    const raw = rep.user || rep.userEmail || rep.account?.maskedUser || rep.account?.user;
    if (raw) {
      return raw.includes('***') ? raw : maskUser(raw);
    }
    return process.env.ALI_USER ? maskUser(process.env.ALI_USER) : 'desconhecida';
  };

  if (customMessage) {
    return customMessage;
  }

  // 1. Mensagem de teste dry-run
  if (event === 'dry_run') {
    return [
      '🧪 <b>AliExpress Moedas - Teste Dry-Run</b>',
      '',
      'A validação de ambiente e credenciais foi concluída com sucesso!',
      `📅 <b>Data:</b> ${now}`,
      `🖥️ <b>Host:</b> <code>${safeHost}</code>`,
      '🔔 <b>Notificações Telegram:</b> Operacionais e ativas'
    ].join('\n');
  }

  // 2. Mensagem de teste manual
  if (event === 'manual_test') {
    return [
      '🔔 <b>AliExpress Moedas - Teste de Notificação Telegram</b>',
      '',
      'Se você está lendo esta mensagem, o bot do Telegram foi configurado com sucesso e está operando perfeitamente! 🎉',
      `📅 <b>Data:</b> ${now}`,
      `🖥️ <b>Host:</b> <code>${safeHost}</code>`
    ].join('\n');
  }

  // 3. Lockfile ativo
  if (event === 'lock_active') {
    const errorDetails = error && error.message ? error.message : String(error || '');
    const userDisplay = resolveUser(report);
    return [
      '⚠️ <b>AliExpress Moedas - Execução Bloqueada (Lock Ativo)</b>',
      '',
      'Outra instância da automação já está em execução no host. A execução atual foi finalizada para evitar sobreposição.',
      errorDetails ? `ℹ️ <i>${escapeHtml(errorDetails)}</i>` : '',
      ...(userDisplay ? [`👤 <b>Conta:</b> <code>${escapeHtml(userDisplay)}</code>`] : []),
      `📅 <b>Data:</b> ${now}`,
      `🖥️ <b>Host:</b> <code>${safeHost}</code>`
    ]
      .filter(Boolean)
      .join('\n');
  }

  // 4. Falha na execução
  if (event === 'failure') {
    const errorSnippet = extractRelevantErrorMessage(error);

    const lines = [
      `🔴 ali-coins — ${now}`,
      `⚠️ <b>Erro:</b> <code>${escapeHtml(errorSnippet)}</code>`
    ];

    const userDisplay = resolveUser(report);
    if (userDisplay) {
      lines.push(`👤 <b>Conta:</b> <code>${escapeHtml(userDisplay)}</code>`);
    }

    if (checkIfImportedSessionExpired(error, report)) {
      lines.push('');
      lines.push('⚠️ <b>Aviso de Sessão Remota:</b>');
      lines.push(
        'A sessão em uso foi importada de outro host (via <code>import_session.js</code>) e parece ter expirado ou sido invalidada pelo AliExpress.'
      );
      lines.push(
        '💡 <i>Ação necessária:</i> É necessário gerar uma nova sessão executando <code>node export_session.js</code> no servidor de origem e importá-la neste host com <code>node import_session.js</code>.'
      );
    }

    lines.push(`🖥️ <b>Host:</b> <code>${safeHost}</code>`);
    return lines.join('\n');
  }

  // 5. Alerta Crítico de Streak Quebrado
  if (event === 'streak_break') {
    const yesterdayStreak =
      report?.checkin?.previousStreakDays ?? report?.previousStreakDays ?? 'N/D';
    const todayStreak = report?.checkin?.streakDays ?? report?.streakDays ?? '0';
    const balance =
      report?.meta?.finalBalance ||
      (report?.checkin?.totalBalance
        ? `${report.checkin.totalBalance} moedas`
        : report?.totalBalance
          ? `${report.totalBalance} moedas`
          : 'N/D');
    const userDisplay = resolveUser(report);

    const lines = [
      `🚨 <b>STREAK QUEBRADO</b> — ${now}`,
      '',
      '⚠️ <b>Atenção:</b> A sequência diária de check-in foi interrompida ou resetada!',
      ...(userDisplay ? [`👤 <b>Conta:</b> <code>${escapeHtml(userDisplay)}</code>`] : []),
      `🖥️ <b>Host:</b> <code>${safeHost}</code>`,
      `📉 <b>Ontem:</b> ${yesterdayStreak} dias ➔ <b>Hoje:</b> ${todayStreak} dias`,
      `💰 <b>Saldo Atual:</b> ${escapeHtml(balance)}`
    ];

    return lines.join('\n');
  }

  // 6. Alerta de 2FA em ambiente não-interativo
  if (event === '2fa_required') {
    const userDisplay = resolveUser(report);
    const lines = [
      `🔐 <b>AliExpress Moedas - Verificação 2FA Solicitada</b> — ${now}`,
      '',
      ...(userDisplay ? [`👤 <b>Conta:</b> <code>${escapeHtml(userDisplay)}</code>`] : []),
      `🖥️ <b>Host:</b> <code>${safeHost}</code>`,
      '',
      '⚠️ <b>Execução Não-Interativa (Cron / CI):</b>',
      'O AliExpress solicitou verificação 2FA (e-mail ou SMS) e a automação foi finalizada em &lt;5s para evitar travamento.',
      '',
      '💡 <b>Guia de Resolução (2FA no Cron):</b>',
      '1. Execute localmente no seu computador: <code>./run_all.sh</code>',
      '2. Digite o código de 6 dígitos quando solicitado no terminal.',
      '3. Exporte a nova sessão gerada: <code>node export_session.js</code>',
      '4. Importe a sessão no servidor: <code>node import_session.js &lt; session_token.txt</code>'
    ];

    return lines.join('\n');
  }

  // 7. Relatório Multi-Conta
  if (report && report.type === 'multi_account_report') {
    const isAlready = event === 'already_collected';
    const titleEmoji = isAlready ? 'ℹ️' : '✅';
    const statusDesc = isAlready ? 'Já Coletado' : 'Sucesso';
    const reportDate = formatDate(new Date());

    const lines = [
      `${titleEmoji} <b>AliExpress Moedas - Multi-Conta (${statusDesc}) — ${reportDate}</b>`,
      `📊 <b>Resumo:</b> ${report.meta?.successfulAccounts || 0}/${report.meta?.totalAccounts || 0} contas processadas com sucesso`,
      ''
    ];

    if (Array.isArray(report.accounts)) {
      report.accounts.forEach((acc, idx) => {
        const userMasked = escapeHtml(acc.user);
        if (acc.error) {
          lines.push(
            `[${idx + 1}] <code>${userMasked}</code>: ❌ Falha (${escapeHtml(acc.error)})`
          );
          return;
        }

        const streak = acc.checkin?.streakDays ? `${acc.checkin.streakDays} dias` : 'N/D';
        const checkinCoins =
          acc.meta?.checkinCoinsGained ??
          (acc.checkin?.coinsGainedToday
            ? parseInt(String(acc.checkin.coinsGainedToday).replace(/[^0-9]/g, ''), 10) || 0
            : 0);
        const balanceAfterCheckin = parseInt(
          String(acc.tasks?.initialBalance || acc.checkin?.totalBalance || '').replace(/\D/g, ''),
          10
        );
        const balanceFinal = parseInt(
          String(
            acc.meta?.finalBalance || acc.tasks?.finalBalance || acc.tasks?.finalCoins || ''
          ).replace(/\D/g, ''),
          10
        );
        const taskGain =
          !isNaN(balanceAfterCheckin) && !isNaN(balanceFinal)
            ? Math.max(0, balanceFinal - balanceAfterCheckin)
            : 0;

        const tasksCoins =
          taskGain > 0 ? taskGain : (acc.meta?.tasksCoinsGained ?? acc.tasks?.coinsGained ?? 0);
        const totalCoins = acc.meta?.totalCoinsGained ?? checkinCoins + tasksCoins;
        const balance =
          acc.meta?.finalBalance ||
          (acc.checkin?.totalBalance ? `${acc.checkin.totalBalance} moedas` : 'N/D');

        lines.push(
          `[${idx + 1}] <code>${userMasked}</code>: 💰 <b>${escapeHtml(balance)}</b> | 🪙 +${totalCoins} (+${checkinCoins}/+${tasksCoins}) | Streak: ${streak}`
        );
      });
    }

    lines.push('');
    let multiTotalDuration = report.meta?.totalDuration;
    if (!multiTotalDuration || multiTotalDuration === '0s') {
      if (report.meta?.startTime && report.meta?.endTime) {
        const ms = new Date(report.meta.endTime) - new Date(report.meta.startTime);
        if (ms > 0) multiTotalDuration = formatDuration(ms);
      }
    }
    if (multiTotalDuration && multiTotalDuration !== '0s') {
      lines.push(`⏱️ <b>Duração Total:</b> ${escapeHtml(multiTotalDuration)}`);
    }
    if (checkIfImportedSessionExpired(error, report)) {
      lines.push('');
      lines.push('⚠️ <b>Aviso de Sessão Remota:</b>');
      lines.push(
        'Uma ou mais contas utilizam sessão importada de outro host que parece ter expirado.'
      );
      lines.push(
        '💡 <i>Ação necessária:</i> Gere uma nova sessão com <code>node export_session.js</code> no servidor de origem e importe com <code>node import_session.js</code>.'
      );
    }

    lines.push(`📅 <b>Data:</b> ${now}`);
    lines.push(`🖥️ <b>Host:</b> <code>${safeHost}</code>`);

    return truncateMessageIfNeeded(lines.join('\n'));
  }

  // 6. Relatório Unificado (Conta Única)
  if (report && report.type === 'unified_report') {
    const reportDate = formatDate(new Date());
    const userDisplay = resolveUser(report);

    let checkinCoins = 0;
    if (report.meta?.checkinCoinsGained !== undefined) {
      checkinCoins = Number(report.meta.checkinCoinsGained) || 0;
    } else if (
      report.checkin?.coinsGainedToday &&
      report.checkin.coinsGainedToday !== 'N/D' &&
      report.checkin.alreadyCollected !== true
    ) {
      const parsed = parseInt(String(report.checkin.coinsGainedToday).replace(/[^0-9]/g, ''), 10);
      if (!isNaN(parsed)) checkinCoins = parsed;
    }

    // Cálculo determinístico por diferença de saldo (delta real entre após check-in e final)
    const balanceAfterCheckin = parseInt(
      String(report.tasks?.initialBalance || report.checkin?.totalBalance || '').replace(/\D/g, ''),
      10
    );
    const balanceFinal = parseInt(
      String(
        report.meta?.finalBalance || report.tasks?.finalBalance || report.tasks?.finalCoins || ''
      ).replace(/\D/g, ''),
      10
    );
    const taskGain =
      !isNaN(balanceAfterCheckin) && !isNaN(balanceFinal)
        ? Math.max(0, balanceFinal - balanceAfterCheckin)
        : 0;

    let tasksCoins = 0;
    if (taskGain > 0) {
      tasksCoins = taskGain;
    } else if (report.meta?.tasksCoinsGained !== undefined) {
      tasksCoins = Number(report.meta.tasksCoinsGained) || 0;
    } else if (report.tasks && typeof report.tasks.coinsGained === 'number') {
      tasksCoins = report.tasks.coinsGained;
    }

    let totalCoins = 0;
    if (
      report.meta?.totalCoinsGained !== undefined &&
      Number(report.meta.totalCoinsGained) >= checkinCoins + tasksCoins
    ) {
      totalCoins = Number(report.meta.totalCoinsGained);
    } else {
      totalCoins = checkinCoins + tasksCoins;
    }

    const isAlready =
      event === 'already_collected' || (report.checkin?.alreadyCollected && tasksCoins === 0);

    const titleEmoji = isAlready ? 'ℹ️' : '✅';

    const streakDays =
      report.checkin?.streakDays !== undefined && report.checkin?.streakDays !== null
        ? String(report.checkin.streakDays)
        : 'N/D';

    let saldoDisplay = 'N/D';
    const rawBalance =
      report.meta?.finalBalance ||
      (report.checkin?.totalBalance ? `${report.checkin.totalBalance} moedas` : 'N/D');
    if (rawBalance && rawBalance !== 'N/D') {
      saldoDisplay = String(rawBalance).includes('moedas') ? rawBalance : `${rawBalance} moedas`;
    }

    let totalDuration = report.meta?.totalDuration;
    if (!totalDuration || totalDuration === '0s') {
      if (report.meta?.startTime && report.meta?.endTime) {
        const ms = new Date(report.meta.endTime) - new Date(report.meta.startTime);
        if (ms > 0) totalDuration = formatDuration(ms);
      }
    }
    if (!totalDuration || totalDuration === '0s') {
      if (report.duration && report.duration !== '0s') {
        totalDuration = report.duration;
      } else if (report.checkin?.startTime && report.tasks?.endTime) {
        const ms = new Date(report.tasks.endTime) - new Date(report.checkin.startTime);
        if (ms > 0) totalDuration = formatDuration(ms);
      } else if (
        report.checkin?.duration &&
        report.checkin.duration !== '0s' &&
        (!report.tasks || !report.tasks.duration || report.tasks.duration === '0s')
      ) {
        totalDuration = report.checkin.duration;
      } else if (
        report.tasks?.duration &&
        report.tasks.duration !== '0s' &&
        (!report.checkin || !report.checkin.duration || report.checkin.duration === '0s')
      ) {
        totalDuration = report.tasks.duration;
      }
    }
    if (!totalDuration) totalDuration = '0s';

    const lines = [
      `${titleEmoji} ali-coins — ${reportDate}`,
      `👤 <b>Conta:</b> <code>${escapeHtml(userDisplay)}</code>`,
      `🖥️ <b>Host:</b> <code>${safeHost}</code>`,
      `🪙 Ganhas hoje: +${totalCoins} moedas (check-in +${checkinCoins} / tarefas +${tasksCoins})`,
      `📅 Sequência: ${streakDays} dias`,
      `💰 Saldo: ${saldoDisplay}`,
      `⏱️ Duração: ${totalDuration}`
    ];

    return lines.join('\n');
  }

  // 7. Relatório Apenas Check-in
  if (report && report.type === 'checkin') {
    const isAlready = event === 'already_collected' || report.alreadyCollected;
    const titleEmoji = isAlready ? 'ℹ️' : '✅';
    const reportDate = formatDate(new Date());
    const userDisplay = resolveUser(report);

    let checkinCoins = 0;
    if (
      report.coinsGainedToday &&
      report.coinsGainedToday !== 'N/D' &&
      report.alreadyCollected !== true
    ) {
      const parsed = parseInt(String(report.coinsGainedToday).replace(/[^0-9]/g, ''), 10);
      if (!isNaN(parsed)) checkinCoins = parsed;
    }

    const streakDays =
      report.streakDays !== undefined && report.streakDays !== null
        ? String(report.streakDays)
        : 'N/D';

    let saldoDisplay = 'N/D';
    if (report.totalBalance && report.totalBalance !== 'N/D') {
      saldoDisplay = String(report.totalBalance).includes('moedas')
        ? report.totalBalance
        : `${report.totalBalance} moedas`;
    }

    let duration = report.duration;
    if (!duration || duration === '0s') {
      if (report.startTime && report.endTime) {
        const ms = new Date(report.endTime) - new Date(report.startTime);
        if (ms > 0) duration = formatDuration(ms);
      }
    }
    if (!duration) duration = '0s';

    const lines = [
      `${titleEmoji} ali-coins — ${reportDate}`,
      `👤 <b>Conta:</b> <code>${escapeHtml(userDisplay)}</code>`,
      `🖥️ <b>Host:</b> <code>${safeHost}</code>`,
      `🪙 Ganhas hoje: +${checkinCoins} moedas (check-in +${checkinCoins} / tarefas +0)`,
      `📅 Sequência: ${streakDays} dias`,
      `💰 Saldo: ${saldoDisplay}`,
      `⏱️ Duração: ${duration}`
    ];

    return lines.join('\n');
  }

  // 8. Relatório Apenas Tarefas
  if (report && report.type === 'tasks') {
    const titleEmoji = '✅';
    const reportDate = formatDate(new Date());
    const userDisplay = resolveUser(report);
    const tasksCoins = typeof report.coinsGained === 'number' ? report.coinsGained : 0;

    let saldoDisplay = 'N/D';
    if (report.finalCoins && report.finalCoins !== 'N/D') {
      saldoDisplay = String(report.finalCoins).includes('moedas')
        ? report.finalCoins
        : `${report.finalCoins} moedas`;
    } else if (report.finalBalance && report.finalBalance !== 'N/D') {
      saldoDisplay = String(report.finalBalance).includes('moedas')
        ? report.finalBalance
        : `${report.finalBalance} moedas`;
    }

    let duration = report.duration;
    if (!duration || duration === '0s') {
      if (report.startTime && report.endTime) {
        const ms = new Date(report.endTime) - new Date(report.startTime);
        if (ms > 0) duration = formatDuration(ms);
      }
    }
    if (!duration) duration = '0s';

    const lines = [
      `${titleEmoji} ali-coins — ${reportDate}`,
      `👤 <b>Conta:</b> <code>${escapeHtml(userDisplay)}</code>`,
      `🖥️ <b>Host:</b> <code>${safeHost}</code>`,
      `🪙 Ganhas hoje: +${tasksCoins} moedas (check-in +0 / tarefas +${tasksCoins})`,
      `💰 Saldo: ${saldoDisplay}`,
      `⏱️ Duração: ${duration}`
    ];

    return lines.join('\n');
  }

  // Fallback padrão genérico
  const fallbackUser = resolveUser(report);
  return [
    '🔔 <b>AliExpress Moedas - Notificação</b>',
    '',
    `Status: ${escapeHtml(event)}`,
    ...(fallbackUser ? [`👤 <b>Conta:</b> <code>${escapeHtml(fallbackUser)}</code>`] : []),
    `📅 <b>Data:</b> ${now}`,
    `🖥️ <b>Host:</b> <code>${safeHost}</code>`
  ].join('\n');
}

/**
 * Trunca mensagem caso ultrapasse o limite de caracteres do Telegram (4096 chars)
 * @param {string} text
 * @returns {string}
 */
function truncateMessageIfNeeded(text) {
  if (text.length <= TELEGRAM_MAX_LENGTH) {
    return text;
  }
  const truncated = text.slice(0, TELEGRAM_SAFE_LIMIT);
  const lastNewline = truncated.lastIndexOf('\n');
  const cleanCut = lastNewline > 2000 ? truncated.slice(0, lastNewline) : truncated;
  return `${cleanCut}\n\n<i>... [mensagem truncada pelo limite de caracteres]</i>`;
}

/**
 * Envia notificação para o Telegram usando fetch nativo do Node 22
 * Nunca lança erros ou quebra a execução do chamador
 * @param {object} params
 * @param {object} params.config Objeto de configurações (loadConfig)
 * @param {object} [params.report] Objeto de relatório para a mensagem
 * @param {string} [params.event='success'] 'success' | 'already_collected' | 'failure' | 'lock_active' | 'dry_run' | 'manual_test' | 'streak_break' | '2fa_required'
 * @param {Error|string} [params.error]
 * @param {string} [params.customMessage]
 * @returns {Promise<{ ok: boolean, skipped?: boolean, status?: number, error?: string }>}
 */
async function sendTelegram({
  config = null,
  chatId = null,
  report = null,
  event = 'success',
  error = null,
  customMessage = null
} = {}) {
  let cfg = config;
  if (!cfg) {
    try {
      const { loadConfig } = require('../config');
      cfg = loadConfig(false);
    } catch {
      cfg = process.env;
    }
  }

  const isEnabled =
    typeof cfg.TELEGRAM_ENABLED === 'boolean'
      ? cfg.TELEGRAM_ENABLED
      : cfg.TELEGRAM_ENABLED === 'true' || cfg.TELEGRAM_ENABLED === '1';

  if (!isEnabled) {
    return { ok: false, skipped: true, reason: 'TELEGRAM_ENABLED is false' };
  }

  const botToken = cfg.TELEGRAM_BOT_TOKEN;
  const targetChatId = chatId || cfg.TELEGRAM_CHAT_ID;
  const timeoutMs = cfg.TELEGRAM_TIMEOUT_MS || 5000;
  const isSilent =
    typeof cfg.TELEGRAM_SILENT === 'boolean'
      ? cfg.TELEGRAM_SILENT
      : cfg.TELEGRAM_SILENT === 'true' || cfg.TELEGRAM_SILENT === '1';

  if (!botToken || !targetChatId) {
    logger.warn(
      'Notificação Telegram ignorada: TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados.'
    );
    return { ok: false, skipped: true, reason: 'Missing credentials' };
  }

  const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const hostLabel = cfg.NOTIFY_HOST_LABEL || process.env.NOTIFY_HOST_LABEL || os.hostname();
  const messageHtml = buildMessage({
    report,
    event,
    error,
    customMessage,
    hostname: hostLabel
  });

  const payload = {
    chat_id: targetChatId,
    text: messageHtml,
    parse_mode: 'HTML',
    disable_notification: isSilent
  };

  try {
    let response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });

    // Fallback: se retornar 400 por erro de parse de entidades HTML, tenta enviar como texto puro
    if (response.status === 400) {
      const plainText = messageHtml.replace(/<[^>]+>/g, '');
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: plainText,
          disable_notification: isSilent
        }),
        signal: AbortSignal.timeout(timeoutMs)
      }).catch(() => response);
    }

    if (!response.ok) {
      const respBody = await response.text().catch(() => '');
      logger.warn(
        { status: response.status, statusText: response.statusText, response: respBody },
        'Falha ao enviar notificação para o Telegram.'
      );
      if (/can't initiate conversation|chat not found/i.test(respBody)) {
        logger.warn(
          'Dica: Bots do Telegram não podem iniciar conversas com usuários. Abra a conversa com seu bot no aplicativo e envie /start para autorizar o recebimento.'
        );
      }
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    logger.info({ event }, 'Notificação Telegram enviada com sucesso.');
    return { ok: true, status: response.status };
  } catch (err) {
    logger.warn(
      { err: err.message },
      'Erro de timeout ou rede ao enviar notificação para o Telegram (job preservado).'
    );
    return { ok: false, error: err.message };
  }
}

/**
 * Dispara uma mensagem manual de teste para validar credenciais e conectividade
 * @param {object} [customConfig]
 * @returns {Promise<boolean>}
 */
async function test(customConfig = null) {
  let cfg = customConfig;
  if (!cfg) {
    const { loadConfig } = require('../config');
    cfg = { ...loadConfig(false), TELEGRAM_ENABLED: true };
  }
  logger.info('Disparando mensagem de teste para o Telegram...');
  const res = await sendTelegram({ config: cfg, event: 'manual_test' });
  if (res.ok) {
    logger.info('Teste concluído com sucesso!');
  } else {
    logger.error({ err: res.error }, 'Falha no envio do teste para o Telegram.');
  }
  return res.ok;
}

module.exports = {
  sendTelegram,
  buildMessage,
  extractRelevantErrorMessage,
  escapeHtml,
  truncateMessageIfNeeded,
  checkIfImportedSessionExpired,
  test
};
