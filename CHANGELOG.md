# Changelog

Todas as alterações notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/)
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Corrigido

- **Scripts Batch do Windows (`setup_windows.bat`, `run_all.bat`, `run.bat`, `run_tasks.bat`):** Correção da validação da versão do Node.js (`set NODE_MAJOR` com operador `LSS`) eliminando o erro de parsing do interpretador `cmd.exe` causado por `< 22` e operadores `||` em comandos inline que interrompiam a execução logo nas primeiras linhas. Adição de `chcp 65001 >nul` para UTF-8 nativo no CMD, ancoragem de diretório com `cd /d "%~dp0"`, eliminação de `||` no teste do Chromium e mecanismo defensivo com `pause` ao detectar falha em execuções por duplo-clique no Explorador de Arquivos.
- **Encoding UTF-8 no Windows PowerShell (`run_all.ps1`, `run.ps1`, `run_tasks.ps1`, `setup_windows.ps1`):** Configuração nativa de suporte completo a UTF-8 (`chcp 65001`, `[Console]::OutputEncoding`, `[Console]::InputEncoding` e `$OutputEncoding = [System.Text.Encoding]::UTF8`) e repasse de argumentos via splatting (`@args`), eliminando problemas de caracteres corrompidos/mojibake na exibição de logs, acentuações e emojis (`🪙`, `💰`, `⏱️`, `✅`, `🚨`).

## [0.8.2] - 2026-09-15

### Corrigido

- **Importação Criptografada At-Rest:** `import_session.js` agora salva por padrão em `session.json.enc` (AES-256-GCM v2, permissão `0o600`) respeitando `ENCRYPT_LOCAL_SESSION=true`, com opt-out explícito via `--plaintext` e migração segura de `session.json` legado com remoção do texto plano apenas após gravação e criptografia bem-sucedidas.
- **Streak-Break Guard Resiliente:** Prevenção de falso-positivo de streak quebrado causado por leitura espúria de ciclo semanal de 7 dias da interface móvel quando a sequência anterior no histórico for muito superior (`isStreakBreak`, commit `15d2725`).
- **Notificações de Erro no Telegram:** Extração da causa raiz (`extractRelevantErrorMessage`) isolando a mensagem de erro antes dos delimitadores de logs de encerramento do Playwright (`cleanup`, etc.) (commit `b1293ac`).
- **Contabilidade de Tarefas no Telegram:** Fallback determinístico por diferença de saldo (`balanceFinal - balanceAfterCheckin`) quando `meta.tasksCoinsGained` estiver ausente (commit `b1293ac`).
- **Montagem de Sessão Docker:** Exemplos de `docker run` no `README.md` atualizados montando `session.json.enc`, `session_meta.json` e `session.json` com `touch` e `chmod 600` prévios (commit `b1293ac`).
- **Instaladores Multiplataforma:** Correção de execução no Windows com ancoragem de diretório (`cd /d "%~dp0"`), validação nativa de Node.js `>= 22` sem parsing frágil de strings em batch, chamada direta do CLI do Playwright, permissões ACL via `icacls`, criação de instalador nativo PowerShell (`setup_windows.ps1`), ajuste de numeração e permissões em `setup_linux.sh` e `setup_macos.sh`, e sincronização completa dos manuais de instalação (`INSTALL_WINDOWS.md`, `INSTALL_LINUX.md`, `INSTALL_MACOS.md`).
- **Manual do Telegram e Inicialização de Conversa:** Documentação formal da etapa obrigatória de autorização inicial via `/start` antes do cadastro de credenciais, refletindo a restrição de arquitetura da Telegram Bot API que impede bots de originar conversas com usuários (`TELEGRAM.md`, `README.md`, `CLOUD_SESSIONS.md`), e inclusão de dica proativa no logger (`libs/notify.js`).

### Adicionado

- **Rótulo de Host Customizado:** Variável `NOTIFY_HOST_LABEL` no `config.js` e `libs/notify.js` para identificação legível da máquina/servidor em containers descartáveis (`--rm`).
- **Confirmação de Envio no Log:** Emissão de log informativo (`logger.info`) ao despachar notificações no Telegram com sucesso (`libs/notify.js`), facilitando o acompanhamento visual da entrega nos logs de console e agendadores (cron).
- **Exemplo de Logrotate para Cron:** Seção em `CLOUD_SESSIONS.md` com modelo de configuração do `logrotate` (`copytruncate weekly rotate 4`) para gerenciamento de logs de agendamento em servidores de nuvem.

