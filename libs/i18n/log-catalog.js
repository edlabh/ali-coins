/**
 * Catálogo PT → EN das mensagens de log.
 * Gerado a partir das chamadas de logger do projeto; revisar termos técnicos ao editar.
 * Placeholders usam {{n}} e são preenchidos pela posição na mensagem original.
 */
module.exports = {
  exact: {
    '\n--- COMO IMPORTAR NO SEU SERVIDOR REMOTO ---':
      '\n--- HOW TO IMPORT ON YOUR REMOTE SERVER ---',
    '[Sessão Inválida] A checagem somente leitura falhou.':
      '[Invalid Session] The read-only check failed.',
    'Conta não encontrada para --check-session.': 'Account not found for --check-session.',
    'Sessão válida (somente leitura).': 'Valid session (read-only).',
    '\n---------------------------------------------------------------':
      '\n---------------------------------------------------------------',
    '\n================ RESUMO DAS TAREFAS ================':
      '\n================ SUMMARY OF TASKS ================',
    '\n===============================================================':
      '\n===============================================================',
    '\nTarefas do Painel "Ganhe mais moedas":': '\n"Earn more coins" Dashboard Tasks:',
    '                 MODO DE VALIDAÇÃO (DRY-RUN)': '                 VALIDATION MODE (DRY-RUN)',
    '                RELATÓRIO CONSOLIDADO FINAL': '                FINAL CONSOLIDATED REPORT',
    '         EXPORTAÇÃO SEGURA DE SESSÃO ALIEXPRESS (AES-256-GCM v3)':
      '         ALIEXPRESS SECURE SESSION EXPORT (AES-256-GCM v3)',
    '         IMPORTAÇÃO SEGURA DE SESSÃO ALIEXPRESS (AES-256-GCM)':
      '         ALIEXPRESS SESSION SECURE IMPORT (AES-256-GCM)',
    '       ALIEXPRESS MOEDAS - MODO UNIFICADO (CHECK-IN + TAREFAS)':
      '       ALIEXPRESS COINS - UNIFIED MODE (CHECK-IN + TASKS)',
    '   IMPORTAÇÃO MULTI-CONTA DE SESSÕES ALIEXPRESS':
      '   MULTI-ACCOUNT IMPORT OF ALIEXPRESS SESSIONS',
    '  node import_session.js --all\n': '  node import_session.js --all\n',
    '  node import_session.js --from-file=session_token.txt\n':
      '  node import_session.js --from-file=session_token.txt\n',
    '  node import_session.js < session_token.txt\n':
      '  node import_session.js < session_token.txt\n',
    ' • Senha: [CONFIGURADA]': ' • Password: [SET]',
    '(Dica: O token não é exibido no stdout por padrão para segurança contra vazamento em logs. Use --show-token se necessário).':
      '(Tip: The token is not displayed on stdout by default to guard against log leaks. Use --show-token if necessary).',
    '--- COMO IMPORTAR NO SEU SERVIDOR NA NUVEM DE FORMA SEGURA ---':
      '--- HOW TO IMPORT TO YOUR CLOUD SERVER SECURELY ---',
    '----------------------------------------------------':
      '----------------------------------------------------',
    '---------------------------------------------------------------':
      '---------------------------------------------------------------',
    '--force: cooldown pós-captcha ignorado; tentando autenticar mesmo assim.':
      '--force: post-captcha cooldown ignored; trying to authenticate anyway.',
    '=== RELATORIO_OUTPUT ===': '=== REPORT_OUTPUT ===',
    '================ CHECK-IN DIÁRIO ================':
      '================ DAILY CHECK-IN ================',
    '================ EXECUÇÃO DAS TAREFAS DIÁRIAS ================':
      '================ EXECUTION OF DAILY TASKS ================',
    '====================================================\n':
      '====================================================\n',
    '===============================================================':
      '===============================================================',
    '===============================================================\n':
      '===============================================================\n',
    '===================================================================':
      '===================================================================',
    '===================================================================\n':
      '===================================================================\n',
    '>>> [ETAPA 1/2] Iniciando Check-in Diário...': '>>> [STEP 1/2] Starting Daily Check-in...',
    '>>> [ETAPA 2/2] Iniciando Execução Sequencial das Tarefas Diárias...':
      '>>> [STEP 2/2] Starting Sequential Execution of Daily Tasks...',
    'A página desktop exibiu um prompt de login/reautenticação (sessão inválida) — não é apenas mudança de layout.':
      "The desktop page displayed a login/reauthentication prompt (invalid session) — it's not just a layout change.",
    'A sessão exportada foi gerada há mais de 90 dias. Recomendado renovar com export_session.js.':
      'The exported session was generated more than 90 days ago. Recommended to renew with export_session.js.',
    'A sessão importada foi exportada há mais de 90 dias. Os cookies podem estar próximos da expiração.':
      'The imported session was exported more than 90 days ago. Cookies may be close to expiring.',
    'A sessão ultrapassou a data estimada de expiração.':
      'The session has passed its estimated expiration date.',
    'Acessando central de moedas...': 'Accessing currency center...',
    'Aplicando --no-sandbox (--disable-setuid-sandbox) ao Chromium.':
      'Applying --no-sandbox (--disable-setuid-sandbox) to Chromium.',
    'Argumento posicional detectado no argv foi ignorado por segurança. Não passe tokens sensíveis na linha de comando.':
      'Positional argument detected in argv was ignored for safety. Do not pass sensitive tokens on the command line.',
    'Arquivo session.json inválido (JSON malformado). Arquivo preservado sem exclusão automática.':
      'Invalid session.json file (malformed JSON). File preserved without automatic deletion.',
    'Arquivo session.json.enc detectado mas SESSION_SECRET não configurado (ou < 32 chars). Não é possível descriptografar.':
      'Session.json.enc file detected but SESSION_SECRET not set (or < 32 chars). Unable to decrypt.',
    'Arquivo session_meta.json inválido (JSON malformado). Arquivo preservado sem exclusão automática.':
      'Invalid session_meta.json file (malformed JSON). File preserved without automatic deletion.',
    'Artefato antigo em scratch/ removido pela política de retenção.':
      'Old artifact in scratch/ removed by the retention policy.',
    'Atraso inicial interrompido por sinal de encerramento.':
      'Initial delay interrupted by closing signal.',
    'Automação pronta para execução com: ./run_all.sh (ou npm start)':
      'Ready-to-run automation with: ./run_all.sh (or npm start)',
    'Aviso ao verificar sincronização de sessões multi-conta.':
      'Warning when checking multi-account session sync.',
    'Aviso na etapa de tarefas.': 'Warning in the task stage.',
    'Aviso: falha ao criar backup versionado da sessão.':
      'Warning: Failed to create versioned session backup.',
    'Aviso: falha durante notificação de emergência no crash handler.':
      'Warning: failure during emergency notification in the crash handler.',
    'Aviso: falha na extração final de tarefas para o relatório.':
      'Warning: Final task extraction for report failed.',
    'Backup da sessão ignorado: diretório fora do scratch do projeto.':
      'Session backup ignored: directory outside of project scratch.',
    'Backup versionado da sessão (.enc) criado com sucesso.':
      'Versioned session backup (.enc) created successfully.',
    'Backup versionado da sessão (.json) criado com sucesso.':
      'Versioned session backup (.json) created successfully.',
    'Campo de busca não localizado na página; tarefa de busca não iniciada.':
      'Search field not located on the page; search task not started.',
    'Checagem prévia de desktop ignorada.': 'Desktop precheck ignored.',
    'Check-in não retornou resultado. Interrompendo execução.':
      'Check-in returned no results. Interrupting execution.',
    'Check-in pendente encontrado. Coletando...': 'Pending check-in found. Collecting...',
    'Clique de check-in não confirmado pela UI (marcador de "hoje" ausente). Não contabilizando como coletado nesta execução.':
      'Check-in click not confirmed by UI (missing "today" marker). Not counting as collected in this run.',
    'Coletando água da Fazenda Mágica...': 'Collecting water from the Magic Farm...',
    'Configuração validada com sucesso:': 'Configuration validated successfully:',
    'Consolidado silenciado: falhas por captcha em cooldown (já notificadas na primeira ocorrência).':
      'Consolidated silenced: captcha failures on cooldown (already notified on first occurrence).',
    'Cooldown expirado, mas o login remoto segue suspenso até a sessão ser renovada manualmente (import).':
      'Cooldown expired, but remote login remains suspended until the session is manually renewed (import).',
    'Cooldown pós-captcha expirado; login será tentado normalmente nesta execução.':
      'Expired post-captcha cooldown; login will be attempted normally in this run.',
    'Detalhe interno da falha de descriptografia do token.':
      'Internal detail of the token decryption failure.',
    'Dica: Bots do Telegram não podem iniciar conversas com usuários. Abra a conversa com seu bot no aplicativo e envie /start para autorizar o recebimento.':
      'Tip: Telegram bots cannot start conversations with users. Open the conversation with your bot in the app and send /start to authorize receipt.',
    'Disparando mensagem de teste para o Telegram...': 'Sending test message to Telegram...',
    'ENCRYPT_LOCAL_SESSION está ativo, mas SESSION_SECRET está ausente ou tem menos de 32 caracteres. Gravação em texto puro evitada por segurança; defina SESSION_SECRET (>= 32 chars) ou use ENCRYPT_LOCAL_SESSION=false explicitamente.':
      'ENCRYPT_LOCAL_SESSION is active, but SESSION_SECRET is missing or has fewer than 32 characters. Plain text recording avoided for security; set SESSION_SECRET (>= 32 chars) or use ENCRYPT_LOCAL_SESSION=false explicitly.',
    'Envio da notificação consumiu a pausa entre contas; iniciando a próxima conta.':
      'Sending the notification consumed the pause between accounts; starting the next account.',
    'Erro ao efetuar o login: não foi possível obter streak e saldo.':
      'Error logging in: Unable to obtain streak and balance.',
    'Erro ao extrair tarefas da gaveta.': 'Error when extracting tasks from the drawer.',
    'Erro de rede ao enviar notificação; tentando novamente...':
      'Network error when sending notification; trying again...',
    'Erro de timeout ou rede ao enviar notificação para o Telegram (job preservado).':
      'Timeout or network error when sending notification to Telegram (job preserved).',
    'Erro fatal durante a execução unificada.': 'Fatal error during unified execution.',
    'Erro não tratado no processo principal.': 'Unhandled error in the main process.',
    'Execução de itens surpresa cancelada por timeout.':
      'Execution of surprise items canceled due to timeout.',
    'Exportação parcial: algumas contas não foram exportadas.':
      'Partial export: Some accounts were not exported.',
    'A sequência lida no calendário é menor que o histórico local; adotando a sequência real do AliExpress.':
      'The streak read from the calendar is lower than the local history; adopting the real AliExpress streak.',
    'Extrato desmente a quebra (sequência do extrato > 1); preservando o streak real.':
      'Statement disproves the break (streak in the statement > 1); preserving the real streak.',
    'Extrato não desmente a quebra (sequência do extrato <= 1 ou indisponível).':
      'Statement does not disprove the break (streak in the statement <= 1 or unavailable).',
    'Falha ao adquirir lock da conta.': 'Failed to acquire account lock.',
    'Falha ao adquirir lock exclusivo.': 'Failed to acquire exclusive lock.',
    'Falha ao atualizar/persistir a sessão após o check-in (cookies não gravados).':
      'Failed to refresh/persist session after check-in (cookies not saved).',
    'Falha ao autenticar conta no AliExpress (desafio de segurança não superado).':
      'Failed to authenticate account on AliExpress (security challenge not overcome).',
    'Falha ao capturar hash do DOM normalizado.': 'Failed to capture normalized DOM hash.',
    'Falha ao capturar screenshot automático.': 'Failed to capture automatic screenshot.',
    'Falha ao capturar screenshot de diagnóstico.': 'Failed to capture diagnostic screenshot.',
    'Falha ao carregar a sessão criptografada para o contexto; seguindo sem storageState.':
      'Failed to load encrypted session for context; following without storageState.',
    'Falha ao confirmar a quebra de streak pelo extrato; mantendo a leitura da tela.':
      'Failed to confirm the streak break by the statement; keeping the screen reading.',
    'Falha ao criar arquivo de lock.': 'Failed to create lockfile.',
    'Falha ao descriptografar session.json.enc com SESSION_SECRET atual. Arquivo preservado.':
      'Failed to decrypt session.json.enc with current SESSION_SECRET. Archive preserved.',
    'Falha ao descriptografar sessão com SESSION_SECRET_OLD durante rotação de chaves.':
      'Failed to decrypt session with SESSION_SECRET_OLD during key rotation.',
    'Falha ao enviar notificação Telegram consolidada.':
      'Failed to send consolidated Telegram notification.',
    'Falha ao enviar notificação Telegram de 2FA.': 'Failed to send 2FA Telegram notification.',
    'Falha ao enviar notificação Telegram de erro.': 'Failed to send Telegram error notification.',
    'Falha ao enviar notificação Telegram de lock.': 'Failed to send Telegram lock notification.',
    'Falha ao enviar notificação Telegram de resultado.':
      'Failed to send Telegram notification of result.',
    'Falha ao enviar notificação Telegram em erro fatal 2FA.':
      'Failed to send Telegram notification in 2FA fatal error.',
    'Falha ao enviar notificação Telegram em erro fatal.':
      'Failed to send Telegram notification in fatal error.',
    'Falha ao enviar notificação Telegram para a conta individual.':
      'Failed to send Telegram notification to individual account.',
    'Falha ao enviar notificação de cooldown liberado.':
      'Failed to send cooldown released notification.',
    'Falha ao enviar notificação para o Telegram.': 'Failed to send notification to Telegram.',
    'Falha ao importar arquivo de token.': 'Failed to import token file.',
    'Falha ao iniciar o Chromium; avaliando próxima configuração de launch...':
      'Failed to start Chromium; Evaluating next launch configuration...',
    'Falha ao inspecionar diretório para limpeza de backups e diagnósticos.':
      'Failed to inspect directory for cleaning backups and diagnostics.',
    'Falha ao ler arquivo accounts.json. Ignorando...':
      'Failed to read accounts.json file. Ignoring...',
    'Falha ao ler o extrato desktop no fim das tarefas; usando fallback de saldo.':
      'Failed to read the desktop statement at the end of tasks; using balance fallback.',
    'Falha ao limpar marcador de captcha em session_meta.json':
      'Failed to clear captcha marker in session_meta.json',
    'Falha ao migrar session.json para .enc. Arquivo em texto claro preservado.':
      'Failed to migrate session.json to .enc. Clear text file preserved.',
    'Falha ao migrar token de sessão legado para v3; mantendo o token atual.':
      'Failed to migrate legacy session token to v3; keeping the current token.',
    'Falha ao obter lock.': 'Failed to obtain lock.',
    'Falha ao persistir streak em session_meta.json':
      'Failed to persist streak in session_meta.json',
    'Falha ao registrar captcha em session_meta.json':
      'Failed to register captcha in session_meta.json',
    'Falha ao renovar o lock; outra instância pode considerá-lo obsoleto e assumir a execução.':
      'Failed to renew the lock; another instance may consider it obsolete and take over execution.',
    'Falha ao repassar a página mobile para as tarefas; fechando o contexto.':
      'Failure to forward the mobile page to tasks; closing the context.',
    'Falha ao rotacionar a chave de sessão da conta.': 'Failed to rotate account session key.',
    'Falha ao salvar a memória de cards da surpresa; seguindo normalmente.':
      'Failed to save surprise card memory; proceeding normally.',
    'Falha ao salvar screenshot de diagnóstico.': 'Failed to save diagnostic screenshot.',
    'Falha crítica na etapa de check-in / login. Interrompendo execução.':
      'Critical failure in the check-in/login step. Interrupting execution.',
    'Falha inesperada na execução de tarefas.': 'Unexpected failure to execute tasks.',
    'Falha inesperada na execução do check-in.': 'Unexpected check-in execution failure.',
    'Falha na execução de tarefas.': 'Failure to execute tasks.',
    'Falha na exportação da sessão.': 'Session export failed.',
    'Falha na exportação multi-conta.': 'Multi-account export failed.',
    'Falha na importação da sessão.': 'Session import failed.',
    'Falha na rotação de chave de sessão.': 'Session key rotation failed.',
    'Falha no check-in diário.': 'Daily check-in failed.',
    'Falha no envio do teste para o Telegram.': 'Failed to send the test to Telegram.',
    'Falha persistente ao ler painel de tarefas no loop. Encerrando etapa para evitar loop infinito.':
      'Persistent failure to read task pane in the loop. Ending step to avoid infinite loop.',
    'Falha silenciosa ao enviar notificação webhook (job preservado).':
      'Silent failure to send webhook notification (job preserved).',
    'Falha temporária de leitura de session.json. Arquivo preservado para nova tentativa.':
      'Temporary reading failure of session.json. File preserved for retry.',
    'Falha temporária de leitura de session.json.enc. Arquivo preservado para nova tentativa.':
      'Temporary reading failure of session.json.enc. File preserved for retry.',
    'Falha temporária de leitura de session_meta.json. Arquivo preservado para nova tentativa.':
      'Temporary reading failure of session_meta.json. File preserved for retry.',
    'Falha transitória ao enviar notificação; tentando novamente...':
      'Transient failure to send notification; trying again...',
    'Fallback de detalhe de produto indisponível.': 'Product detail fallback unavailable.',
    'Fallback de detalhe: item aberto em nova aba e fechado.':
      'Detail fallback: item opened in a new tab and closed.',
    'Fallback de detalhe: item aberto na mesma aba e retornado à feed.':
      'Detail fallback: item opened in the same tab and returned to the feed.',
    'Flag --force detectada: sobrescrevendo lockfile ativo.':
      'Flag --force detected: overwriting active lockfile.',
    'Flag --force detectada: sobrescrevendo lockfile de outro host.':
      'Flag --force detected: overwriting lockfile from another host.',
    'Heap do Node próximo do limite; considere aumentar ALI_HEAP_MB (run*.sh) ou NODE_OPTIONS=--max-old-space-size=...':
      'Node heap close to limit; consider increasing ALI_HEAP_MB (run*.sh) or NODE_OPTIONS=--max-old-space-size=...',
    'Heartbeat de falha (GET fallback) enviado com sucesso.':
      'Failure heartbeat (GET fallback) sent successfully.',
    'Heartbeat de falha enviado com sucesso.': 'Failure heartbeat sent successfully.',
    'Heartbeat de início (GET fallback) enviado com sucesso.':
      'GET fallback heartbeat sent successfully.',
    'Heartbeat de início enviado com sucesso.': 'Start heartbeat sent successfully.',
    'Heartbeat de sucesso (GET fallback) enviado com sucesso.':
      'Success heartbeat (GET fallback) sent successfully.',
    'Heartbeat de sucesso enviado com sucesso.': 'Successful heartbeat sent successfully.',
    'Heartbeat ignorado na falha: URL não informada.':
      'Heartbeat ignored on failure: URL not provided.',
    'Heartbeat ignorado no início: URL não informada.':
      'Heartbeat ignored at first: URL not provided.',
    'Heartbeat ignorado no sucesso: URL não informada.':
      'Heartbeat ignored on success: URL not provided.',
    'Heartbeat não enviado: destino bloqueado pela validação de segurança (SSRF).':
      'Heartbeat not sent: destination blocked by security validation (SSRF).',
    'Host com pouca RAM detectado: usando SCRYPT_N reduzido (2^15) para novas criptografias.':
      'Low RAM host detected: using reduced SCRYPT_N (2^15) for new encryptions.',
    'Ignorando tentativa de salvar storageState sem cookies de autenticação válidos.':
      'Ignoring attempt to save storageState without valid authentication cookies.',
    'Importação parcial: algumas contas não foram importadas.':
      'Partial import: Some accounts were not imported.',
    'Janela manual: página de moedas aberta, mas nenhum cookie forte novo detectado; continuando a aguardar.':
      'Manual window: coins page open, but no new strong cookies detected; continuing to wait.',
    'Leitura de streak = 1 com histórico anterior > 1; confirmando a quebra pelo extrato desktop...':
      'Streak reading = 1 with previous history > 1; confirming the break via the desktop statement...',
    'Lockfile expirado (staleTimeout atingido). Removendo lock antigo.':
      'lockfile expired (staleTimeout reached). Removing old lock.',
    'Lockfile ilegível ou inválido detectado após carência de leitura. Removendo para recriar com segurança.':
      'Unreadable or invalid lockfile detected after lack of reading. Removing to recreate safely.',
    'Lockfile suspeito (symlink) detectado. Removendo apenas o link por segurança.':
      'Suspicious lockfile (symlink) detected. Just removing the link to be safe.',
    'Login automático bloqueado: exibindo menu de login manual.':
      'Automatic login blocked: Displaying manual login menu.',
    'Login manual concluído após bloqueio; sessão renovada e fluxo headless retomado.':
      'Manual login completed after blocking; session renewed and headless flow resumed.',
    'Login manual concluído; sessão renovada e fluxo headless retomado.':
      'Manual login completed; session renewed and headless flow resumed.',
    'Login manual disponível: exibindo menu de escolha.':
      'Manual login available: displaying choice menu.',
    'Login manual indisponível neste ambiente; mantendo a falha.':
      'Manual login unavailable in this environment; maintaining the failure.',
    'Login manual indisponível neste ambiente; seguindo headless.':
      'Manual login unavailable in this environment; following headless.',
    'Login necessário: acionando autenticação.': 'Login required: triggering authentication.',
    'Login pausado pelo cooldown pós-captcha; nenhuma tentativa será feita nesta execução.':
      'Login paused by post-captcha cooldown; no attempt will be made in this execution.',
    'Login rejeitado pelo controle de risco do AliExpress (RGV587/FAIL_SYS_USER_VALIDATE).':
      'Login rejected by AliExpress risk control (RGV587/FAIL_SYS_USER_VALIDATE).',
    'Login remoto suspenso: sessão precisa ser renovada manualmente (pós-bloqueio RGV587).':
      'Remote login suspended: session needs to be manually renewed (post-RGV587 lockout).',
    'MANUAL_LOGIN=always, mas não há TTY/interface gráfica disponível; mantendo o login automático headless.':
      'MANUAL_LOGIN=always, but there is no TTY/graphical interface available; maintaining automatic headless login.',
    'Menu de login manual cancelado; mantendo a falha.':
      'Manual login menu canceled; maintaining the failure.',
    'Menu de login manual cancelado; seguindo headless.':
      'Manual login menu canceled; following headless.',
    'Menu de login manual expirou sem resposta; mantendo a falha.':
      'Manual login menu timed out with no response; maintaining the failure.',
    'Menu de login manual expirou sem resposta; seguindo headless.':
      'Manual login menu timed out with no response; following headless.',
    'Migrando sessão legada em texto claro (session.json) para formato criptografado at-rest (session.json.enc)...':
      'Migrating legacy clear text session (session.json) to at-rest encrypted format (session.json.enc)...',
    'Modo de baixo consumo do Chromium desativado (CHROMIUM_LOW_MEMORY=false ou fallback de launch).':
      'Chromium Low Power Mode disabled (CHROMIUM_LOW_MEMORY=false or launch fallback).',
    'Módulo undici indisponível: proteção anti-DNS rebinding via lookup pinado desativada; mitigação SSRF baseada exclusivamente em resolução prévia de DNS.':
      'Unavailable module: anti-DNS rebinding protection via pinned lookup disabled; SSRF mitigation based solely on DNS pre-resolution.',
    'Nenhum card novo encontrado; recarregando o feed de surpresas...':
      'No new cards found; reloading the feed of surprises...',
    'Nenhuma conta foi rotacionada com sucesso.': 'No accounts were successfully rotated.',
    'Nenhuma sessão ativa encontrada para exportar.': 'No active sessions found to export.',
    'Nenhuma sessão foi importada.': 'No sessions were imported.',
    'Nenhuma tarefa pendente encontrada no painel. Etapa concluída com sucesso.':
      'No pending tasks found in the dashboard. Step completed successfully.',
    'Notificação Telegram enviada com sucesso.': 'Telegram notification sent successfully.',
    'Notificação Telegram ignorada: TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados.':
      'Telegram notification ignored: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured.',
    'Notificação via Webhook enviada com sucesso.': 'Webhook notification sent successfully.',
    'Não foi possível fazer backup do .enc existente; migração abortada para não perder a sessão.':
      'Unable to backup existing .enc; aborted migration so as not to lose the session.',
    'Não foi possível remover o arquivo de token após a importação.':
      'Unable to remove token file after import.',
    'Opção A (Importar todas as contas no servidor remoto):':
      'Option A (Import all accounts on the remote server):',
    'Opção A (Recomendada via STDIN):': 'Option A (Recommended via STDIN):',
    'Opção B (Importar individualmente via STDIN):': 'Option B (Import individually via STDIN):',
    'Opção B (Via arquivo):': 'Option B (Via file):',
    'Painel de tarefas inline detectado (layout aecoin-*); sem gaveta para abrir.':
      'Inline task pane detected (aecoin-* layout); no drawer to open.',
    'Payload do relatório diverge do schema (campo ausente ou tipo inesperado).':
      'Report payload deviates from schema (missing field or unexpected type).',
    'Payload do webhook excede o limite; enviando versão truncada.':
      'Webhook payload exceeds limit; sending truncated version.',
    'Payload final do webhook excede o limite em bytes; enviando versão truncada.':
      'Final webhook payload exceeds limit in bytes; sending truncated version.',
    'Playwright trace capturado e salvo após falha.':
      'Playwright trace captured and saved after crash.',
    'Poda de artefatos ignorada: diretório fora do scratch do projeto.':
      'Artifact pruning ignored: directory outside of project scratch.',
    'Página mobile preservada para a etapa de tarefas (sem recarregar o SPA).':
      'Mobile page preserved for the task stage (without reloading the SPA).',
    'Página presa em skeleton de carregamento. Recarregando página (reload)...':
      'Page stuck in loading skeleton. Reloading page (reload)...',
    'Página principal fechada ou indisponível. Recriando página principal...':
      'Home page closed or unavailable. Recreating main page...',
    'Página principal não responde (renderer travado ou caiu). Recriando...':
      'Main page is unresponsive (renderer hung or crashed). Recreating...',
    'Realizando check-in diário...': 'Performing daily check-in...',
    'Removendo lockfile órfão de processo anterior finalizado.':
      'Removing orphaned lockfile from previous terminated process.',
    'Reutilizando a página mobile do check-in (sem recarregar a central de moedas).':
      'Reusing the mobile check-in page (without reloading the coin center).',
    'Saldo desktop não detectado diretamente. Salvando screenshot de diagnóstico...':
      'Desktop balance not detected directly. Saving diagnostic screenshot...',
    'Saldo pós-checkin sincronizado com as moedas recebidas no check-in (ledger defasado).':
      'Post-checkin balance synchronized with coins received at check-in (outdated ledger).',
    'Saldo/streak reutilizados da checagem inicial do desktop (sem nova leitura).':
      'Balance/streak reused from initial desktop check (no new reading).',
    'Screenshot automático de diagnóstico capturado (PW_SCREENSHOT).':
      'Automatic diagnostic screenshot captured (PW_SCREENSHOT).',
    'Segunda passada: nenhuma tarefa incompleta para reabrir. Encerrando.':
      'Second pass: no incomplete tasks to reopen. Closing.',
    'Sessão anterior inválida ou expirada. Limpando...':
      'Previous session invalid or expired. Cleaning...',
    'Sessão autenticada criptografada at-rest salva com sucesso (.enc, 0o600).':
      'At-rest encrypted authenticated session saved successfully (.enc, 0o600).',
    'Sessão autenticada e metadados salvos com sucesso (permissão 0o600).':
      'Session authenticated and metadata saved successfully (permission 0o600).',
    'Sessão descriptografada com SESSION_SECRET_OLD (rotação detectada). Re-criptografando com a nova chave...':
      'Session decrypted with SESSION_SECRET_OLD (rotation detected). Re-encrypting with the new key...',
    'Sessão em cache pertence a outra conta configurada. Preservando arquivos sem exclusão.':
      'Cached session belongs to another configured account. Preserving files without deletion.',
    'Sessão legada migrada com sucesso para formato criptografado at-rest.':
      'Successfully migrated legacy session to at-rest encrypted format.',
    'Sessão legada vinculada a conta secundária migrada com sucesso para arquivos isolados.':
      'Legacy session linked to secondary account successfully migrated to isolated files.',
    'Sessão removida; metadados anti-bot (gate/cooldown) preservados.':
      'Session removed; anti-bot metadata (gate/cooldown) preserved.',
    'Sinal de encerramento recebido; fechando browser e liberando lock...':
      'Closing signal received; closing browser and releasing lock...',
    'Sinal recebido em collect.js; fechando browser e liberando lock...':
      'Signal received in collect.js; closing browser and releasing lock...',
    'Sinal recebido em do_tasks.js; fechando browser e liberando lock...':
      'Signal received in do_tasks.js; closing browser and releasing lock...',
    'Tentando carregar URL novamente...': 'Trying to load URL again...',
    'Teste concluído com sucesso!': 'Test completed successfully!',
    'Teto global de ações atingido; encerrando novas passadas para não estourar o tempo.':
      'Global share ceiling reached; closing new passes so as not to run out of time.',
    'Timeout ao enviar notificação (resultado ambíguo); NÃO reenviando para evitar mensagem duplicada.':
      'Timeout when sending notification (ambiguous result); NOT resending to avoid duplicate message.',
    'Todas as tarefas disponíveis foram concluídas ou verificadas.':
      'All available tasks have been completed or checked.',
    'Token de sessão legado migrado para v3 (salt aleatório).':
      'Migrated legacy session token to v3 (random salt).',
    'Token de sessão removido após importação bem-sucedida (use --keep-tokens para preservar).':
      'Session token removed after successful import (use --keep-tokens to preserve).',
    'Uso de heap do Node.': 'Node heap usage.',
    'Valor de SCRYPT_N abaixo do piso criptográfico seguro (16384). Aplicando valor padrão seguro (131072).':
      'Value of SCRYPT_N below the secure cryptographic floor (16384). Applying safe default value (131072).',
    'Valor do check-in creditado difere do tier sugerido pela UI; usando o valor real do extrato.':
      'Check-in value credited differs from the tier suggested by the UI; using the actual value of the statement.',
    'Variável SCRYPT_N abaixo do piso criptográfico seguro (16384). Aplicando valor padrão seguro (131072).':
      'Variable SCRYPT_N below the secure cryptographic floor (16384). Applying safe default value (131072).',
    'Verificando botão de água da Fazenda Mágica / Prize Land...':
      'Checking the water button at Fazenda Mágica / Prize Land...',
    'Verificação das tarefas exclusivas do app DESLIGADA (SKIP_APP_ONLY_TASKS=true): Prize Land/regar, minigames, quizzes e avaliações serão ignorados.':
      'Checking app-exclusive tasks OFF (SKIP_APP_ONLY_TASKS=true): Prize Land/watering, minigames, quizzes and assessments will be ignored.',
    'Verificação de navegação do card de produto...': 'Product card navigation check...',
    'Verificação de segurança (slide captcha) detectada. Tentando deslizar...':
      'Security check (captcha slide) detected. Trying to slide...',
    'Verificação pós-escrita da migração falhou. Texto claro preservado; .enc pode estar inválido.':
      'Migration post-write verification failed. Clear text preserved; .enc may be invalid.',
    'Webhook abortado: destino (ou redirect) apontou para rede privada (SSRF).':
      'Webhook aborted: destination (or redirect) pointed to private network (SSRF).',
    'Webhook notification retornou status não-2xx.':
      'Webhook notification returned non-2xx status.',
    'Webhook não enviado: destino bloqueado pela validação de segurança (SSRF).':
      'Webhook not sent: destination blocked by security validation (SSRF).',
    '[2FA Não-Interativo] O AliExpress exigiu verificação 2FA sem terminal interativo (cron/CI). Finalizando conta rapidamente.':
      '[2FA Non-Interactive] AliExpress required 2FA verification without interactive terminal (cron/CI). Finalizing account quickly.',
    '[2FA Não-Interativo] O AliExpress exigiu verificação de código 2FA durante execução sem terminal interativo (cron/CI). Finalizando rapidamente (<5s) para evitar travamento. Solução: execute localmente com "./run_all.sh", resolva o 2FA e use "node export_session.js" / "node import_session.js".':
      '[2FA Non-Interactive] AliExpress required 2FA code verification when running without an interactive terminal (cron/CI). Finishing quickly (<5s) to avoid crashing. Solution: Run locally with "./run_all.sh", resolve 2FA and use "node export_session.js" / "node import_session.js".',
    '[2FA Não-Interativo] O AliExpress exigiu verificação de código 2FA durante execução sem terminal interativo (cron/CI). Solução: execute localmente com "./run_all.sh", resolva o 2FA e use "node export_session.js" / "node import_session.js".':
      '[2FA Non-Interactive] AliExpress required 2FA code verification when running without an interactive terminal (cron/CI). Solution: Run locally with "./run_all.sh", resolve 2FA and use "node export_session.js" / "node import_session.js".',
    '[Anti-bot] Captcha/desafio de segurança no login; novas tentativas ficam pausadas pelo cooldown configurado.':
      '[Anti-bot] Captcha/security challenge at login; new attempts are paused by the configured cooldown.',
    '[Anti-bot] Login manual em janela não foi concluído; intervenção do operador necessária (sem retry automático).':
      '[Anti-bot] Manual login in window was not completed; operator intervention required (no automatic retry).',
    '[Anti-bot] Login remoto suspenso até renovação manual da sessão (login local + captcha + import).':
      '[Anti-bot] Remote login suspended until manual session renewal (local login + captcha + import).',
    '[DRY-RUN] Artefato antigo em scratch/ seria removido pela política de retenção.':
      '[DRY-RUN] Old artifact in scratch/ would be removed by retention policy.',
    '[Login] Nova sessão autenticada salva com sucesso.':
      '[Login] New authenticated session saved successfully.',
    '[Login] Prompt de reautenticação in-page detectado (somente senha).':
      '[Login] In-page reauthentication prompt detected (password only).',
    '[OK] Permissões 0o600 aplicadas em todos os arquivos de sessão':
      '[OK] Permissions 0o600 applied to all session files',
    '[PARCIAL] Rotação concluída com falhas em algumas contas.':
      '[PARTIAL] Rotation completed with failures on some accounts.',
    '[PW_DUMP_DOM=true] HTML normalizado completo gravado no artefato de diagnóstico.':
      '[PW_DUMP_DOM=true] Full normalized HTML written to the diagnostic artifact.',
    '[ROTAÇÃO] Chave de sessão rotacionada com sucesso.':
      '[ROTATION] Session key rotated successfully.',
    '[SUCESSO] Rotação de chave concluída para todas as contas.':
      '[SUCCESS] Key rotation completed for all accounts.',
    '[Segurança AliExpress] Código de verificação 2FA solicitado pelo AliExpress.':
      '[AliExpress Security] 2FA verification code requested by AliExpress.',
    '[Sessão Remota Expirada] A execução falhou e a sessão ativa foi importada de outro host. Gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".':
      '[Remote Session Expired] Execution failed and the active session was imported from another host. Generate a new session by running "node export_session.js" on the source server and import it with "node import_session.js".',
    '[Sessão Remota Expirada] A sessão foi importada de outro host (via import_session.js) e está expirada ou inválida. Gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".':
      '[Expired Remote Session] The session was imported from another host (via import_session.js) and is expired or invalid. Generate a new session by running "node export_session.js" on the source server and import it with "node import_session.js".',
    '[Sessão Remota Expirada] A sessão importada da conta expirou. Gere uma nova sessão com "node export_session.js" no servidor de origem e importe-a com "node import_session.js".':
      '[Remote Session Expired] The account\'s imported session has expired. Generate a new session with "node export_session.js" on the source server and import it with "node import_session.js".',
    '[Sessão Remota Expirada] A sessão importada expirou ou foi invalidada pelo AliExpress. É necessário gerar nova sessão com "node export_session.js" no servidor de origem e importá-la com "node import_session.js".':
      '[Remote Session Expired] The imported session has expired or been invalidated by AliExpress. You need to generate new session with "node export_session.js" on the source server and import it with "node import_session.js".',
    '[Sessão Remota Expirada] A sessão importada expirou ou é inválida. É necessário gerar nova sessão executando "node export_session.js" no servidor de origem e importá-la com "node import_session.js".':
      '[Remote Session Expired] The imported session has expired or is invalid. You need to generate new session by running "node export_session.js" on the source server and import it with "node import_session.js".',
    '[Sessão Remota Expirada] Falha ao autenticar no AliExpress. A sessão importada de outro host expirou ou foi invalidada. Gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".':
      '[Remote Session Expired] Failed to authenticate with AliExpress. The session imported from another host has expired or been invalidated. Generate a new session by running "node export_session.js" on the source server and import it with "node import_session.js".',
    '[Sessão Remota Expirada] Falha durante a execução: a sessão importada expirou ou foi invalidada pelo AliExpress. Gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".':
      '[Remote Session Expired] Failed to run: The imported session has expired or been invalidated by AliExpress. Generate a new session by running "node export_session.js" on the source server and import it with "node import_session.js".',
    '[Sessão Remota Expirada] Falha na execução de tarefas: a sessão importada expirou. Sugestão: gere uma nova sessão com "node export_session.js" no servidor de origem e importe-a com "node import_session.js".':
      '[Remote Session Expired] Task execution failed: The imported session has expired. Suggestion: Generate a new session with "node export_session.js" on the source server and import it with "node import_session.js".',
    '[Sessão Remota Expirada] Login falhou em servidor remoto. Sugestão: gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".':
      '[Remote Session Expired] Login failed on remote server. Suggestion: Generate a new session by running "node export_session.js" on the source server and import it with "node import_session.js".',
    '[Sessão Remota Expirada] Login falhou no servidor remoto. A sessão importada expirou ou foi invalidada pelo AliExpress. Sugestão: gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".':
      '[Remote Session Expired] Login failed on the remote server. The imported session has expired or been invalidated by AliExpress. Suggestion: Generate a new session by running "node export_session.js" on the source server and import it with "node import_session.js".',
    '[Sessão Remota Expirada] Não foi possível obter streak e saldo. A sessão importada de outro host expirou ou foi invalidada pelo AliExpress. Gere uma nova sessão executando "node export_session.js" no servidor de origem e importe-a com "node import_session.js".':
      '[Remote Session Expired] Unable to obtain streak and balance. The session imported from another host has expired or been invalidated by AliExpress. Generate a new session by running "node export_session.js" on the source server and import it with "node import_session.js".',
    '[Sessão Remota] Autenticação necessária com sessão importada. Em servidores remotos (VPS/nuvem), desafios de segurança anti-bot podem impedir o login automático.':
      '[Remote Session] Authentication required with imported session. On remote servers (VPS/cloud), anti-bot security challenges may prevent automatic login.',
    '[Sessão] Prompt de login/reautenticação detectado no desktop; saldo indisponível nesta leitura.':
      '[Session] Login/reauthentication prompt detected on desktop; balance unavailable at this reading.',
    'accounts.json contém credenciais e estava acessível a outros usuários; aplicando permissão 0o600.':
      'accounts.json contains credentials and was accessible to other users; applying permission 0o600.',
    'accounts.json: falha ao ler passwordFile; conta ignorada.':
      'accounts.json: failed to read passwordFile; account ignored.',
    'accounts.json: passwordEnv definido, mas a variável não está no ambiente; conta ignorada.':
      'accounts.json: passwordEnv defined, but the variable is not in the environment; account ignored.',
    'executeSurpriseItems chamado sem instância válida de page.':
      'executeSurpriseItems called without valid instance of page.',
    'options.N inválido ou abaixo do piso criptográfico seguro (16384). Aplicando valor padrão seguro (131072).':
      'Invalid options.N or below the safe cryptographic floor (16384). Applying safe default value (131072).',
    'safeWriteFile: destino é symlink; removendo o link para gravar com segurança.':
      'safeWriteFile: target is symlink; removing the link to record safely.',
    'session.json.enc existente preservado como backup antes da migração do texto claro.':
      'Existing session.json.enc preserved as backup before plaintext migration.',
    'session_meta.json ilegível (JSON malformado): sessão preservada sem exclusão automática para não perder credencial válida.':
      'unreadable session_meta.json (malformed JSON): session preserved without automatic deletion to avoid losing valid credentials.',
    'utimes indisponível; renovando o lock por reescrita condicional.':
      'utimes unavailable; renewing the lock by conditional rewriting.',
    '⚠️  [AVISO] Exibição de token em tela solicitada via --show-token.':
      '⚠️ [WARNING] On-screen token display requested via --show-token.',
    '🚨 ALERTA CRÍTICO: Streak quebrado! A sequência diária de check-in foi interrompida ou resetada.':
      '🚨 CRITICAL ALERT: Streak broken! The daily check-in streak has been interrupted or reset.',
    'já estava coletado (+0 moedas)': 'already collected (+0 coins)',
    'sequência não identificada na página': 'streak not identified on the page',
    'SESSION_SECRET é obrigatório e deve ter no mínimo 32 caracteres para migração segura.':
      'SESSION_SECRET is required and must be at least 32 characters long for secure migration.',
    'ENCRYPT_LOCAL_SESSION está desligado; a migração para .enc requer criptografia ativa. Remova o opt-out ou use --plaintext no import.':
      'ENCRYPT_LOCAL_SESSION is disabled; migration to .enc requires encryption to be active. Remove the opt-out or use --plaintext on import.',
    'Conteúdo do session.json legado é inválido (JSON malformado).':
      'Legacy session.json content is invalid (malformed JSON).',
    'Falha ao analisar JSON da sessão legada.': 'Failed to parse legacy session JSON.',
    'Falha na verificação da migração para .enc.': 'Failed to verify migration to .enc.',
    'Falha na validação das variáveis de configuração em credentials.env.':
      'Failed to validate the configuration variables in credentials.env.',
    'Campo/atalho de busca não disponível ou resultado não confirmado; tarefa de busca não iniciada.':
      'Search field/shortcut unavailable or result not confirmed; search task not started.',
    'A busca embutida abriu uma aba que não é a página de resultados esperada; fechando.':
      'The inline search opened a tab that is not the expected results page; closing it.',
    'A busca embutida não abriu a página de resultados esperada.':
      'The inline search did not open the expected results page.'
  },
  templates: [
    {
      pt: 'Busca embutida da central de moedas detectada; pesquisando "{{0}}"...',
      en: 'Coin center inline search detected; searching "{{0}}"...'
    },
    {
      pt: '\n--- Executando: "{{0}}" ({{1}}){{2}} ---',
      en: '\n--- Running: "{{0}}" ({{1}}){{2}} ---'
    },
    {
      pt: '\n>>> [CONTA {{0}}/{{1}}] Iniciando execução para: {{2}} (versão v{{3}})',
      en: '\n>>> [ACCOUNT {{0}}/{{1}}] Starting execution for: {{2}} (version v{{3}})'
    },
    {
      pt: '\nSaldo total final: {{0}}',
      en: '\nFinal total balance: {{0}}'
    },
    {
      pt: '\n[Conta {{0}}/{{1}}]: {{2}}',
      en: '\n[Account {{0}}/{{1}}]: {{2}}'
    },
    {
      pt: '       ALIEXPRESS MOEDAS - MODO MULTI-CONTA ({{0}} CONTAS)',
      en: '       ALIEXPRESS COINS - MULTI-ACCOUNT MODE ({{0}} ACCOUNTS)'
    },
    {
      pt: '       RELATÓRIO CONSOLIDADO FINAL - MULTI-CONTA ({{0}} contas)',
      en: '       FINAL CONSOLIDATED REPORT - MULTI-ACCOUNT ({{0}} accounts)'
    },
    {
      pt: '    - [Conta {{0}}] {{1}}',
      en: '    - [Account {{0}}] {{1}}'
    },
    {
      pt: '    - {{0}}: {{1}} ({{2}})',
      en: '    - {{0}}: {{1}} ({{2}})'
    },
    {
      pt: '    Dia e Hora de Início: {{0}}',
      en: '    Start Day and Time: {{0}}'
    },
    {
      pt: '   EXPORTAÇÃO CONCLUÍDA: {{0}} CONTA(S) EXPORTADA(S)',
      en: '   EXPORT COMPLETED: {{0}} EXPORTED ACCOUNT(S)'
    },
    {
      pt: '   EXPORTAÇÃO MULTI-CONTA DE SESSÕES ALIEXPRESS ({{0}} CONTAS)',
      en: '   MULTI-ACCOUNT EXPORT OF ALIEXPRESS SESSIONS ({{0}} ACCOUNTS)'
    },
    {
      pt: '   IMPORTAÇÃO CONCLUÍDA: {{0}} CONTA(S) IMPORTADA(S)',
      en: '   IMPORT COMPLETE: {{0}} IMPORTED ACCOUNT(S)'
    },
    {
      pt: '   ROTAÇÃO DE CHAVE DE SESSÃO ({{0}} CONTA(S))',
      en: '   SESSION KEY ROTATION ({{0}} ACCOUNT(S))'
    },
    {
      pt: '  node import_session.js < {{0}}',
      en: '  node import_session.js < {{0}}'
    },
    {
      pt: '  • Check-in: {{0}}',
      en: '  • Check-in: {{0}}'
    },
    {
      pt: '  • Janela: {{0}} → {{1}} ({{2}})',
      en: '  • Window: {{0}} → {{1}} ({{2}})'
    },
    {
      pt: '  • Moedas Ganhas Hoje: +{{0}} moedas (check-in +{{1}} / tarefas +{{2}})',
      en: '  • Coins Earned Today: +{{0}} coins (check-in +{{1}} / tasks +{{2}})'
    },
    {
      pt: '  • Saldo Final: {{0}}',
      en: '  • Final Balance: {{0}}'
    },
    {
      pt: '  • Sequência (Streak): {{0}} dias (+{{1}} moedas/dia)',
      en: '  • Streak: {{0}} days (+{{1}} coins/day)'
    },
    {
      pt: '  • Maior sequência (recorde): {{0}} dias',
      en: '  • Longest streak (record): {{0}} days'
    },
    {
      pt: 'Maior sequência (recorde): {{0}} dias',
      en: 'Longest streak (record): {{0}} days'
    },
    {
      pt: '  • Status: FALHA ({{0}})',
      en: '  • Status: FAILURE ({{0}})'
    },
    {
      pt: '  • Tarefas executadas: {{0}}',
      en: '  • Tasks performed: {{0}}'
    },
    {
      pt: '  • {{0}}: {{1}} ({{2}})',
      en: '  • {{0}}: {{1}} ({{2}})'
    },
    {
      pt: ' • Atraso inicial (START_DELAY_MIN_MS..MAX_MS): {{0}}',
      en: ' • Start delay (START_DELAY_MIN_MS..MAX_MS): {{0}}'
    },
    {
      pt: ' • Bloqueio de mídia (ALLOW_MEDIA): {{0}}',
      en: ' • Media blocking (ALLOW_MEDIA): {{0}}'
    },
    {
      pt: ' • Contas detectadas ({{0}}):',
      en: ' • Detected accounts ({{0}}):'
    },
    {
      pt: ' • Contexto do login manual (MANUAL_LOGIN_CONTEXT): {{0}}',
      en: ' • Manual login context (MANUAL_LOGIN_CONTEXT): {{0}}'
    },
    {
      pt: ' • Cooldown pós-captcha (CAPTCHA_COOLDOWN_HOURS): {{0}}',
      en: ' • Post-captcha cooldown (CAPTCHA_COOLDOWN_HOURS): {{0}}'
    },
    {
      pt: " • Dead Man's Switch (Heartbeat): {{0}}",
      en: " • Dead Man's Switch (Heartbeat): {{0}}"
    },
    {
      pt: ' • Envio Teste Telegram: {{0}}',
      en: ' • Telegram Test Sending: {{0}}'
    },
    {
      pt: ' • Limite de Ações de Tarefas: {{0}}',
      en: ' • Task Action Limit: {{0}}'
    },
    {
      pt: ' • Limite por Rodada (TASK_ROUND_MAX_ATTEMPTS): {{0}}',
      en: ' • Limit per Round (TASK_ROUND_MAX_ATTEMPTS): {{0}}'
    },
    {
      pt: ' • Login manual em janela (MANUAL_LOGIN): {{0}}',
      en: ' • Manual login in window (MANUAL_LOGIN): {{0}}'
    },
    {
      pt: ' • Modo Headless: {{0}}',
      en: ' • Headless Mode: {{0}}'
    },
    {
      pt: ' • Notificação individual por conta (TELEGRAM_PER_ACCOUNT): {{0}}',
      en: ' • Individual notification per account (TELEGRAM_PER_ACCOUNT): {{0}}'
    },
    {
      pt: ' • Notificações Telegram: {{0}}',
      en: ' • Telegram notifications: {{0}}'
    },
    {
      pt: ' • Nível de Log: {{0}}',
      en: ' • Log Level: {{0}}'
    },
    {
      pt: ' • Pausa entre contas (ACCOUNT_DELAY_MIN_MS..MAX_MS): {{0}}',
      en: ' • Pause between accounts (ACCOUNT_DELAY_MIN_MS..MAX_MS): {{0}}'
    },
    {
      pt: ' • Pausa entre tarefas (TASK_PAUSE_MIN_MS..MAX_MS): {{0}}',
      en: ' • Pause between tasks (TASK_PAUSE_MIN_MS..MAX_MS): {{0}}'
    },
    {
      pt: ' • SESSION_SECRET: {{0}}',
      en: ' • SESSION_SECRET: {{0}}'
    },
    {
      pt: ' • Sandbox Chromium: {{0}}',
      en: ' • Chromium Sandbox: {{0}}'
    },
    {
      pt: ' • Tarefas exclusivas do app (SKIP_APP_ONLY_TASKS): {{0}}',
      en: ' • App-exclusive tasks (SKIP_APP_ONLY_TASKS): {{0}}'
    },
    {
      pt: ' • Teto de Scroll (TASK_SCROLL_MAX_MS): {{0}}ms',
      en: ' • Scroll Ceiling (TASK_SCROLL_MAX_MS): {{0}}ms'
    },
    {
      pt: ' • Timeout de Navegação (NAV_TIMEOUT): {{0}}ms',
      en: ' • Navigation Timeout (NAV_TIMEOUT): {{0}}ms'
    },
    {
      pt: ' • Timeout por Tentativa (TASK_MAX_DURATION_MS): {{0}}ms',
      en: ' • Attempt Timeout (TASK_MAX_DURATION_MS): {{0}}ms'
    },
    {
      pt: ' • Usuário: {{0}}',
      en: ' • User: {{0}}'
    },
    {
      pt: ' • Webhook de notificação: {{0}}{{1}}',
      en: ' • Notification webhook: {{0}}{{1}}'
    },
    {
      pt: ' • [Conta {{0}}] {{1}} -> {{2}}',
      en: ' • [Account {{0}}] {{1}} -> {{2}}'
    },
    {
      pt: ' • [Conta {{0}}] {{1}} <- {{2}} (salvo em {{3}})',
      en: ' • [Account {{0}}] {{1}} <- {{2}} (except in {{3}})'
    },
    {
      pt: '- {{0}}: {{1}} ({{2}})',
      en: '- {{0}}: {{1}} ({{2}})'
    },
    {
      pt: '>>> [CONTA {{0}}/{{1}}] [ETAPA 1/2] Check-in Diário...',
      en: '>>> [ACCOUNT {{0}}/{{1}}] [STEP 1/2] Daily Check-in...'
    },
    {
      pt: '>>> [CONTA {{0}}/{{1}}] [ETAPA 1/2] Concluída em {{2}} | Duração: {{3}}',
      en: '>>> [ACCOUNT {{0}}/{{1}}] [STAGE 1/2] Completed in {{2}} | Duration: {{3}}'
    },
    {
      pt: '>>> [CONTA {{0}}/{{1}}] [ETAPA 2/2] Concluída em {{2}} | Duração: {{3}}',
      en: '>>> [ACCOUNT {{0}}/{{1}}] [STAGE 2/2] Completed in {{2}} | Duration: {{3}}'
    },
    {
      pt: '>>> [CONTA {{0}}/{{1}}] [ETAPA 2/2] Tarefas Diárias...',
      en: '>>> [ACCOUNT {{0}}/{{1}}] [STEP 2/2] Daily Tasks...'
    },
    {
      pt: '>>> [ETAPA 1/2] Concluída em {{0}} | Duração: {{1}}',
      en: '>>> [STAGE 1/2] Completed in {{0}} | Duration: {{1}}'
    },
    {
      pt: '>>> [ETAPA 2/2] Concluída em {{0}} | Duração: {{1}}',
      en: '>>> [STAGE 2/2] Completed in {{0}} | Duration: {{1}}'
    },
    {
      pt: 'Aguardando backoff de {{0}}ms antes de tentar próxima conta...',
      en: 'Waiting for backoff {{0}}months before trying the next account...'
    },
    {
      pt: 'Aguardando backoff exponencial com jitter de {{0}}ms antes de tentar próxima conta...',
      en: 'Waiting for exponential backoff with jitter {{0}}months before trying the next account...'
    },
    {
      pt: 'Aguardando {{0}}ms antes da passada extra...',
      en: 'Waiting {{0}}month before the extra pass...'
    },
    {
      pt: 'Ação abortada por timeout em: {{0}}',
      en: 'Action aborted due to timeout in: {{0}}'
    },
    {
      pt: 'Check-in Diário: {{0}}',
      en: 'Daily Check-in: {{0}}'
    },
    {
      pt: 'Concluída ação em: {{0}}',
      en: 'Action completed on: {{0}}'
    },
    {
      pt: 'Conta: {{0}}',
      en: 'Account: {{0}}'
    },
    {
      pt: 'Data:                {{0}}',
      en: 'Date:                {{0}}'
    },
    {
      pt: 'Duração Etapa 1:     {{0}}',
      en: 'Duration Step 1:     {{0}}'
    },
    {
      pt: 'Duração Etapa 2:     {{0}}',
      en: 'Duration Step 2:     {{0}}'
    },
    {
      pt: 'Duração Total:       {{0}}',
      en: 'Total Duration:       {{0}}'
    },
    {
      pt: 'Erro ao executar "{{0}}".',
      en: 'Error executing "{{0}}".'
    },
    {
      pt: 'Executando busca por produto: "{{0}}"...',
      en: 'Executing search by product: "{{0}}"...'
    },
    {
      pt: 'Executando navegação com scroll ({{0}}s): "{{1}}"...',
      en: 'Performing scroll navigation ({{0}}s): "{{1}}"...'
    },
    {
      pt: 'Executando tarefa: tocar em 3 itens (a partir do card #{{0}})...',
      en: 'Performing task: touch 3 items (from card #{{0}})...'
    },
    {
      pt: 'Falha ao enviar heartbeat de falha: {{0}}',
      en: 'Failed to send failure heartbeat: {{0}}'
    },
    {
      pt: 'Falha ao enviar heartbeat de início: {{0}}',
      en: 'Failed to send initial heartbeat: {{0}}'
    },
    {
      pt: 'Falha ao enviar heartbeat de sucesso: {{0}}',
      en: 'Failed to send successful heartbeat: {{0}}'
    },
    {
      pt: 'Falha ao exportar sessão da Conta {{0}}.',
      en: 'Failed to export Account session {{0}}.'
    },
    {
      pt: 'Falha global não tratada detectada ({{0}}). Finalizando execução com código 6.',
      en: 'Unhandled global failure detected ({{0}}). Ending execution with code 6.'
    },
    {
      pt: 'Falha na execução da conta {{0}}. Continuando com as próximas.',
      en: 'Account execution failed {{0}}. Continuing with the next ones.'
    },
    {
      pt: 'Falha na resposta do heartbeat de falha (HTTP {{0}}).',
      en: 'Failed heartbeat response failure (HTTP {{0}}).'
    },
    {
      pt: 'Falha na resposta do heartbeat de início (HTTP {{0}}).',
      en: 'Initial heartbeat response failure (HTTP {{0}}).'
    },
    {
      pt: 'Falha na resposta do heartbeat de sucesso (HTTP {{0}}).',
      en: 'Success heartbeat response failed (HTTP {{0}}).'
    },
    {
      pt: 'Falha na validação do arquivo credentials.env:\n{{0}}',
      en: 'Credentials.env file validation failed:\n{{0}}'
    },
    {
      pt: 'Ganho Real pelas Tarefas: +{{0}} moedas',
      en: 'Real Earnings for Tasks: +{{0}} coins'
    },
    {
      pt: 'Heartbeat ({{0}}) desativado ou sem URL.',
      en: 'Heartbeat ({{0}}) disabled or no URL.'
    },
    {
      pt: 'Hora de Finalização: {{0}}',
      en: 'End Time: {{0}}'
    },
    {
      pt: 'Hora de Início:      {{0}}',
      en: 'Start Time:      {{0}}'
    },
    {
      pt: 'Início atrasado em {{0}}s (janela {{1}}–{{2}}s; início previsto às {{3}} {{4}})',
      en: 'Delayed start in {{0}}s (window {{1}}–{{2}}s; scheduled start at {{3}} {{4}})'
    },
    {
      pt: 'Lock ativo para a conta {{0}}. Pulando...',
      en: 'Active lock for the account {{0}}. Jumping...'
    },
    {
      pt: 'Memória da surpresa: {{0}} card(s) tocados hoje ({{1}}) salvos em scratch/.',
      en: 'Surprise memory: {{0}} card(s) played today ({{1}}) saved in scratch/.'
    },
    {
      pt: 'Moedas Ganhas Hoje:     +{{0}} moedas (check-in +{{1}} / tarefas +{{2}})',
      en: 'Coins Earned Today: +{{0}} coins (check-in +{{1}} / tasks +{{2}})'
    },
    {
      pt: 'Nenhum card de produto encontrado no DOM para o clique {{0}}/{{1}}.',
      en: 'No product cards found in the DOM for the click {{0}}/{{1}}.'
    },
    {
      pt: 'Pausa de {{0}}s antes da próxima tarefa.',
      en: 'Break from {{0}}s before the next task.'
    },
    {
      pt: 'Pausa entre contas: {{0}}s (próxima conta às {{1}} {{2}})',
      en: 'Pause between accounts: {{0}}s (next account at {{1}} {{2}})'
    },
    {
      pt: 'Possível progresso tardio em {{0}} tarefa(s) ({{1}}); relendo o painel em {{2}}ms antes de desistir...',
      en: 'Possible late progress in {{0}} task(s) ({{1}}); rereading the panel in {{2}}months before giving up...'
    },
    {
      pt: 'Processando arquivo de token: {{0}}...',
      en: 'Processing token file: {{0}}...'
    },
    {
      pt: 'Resgatando recompensa da tarefa "{{0}}" (botão "{{1}}")...',
      en: 'Redeeming task reward "{{0}}" (button "{{1}}")...'
    },
    {
      pt: 'Saldo Total Atualizado: {{0}}',
      en: 'Updated Total Balance: {{0}}'
    },
    {
      pt: 'Screenshot de diagnóstico salva: {{0}}',
      en: 'Saved diagnostic screenshot: {{0}}'
    },
    {
      pt: 'Segunda passada ATIVADA (TASK_RETRY_UNFINISHED=true): até {{0}} passada(s) extra(s) apenas para tarefas incompletas.',
      en: 'Second pass ENABLED (TASK_RETRY_UNFINISHED=true): until {{0}} extra pass(es) only for incomplete tasks.'
    },
    {
      pt: 'Segunda passada {{0}}/{{1}}: reabrindo {{2}} tarefa(s) incompleta(s): {{3}}',
      en: 'Last Monday {{0}}/{{1}}: reopening {{2}} incomplete task(s): {{3}}'
    },
    {
      pt: 'Sequência (Streak): {{0}} dias seguidos (+{{1}} moedas/dia)',
      en: 'Streak: {{0}} days in a row (+{{1}} coins/day)'
    },
    {
      pt: 'Sessão inválida ({{0}}). Autenticando via check-in...',
      en: 'Invalid session ({{0}}). Authenticating via check-in...'
    },
    {
      pt: 'Tarefa "{{0}}" avançou de rodada ({{1}}/{{2}}). Resetando tentativas.',
      en: 'Task "{{0}}"advanced round ({{1}}/{{2}}). Resetting attempts.'
    },
    {
      pt: 'Tarefa "{{0}}" avançou de rodada ({{1}}/{{2}}). Resetando tentativas. Falha anterior limpa (progresso tardio).',
      en: 'Task "{{0}}"advanced round ({{1}}/{{2}}). Resetting attempts. Clean previous failure (late progress).'
    },
    {
      pt: 'Tarefa "{{0}}" exige o app e está desativada (SKIP_APP_ONLY_TASKS=true). Ignorando.',
      en: 'Task "{{0}}" requires the app and is disabled (SKIP_APP_ONLY_TASKS=true). Ignoring.'
    },
    {
      pt: 'Tarefa "{{0}}" requer pedido entregue para avaliação. Marcando como especial.',
      en: 'Task "{{0}}" requires order submitted for evaluation. Marking as special.'
    },
    {
      pt: 'Tempo limite de execução atingido para "{{0}}". Abortando tentativa.',
      en: 'Execution timeout reached for "{{0}}". Aborting attempt.'
    },
    {
      pt: 'Tentativa {{0}}/5 de abrir o painel "Ganhe mais moedas"...',
      en: 'Attempt {{0}}/5 to open the "Earn more coins" panel...'
    },
    {
      pt: 'Tocando item {{0}}/3 (card #{{1}})...',
      en: 'Playing item {{0}}/3 (card #{{1}})...'
    },
    {
      pt: 'Todos os {{0}} cards disponíveis já foram tocados nesta rodada. Encerrando toques para evitar repetição de itens.',
      en: 'All {{0}} Available cards have already been played this round. Ending taps to avoid repeating items.'
    },
    {
      pt: '[Conta {{0}}/{{1}} - {{2}}] Nenhum arquivo de sessão ativo encontrado. Pulando...',
      en: '[Account {{0}}/{{1}} - {{2}}] No active session files found. Jumping...'
    },
    {
      pt: '[Dia e Hora]: {{0}}',
      en: '[Day and Time]: {{0}}'
    },
    {
      pt: '[Login] Autenticando com credenciais de "{{0}}"...',
      en: '[Login] Authenticating with " credentials{{0}}"...'
    },
    {
      pt: '[Login] Sessão validada para: {{0}}',
      en: '[Login] Session validated for: {{0}}'
    },
    {
      pt: '[Login] Usuário: {{0}}',
      en: '[Login] User: {{0}}'
    },
    {
      pt: '[OBSERVABLE-SELECTORS] Falha detectada em "{{0}}". Hash do DOM normalizado: {{1}}',
      en: '[OBSERVABLE-SELECTORS] Failure detected in "{{0}}". Normalized DOM hash: {{1}}'
    },
    {
      pt: '[OK] Cookies de autenticação: VÁLIDOS ({{0}} cookies)',
      en: '[OK] Authentication cookies: VALID ({{0}} cookies)'
    },
    {
      pt: '[OK] Data de exportação: {{0}}',
      en: '[OK] Export date: {{0}}'
    },
    {
      pt: '[OK] Expiração estimada: até {{0}} (~90 dias)',
      en: '[OK] Estimated expiration: up to {{0}} (~90 days)'
    },
    {
      pt: '[OK] Fingerprint do token (SHA-256): {{0}}',
      en: '[OK] Token fingerprint (SHA-256): {{0}}'
    },
    {
      pt: '[OK] Sessão autenticada encontrada para a conta: {{0}}',
      en: '[OK] Authenticated session found for account: {{0}}'
    },
    {
      pt: '[OK] Tamanho do payload criptografado: {{0}} bytes',
      en: '[OK] Encrypted payload size: {{0}} bytes'
    },
    {
      pt: '[OK] Token criptografado (v3) salvo em: {{0}}\n',
      en: '[OK] Encrypted token (v3) saved in: {{0}}\n'
    },
    {
      pt: '[SUCESSO] Arquivo "{{0}}" gravado com permissão 0o600 ({{1}} cookies, criptografia AES-256-GCM at-rest).',
      en: '[SUCCESS] File "{{0}}" written with permission 0o600 ({{1}} cookies, AES-256-GCM at-rest encryption).'
    },
    {
      pt: '[SUCESSO] Arquivo "{{0}}" gravado com permissão 0o600 ({{1}} cookies, opt-out plaintext at-rest).',
      en: '[SUCCESS] File "{{0}}" written with permission 0o600 ({{1}} cookies, opt-out plaintext at-rest).'
    },
    {
      pt: '[SUCESSO] Arquivo "{{0}}" gravado com permissão 0o600.\n',
      en: '[SUCCESS] File "{{0}}" written with permission 0o600.\n'
    },
    {
      pt: '[SUCESSO] Data de exportação original: {{0}}',
      en: '[SUCCESS] Original export date: {{0}}'
    },
    {
      pt: '[SUCESSO] Sessão autenticada descriptografada e validada para a conta: "{{0}}"{{1}}!',
      en: '[SUCCESS] Authenticated session decrypted and validated for account: "{{0}}"{{1}}!'
    },
    {
      pt: '[SUCESSO] Validade estimada da sessão: até {{0}}',
      en: '[SUCCESS] Estimated session validity: up to {{0}}'
    },
    {
      pt: '[Versão] ali-coins v{{0}}',
      en: '[Version] ali-coins v{{0}}'
    },
    {
      pt: '[{{0}}] Nenhuma sessão ativa encontrada. Pulando...',
      en: '[{{0}}] No active sessions found. Jumping...'
    },
    {
      pt: '[{{0}}] Tentativa {{1}}/{{2}}: falha na leitura dos elementos de tarefas.',
      en: '[{{0}}] Attempt {{1}}/{{2}}: Failed to read task elements.'
    },
    {
      pt: '[{{0}}] Tentativa {{1}}/{{2}}: painel de tarefas fechado ou não detectado.',
      en: '[{{0}}] Attempt {{1}}/{{2}}: Task pane closed or not detected.'
    },
    {
      pt: '🚨 ALERTA CRÍTICO: Streak quebrado para a conta {{0}}!',
      en: '🚨 CRITICAL ALERT: Streak broken for account {{0}}!'
    },
    {
      pt: 'a sequência subiu ({{0}} dias seguidos)',
      en: 'the streak went up ({{0}} days in a row)'
    },
    {
      pt: 'Arquivo legado session.json não encontrado em: "{{0}}"',
      en: 'Legacy session.json file not found at: "{{0}}"'
    },
    {
      pt: 'Falha ao preservar backup do .enc existente antes da migração: {{0}}',
      en: 'Failed to preserve the existing .enc backup before migration: {{0}}'
    },
    {
      pt: 'Não foi possível ler o lockfile "{{0}}" (erro de I/O transitório). Tratando como lock ativo por segurança.',
      en: 'Could not read lockfile "{{0}}" (transient I/O error). Treating as an active lock for safety.'
    },
    {
      pt: 'O processo já está em execução no host local (PID ativo: {{0}}, iniciado em: {{1}}).',
      en: 'The process is already running on the local host (active PID: {{0}}, started at: {{1}}).'
    },
    {
      pt: 'O processo está ativo em outro host ({{0}}, PID: {{1}}, iniciado em: {{2}}).',
      en: 'The process is active on another host ({{0}}, PID: {{1}}, started at: {{2}}).'
    },
    {
      pt: ' • Idioma (APP_LANGUAGE): {{0}}',
      en: ' • Language (APP_LANGUAGE): {{0}}'
    },
    {
      pt: 'Executada parcialmente ({{0}})',
      en: 'Partially executed ({{0}})'
    },
    {
      pt: 'Requer verificação manual (botão "{{0}}" não reconhecido)',
      en: 'Manual verification required (button "{{0}}" not recognized)'
    },
    {
      pt: 'Falhou (limite de {{0}} tentativas atingido)',
      en: 'Failed (attempt limit of {{0}} reached)'
    },
    {
      pt: 'Falhou (sem progresso após {{0}} tentativas)',
      en: 'Failed (no progress after {{0}} attempts)'
    },
    {
      pt: 'Concluída ({{0}})',
      en: 'Completed ({{0}})'
    },
    {
      pt: '[{{0}}] {{1}} — {{2}}',
      en: '[{{0}}] {{1}} — {{2}}'
    }
  ]
};
