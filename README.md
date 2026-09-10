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
Edite o arquivo `credentials.env` com seu e-mail e senha:
```env
ALI_USER="seu_email_ou_telefone"
ALI_PASSWORD="sua_senha"
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
- ☁️ **[Guia de Execução na Nuvem e Sessões](CLOUD_SESSIONS.md):** Entenda como funciona a proteção anti-bot em IPs de Datacenter (Oracle Cloud, AWS, GCP) e como delegar a sessão autenticada do seu computador para o servidor em segundos.

---

## Execução em Nuvem (Oracle Cloud / AWS / VPS)

Provedores de nuvem possuem IPs de Datacenter que o AliExpress identifica com risco elevado, bloqueando novas tentativas de login com Slide Captchas ou códigos 2FA.

### Como Resolver (Delegação de Sessão em 2 Comandos):
1. No seu **computador pessoal** (conexão residencial onde o login não é desafiado), execute o script uma vez e depois exporte a sessão:
   ```bash
   node export_session.js
   ```
2. No terminal do seu **servidor na nuvem** (dentro da pasta `ali-coins`), cole o comando gerado:
   ```bash
   node import_session.js '<TOKEN>'
   ```
3. Execute `./run_all.sh` na nuvem. A sessão permanecerá válida por semanas/meses sem exigir login.

> Consulte o [Guia de Execução na Nuvem e Sessões](CLOUD_SESSIONS.md) para detalhes técnicos e métodos alternativos (via SCP ou manual).

---

## Agendamento Automático Diário

- **Linux / Servidores na Nuvem:** Configure via `crontab -e` (instruções completas no [Guia Linux](INSTALL_LINUX.md#4-configura%C3%A7%C3%A3o-do-agendamento-di%C3%A1rio-crontab)).
- **Windows:** Configure via Agendador de Tarefas do Windows (instruções completas no [Guia Windows](INSTALL_WINDOWS.md#3-agendamento-autom%C3%A1tico-no-windows)).
- **macOS:** Configure via daemon de usuário do `launchd` (instruções completas no [Guia macOS](INSTALL_MACOS.md#4-agendamento-autom%C3%A1tico-no-macos-launchd)).

---

## Segurança

- Nunca compartilhe nem envie para repositórios públicos os arquivos `credentials.env`, `session.json` ou `session_token.txt`.
- O repositório já possui regras estritas no `.gitignore` para proteger suas credenciais e tokens.