## [0.8.1] - 2026-09-15

### Corrigido

- **Contabilidade de moedas no Telegram:** relatório passa a usar delta de saldo (saldo final − saldo inicial) em vez de soma estimada, com template atualizado (`all.js`, `do_tasks.js`, `libs/notify.js`, `libs/report.js`, `libs/tasks/verifier.js`).

## [0.8.0] - 2026-09-14

### Adicionado

- **Criptografia At-Rest da Sessão:** Persistência de `session.json.enc` usando AES-256-GCM v2 com derivação `scrypt` e salt dinâmico (`ENCRYPT_LOCAL_SESSION=true`).
- **Migração Transparente:** Leitura automática de `session.json.enc` com fallback para `session.json` legado e migração automática.
- **Rotação de Chaves:** Suporte à variável `SESSION_SECRET_OLD` e comando CLI `node export_session.js --rotate --new-secret-from-env=VAR` via `rotateSessionSecret`.
- **Backups Versionados & Retenção:** Geração de backup seguro em `scratch/session.bak-<timestamp>.json.enc` (0o600) e política de expiração automática (`pruneSessionBackups`, `SESSION_BACKUP_RETENTION_DAYS=7`).
- **Observable Selectors & Diagnósticos:** Captura automática de hash SHA-256 do HTML normalizado (`scratch/dom-<timestamp>.hash.txt`) e screenshot (`scratch/tasks_drawer_failed.png`) em falhas do drawer de tarefas (`captureDomHashAndArtifacts`).
- **Notificações Telegram:** Suporte nativo completo a notificações via Bot do Telegram (`libs/notify.js`, flags `--notify` / `--no-notify`), suporte multi-conta com chat IDs dedicados (`TELEGRAM_CHAT_ID_${i}` / `telegramChatId` em `accounts.json`), formatação resiliente com resumo limpo e tratamento de erro sem interromper a automação.
- **Alerta de Sessão Remota Expirada:** Diagnóstico imediato no log e Telegram quando uma sessão importada de outro host expira, orientando a renovação com `node export_session.js`.
- **Resiliência Multi-Conta:** Fila sequencial com backoff exponencial com jitter (base 2s a teto 30s) entre falhas de contas (`calculateAccountBackoff`, `ACCOUNT_BACKOFF_BASE_MS`) e chamadas de notificação 100% blindadas contra exceções.
- **Smoke Tests de Seletores:** Suíte `tests/selectors.smoke.js` com fixture HTML sem dependência de navegador real e guia de atualização via dump.
- **Segurança Docker & BuildKit:** Imagem base pinada por digest multi-plataforma (`node:22-slim@sha256:...`), usuário dedicado não-root `appuser` (UID 10001 / GID 10001), nota de cache mount BuildKit `/ms-playwright` e HEALTHCHECK inteligente (`CMD-SHELL [ -f credentials.env ] && node all.js --dry-run --json ...`).
- **CI & Cobertura:** Elevação do threshold de cobertura de linhas nativo para `>= 80%`, geração de SBOM CycloneDX, scan de segredos com Gitleaks, CodeQL básico e dependabot auto-merge.
- **Supply-Chain & Upgrades:** Atualização para `commander` v15 e `eslint` v10 (com `globals`), auditoria zero vulnerabilidades e permissão estrita `0o600` auditada em todos os artefatos de segredos.
- **Streak-Break Guard (P1):** Rastreamento de histórico de sequência com persistência segura (`updateSessionStreak`, `lastStreakDays`, `lastCheckinDate` em `session_meta.json`). Detecção determinística de reset de sequência (ex: 200 ➔ 1 dias) com zero falso-positivo na primeira execução (`isStreakBreak`), alerta crítico no Telegram (`🚨 STREAK QUEBRADO`) e encerramento com **exit code 4**.
- **2FA Fail-Fast em Cron / CI (P2):** Detecção automática de ambiente não-interativo (`!process.stdin.isTTY`). Quando o AliExpress solicita verificação 2FA, encerra imediatamente em `<5s` com erro tipado `TwoFactorRequiredNonInteractive`, alerta no Telegram com passo a passo de renovação de sessão e encerramento com **exit code 5** (eliminando bloqueio de 120s no cron).
- **Dead Man's Switch / Heartbeat:** Integração nativa com monitores de uptime (Healthchecks.io, Uptime Kuma) via `HEARTBEAT_URL` e `HEARTBEAT_TIMEOUT_MS`. Envio de pings de início (`/start`), sucesso com relatório e falha (`/fail`), mascaramento seguro de tokens/UUIDs em logs e flags de controle CLI (`--heartbeat` / `--no-heartbeat`), prevenindo falhas silenciosas em servidores/VPS sem alterar códigos de saída.

