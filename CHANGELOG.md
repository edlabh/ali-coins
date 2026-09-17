# Changelog

Todas as alterações notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/)
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.9.4] - 2026-09-17

### Corrigido

- **Aquisição Atômica do Lockfile (`acquireLock`):** Eliminação da janela TOCTOU (_time-of-check to time-of-use_) que permitia duas instâncias adquirirem o mesmo lock simultaneamente sob concorrência real (reproduzido em 2/25 execuções com 6 processos). A criação agora usa a flag exclusiva `wx` (`O_CREAT|O_EXCL`) com `fsync`, inspeção de lock existente e até 5 tentativas após remoção de locks órfãos/stale. Adicionada defesa contra symlink no caminho do lock: o link é removido sem nunca seguir o alvo (impedindo truncamento malicioso de arquivos em `/tmp`).
- **Encerramento Correto em SIGINT/SIGTERM:** Os handlers de sinal do lockfile não suprimem mais o comportamento padrão do Node. Ao receber `SIGINT`/`SIGTERM`, o lock é liberado, os listeners são removidos e o sinal é reemitido, encerrando o processo imediatamente (antes, o processo permanecia vivo em segundo plano com o Chromium em execução). Após liberação normal do lock, os listeners também são removidos, restaurando o `Ctrl+C` padrão.
- **Flush de stdout/stderr Antes do Encerramento (`libs/exit.js`):** Novo helper `flushAndExit()` aguarda o flush físico de `stdout`/`stderr` antes de chamar `process.exit()`. Elimina o truncamento silencioso de relatórios JSON e tokens (`--json`, `--show-token`) no limite do buffer de pipe (~64 KB), mantendo os exit codes 0–6 inalterados.
- **Mascaramento de Segredos no Logger (`redact` + scrub recursivo):** Caminhos inválidos do fast-redact (`*secret*`, `*passwd*`) foram substituídos por caminhos válidos e uma varredura recursiva (`scrubSensitiveFields`) passou a mascarar chaves sensíveis por prefixo/sufixo (`my_secret_field`, `userToken`, `apiKey`, objetos aninhados) sem mutar o objeto original do chamador.
- **Leitura Não-Destrutiva de Sessões (`loadSessionFiles`):** Erros transitórios de I/O (`EACCES`/`EMFILE`/`EINTR`) não removem mais `session.json.enc`, `session.json` ou `session_meta.json`. A remoção de arquivos só ocorre quando a migração é concluída com sucesso; JSON malformado é preservado para diagnóstico em vez de excluído automaticamente.

### Adicionado

- **Testes de Regressão de Concorrência e Encerramento:** Cobertura dedicada para dupla aquisição sob 6 processos concorrentes, defesa contra symlink, encerramento por `SIGINT` com liberação de lock, ausência de truncamento de `stdout` acima de 64 KB, scrub de chaves sensíveis e preservação de arquivos de sessão sob `EACCES`/JSON malformado/falha de migração (171 testes no total).

## [0.9.3] - 2026-09-17

### Corrigido

