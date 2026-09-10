# Guia Detalhado de Instalação no macOS (Apple Silicon & Intel)

Este manual descreve o passo a passo completo para instalar, configurar e rodar o **AliExpress Coin Collector & Task Runner** no **macOS** (macOS 12 Monterey, 13 Ventura, 14 Sonoma e 15 Sequoia), compatível nativamente com processadores **Apple Silicon (M1, M2, M3 e M4)** e Macs com processador **Intel**.

---

## Sumário
1. [Requisitos Mínimos](#1-requisitos-m%C3%ADnimos)
2. [Método A: Instalação Automática (setup_macos.sh)](#2-m%C3%A9todo-a-instala%C3%A7%C3%A3o-autom%C3%A1tica-setup_macossh)
3. [Método B: Instalação Manual Passo a Passo](#3-m%C3%A9todo-b-instala%C3%A7%C3%A3o-manual-passo-a-passo)
   - [Passo 1: Instalação do Node.js 20 LTS](#passo-1-instala%C3%A7%C3%A3o-do-nodejs-20-lts)
   - [Passo 2: Baixar ou Clonar o Projeto e Permissões](#passo-2-baixar-ou-clonar-o-projeto-e-permiss%C3%B5es)
   - [Passo 3: Instalar Dependências npm](#passo-3-instalar-depend%C3%AAncias-npm)
   - [Passo 4: Instalar o Navegador Chromium do Playwright](#passo-4-instalar-o-navegador-chromium-do-playwright)
   - [Passo 5: Teste de Validação do Chromium](#passo-5-teste-de-valida%C3%A7%C3%A3o-do-chromium)
   - [Passo 6: Configurar Credenciais](#passo-6-configurar-credenciais)
   - [Passo 7: Primeira Execução](#passo-7-primeira-execu%C3%A7%C3%A3o)
4. [Agendamento Automático Diário no macOS](#4-agendamento-autom%C3%A1tico-di%C3%A1rio-no-macos)
   - [Opção 1: Via Cron (Mais simples)](#op%C3%A7%C3%A3o-1-via-cron-mais-simples)
   - [Opção 2: Via Launchd (Nativo e Recomendado no macOS)](#op%C3%A7%C3%A3o-2-via-launchd-nativo-e-recomendado-no-macos)
5. [Resolução de Problemas Frequentes no macOS](#5-resolu%C3%A7%C3%A3o-de-problemas-frequentes-no-macos)

---

## 1. Requisitos Mínimos

- **Sistema:** macOS 12 (Monterey) ou superior.
- **Processador:** Apple Silicon (M1/M2/M3/M4 - ARM64) ou Intel (x86_64).
- **Terminal:** Aplicativo Terminal do macOS ou iTerm2.
- **Node.js:** Versão 18 ou 20 LTS (recomendada a versão 20 LTS).

---

## 2. Método A: Instalação Automática (`setup_macos.sh`)

O projeto inclui um script que detecta sua arquitetura (Apple Silicon ou Intel), instala o **Node.js** via Homebrew caso necessário, baixa o binário nativo do Chromium, concede permissões de execução e prepara seu arquivo de credenciais:

```bash
cd ali-coins
chmod +x setup_macos.sh
./setup_macos.sh
```

Após a execução, configure seu e-mail/senha com `nano credentials.env` e inicie a coleta com `./run_all.sh`.

---

## 3. Método B: Instalação Manual Passo a Passo

### Passo 1: Instalação do Node.js 20 LTS

O projeto necessita do **Node.js 18 ou superior**.

#### Opção 1: Via Homebrew (Recomendado para macOS)
O Homebrew é o gerenciador de pacotes padrão da comunidade para macOS.

1. Se você ainda não possui o Homebrew instalado, instale com:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
   *(No Apple Silicon, siga a instrução exibida ao final da instalação para adicionar o Homebrew ao PATH no seu `~/.zprofile`)*:
   ```bash
   echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
   eval "$(/opt/homebrew/bin/brew shellenv)"
   ```

2. Instale o Node.js:
   ```bash
   brew install node
   ```

#### Opção 2: Pelo Site Oficial (Pacote .pkg)
1. Acesse: [https://nodejs.org/](https://nodejs.org/).
2. Baixe a versão recomendada **LTS** (instalador `.pkg` para macOS).
3. Abra o arquivo `.pkg` e siga os passos do assistente de instalação da Apple.

#### Opção 3: Via NVM (Node Version Manager)
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install 20
nvm use 20
```

#### Validar a instalação:
Abra o **Terminal** e confirme as versões:
```bash
node -v
npm -v
```
*(Deve exibir `v20.x.x` ou superior e npm versão 9 ou superior).*

---

### Passo 2: Baixar ou Clonar o Projeto e Permissões

Abra o Terminal e clone o repositório:
```bash
git clone https://github.com/edlabh/ali-coins.git
cd ali-coins
chmod +x *.sh
```

---

### Passo 3: Instalar Dependências npm

Na pasta do projeto, instale as dependências declaradas no `package.json`:
```bash
npm install
```

---

### Passo 4: Instalar o Navegador Chromium do Playwright

O Playwright identifica automaticamente a arquitetura do seu processador e baixa a versão compilada nativamente para **Apple Silicon (arm64)** ou **Intel (x64)**:

```bash
npx playwright install chromium
```

> **Nota para macOS:** Diferente do Linux, o Chromium no macOS é totalmente autocontido e não requer instalação de pacotes externos do sistema via root/sudo.

---

### Passo 5: Teste de Validação do Chromium

Execute o teste rápido para confirmar que o Chromium abre perfeitamente em segundo plano:

```bash
node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); console.log('Chromium OK no macOS!'); await b.close(); })();"
```

Se a mensagem `Chromium OK no macOS!` for exibida, o navegador está 100% funcional.

---

### Passo 6: Configurar Credenciais

1. Crie o arquivo `credentials.env` a partir do modelo:
   ```bash
   cp credentials.env.example credentials.env
   chmod 600 credentials.env
   ```

2. Abra o arquivo no editor de sua preferência (`nano credentials.env` ou `open -e credentials.env`):
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"
   ```

---

### Passo 7: Primeira Execução

- **Modo Unificado (Recomendado - Check-in diário + Tarefas):**
  ```bash
  ./run_all.sh
  # ou via npm:
  npm start
  ```
- **Apenas Check-in diário:** `./run.sh`
- **Apenas Tarefas:** `./run_tasks.sh`

---

## 4. Agendamento Automático Diário no macOS

### Opção 1: Via Cron (Mais simples)

1. Abra a edição do crontab no Terminal:
   ```bash
   crontab -e
   ```
2. Adicione as linhas abaixo para rodar todo dia às 08:00 (ajuste o caminho da pasta):
   ```cron
   SHELL=/bin/zsh
   PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

   0 8 * * * cd /caminho/completo/para/ali-coins && ./run_all.sh >> coins_daily.log 2>&1
   ```

> ⚠️ **Importante no macOS Ventura/Sonoma/Sequoia:** O sistema de segurança da Apple exige permissão de acesso a arquivos para o utilitário cron. Se a execução não gravar logs, acesse:
> **Ajustes do Sistema > Privacidade e Segurança > Acesso Total ao Disco** e habilite o aplicativo **Terminal** e `/usr/sbin/cron`.

---

### Opção 2: Via Launchd (Nativo e Recomendado no macOS)

O `launchd` é o subsistema nativo do macOS para agendamento de tarefas em segundo plano. Ele possui a grande vantagem de executar tarefas pendentes mesmo se o computador estiver em modo de repouso no momento exato do disparo.

1. Crie o arquivo de definição do agente de inicialização:
   ```bash
   mkdir -p ~/Library/LaunchAgents
   nano ~/Library/LaunchAgents/com.alicoins.collector.plist
   ```

2. Cole o conteúdo abaixo (substitua `/Users/SEU_USUARIO/ali-coins` pelo caminho real da pasta do projeto):
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.alicoins.collector</string>
       <key>ProgramArguments</key>
       <array>
           <string>/bin/zsh</string>
           <string>-c</string>
           <string>cd /Users/SEU_USUARIO/ali-coins && ./run_all.sh >> coins_daily.log 2>&1</string>
       </array>
       <key>StartCalendarInterval</key>
       <dict>
           <key>Hour</key>
           <integer>8</integer>
           <key>Minute</key>
           <integer>0</integer>
       </dict>
       <key>StandardErrorPath</key>
       <string>/Users/SEU_USUARIO/ali-coins/launchd_err.log</string>
       <key>StandardOutPath</key>
       <string>/Users/SEU_USUARIO/ali-coins/launchd_out.log</string>
   </dict>
   </plist>
   ```

3. Carregue o agente no sistema:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.alicoins.collector.plist
   ```

---

## 5. Resolução de Problemas Frequentes no macOS

### A. `zsh: command not found: node` ou `npm`
- **Causa:** O Homebrew ou Node.js foi instalado mas seu diretório binário não está no `PATH` do shell `zsh`.
- **Solução:** Adicione a linha apropriada no seu `~/.zshrc`:
  - **Apple Silicon:** `export PATH="/opt/homebrew/bin:$PATH"`
  - **Intel:** `export PATH="/usr/local/bin:$PATH"`
  Em seguida, execute `source ~/.zshrc`.

### B. `zsh: permission denied: ./run_all.sh`
- **Causa:** O script não possui o bit de execução habilitado.
- **Solução:** Execute `chmod +x *.sh` dentro da pasta do projeto.

### C. Alerta de Segurança do macOS (Gatekeeper / Desenvolvedor não identificado)
- **Causa:** Em algumas versões do macOS, o binário do Chromium baixado pelo Playwright pode solicitar confirmação de segurança.
- **Solução:** Vá em **Ajustes do Sistema > Privacidade e Segurança**, role até a seção "Segurança" e clique em **Permitir mesmo assim** caso haja algum aviso referente ao Chromium.

---
