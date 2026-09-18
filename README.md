# AliExpress Coin Collector & Task Runner

Automação completa para **check-in diário de moedas** e **execução de tarefas ("Ganhe mais moedas")** do AliExpress com emulação mobile (Google Pixel 7 / Android) via Playwright.

Compatível com **Linux (Ubuntu / Debian)**, **Windows 10/11** e **macOS (Apple Silicon & Intel)**.

Requer **Node.js >= 22** (`.nvmrc: 22`).

---

## Recursos Principais

- **Modo Unificado (1 Único Comando):** Executa o check-in diário e todas as tarefas do painel em sequência, gerando um relatório consolidado com saldo inicial, ganho por tarefa e saldo final.
- **Check-in Diário Inteligente:** Compatível com o layout de cartões do AliExpress. Mantém sequências ativas (incluindo 200+ dias) e valores progressivos (+10 até +40 moedas/dia). Detecção bilíngue de saldo ("My coins" / "Minhas moedas").
- **Tarefas Diárias Automatizadas:** Executa tarefas em lote (produtos surpresa com permanência real, busca por palavras-chave e navegação com scroll).
- **Sessão Resiliente & Troca de Conta:** Validação estrita de cookies (`xman_us_t`). Detecta alterações de conta no `credentials.env` e renova credenciais com segurança.
- **Criptografia v3 de Alta Segurança:** Exportação segura de sessão usando derivação via `scrypt` com salt criptográfico dinâmico de 16 bytes, parâmetros explícitos e cifra `AES-256-GCM` (formato `v3:N:r:p:salt:iv:tag:ct:base64`). Mantém compatibilidade retroativa com tokens legados `v1` e `v2`.
- **Lockfile com Prevenção de Concorrência & Stale Timeout:** Evita execuções sobrepostas no Cron com checagem de hostname + PID e timeout de inatividade (padrão: 30min).
- **Diagnósticos Playwright:** Captura automática de trace (`retain-on-failure`), screenshots (`only-on-failure`) e vídeo opcional em `scratch/`.

---

## Modos de Execução

| Modo                        | Descrição                                         | Windows CMD             | Windows PowerShell | Linux / macOS            | npm                      |
| :-------------------------- | :------------------------------------------------ | :---------------------- | :----------------- | :----------------------- | :----------------------- |
| **Unificado (Recomendado)** | Check-in + todas as tarefas em sequência          | `run_all.bat`           | `.\run_all.ps1`    | `./run_all.sh`           | `npm start`              |
| **Apenas Check-in**         | Check-in diário e consulta de saldo               | `run.bat`               | `.\run.ps1`        | `./run.sh`               | `npm run collect`        |
| **Apenas Tarefas**          | Painel "Ganhe mais moedas"                        | `run_tasks.bat`         | `.\run_tasks.ps1`  | `./run_tasks.sh`         | `npm run tasks`          |
| **Validação (Dry-Run)**     | Valida credenciais e ambiente sem abrir navegador | `run_all.bat --dry-run` | `.\run_all.ps1 -d` | `./run_all.sh --dry-run` | `npm start -- --dry-run` |

---

## Opções de Linha de Comando (CLI)

A CLI suporta as seguintes flags unificadas (via `commander`):

| Flag                    | Descrição                                                                                |
| :---------------------- | :--------------------------------------------------------------------------------------- |
| `-d, --dry-run`         | Executa a validação completa de credenciais e ambiente sem inicializar o Chromium.       |
| `-f, --force`           | Força a execução sobrescrevendo um lockfile ativo existente.                             |
| `--json`                | Emite o relatório de execução, diagnósticos e validação em formato JSON puro.            |
| `--notify`              | Força o envio de notificações via Telegram para a execução atual.                        |
| `--no-notify`           | Desativa o envio de notificações via Telegram para a execução atual.                     |
| `--show-token`          | Exibe o token criptografado na saída do terminal durante o `export_session.js`.          |
| `--from-file <caminho>` | Lê o token criptografado a partir do arquivo especificado durante o `import_session.js`. |
| `-h, --help`            | Exibe a mensagem de ajuda com a lista de parâmetros disponíveis.                         |

---

## Códigos de Saída (Exit Codes)

Os scripts retornam códigos de saída padronizados para integração contínua e automação via Cron/Task Scheduler:

| Código  | Significado            | Descrição                                                                             |
| :-----: | :--------------------- | :------------------------------------------------------------------------------------ |
| **`0`** | Sucesso                | Check-in ou tarefas executadas com novas moedas coletadas com sucesso.                |
| **`1`** | Falha                  | Erro crítico de execução, credenciais inválidas ou falha de autenticação.             |
| **`2`** | Sem Ação / Já Coletado | O check-in já havia sido realizado hoje e não há tarefas pendentes.                   |
| **`3`** | Lock Ativo             | Outra instância da automação já está em execução no momento (evita sobreposição).     |
| **`4`** | Streak Quebrado        | Alerta crítico: sequência de check-in foi interrompida/resetada (ontem → hoje).       |
| **`5`** | 2FA Não-Interativo     | Interrupção rápida (<5s) em cron/CI quando o AliExpress solicita 2FA (sem TTY).       |
| **`6`** | Falha Global           | Erro não capturado ou Promise rejeitada (`uncaughtException` / `unhandledRejection`). |

---

## Início Rápido (3 Passos)

### 1. Clonar o repositório

```bash
git clone https://github.com/edlabh/ali-coins.git
cd ali-coins
```

### 2. Instalação Automática

Execute o instalador correspondente ao seu sistema operacional:

- **Linux (Ubuntu / Debian):** `./setup_linux.sh` (Guia detalhado: [INSTALL_LINUX.md](INSTALL_LINUX.md))
- **Windows:** `setup_windows.bat` (CMD / duplo clique) ou `.\setup_windows.ps1` (PowerShell) (Guia detalhado: [INSTALL_WINDOWS.md](INSTALL_WINDOWS.md))
- **macOS:** `./setup_macos.sh` (Guia detalhado: [INSTALL_MACOS.md](INSTALL_MACOS.md))

_(O instalador verifica o Node.js >= 22, roda `npm install`, baixa o Chromium e prepara as credenciais)._

### 3. Configurar Credenciais e Executar

Edite o arquivo `credentials.env` com suas configurações (permissão restrita `0o600`):

```env
ALI_USER="seu_email_ou_telefone"
ALI_PASSWORD="sua_senha"

# Suporte Multi-Conta (Opcional - até 20 contas sequenciais):
# ALI_USER_2="segunda_conta@exemplo.com"
# ALI_PASSWORD_2="senha_segunda_conta"

# Notificação via Webhook (Discord / Telegram / HTTP POST genérico)
# NOTIFY_WEBHOOK_URL="https://discord.com/api/webhooks/..."

# Chave para criptografia de exportação de sessão (mínimo 32 caracteres)
# No Windows usando Node.js: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# No Linux/macOS: openssl rand -base64 32
SESSION_SECRET="sua_chave_secreta_com_pelo_menos_32_caracteres"

# Bloqueio de mídia (imagens, vídeos, fontes) para acelerar execução (padrão: false)
ALLOW_MEDIA=false

# Modo headless (sem janela gráfica) (padrão: true)
HEADLESS=true

# Nível de log estruturado (trace, debug, info, warn, error) (padrão: info)
LOG_LEVEL=info

# Configurações opcionais de timeout e limites
# NAV_TIMEOUT=35000
# TASK_MAX_ACTIONS=25
# TASK_MAX_ATTEMPTS=4
```

> **Dica Multi-Conta:** Além das variáveis `ALI_USER_2...20`, você pode criar um arquivo `accounts.json` (ignorado pelo git) contendo `[{"user": "...", "password": "..."}]`. As sessões são isoladas automaticamente por conta (`session_<hash>.json`) e executadas sequencialmente com reaproveitamento do Chromium.

Valide sua configuração sem abrir o navegador:

```bash
npm start -- --dry-run
# ou com saída estruturada JSON:
npm start -- --dry-run --json
```

Execute o modo unificado:

- **Linux / macOS:** `./run_all.sh`
- **Windows:** `run_all.bat` ou `.\run_all.ps1`

---

## Testes e Qualidade de Código

O projeto utiliza a suíte de testes nativa do Node.js (`node:test`), Prettier e ESLint 9:

```bash
# Executar suíte de testes unitários e de integração
npm test

# Executar suíte com relatório de cobertura de código
npm run test:coverage

# Verificar formatação e linter
npm run format:check
npm run lint

# Formatar automaticamente e corrigir linter
npm run format
npm run lint:fix
```