- **Escrita Atômica de Sessões (`safeWriteFile`):** Eliminação do risco de arquivos de sessão e tokens truncados por encerramento abrupto do processo (`SIGKILL`, exit 137 / OOM em ambientes com pouca memória). O método agora grava inicialmente em arquivo temporário com permissão `0o600` (`<destino>.tmp-<pid>-<rand>`), realiza `fsync` físico e conclui a operação através de substituição atômica (`fs.promises.rename`). Em caso de falha, o arquivo de destino permanece 100% íntegro e temporários órfãos são removidos automaticamente no boot.
- **Handler Global de Falhas e Crash Handler (`setupGlobalCrashHandler`):** Tratamento global para exceções não capturadas (`uncaughtException`) e promessas rejeitadas sem captura (`unhandledRejection`) em `all.js`, `collect.js` e `do_tasks.js`. O handler registra log em nível `fatal`, efetua despacho best-effort de notificação parcial ao Telegram e sinal de falha no heartbeat, finalizando o processo com o novo código de saída padronizado **`6`** (com timeout de segurança de 5s para prevenir qualquer possibilidade de travamento).
- **Resiliência de Testes em CI Windows (`--test-timeout=35000` e `SCRYPT_N`):** Aumento do timeout nativo da suíte de testes de 15s para 35s nos scripts `test` e `test:coverage`, prevenindo timeouts espúrios no executor virtual `windows-latest` do GitHub Actions causados pela maior carga de computação scrypt v3 (`N=131072`). Adicionado suporte à variável de ambiente `SCRYPT_N` e setter programático em `SCRYPT_PARAMS_V3` para ajuste em hosts com recursos restritos.
- **Desduplicação Case-Insensitive de Contas (`loadAccounts`):** Comparação normalizada com `.toLowerCase()` no cadastro e agrupamento de contas em `config.js` (`accounts.json`, `ALI_USER` primário e `ALI_USER_2..20`), alinhando o comportamento ao importador de sessões e prevenindo a geração espúria de locks e arquivos duplicados para a mesma conta (ex: `Foo@x` e `foo@x`). Preserva integralmente o primeiro cadastro (usuário, `maskedUser`, índice, lock e caminhos) e herda `telegramChatId` se ausente.
- **Sanitização e Normalização no Template Multi-Conta (`libs/notify.js`):** Coerção defensiva de `streakDays` para número ou `'N/D'`, valores de moedas (`totalCoins`, `checkinCoins`, `tasksCoins`) para inteiros seguros `>= 0` via `toSafeInt`, e aplicação de `escapeHtml` nas interpolações do bloco multi-conta. Impede que valores malformados ou caracteres exóticos quebrem o parser HTML do Telegram Bot API (`400 can't parse entities`), preservando a saída idêntica byte-a-byte para entradas válidas.
- **Piso Criptográfico de Segurança em `SCRYPT_N` (`security.js`):** Estabelecido piso mínimo obrigatório de $N \ge 16384$ ($2^{14}$) para derivação de chaves scrypt. Valores inferiores configurados via variável de ambiente `SCRYPT_N` ou opções programáticas emitem alerta estruturado (`logger.warn`) e são clampeados de forma defensiva para o padrão seguro de $131072$ ($2^{17}$), impedindo o enfraquecimento acidental da criptografia AES-256-GCM sem causar falhas fatais no processo.
- **Gate de Supply-Chain no Auto-Merge do Dependabot:** Atualização do workflow `.github/workflows/dependabot-automerge.yml` com etapa de verificação ativa via `gh api` que aguarda a conclusão com sucesso do workflow `CI` (matriz Linux, macOS e Windows) no SHA exato do PR antes de autorizar o merge automático (`squash`), prevenindo merges prematuros mesmo sem regras de branch protection ativas.
- **Sanitização de Parâmetros scrypt em Tokens Não Confiáveis (`sanitizeScryptParams`):** O `decryptSession` não confia mais cegamente nos marcadores `N:r:p` embutidos em tokens `v3`. Novos tetos defensivos (`N <= 2^20`, `r/p <= 16`) e limite de memória combinada (`128*N*r <= 256 MB`, com redução progressiva e fallback seguro) impedem esgotamento de memória/CPU a partir de um token forjado ou corrompido, mantendo a compatibilidade integral com `v1`, `v2` e `v3` legítimos.
- **Coerção Numérica de `options.N` na Criptografia:** `encryptSession` agora aceita `N` em formato string numérico (ex: `'16384'`) e aplica a mesma sanitização da decifragem, garantindo que qualquer token gerado seja sempre decifrável e eliminando o erro críptico `The "N" argument must be of type number`.
- **Máscara de Telefone/Identificador (`maskUser`):** Usuários sem `@` (telefones/IDs) não expõem mais os dígitos finais nas notificações e logs (`11999887766` passa a exibir `11***` em vez de `11***66`). E-mails permanecem inalterados.
- **Documentação de Quoting de Credenciais:** `credentials.env.example` e guias `INSTALL_LINUX/WINDOWS/MACOS.md` agora alertam explicitamente que senhas com `#`, espaços ou `!` exigem aspas duplas, evitando o truncamento silencioso do `dotenv` (ex: `ALI_PASSWORD="abc#123!"`).

### Adicionado

- **Criptografia com Marcador de Parâmetros e Suporte v3:** Novos tokens de sessão gerados no formato versionado `v3:N:r:p:salt:iv:tag:ciphertext:base64` com parâmetros robustos (`scrypt N=131072` / 2¹⁷, `r=8`, `p=1`). O deserializador (`decryptSession`) oferece suporte transparente e retrocompatibilidade cruzada total entre versões `v3`, `v2` e `v1`.
- **Sincronização de Variáveis no `credentials.env.example`:** Documentação detalhada com exemplos e explicações para as variáveis `DIAGNOSTICS_RETENTION_DAYS` (retenção de artefatos e traces em `scratch/`, padrão 7 dias) e `NOTIFY_HOST_LABEL` (customização do rótulo do host nas mensagens do Telegram).
- **Documentação de Race em Reuso de PIDs no Lockfile:** Análise de segurança no código de `lockfile.js` documentando o comportamento fail-safe em eventuais reciclagem de PIDs pelo sistema operacional e a mitigação definitiva via `staleTimeoutMs` (30 min).

## [0.9.2] - 2026-09-17

### Corrigido

