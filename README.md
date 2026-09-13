# AliExpress Coin Collector & Task Runner

Automação completa para **check-in diário de moedas** e **execução de tarefas ("Ganhe mais moedas")** do AliExpress com emulação mobile (Google Pixel 7 / Android) via Playwright.

Compatível com **Windows 10/11**, **macOS (Apple Silicon & Intel)** e **Linux (Ubuntu / Debian)**.

---

## Recursos Principais

- **Modo Unificado (1 Único Comando):** Executa o check-in diário e todas as tarefas do painel em sequência, gerando um relatório consolidado com saldo inicial, ganho por tarefa e saldo final.
- **Check-in Diário Inteligente:** Compatível com o layout de cartões do AliExpress. Mantém sequências ativas (incluindo 200+ dias) e valores progressivos (+10 até +40 moedas/dia).
- **Tarefas Diárias Automatizadas:** Executa tarefas em lote (produtos surpresa com permanência real, itens patrocinados, super descontos, retrospectiva e busca por palavras-chave).
- **Sessão Resiliente & Troca de Conta:** Validação estrita de cookies (`xman_us_t`). Detecta alterações de conta no `credentials.env` e renova credenciais com segurança.
- **Suporte a Servidores na Nuvem:** Utilitários integrados (`export_session.js` e `import_session.js`) para contornar desafios de captcha de datacenter em VPS (Oracle Cloud, AWS, etc.).

---

## Modos de Execução

| Modo | Descrição | Windows CMD | Windows PowerShell | Linux / macOS | npm |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Unificado (Recomendado)** | Check-in + todas as tarefas em sequência | `run_all.bat` | `.\run_all.ps1` | `./run_all.sh` | `npm start` |
| **Apenas Check-in** | Check-in diário e consulta de saldo | `run.bat` | `.\run.ps1` | `./run.sh` | `npm run collect` |
| **Apenas Tarefas** | Painel "Ganhe mais moedas" | `run_tasks.bat` | `.\run_tasks.ps1` | `./run_tasks.sh` | `npm run tasks` |
| **Validação (Dry-Run)** | Valida credenciais e ambiente sem abrir navegador | `run_all.bat --dry-run` | `.\run_all.ps1 -d` | `./run_all.sh --dry-run` | `npm start -- --dry-run` |

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

*(O instalador verifica o Node.js, roda `npm install`, baixa o Chromium e prepara as credenciais).*

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
```

Valide sua configuração sem abrir o navegador:
```bash
npm start -- --dry-run
```

Execute o modo unificado:
- **Linux / macOS:** `./run_all.sh`
- **Windows:** `run_all.bat` ou `.\run_all.ps1`

---

## Guias Detalhados por Plataforma

Para instruções passo a passo aprofundadas, resolução de dependências e configuração de agendadores automáticos, consulte o manual específico do seu ambiente:

- 🐧 **[Guia Detalhado de Instalação no Linux](INSTALL_LINUX.md):** Passo a passo manual para Ubuntu 22.04/24.04 e Debian, resolução de bibliotecas nativas de C/C++, swap em VPS e agendamento via `cron`.
- 🪟 **[Guia Detalhado de Instalação no Windows](INSTALL_WINDOWS.md):** Políticas de execução do PowerShell, dependências de runtime e agendamento via Agendador de Tarefas (*Task Scheduler*).
- 🍎 **[Guia Detalhado de Instalação no macOS](INSTALL_MACOS.md):** Suporte nativo para Apple Silicon (M1/M2/M3/M4) e Intel, permissões do sistema e agendamento contínuo via `launchd`.
- ☁️ **[Guia de Execução na Nuvem e Sessões](CLOUD_SESSIONS.md):** Entenda como funciona a proteção anti-bot em IPs de Datacenter (Oracle Cloud, AWS, GCP) e como delegar a sessão criptografada (AES-256-GCM) do seu computador para o servidor em segundos.

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

Você pode rodar a automação em container Docker isolado:
```bash
docker build -t ali-coins .
docker run --rm -v $(pwd)/credentials.env:/app/credentials.env -v $(pwd)/session.json:/app/session.json ali-coins
```
- A variável `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` garante o compartilhamento e cache dos navegadores.

---

## Agendamento Automático Diário

- **Linux / Servidores na Nuvem:** Configure via `crontab -e` (instruções completas no [Guia Linux](INSTALL_LINUX.md#4-configura%C3%A7%C3%A3o-do-agendamento-di%C3%A1rio-crontab)).
- **Proteção contra Cron Sobreposto (Lockfile):** O projeto utiliza lockfile automático (`/tmp/ali-coins.lock`). Se uma execução anterior ainda estiver ativa, a nova execução é pausada para evitar conflitos de sessão. Para destravar manualmente: `npm start -- --force`.

---

## Segurança e Permissões

- **Permissões 0o600:** Todos os arquivos de segredos (`credentials.env`, `session.json`, `session_meta.json`, `session_token.txt`, capturas de depuração `.png`) são salvos e mantidos exclusivamente com permissão `0o600` (somente leitura/escrita pelo proprietário).
- **Criptografia AES-256-GCM:** Exportações usam derivação de chave via `scrypt` com `SESSION_SECRET` (mínimo 32 caracteres) e autenticação de integridade (auth tag GCM).
- **Isolamento do Navegador:** A flag `--no-sandbox` do Chromium é ativada **exclusivamente** quando executado como root (UID 0) ou em ambiente de CI, mantendo o sandbox de segurança do Chromium ativo para usuários comuns.
- **Redação de Logs:** Logs estruturados via `pino` redigem senhas, tokens e cookies automaticamente.
- O repositório já possui regras estritas no `.gitignore` para proteger suas credenciais e tokens.