---

## Notificações via Bot do Telegram (100% Opcional)

A automação suporta envio de status em tempo real (saldo atualizado, streak, moedas ganhas, tarefas concluídas e eventuais erros) diretamente para seu Telegram através de um bot exclusivo. A funcionalidade é **100% opcional** e permanece desativada por padrão (`TELEGRAM_ENABLED=false`).

### Passo a Passo de Configuração:

1. **Criar o Bot no Telegram:**
   - Inicie uma conversa com o [@BotFather](https://t.me/BotFather) no Telegram.
   - Envie o comando `/newbot`, escolha um nome e um username único (ex: `MeuAliCoinsBot`).
   - Copie o **HTTP API Token** gerado (formato `123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456`).
2. **Inicializar a Conversa com o Bot (Autorização Prévia Obrigatória):**
   - Acesse o diálogo com o bot recém-criado (pesquise por `@MeuAliCoinsBot` ou acesse `https://t.me/MeuAliCoinsBot`) e clique em **Iniciar** (`/start`).
   - _Nota de conformidade:_ Por políticas de privacidade da Telegram Bot API, **bots não possuem permissão para iniciar conversas com usuários**. O envio prévio do comando `/start` é indispensável para autorizar a entrega de mensagens.
3. **Obter seu Chat ID:**
   - Inicie uma conversa com o [@userinfobot](https://t.me/userinfobot) no Telegram.
   - O bot responderá com seu `Id` numérico (ex: `987654321`).
4. **Configurar no `credentials.env`:**

```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456"
TELEGRAM_CHAT_ID="987654321"
TELEGRAM_SILENT=false

# Para contas secundárias no modo multi-conta (opcional):
# TELEGRAM_CHAT_ID_2="111222333"
# Ou configure "telegramChatId" em cada objeto no accounts.json
```

### Como Testar:

```bash
# Teste direto de envio com o bot:
npm run notify:test

# Teste com validação completa de credenciais e notificação:
npm start -- --dry-run --notify
```

Consulte o manual detalhado com imagens e solução de problemas em: [**`TELEGRAM.md`**](TELEGRAM.md).

---

## Execução em Nuvem (Oracle Cloud / AWS / VPS)

Provedores de nuvem possuem IPs de Datacenter que o AliExpress identifica com risco elevado, bloqueando novas tentativas de login com Slide Captchas ou códigos 2FA.

### Como Resolver (Delegação de Sessão Segura):

1. No seu **computador pessoal** (conexão residencial onde o login não é desafiado), execute o script uma vez e exporte a sessão criptografada:
   ```bash
   export SESSION_SECRET="sua_chave_secreta_com_pelo_menos_32_caracteres"

   # Para conta única:
   node export_session.js

   # Para todas as contas configuradas (multi-conta):
   node export_session.js --all

   # Para uma conta específica:
   node export_session.js --account=2
   ```
2. No seu **servidor na nuvem** (dentro da pasta `ali-coins`), importe a sessão via STDIN ou arquivo:

   ```bash
   export SESSION_SECRET="sua_chave_secreta_com_pelo_menos_32_caracteres"

   # Importar todas as contas de uma vez:
   node import_session.js --all

   # Ou importar individualmente via STDIN:
   node import_session.js < session_token.txt
   node import_session.js < session_token_2.txt
   # ou via arquivo:
   node import_session.js --from-file=session_token_2.txt
   ```

   > ⚠️ **Aviso de Segurança:** Por segurança, o script recusa a passagem de tokens via linha de comando (`argv`), pois isso exporia credenciais no histórico do shell (`history`) e na listagem de processos do sistema (`ps aux`). O importador realiza **auto-roteamento inteligente**, salvando a sessão da conta correspondente sem nunca sobrescrever outras contas.
   >
   > 🧹 **Higiene de Tokens:** na importação em lote (`--all`), os arquivos `session_token*.txt` são removidos após cada importação bem-sucedida (uso único). Use `--keep-tokens` (ou `KEEP_SESSION_TOKENS=true`) para preservá-los.

3. Execute `./run_all.sh` na nuvem. A sessão permanecerá válida por semanas/meses sem exigir login.

> 💡 **Proteção de Cron / Execução Não-Interativa (2FA Fail-Fast):** Em ambientes sem TTY (`!process.stdin.isTTY`), se a sessão expirar e o AliExpress solicitar verificação por código 2FA (SMS/e-mail), o script aborta em `<5s` com **código de saída 5** e dispara alerta no Telegram com o passo a passo de renovação, evitando bloqueio do agendador por timeout de 120s.

### Monitorar se o Cron Morreu (Dead Man's Switch / Heartbeat)

Se a sua VPS cair, faltar energia no datacenter ou o `cron` travar, **nenhum log ou Telegram de erro é emitido**. Para evitar falhas silenciosas e a perda de sequência (_streak_):

1. Crie um check gratuito no [Healthchecks.io](https://healthchecks.io) (ou monitor Push no [Uptime Kuma](https://github.com/louislam/uptime-kuma)) configurado com:
   - **Period:** `24 hours`
   - **Grace Time:** `1 hour` (alerta após ~25h sem ping do job).
2. Configure no seu `credentials.env`:
   ```env
   HEARTBEAT_URL="https://hc-ping.com/seu-uuid-aqui"
   HEARTBEAT_TIMEOUT_MS=5000
   ```
3. O script enviará automaticamente `/start` ao iniciar, `/` no sucesso com o relatório estruturado e `/fail` em caso de erro, sem nunca alterar o código de saída original.
4. No CLI: use `--heartbeat` para forçar ou `--no-heartbeat` para desativar pontualmente.
5. Mais detalhes e resolução de problemas em: [**`CLOUD_SESSIONS.md`**](CLOUD_SESSIONS.md#10-monitorar-se-o-cron-morreu-dead-mans-switch--heartbeat).

---

## Execução via Docker (Opcional)

Você pode rodar a automação em container Docker isolado (`node:22-slim`):

```bash
docker build -t ali-coins .

# Dica: crie os arquivos de sessão no host antes de montar para persistência at-rest:
touch session.json.enc session_meta.json session.json
chmod 600 credentials.env session.json.enc session_meta.json session.json
# O container roda como appuser (UID/GID 10001): se o processo for executado sem --user,
# ajuste a posse dos arquivos montados para que o appuser consiga lê-los/gravá-los:
chown 10001:10001 credentials.env session.json.enc session_meta.json session.json

docker run --rm \
  -v $(pwd)/credentials.env:/app/credentials.env:ro \
  -v $(pwd)/session.json.enc:/app/session.json.enc \
  -v $(pwd)/session_meta.json:/app/session_meta.json \
  -v $(pwd)/session.json:/app/session.json \
  -e NOTIFY_HOST_LABEL="meu-servidor" \
  ali-coins
```

- **Hosts com 1 GB de RAM (Oracle Free Tier, t2/t3.micro, DO):** recomende 1–2 GB de swap no host (`fallocate -l 2G /swapfile`) e limite o container: `--init --pids-limit=256 --shm-size=256m --memory=768m --memory-swap=1536m`. As flags de baixo consumo do Chromium já são aplicadas por padrão tanto no Docker quanto fora dele (`CHROMIUM_LOW_MEMORY=true`), `NODE_OPTIONS="--max-old-space-size=192"` previne picos de heap e `SCRYPT_N=32768` reduz o pico do scrypt de ~134 MB para ~33 MB. Detalhes em [`CLOUD_SESSIONS.md`](CLOUD_SESSIONS.md#7-otimizações-para-vps-com-pouca-memória-512-mb---1-gb-ram) e nos manuais específicos por SO ([`INSTALL_LINUX.md`](INSTALL_LINUX.md#d-servidores-com-pouca-memória-ram-vps-de-512-mb-ou-1-gb---execução-nativa-ou-docker), [`INSTALL_WINDOWS.md`](INSTALL_WINDOWS.md#h-otimização-para-ambientes-com-pouca-memória-ram-1-gb-a-2-gb-ou-vms-windows), [`INSTALL_MACOS.md`](INSTALL_MACOS.md#d-otimização-de-recursos-e-baixo-consumo-de-memória-macs-com-pouca-ram-ou-vms)).
- **Usuário não-root:** O container executa por padrão como usuário de sistema dedicado `appuser` (UID/GID 10001).
- **Execução com `--user <uid>:<gid>` do host:** Se você especificar o usuário do host para manter as permissões dos arquivos montados, monte `/etc/passwd` e `/etc/group` em modo somente-leitura para que a resolução de usuário do Node (`os.userInfo()` via libuv `uv_os_get_passwd`) não gere erro `ENOENT`:
  ```bash
  docker run --rm \
    -u $(id -u):$(id -g) \
    -v /etc/passwd:/etc/passwd:ro \
    -v /etc/group:/etc/group:ro \
    -v $(pwd)/credentials.env:/app/credentials.env:ro \
    -v $(pwd)/session.json.enc:/app/session.json.enc \
    -v $(pwd)/session_meta.json:/app/session_meta.json \
    -v $(pwd)/session.json:/app/session.json \
    -e NOTIFY_HOST_LABEL="meu-servidor" \
    ali-coins
  ```
- **Persistência At-Rest (`session.json.enc`):** Com `ENCRYPT_LOCAL_SESSION=true` (padrão desde a 0.8), o AliExpress salva a sessão criptografada em `session.json.enc` e os metadados em `session_meta.json`. A montagem desses arquivos garante que a sessão seja persistida entre execuções do container efêmero (`--rm`).
- **Identificação do Host no Telegram (`NOTIFY_HOST_LABEL`):** Em containers descartáveis, o hostname padrão é o ID aleatório do container. Passe `-e NOTIFY_HOST_LABEL="meu-servidor"` ou a flag `--hostname meu-servidor` para que as notificações identifiquem corretamente o seu servidor.
- A variável `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` garante o compartilhamento e cache dos navegadores.

---

## Segurança e Permissões

- **Criptografia At-Rest (`session.json.enc`):** Sessões locais são gravadas criptografadas com AES-256-GCM v2 (`scrypt` + salt aleatório) quando `SESSION_SECRET` estiver configurado (`ENCRYPT_LOCAL_SESSION=true`). Inclui leitura transparente com fallback para migração de `session.json` legado e rotação suave de chaves via `SESSION_SECRET_OLD`.
- **Rotação de Chaves de Sessão:** A rotação at-rest pode ser executada manualmente via CLI:
  ```bash
  export SESSION_SECRET_OLD="chave_antiga_com_mais_de_32_chars"
  export SESSION_SECRET_NEW="nova_chave_secreta_com_mais_de_32_chars"
  node export_session.js --rotate --new-secret-from-env=SESSION_SECRET_NEW
  ```
  A sessão anterior é descriptografada com `SESSION_SECRET_OLD`, validada, salva como backup seguro em `scratch/session.bak-<timestamp>.json.enc` (0o600) e re-criptografada com a nova chave.
- **Política de Retenção de Backups (`scratch/`):** Limpeza automática (`pruneSessionBackups`) de backups com idade superior a `SESSION_BACKUP_RETENTION_DAYS` (padrão: 7 dias) acionada durante rotação, salvamento ou limpeza de sessões.
- **Permissões 0o600 Estritas:** Todos os arquivos de segredos (`credentials.env`, `session.json`, `session.json.enc`, `session_meta.json`, `session_token.txt`, backups e dumps) são salvos e mantidos exclusivamente com permissão `0o600`.
- **Criptografia AES-256-GCM v3:** Exportações e repouso usam derivação de chave via `scrypt` com salt aleatório dinâmico de 16 bytes, parâmetros explícitos e `SESSION_SECRET` (mínimo 32 caracteres). Compatível com tokens legados `v1` e `v2`.
- **Isolamento do Navegador:** A flag `--no-sandbox` do Chromium é restrita exclusivamente para execução como root (UID 0) ou CI, mantendo a sandbox ativada para usuários comuns.
- **Redação de Logs:** Logs estruturados via `pino` redigem senhas, tokens, cookies e parâmetros de URL sensíveis automaticamente.

---

## Proteção de Branch e Integração Contínua (CI)

- **Validação Obrigatória:** A branch `main` exige que todos os testes em Linux, macOS e Windows bem como verificação de formatação e linter passem com sucesso no workflow `CI` antes de qualquer merge.
- **Gate de Supply-Chain no Dependabot:** PRs automatizados de dependências (patch/minor) contam com gate de segurança que aguarda a conclusão bem-sucedida do workflow `CI` no SHA do commit antes de autorizar o auto-merge (`squash`).