- **Anti-Travamento do Dispatcher de Tarefas (Rodadas Repetidas):** Rastreamento granular de tentativas por rodada (`getRoundKey`, combinando `taskTitle + statusText`). Ao atingir o limite configurável (`TASK_ROUND_MAX_ATTEMPTS=3`, padrão 3) sem avanço em `statusText` ou `completedRounds` (ex: travamento por throttling de msite/servidor), o despachante desiste da tarefa com o status descritivo `'Falhou (sem progresso após 3 tentativas)'` e a exclui do ciclo, eliminando repetições desnecessárias.
- **Timeout Estrito por Tentativa de Tarefa (`TASK_MAX_DURATION_MS`):** Implementação de encapsulamento com `withTimeout` (`TASK_MAX_DURATION_MS=180000`, padrão 3 minutos / 180s) abortando pontualmente tentativas congeladas, contabilizando a ação gasta, fechando abas filhas órfãs ou forçando cancelamento de navegações penduradas com `page.goto(coin-index, { waitUntil: 'commit', timeout: 10000 })` para garantir isolamento da próxima ação.
- **Fail-Fast em Páginas Lentas (`TASK_SCROLL_MAX_MS`):** Inclusão de teto defensivo em `waitWithScroll` (`TASK_SCROLL_MAX_MS=30000`, padrão 30 segundos) e saída antecipada quando nenhum sinal de tracking for detectado (`earlyExitOnNoProgress`, com suporte retrocompatível e depreciação dos aliases `earlyExitOnNoTracking` e `noTrackingTimeoutMs`).
- **Transparência e Integridade no Relatório Final:** Tarefas que desistirem ou falharem são categorizadas estritamente como `Falhou (...)` via `classifyTaskStatus(t, { failedTasks })` e nunca como `Concluída`, refletindo fielmente os dados no resumo impresso, no payload JSON e nas notificações enviadas ao Telegram e multi-conta.
- **Duração Real nas Notificações do Telegram:** Eliminação do valor estático `'0s'` em `all.js` no envio de relatórios individuais de contas em ambiente multi-conta, adicionando medição precisa de tempo por conta/etapa e resolução defensiva e inteligente de `totalDuration` em `buildUnifiedReportPayload`, `buildMultiAccountReportPayload` e `libs/notify.js` a partir dos timestamps reais de início/fim e etapas executadas.

## [0.9.1] - 2026-09-16

### Corrigido

- **Cálculo de Moedas no Check-in Já Coletado (Bug 12):** Na função `buildUnifiedReportPayload()` (`libs/report.js`), adicionada a condição `checkinResult.alreadyCollected === false` no cálculo de `checkinCoinsGained`. Evita duplicação ou contagem de moedas informativas em execuções subsequentes no mesmo dia.
- **Proteção de Sessão Multi-Conta no Importador (Bug 13):** Em `import_session.js`, lança `ImportSessionError` explícito quando o e-mail do token não coincide com nenhuma conta configurada em `credentials.env` ou `accounts.json` em ambientes com mais de uma conta (`accounts.length > 1`), impedindo a sobrescrita acidental da Conta 1 primária.
- **Isolamento de Streak Entre Contas (Bug 14):** Em `collect.js`, `previousStreakDays` passa a validar se `sessionStatus.previousMeta?.user === userEmail` antes de reutilizar o streak anterior, impedindo que contas novas herdem a sequência de dias de contas antigas e emitam alertas falsos de quebra de streak.
- **Roteamento de Alertas no Telegram (Bug 15):** Em `libs/notify.js`, `resolveUser()` retorna `null` para relatórios consolidados multi-conta (`multi_account_report`) e omite a linha `👤 Conta:` em alertas de escopo global (`streak_break`, `lock_active`, `failure`, `2fa_required`).
- **Confiabilidade da Suíte de Testes no Node.js 22:** Desativação de worker threads assíncronas do `pino.transport` durante testes (`NODE_TEST_CONTEXT` / `NODE_ENV=test`) em `logger.js`, inclusão de timeout defensivo de 15 segundos (`--test-timeout=15000`) em `package.json` e ajuste de timeout para 500ms no teste de 2FA não-interativo (`tests/non_interactive_2fa.test.js`).

## [0.9.0] - 2026-09-16

### Corrigido

- **Divergência de Sessão e Limpeza Indevida no Multi-Conta:** Correção da causa raiz do erro `Conta da sessão ativa ("conta1") não corresponde à conta configurada ("conta2")`. A função `resolveSessionPaths` (`libs/session.js`) agora deriva dinamicamente o caminho de metadados correspondente (`session_meta_<hash>.json` ou `session_meta.json`) a partir do `sessionPath` da conta. O arquivo `collect.js` removeu o fallback rígido para caminhos globais, e `validateAndRefresh` não executa mais `clearSession` destrutivo se o cache pertencer a outra conta configurada no `credentials.env`. Adicionada migração transparente e não destrutiva de sessões legadas via `syncAccountSessions` (`config.js`) e isolamento rigoroso de contextos de navegador Playwright entre iterações de contas em `all.js`.

