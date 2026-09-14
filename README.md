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
- **Criptografia v2 de Alta Segurança:** Exportação segura de sessão usando derivação via `scrypt` com salt criptográfico dinâmico de 16 bytes e cifra `AES-256-GCM` (formato `v2:salt:iv:tag:ct:base64`). Mantém compatibilidade retroativa com tokens legados `v1`.
- **Lockfile com Prevenção de Concorrência & Stale Timeout:** Evita execuções sobrepostas no Cron com checagem de hostname + PID e timeout de inatividade (padrão: 30min).
- **Diagnósticos Playwright:** Captura automática de trace (`retain-on-failure`), screenshots (`only-on-failure`) e vídeo opcional em `scratch/`.

---

## Modos de Execução

| Modo | Descrição | Windows CMD | Windows PowerShell | Linux / macOS | npm |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Unificado (Recomendado)** | Check-in + todas as tarefas em sequência | `run_all.bat` | `.\run_all.ps1` | `./run_all.sh` | `npm start` |
| **Apenas Check-in** | Check-in diário e consulta de saldo | `run.bat` | `.\run.ps1` | `./run.sh` | `npm run collect` |
| **Apenas Tarefas** | Painel "Ganhe mais moedas" | `run_tasks.bat` | `.\run_tasks.ps1` | `./run_tasks.sh` | `npm run tasks` |
| **Validação (Dry-Run)** | Valida credenciais e ambiente sem abrir navegador | `run_all.bat --dry-run` | `.\run_all.ps1 -d` | `./run_all.sh --dry-run` | `npm start -- --dry-run` |

---

## Opções de Linha de Comando (CLI)

A CLI suporta as seguintes flags unificadas (via `commander`):

| Flag | Descrição |
| :--- | :--- |
| `-d, --dry-run` | Executa a validação completa de credenciais e ambiente sem inicializar o Chromium. |
| `-f, --force` | Força a execução sobrescrevendo um lockfile ativo existente. |
| `--json` | Emite o relatório de execução, diagnósticos e validação em formato JSON puro. |
| `--show-token` | Exibe o token criptografado na saída do terminal durante o `export_session.js`. |
| `--from-file <caminho>` | Lê o token criptografado a partir do arquivo especificado durante o `import_session.js`. |
| `-h, --help` | Exibe a mensagem de ajuda com a lista de parâmetros disponíveis. |

---

## Códigos de Saída (Exit Codes)

Os scripts retornam códigos de saída padronizados para integração contínua e automação via Cron/Task Scheduler:

| Código | Significado | Descrição |
| :---: | :--- | :--- |
| **`0`** | Sucesso | Check-in ou tarefas executadas com novas moedas coletadas com sucesso. |
| **`1`** | Falha | Erro crítico de execução, credenciais inválidas ou falha de autenticação. |
| **`2`** | Sem Ação / Já Coletado | O check-in já havia sido realizado hoje e não há tarefas pendentes. |
| **`3`** | Lock Ativo | Outra instância da automação já está em execução no momento (evita sobreposição). |

---

## Início Rápido (3 Passos)

### 1. Clonar o repositório
```bash
git clone https://github.com/edlabh/ali-coins.git
cd ali-coins
```

### 2. Instalação Automática
Execute o instalador correspondente ao seu sistema operacional:
- **Linux (Ubuntu / Debian):** `./setup_linux.sh`
- **Windows:** Dê dois cliques em `setup_windows.bat` (ou execute via terminal CMD/PowerShell)
- **macOS:** `./setup_macos.sh`

*(O instalador verifica o Node.js >= 22, roda `npm install`, baixa o Chromium e prepara as credenciais).*

### 3. Configurar Credenciais e Executar
Edite o arquivo `credentials.env` com suas configurações (permissão restrita `0o600`):
```env
ALI_USER="seu_email_ou_telefone"
ALI_PASSWORD="sua_senha"

# Chave para criptografia de exportação de sessão (mínimo 32 caracteres)
# Gere no terminal com: openssl rand -base64 32
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

O projeto utiliza a suíte de testes nativa do Node.js (`node:test`) e linter ESLint 9:

```bash
# Executar suíte de testes unitários e de integração
npm test

# Executar linter ESLint
npm run lint

# Corrigir automaticamente problemas de formatação
npm run lint:fix
```

---

## Execução em Nuvem (Oracle Cloud / AWS / VPS)

Provedores de nuvem possuem IPs de Datacenter que o AliExpress identifica com risco elevado, bloqueando novas tentativas de login com Slide Captchas ou códigos 2FA.

### Como Resolver (Delegação de Sessão Segura):
1. No seu **computador pessoal** (conexão residencial onde o login não é desafiado), execute o script uma vez e exporte a sessão criptografada:
   ```bash
   export SESSION_SECRET="sua_chave_secreta_com_pelo_menos_32_caracteres"
   node export_session.js
   ```
2. No seu **servidor na nuvem** (dentro da pasta `ali-coins`), importe a sessão via STDIN ou arquivo:
   ```bash
   export SESSION_SECRET="sua_chave_secreta_com_pelo_menos_32_caracteres"
   node import_session.js < session_token.txt
   # ou via arquivo:
   node import_session.js --from-file=session_token.txt
   ```
   > ⚠️ **Aviso de Segurança:** Por segurança, o script recusa a passagem de tokens via linha de comando (`argv`), pois isso exporia credenciais no histórico do shell (`history`) e na listagem de processos do sistema (`ps aux`).

3. Execute `./run_all.sh` na nuvem. A sessão permanecerá válida por semanas/meses sem exigir login.

---

## Execução via Docker (Opcional)

Você pode rodar a automação em container Docker isolado (`node:22-slim`):
```bash
docker build -t ali-coins .
docker run --rm -v $(pwd)/credentials.env:/app/credentials.env -v $(pwd)/session.json:/app/session.json ali-coins
```
- A variável `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` garante o compartilhamento e cache dos navegadores.

---

## Segurança e Permissões

- **Permissões 0o600:** Todos os arquivos de segredos (`credentials.env`, `session.json`, `session_meta.json`, `session_token.txt`) são salvos e mantidos exclusivamente com permissão `0o600`.
- **Criptografia AES-256-GCM v2:** Exportações usam derivação de chave via `scrypt` com salt aleatório dinâmico de 16 bytes e `SESSION_SECRET` (mínimo 32 caracteres).
- **Isolamento do Navegador:** A flag `--no-sandbox` do Chromium é restrita exclusivamente para execução como root (UID 0) ou CI, mantendo a sandbox ativada para usuários comuns.
- **Redação de Logs:** Logs estruturados via `pino` redigem senhas, tokens, cookies e parâmetros de URL sensíveis automaticamente.
