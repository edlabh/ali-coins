/**
 * Traduções PT → EN de frases usadas nas notificações (Telegram).
 * Extraídas dos literais de libs/notify.js; aplicadas por substituição de substring
 * para preservar HTML, emojis e valores dinâmicos. Frases de uma palavra ficam no
 * glossário de valores (values.js) para evitar substituições em substrings.
 */
module.exports = [
  [
    '💡 <b>Ação:</b> renove a sessão localmente (rede residencial) e importe com <code>node import_session.js</code>. Novas tentativas de login ficam pausadas pelo cooldown (<code>CAPTCHA_COOLDOWN_HOURS</code>).',
    '💡 <b>Action:</b> renew the session locally (home network) and import with <code>node import_session.js</code>. New login attempts are paused due to the cooldown (<code>CAPTCHA_COOLDOWN_HOURS</code>).'
  ],
  [
    '💡 <i>Ação necessária:</i> É necessário gerar uma nova sessão executando <code>node export_session.js</code> no servidor de origem e importá-la neste host com <code>node import_session.js</code>.',
    '💡 <i>Action required:</i> You need to generate a new session by running <code>node export_session.js</code> on the source server and import it on this host with <code>node import_session.js</code>.'
  ],
  [
    '💡 <b>Dica:</b> em um host com interface gráfica, execute <code>node collect.js</code> e escolha a opção <b>2</b> para abrir a janela de login manual — a sessão é salva automaticamente.',
    '💡 <b>Tip:</b> on a host with a GUI, run <code>node collect.js</code> and choose option <b>2</b> to open the manual login window — the session is saved automatically.'
  ],
  [
    '💡 <b>Ação:</b> faça a <b>coleta manual</b> das moedas no app/site do AliExpress enquanto o cooldown estiver ativo. Nenhuma tentativa de login será feita até a liberação.',
    '💡 <b>Action:</b> <b>manually collect coins</b> on the AliExpress app/website while the cooldown is active. No login attempts will be made until released.'
  ],
  [
    '💡 <i>Ação necessária:</i> Gere uma nova sessão com <code>node export_session.js</code> no servidor de origem e importe com <code>node import_session.js</code>.',
    '💡 <i>Action required:</i> Generate a new session with <code>node export_session.js</code> on the source server and import with <code>node import_session.js</code>.'
  ],
  [
    'Dica: Bots do Telegram não podem iniciar conversas com usuários. Abra a conversa com seu bot no aplicativo e envie /start para autorizar o recebimento.',
    'Tip: Telegram bots cannot start conversations with users. Open the conversation with your bot in the app and send /start to authorize receipt.'
  ],
  [
    'A sessão em uso foi importada de outro host (via <code>import_session.js</code>) e parece ter expirado ou sido invalidada pelo AliExpress.',
    'The session in use was imported from another host (via <code>import_session.js</code>) and appears to have expired or been invalidated by AliExpress.'
  ],
  [
    '3️⃣ Exporte a sessão com <code>node export_session.js</code> e importe no host remoto com <code>node import_session.js</code>.',
    '3️⃣ Export the session with <code>node export_session.js</code> and import it on the remote host with <code>node import_session.js</code>.'
  ],
  [
    'O AliExpress solicitou verificação 2FA (e-mail ou SMS) e a automação foi finalizada em &lt;5s para evitar travamento.',
    'AliExpress requested 2FA verification (email or SMS) and the automation was completed in &lt;5s to avoid crashing.'
  ],
  [
    'Outra instância da automação já está em execução no host. A execução atual foi finalizada para evitar sobreposição.',
    'Another instance of the automation is already running on the host. The current run has been terminated to avoid overlap.'
  ],
  [
    'Se você está lendo esta mensagem, o bot do Telegram foi configurado com sucesso e está operando perfeitamente! 🎉',
    'If you are reading this message, the Telegram bot has been successfully configured and is operating perfectly! 🎉'
  ],
  [
    'ℹ️ A automação só voltará a executar após a sessão ser renovada (importada ou salva pelo login manual).',
    'ℹ️ The automation will only run again after the session is renewed (imported or saved by manual login).'
  ],
  [
    'Timeout ao enviar notificação (resultado ambíguo); NÃO reenviando para evitar mensagem duplicada.',
    'Timeout when sending notification (ambiguous result); NOT resending to avoid duplicate message.'
  ],
  [
    '4. Importe a sessão no servidor: <code>node import_session.js &lt; session_token.txt</code>',
    '4. Import the session on the server: <code>node import_session.js &lt; session_token.txt</code>'
  ],
  [
    'Notificação Telegram ignorada: TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados.',
    'Telegram notification ignored: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured.'
  ],
  [
    'Uma ou mais contas utilizam sessão importada de outro host que parece ter expirado.',
    'One or more accounts use a session imported from another host that appears to have expired.'
  ],
  [
    '⚠️ <b>Atenção:</b> A sequência diária de check-in foi interrompida ou resetada!',
    '⚠️ <b>Attention:</b> The daily check-in streak has been interrupted or reset!'
  ],
  [
    'Erro de timeout ou rede ao enviar notificação para o Telegram (job preservado).',
    'Timeout or network error when sending notification to Telegram (job preserved).'
  ],
  [
    'A janela de pausa expirou; a automação voltará a tentar o login normalmente.',
    'The pause window has expired; the automation will retry login normally.'
  ],
  [
    '🚫 <b>AliExpress bloqueou a conta por suspeita de uso de bot (RGV587)</b>',
    '🚫 <b>AliExpress blocked account due to suspected bot use (RGV587)</b>'
  ],
  [
    '1️⃣ Faça o login no AliExpress <b>na máquina local</b> (navegador real).',
    '1️⃣ Login to AliExpress <b>on local machine</b> (real browser).'
  ],
  [
    '3. Exporte a nova sessão gerada: <code>node export_session.js</code>',
    '3. Export the new generated session: <code>node export_session.js</code>'
  ],
  [
    '1. Execute localmente no seu computador: <code>./run_all.sh</code>',
    '1. Run locally on your computer: <code>./run_all.sh</code>'
  ],
  [
    '❌ <b>A tentativa de login manual em janela não foi concluída.</b>',
    '❌ <b>Manual window login attempt was not completed.</b>'
  ],
  [
    'A validação de ambiente e credenciais foi concluída com sucesso!',
    'Environment and credentials validation completed successfully!'
  ],
  [
    '🔒 <b>Login remoto suspenso após bloqueio anti-bot (RGV587)</b>',
    '🔒 <b>Remote login suspended after anti-bot blocking (RGV587)</b>'
  ],
  [
    'Falha transitória ao enviar notificação; tentando novamente...',
    'Transient failure to send notification; trying again...'
  ],
  [
    '2. Digite o código de 6 dígitos quando solicitado no terminal.',
    '2. Enter the 6-digit code when prompted on the terminal.'
  ],
  [
    '⚠️ <b>AliExpress Moedas - Execução Bloqueada (Lock Ativo)</b>',
    '⚠️ <b>AliExpress Coins - Blocked Execution (Active Lock)</b>'
  ],
  [
    '🔔 <b>AliExpress Moedas - Teste de Notificação Telegram</b>',
    '🔔 <b>AliExpress Coins - Telegram Notification Test</b>'
  ],
  [
    '🔐 <b>AliExpress Moedas - Verificação 2FA Solicitada</b> —',
    '🔐 <b>AliExpress Coins - 2FA Verification Requested</b> —'
  ],
  [
    'Erro de rede ao enviar notificação; tentando novamente...',
    'Network error when sending notification; trying again...'
  ],
  [
    '<i>... [mensagem truncada pelo limite de caracteres]</i>',
    '<i>... [message truncated due to character limit]</i>'
  ],
  [
    '⚠️ <b>Desafio anti-bot (captcha) detectado no login</b>',
    '⚠️ <b>Anti-bot challenge (captcha) detected at login</b>'
  ],
  [
    '🔔 <b>Notificações Telegram:</b> Operacionais e ativas',
    '🔔 <b>Telegram notifications:</b> Operational and active'
  ],
  ['Disparando mensagem de teste para o Telegram...', 'Sending test message to Telegram...'],
  [
    '⚠️ <b>Execução Não-Interativa (Cron / CI):</b>',
    '⚠️ <b>Non-Interactive Execution (Cron / CI):</b>'
  ],
  ['Falha ao enviar notificação para o Telegram.', 'Failed to send notification to Telegram.'],
  ['🧪 <b>AliExpress Moedas - Teste Dry-Run</b>', '🧪 <b>AliExpress Coins - Dry-Run Test</b>'],
  ['2️⃣ Resolva o captcha/desafio, se aparecer.', '2️⃣ Solve the captcha/challenge, if it appears.'],
  ['Erro desconhecido durante o processamento.', 'Unknown error during processing.'],
  ['💡 <b>Guia de Resolução (2FA no Cron):</b>', '💡 <b>Resolution Guide (2FA in Cron):</b>'],
  ['🔔 <b>AliExpress Moedas - Notificação</b>', '🔔 <b>AliExpress Coins - Notification</b>'],
  ['Notificação Telegram enviada com sucesso.', 'Telegram notification sent successfully.'],
  ['Falha no envio do teste para o Telegram.', 'Failed to send the test to Telegram.'],
  ['✅ <b>Cooldown pós-captcha liberado</b>', '✅ <b>Post-captcha cooldown released</b>'],
  ['⏰ <b>Última conta desta execução.</b>', '⏰ <b>Last account of this execution.</b>'],
  ['<b>AliExpress Moedas - Multi-Conta (', '<b>AliExpress Coins - Multi-Account ('],
  ['<b>Ação necessária (na ordem):</b>', '<b>Action required (in order):</b>'],
  ['⚠️ <b>Aviso de Sessão Remota:</b>', '⚠️ <b>Remote Session Notice:</b>'],
  ['🔒 <b>Login manual necessário</b>', '🔒 <b>Manual login required</b>'],
  ['h</b> (cooldown anti-bot ativo).', 'h</b> (active anti-bot cooldown).'],
  ['moedas (check-in +0 / tarefas +', 'coins (check-in +0 / tasks +'],
  ['contas processadas com sucesso', 'accounts processed successfully'],
  ['Teste concluído com sucesso!', 'Test completed successfully!'],
  ['🚨 <b>STREAK QUEBRADO</b> —', '🚨 <b>BROKEN STREAK</b> —'],
  ['⏳ <b>Cooldown previsto até', '⏳ <b>Expected cooldown until'],
  ['⏳ <b>Cooldown encerrado em', '⏳ <b>Cooldown ended at'],
  ['⏱️ <b>Tempo restante:</b>', '⏱️ <b>Time remaining:</b>'],
  ['⏱️ <b>Duração Total:</b>', '⏱️ <b>Total Duration:</b>'],
  ['⏰ <b>Próxima conta:</b>', '⏰ <b>Next account:</b>'],
  ['👤 <b>Conta:</b> <code>', '👤 <b>Account:</b> <code>'],
  ['⏳ <b>Login suspenso por', '⏳ <b>Login suspended for'],
  ['⚠️ <b>Erro:</b> <code>', '⚠️ <b>Error:</b> <code>'],
  ['💰 <b>Saldo Atual:</b>', '💰 <b>Current Balance:</b>'],
  ['Captcha Solicitado', 'Captcha Required'],
  ['</code>: ❌ Falha (', '</code>: ❌ Failure ('],
  ['moedas (check-in +', 'coins (check-in +'],
  ['📊 <b>Resumo:</b>', '📊 <b>Summary:</b>'],
  ['em menos de 1 min', 'in less than 1 min'],
  ['👤 <b>Contas:</b>', '👤 <b>Accounts:</b>'],
  ['🪙 Ganhas hoje: +', '🪙 Earned today: +'],
  ['📉 <b>Ontem:</b>', '📉 <b>Yesterday:</b>'],
  ['📅 <b>Data:</b>', '📅 <b>Date:</b>'],
  ['➔ <b>Hoje:</b>', '➔ <b>Today:</b>'],
  ['📅 Sequência:', '📅 Streak:'],
  ['🏆 Maior sequência:', '🏆 Longest streak:'],
  ['(recorde:', '(record:'],
  ['/ tarefas +0)', '/ tasks +0)'],
  ['Já Coletado', 'Already Collected'],
  ['/ tarefas +', '/ tasks +'],
  ['⏱️ Duração:', '⏱️ Duration:'],
  ['(libera em', '(unlocks at'],
  ['💰 Saldo:', '💰 Balance:'],
  ['próxima:', 'next:'],
  ['em ~', 'in ~'],
  ['N/D', 'N/A']
];