### Modificado

- Otimização do loop de tarefas para classificar "Write reviews" como especial e evitar 4 tentativas sem pedido entregue.
- Isolamento estrito de `--json` direcionando logs operacionais para `stderr` (`pino.destination(2)`).
- Relatório de check-in reportando honestamente `N/D` quando o extrato de moedas do dia não puder ser extraído.

### Corrigido

- **Detecção e Resiliência de Streak (Sequência):** Suporte multilíngue abrangente (pt-BR, en-US, es-ES) com expressões regulares flexíveis ("Sequência de X dias", "X dias seguidos", "X-day streak", "Dia X/7"); captura do streak no modal pós-checkin antes do seu fechamento; fallback automático no desktop via contagem de datas consecutivas no histórico e mapeamento determinístico por tier de recompensa (+10 a +40 moedas), eliminando o falso `N/D`.
- **Execução Completa de Tarefas Multi-Rodadas (Explore Itens Surpresa e Super Descontos):**
  - **Re-query Dinâmico de Cards:** Em tarefas de itens surpresa, re-consulta dinâmica de elementos no DOM a cada clique e scroll incremental de cards, eliminando referências desanexadas (_stale element reference_) causadas por navegação `goBack()` e completando todas as rodadas (ex: 2/2).
  - **Permanência Real em SuperDeals/Descontos:** Remoção do corte prematuro aos 5s por detecção de tracking em `waitWithScroll`, garantindo tempo de permanência mínimo de 16 segundos com scroll gradual exigido pelo AliExpress para validar as rodadas (ex: 3/3).
  - **Resgate de Recompensas Intermediárias:** Suporte a botões de coleta (`Coletar`, `Collect`, `Claim`, `Receber`, `+5 moedas`), realizando o resgate imediato antes de prosseguir para a próxima rodada da tarefa.
  - **Reset de Tentativas por Progresso de Rodada:** Limpeza automática do contador de tentativas consecutivas da tarefa quando há avanço de rodadas, prevenindo o bloqueio prematuro por teto de `TASK_MAX_ATTEMPTS`.
  - **Sincronização Aprimorada pós-Tarefa:** Aumento do tempo de estabilização pós-retorno para 2500ms, permitindo que as animações de moedas e requisições AJAX do msite terminem de atualizar o DOM.
- **Auto-Cura de Skeleton e Resiliência na Abertura do Painel de Tarefas:**
  - **Correção da Sintaxe do Seletor (`openDrawerBtn`):** Eliminação de prefixos de engine inválidos (`text=...`) em listas separadas por vírgula que causavam erro de parse no Playwright e retorno silencioso de `null`. Inclusão de `#signButton` e classes dedicadas de tarefas (`.aecoin-taskButton-3V41b`, `[class*="taskButton"]`), com fallback semântico via `page.getByRole('button')`.
  - **Paciência na Hidratação e Reload Defensivo Único:** Auto-cura com aguardo paciente de hidratação pós-carregamento e no máximo um reload defensivo único, eliminando reloads em cascata concorrentes no meio das tentativas de clique que interrompiam a montagem do SPA do AliExpress.
  - **Navegação Móvel Direta:** Acesso direto à URL móvel com parâmetros imersivos (`_immersiveMode=true&from=pc302`) em `do_tasks.js`, eliminando conflitos de redirecionamento 302 que cancelavam o carregamento de scripts do SPA.
  - **Eliminação de Conflito em Modais:** Remoção do seletor de botão de tarefa (`.e2e_normal_task_right_btn`) de `SELECTORS.modals.closeButtons`, impedindo que `closeModals` interfira nas ações de tarefas.

---

## [0.7.0] - 2026-09-14

### Adicionado

- Orquestrador unificado (`all.js`) integrando check-in e tarefas em lote.
- Suporte a multi-contas sequencial (`ALI_USER_2`, `accounts.json`).
- Suporte à flag `--json` estruturada para pipelines e scripts.
- Tratamento resiliente de desafios de segurança e 2FA móvel.
- Permissões estritas 0o600 em todos os arquivos de segredos.
- Criptografia AES-256-GCM v2 com salt dinâmico.