### Adicionado

- **Exportação Multi-Conta (`export_session.js`):** Suporte nativo a múltiplas contas com as opções `--all` e `--account <id|email>`. Ao executar em ambiente com mais de uma conta configurada, o utilitário exporta todas as contas ativas gerando tokens criptografados individuais (`session_token.txt`, `session_token_2.txt`, etc.) ou exporta estritamente a conta solicitada.
- **Importação com Auto-Roteamento Inteligente (`import_session.js`):** Suporte nativo a `--all` e `--account <id|email>`. O importador inspeciona o payload descriptografado (`meta.user`) e roteia a gravação automaticamente para o arquivo isolado da respectiva conta (`session.json.enc` para a Conta 1, `session_<hash>.json.enc` para contas secundárias), impedindo sobrescritas acidentais. O comando `node import_session.js --all` importa e protege todas as contas de uma única vez no servidor remoto.

## [0.8.3] - 2026-09-16 (atualizada em 2026-09-16)

### Corrigido

- **Scripts Batch do Windows (`setup_windows.bat`, `run_all.bat`, `run.bat`, `run_tasks.bat`):** Correção da validação da versão do Node.js (`set NODE_MAJOR` com operador `LSS`) eliminando o erro de parsing do interpretador `cmd.exe` causado por `< 22` e operadores `||` em comandos inline que interrompiam a execução logo nas primeiras linhas. Adição de `chcp 65001 >nul` para UTF-8 nativo no CMD, ancoragem de diretório com `cd /d "%~dp0"`, eliminação de `||` no teste do Chromium e mecanismo defensivo com `pause` ao detectar falha em execuções por duplo-clique no Explorador de Arquivos.
- **Encoding UTF-8 no Windows PowerShell (`run_all.ps1`, `run.ps1`, `run_tasks.ps1`, `setup_windows.ps1`):** Configuração nativa de suporte completo a UTF-8 (`chcp 65001`, `[Console]::OutputEncoding`, `[Console]::InputEncoding` e `$OutputEncoding = [System.Text.Encoding]::UTF8`) e repasse de argumentos via splatting (`@args`), eliminando problemas de caracteres corrompidos/mojibake na exibição de logs, acentuações e emojis (`🪙`, `💰`, `⏱️`, `✅`, `🚨`).

### Adicionado

- **Retenção Automática de Diagnósticos em `scratch/`:** Expansão do mecanismo `pruneSessionBackups` (`libs/session.js`) para expirar artefatos de diagnóstico em `scratch/` (`*-trace-*.zip`, `*.png`, `dom-*.hash.txt`, `mobile_body.html`, `*.jpeg`) compartilhando a política de `SESSION_BACKUP_RETENTION_DAYS` ou `DIAGNOSTICS_RETENTION_DAYS` (padrão de 7 dias) e suporte integral a `--dry-run`. Proteção estrita garantida: arquivos essenciais de sessão e agendamento (`session.json`, `session.json.enc`, `session_meta.json`, `session_token.txt`, `cron.log`, `credentials.env`) permanecem 100% protegidos contra remoção acidental.
- **Gerador de Chave SESSION_SECRET no Windows (`generate_secret.bat`, `generate_secret.ps1`):** Utilitários dedicados para gerar chaves de 32 bytes em Base64 para `SESSION_SECRET` suportando opcionalmente OpenSSL (`openssl rand -base64 32`) com detecção automática do binário no sistema ou no Git for Windows, e solução complementar nativa via Node.js crypto (`crypto.randomBytes(32)`) e .NET `RandomNumberGenerator`, dispensando a instalação avulsa do OpenSSL no Windows.
- **Configuração Automática de Chave no Setup do Windows:** `setup_windows.bat` e `setup_windows.ps1` passam a gerar e pré-configurar automaticamente a chave `SESSION_SECRET` em `credentials.env` recém-criado, com orientações detalhadas em `INSTALL_WINDOWS.md`.
- **Configuração Automática de Chave no Setup do Linux e macOS (`setup_linux.sh`, `setup_macos.sh`):** Integração da geração automática de chave `SESSION_SECRET` (AES-256 de 32 bytes em Base64) na criação de `credentials.env` a partir do modelo, com detecção de `openssl` e fallback nativo para `crypto.randomBytes(32)` do Node.js, garantindo paridade multiplataforma completa (Linux, macOS e Windows) e sincronização com os manuais (`INSTALL_LINUX.md`, `INSTALL_MACOS.md`).

### Alterado

- **Manutenção de Dependências:** Atualização de `prettier` de `3.9.6` para `^3.9.7` em `devDependencies`.

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
