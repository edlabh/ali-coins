const fs = require('fs');
const os = require('os');
const { formatDateTime } = require('../time_utils');
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
  hostname = os.hostname()
} = {}) {
  const now = formatDateTime(new Date());
  const safeHost = escapeHtml(hostname);

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
    return [
      '⚠️ <b>AliExpress Moedas - Execução Bloqueada (Lock Ativo)</b>',
      '',
      'Outra instância da automação já está em execução no host. A execução atual foi finalizada para evitar sobreposição.',
      errorDetails ? `ℹ️ <i>${escapeHtml(errorDetails)}</i>` : '',
      `📅 <b>Data:</b> ${now}`,
      `🖥️ <b>Host:</b> <code>${safeHost}</code>`
    ]
      .filter(Boolean)
      .join('\n');
  }

  // 4. Falha na execução
  if (event === 'failure') {
    const errorMsg =
      error && error.message
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Erro desconhecido durante o processamento.';

    const lastLines = String(errorMsg).trim().split('\n').slice(-3).join('\n');

    const lines = [
      `🔴 ali-coins — ${now}`,
      `⚠️ <b>Erro:</b> <code>${escapeHtml(lastLines || errorMsg)}</code>`
    ];

    if (report && (report.user || report.userEmail)) {
      lines.push(`👤 <b>Conta:</b> <code>${escapeHtml(report.user || report.userEmail)}</code>`);
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
    const userMasked = report?.user || report?.userEmail;

    const lines = [
      `🚨 <b>STREAK QUEBRADO</b> — ${now}`,
      '',
      '⚠️ <b>Atenção:</b> A sequência diária de check-in foi interrompida ou resetada!',
      `📉 <b>Ontem:</b> ${yesterdayStreak} dias ➔ <b>Hoje:</b> ${todayStreak} dias`,
      `💰 <b>Saldo Atual:</b> ${escapeHtml(balance)}`
    ];

    if (userMasked) {
      lines.push(`👤 <b>Conta:</b> <code>${escapeHtml(userMasked)}</code>`);
    }

    lines.push(`🖥️ <b>Host:</b> <code>${safeHost}</code>`);
    return lines.join('\n');
  }

  // 6. Alerta de 2FA em ambiente não-interativo
  if (event === '2fa_required') {
    const userMasked = report?.user || report?.userEmail;
    const lines = [
      `🔐 <b>AliExpress Moedas - Verificação 2FA Solicitada</b> — ${now}`,
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

    if (userMasked) {
      lines.push('');
      lines.push(`👤 <b>Conta:</b> <code>${escapeHtml(userMasked)}</code>`);
    }

    lines.push(`🖥️ <b>Host:</b> <code>${safeHost}</code>`);
    return lines.join('\n');
  }

  // 7. Relatório Multi-Conta
  if (report && report.type === 'multi_account_report') {
    const isAlready = event === 'already_collected';
    const titleEmoji = isAlready ? 'ℹ️' : '✅';
    const statusDesc = isAlready ? 'Já Coletado' : 'Sucesso';

    const lines = [
      `${titleEmoji} <b>AliExpress Moedas - Multi-Conta (${statusDesc})</b>`,
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

        const streak = acc.checkin?.streakDays ? `${acc.checkin.streakDays}d` : 'N/D';
        const checkinCoins = acc.checkin?.coinsGainedToday
          ? `+${acc.checkin.coinsGainedToday}`
          : '0';
        const balance = acc.meta?.finalBalance || acc.checkin?.totalBalance || 'N/D';
        const tasksCount = acc.tasks?.results ? acc.tasks.results.length : 0;

        lines.push(
          `[${idx + 1}] <code>${userMasked}</code>: 💰 <b>${escapeHtml(balance)}</b> | Streak: ${streak} (${checkinCoins}) | Tarefas: ${tasksCount}`
        );
      });
    }

    lines.push('');
    if (report.meta?.totalDuration) {
      lines.push(`⏱️ <b>Duração Total:</b> ${escapeHtml(report.meta.totalDuration)}`);
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

    lines.push(`📅 <b>Data:</b> ${now} | 🖥️ <b>Host:</b> <code>${safeHost}</code>`);

    return truncateMessageIfNeeded(lines.join('\n'));
  }

  // 6. Relatório Unificado (Conta Única)
  if (report && report.type === 'unified_report') {
    const isAlready =
      event === 'already_collected' ||
      (report.checkin?.alreadyCollected && (!report.tasks || report.tasks.results?.length === 0));

    const titleEmoji = isAlready ? 'ℹ️' : '✅';
    const coinsGainedToday = report.checkin?.coinsGainedToday || '0';
    const streakDays =
      report.checkin?.streakDays !== undefined && report.checkin?.streakDays !== null
        ? String(report.checkin.streakDays)
        : 'N/D';
    const finalBalance =
      report.meta?.finalBalance ||
      (report.checkin?.totalBalance ? `${report.checkin.totalBalance} moedas` : 'N/D');
    const totalDuration = report.meta?.totalDuration || '0s';

    let taskRatio = '0/0';
    if (report.tasks && Array.isArray(report.tasks.results)) {
      const totalTasks = report.tasks.results.length;
      const completedTasks = report.tasks.results.filter(
        (t) =>
          t.status &&
          (t.status.toLowerCase().includes('conclu') ||
            t.status.toLowerCase().includes('sucesso') ||
            t.status.toLowerCase().includes('done'))
      ).length;
      taskRatio = `${completedTasks}/${totalTasks}`;
    }

    const lines = [
      `${titleEmoji} ali-coins — ${now}`,
      `🪙 Ganhas hoje: +${coinsGainedToday} moedas`,
      `📅 Sequência: ${streakDays} dias`,
      `💰 Saldo: ${finalBalance}`,
      `📋 Tarefas: ${taskRatio} concluídas`,
      `⏱️ Duração: ${totalDuration}`
    ];

    if (report.user) {
      lines.push(`👤 Conta: <code>${escapeHtml(report.user)}</code>`);
    }

    return lines.join('\n');
  }

  // 7. Relatório Apenas Check-in
  if (report && report.type === 'checkin') {
    const isAlready = event === 'already_collected' || report.alreadyCollected;
    const titleEmoji = isAlready ? 'ℹ️' : '✅';
    const coinsGainedToday = report.coinsGainedToday || '0';
    const streakDays =
      report.streakDays !== undefined && report.streakDays !== null
        ? String(report.streakDays)
        : 'N/D';
    const finalBalance = report.totalBalance ? `${report.totalBalance} moedas` : 'N/D';
    const duration = report.duration || '0s';

    const lines = [
      `${titleEmoji} ali-coins — ${now}`,
      `🪙 Ganhas hoje: +${coinsGainedToday} moedas`,
      `📅 Sequência: ${streakDays} dias`,
      `💰 Saldo: ${finalBalance}`,
      `📋 Tarefas: 0/0 concluídas`,
      `⏱️ Duração: ${duration}`
    ];

    if (report.userEmail) {
      lines.push(`👤 Conta: <code>${escapeHtml(report.userEmail)}</code>`);
    }

    return lines.join('\n');
  }

  // 8. Relatório Apenas Tarefas
  if (report && report.type === 'tasks') {
    const lines = [
      '✅ <b>AliExpress Moedas - Tarefas Diárias</b>',
      '',
      `👤 <b>Conta:</b> <code>${escapeHtml(report.userEmail || 'N/D')}</code>`,
      `💰 <b>Saldo Final:</b> <b>${escapeHtml(report.finalCoins || 'N/D')}</b>`
    ];

    if (Array.isArray(report.results) && report.results.length > 0) {
      lines.push('');
      lines.push('📋 <b>Tarefas:</b>');
      report.results.forEach((t) => {
        lines.push(` • ${escapeHtml(t.title)}: <i>${escapeHtml(t.status)}</i>`);
      });
    }

    lines.push('');
    lines.push(`⏱️ <b>Duração:</b> ${escapeHtml(report.duration || 'N/D')}`);
    lines.push(`📅 <b>Data:</b> ${now} | 🖥️ <b>Host:</b> <code>${safeHost}</code>`);
    return truncateMessageIfNeeded(lines.join('\n'));
  }

  // Fallback padrão genérico
  return [
    '🔔 <b>AliExpress Moedas - Notificação</b>',
    '',
    `Status: ${escapeHtml(event)}`,
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
  const messageHtml = buildMessage({ report, event, error, customMessage });

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
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    logger.info('Notificação enviada com sucesso para o Telegram.');
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
 * Função utilitária para testar a integração do bot diretamente via terminal
 * Exemplo: node -e "require('./libs/notify').test()"
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
  escapeHtml,
  truncateMessageIfNeeded,
  checkIfImportedSessionExpired,
  test
};
