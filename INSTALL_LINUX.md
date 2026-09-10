# Guia Detalhado de Instalação no Linux (Ubuntu 22.04 LTS / 24.04 LTS e Debian)

Este manual foi criado para guiar passo a passo a instalação completa do **AliExpress Coin Collector & Task Runner** em qualquer ambiente Linux, cobrindo desde desktops até servidores em nuvem headless (como Oracle Cloud, AWS EC2, DigitalOcean, Google Cloud, etc.).

---

## Sumário
1. [Requisitos Mínimos](#1-requisitos-m%C3%ADnimos)
2. [Método A: Instalação Automática (Recomendado - 1 Comando)](#2-m%C3%A9todo-a-instala%C3%A7%C3%A3o-autom%C3%A1tica-recomendado---1-comando)
3. [Método B: Instalação Manual Passo a Passo Detalhada](#3-m%C3%A9todo-b-instala%C3%A7%C3%A3o-manual-passo-a-passo-detalhada)
   - [Passo 1: Limpeza de versões antigas do Node.js](#passo-1-limpeza-de-vers%C3%B5es-antigas-do-nodejs)
   - [Passo 2: Instalação do Node.js 20 LTS](#passo-2-instala%C3%A7%C3%A3o-do-nodejs-20-lts)
   - [Passo 3: Clonar o projeto e permissões](#passo-3-clonar-o-projeto-e-permiss%C3%B5es)
   - [Passo 4: Instalação das dependências npm](#passo-4-instala%C3%A7%C3%A3o-das-depend%C3%AAncias-npm)
   - [Passo 5: Instalação do Chromium e dependências nativas do SO](#passo-5-instala%C3%A7%C3%A3o-do-chromium-e-depend%C3%AAncias-nativas-do-so)
   - [Passo 6: Validação rápida do Chromium](#passo-6-valida%C3%A7%C3%A3o-r%C3%A1pida-do-chromium)
   - [Passo 7: Configuração de Credenciais](#passo-7-configura%C3%A7%C3%A3o-de-credenciais)
   - [Passo 8: Primeira Execução](#passo-8-primeira-execu%C3%A7%C3%A3o)
4. [Configuração do Agendamento Diário (Crontab)](#4-configura%C3%A7%C3%A3o-do-agendamento-di%C3%A1rio-crontab)
5. [Resolução de Problemas Frequentes (Troubleshooting)](#5-resolu%C3%A7%C3%A3o-de-problemas-frequentes-troubleshooting)

---

## 1. Requisitos Mínimos

- **Distribuição:** Ubuntu 20.04 LTS, Ubuntu 22.04 LTS, Ubuntu 24.04 LTS ou Debian 11/12 (arquitetura x86_64 ou ARM64/aarch64).
- **Recursos de Hardware:** Mínimo de 1 vCPU e 1 GB de RAM (para servidores com 1 GB de RAM ou menos, recomenda-se ativar 1 GB ou 2 GB de memória Swap).
- **Acesso:** Privilégios `sudo` para instalar as bibliotecas de sistema.

---

## 2. Método A: Instalação Automática (Recomendado - 1 Comando)

Se você já clonou o repositório, basta executar o script automatizado incluído na raiz do projeto:

```bash
cd ali-coins
chmod +x setup_linux.sh
./setup_linux.sh
```

O instalador automático realiza sozinho:
1. Instalação de utilitários de sistema (`curl`, `git`, `ca-certificates`, `gnupg`);
2. Instalação do **Node.js 20 LTS** caso o sistema não tenha ou tenha versão inferior à 18;
3. Execução do `npm install`;
4. Download do navegador Chromium via Playwright;
5. Instalação de todas as bibliotecas nativas de SO específicas para a sua distribuição;
6. Configuração das permissões de execução dos scripts `.sh`;
7. Criação do arquivo de configuração `credentials.env`.

Após a conclusão, basta editar suas credenciais com `nano credentials.env` e rodar `./run_all.sh`.

---

## 3. Método B: Instalação Manual Passo a Passo Detalhada

Siga as etapas abaixo caso queira controle total sobre cada pacote instalado em seu sistema operacional.

### Passo 1: Limpeza de versões antigas do Node.js
No Ubuntu 22.04 LTS padrão, o repositório da Canonical instala o Node.js `v12.22.9`. O Playwright exige **Node.js 18 ou superior**. Se você já instalou o pacote padrão do apt anteriormente, remova-o primeiro:

```bash
sudo apt-get remove -y nodejs npm
sudo apt-get autoremove -y
```

### Passo 2: Instalação do Node.js 20 LTS

#### Opção 1: Via Repositório Oficial NodeSource (Recomendado para servidores/VPS)
Instala o binário estável mais recente do Node.js 20 LTS e o npm atualizado:

```bash
# 1. Atualizar índice do apt e instalar pré-requisitos
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git

# 2. Baixar e registrar o repositório oficial da NodeSource para Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 3. Instalar o Node.js e npm
sudo apt-get install -y nodejs

# 4. Validar se a instalação foi bem-sucedida (deve exibir v20.x.x e npm 9+)
node -v
npm -v
```

#### Opção 2: Via NVM (Node Version Manager)
Caso você prefira gerenciar versões no espaço de usuário sem instalar pacotes globais no sistema:

```bash
# Baixar e instalar NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Carregar NVM na sessão atual
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Instalar e fixar Node.js 20 LTS
nvm install 20
nvm use 20
nvm alias default 20
```

### Passo 3: Clonar o projeto e permissões

```bash
git clone https://github.com/edlabh/ali-coins.git
cd ali-coins
chmod +x *.sh
```

### Passo 4: Instalação das dependências npm

Na raiz da pasta `ali-coins`:

```bash
npm install
```

Isso instalará a versão travada do Playwright declarada no `package.json` (`^1.48.0`).

### Passo 5: Instalação do Chromium e dependências nativas do SO

O Playwright gerencia seus navegadores de forma isolada no diretório `~/.cache/ms-playwright/`.

1. **Baixar o binário do Chromium:**
   ```bash
   npx playwright install chromium
   ```

2. **Instalar as dependências de sistema:**
   Mesmo rodando em modo headless (sem interface gráfica), o Chromium depende de diversas bibliotecas nativas de decodificação de imagem, áudio, rede e renderização X11.

   - **Método Oficial Automatizado do Playwright (Mais fácil):**
     ```bash
     sudo npx playwright install-deps chromium
     ```

   - **Método Manual via apt-get:**
     Se preferir instalar pacote por pacote ou se estiver customizando uma imagem Docker/minimalista:

     **Para Ubuntu 22.04 LTS (Jammy) e Debian 11/12:**
     ```bash
     sudo apt-get update && sudo apt-get install -y \
       libasound2 \
       libatk-bridge2.0-0 \
       libatk1.0-0 \
       libatspi2.0-0 \
       libcairo2 \
       libcups2 \
       libdbus-1-3 \
       libdrm2 \
       libgbm1 \
       libglib2.0-0 \
       libnspr4 \
       libnss3 \
       libpango-1.0-0 \
       libx11-6 \
       libxcb1 \
       libxcomposite1 \
       libxdamage1 \
       libxext6 \
       libxfixes3 \
       libxkbcommon0 \
       libxrandr2 \
       fonts-liberation \
       fonts-noto-color-emoji
     ```

     **Para Ubuntu 24.04 LTS (Noble):**
     *(Nota: No Ubuntu 24.04, diversos pacotes foram renomeados com o sufixo `t64` devido à transição de 64 bits do kernel Linux):*
     ```bash
     sudo apt-get update && sudo apt-get install -y \
       libasound2t64 \
       libatk-bridge2.0-0t64 \
       libatk1.0-0t64 \
       libatspi2.0-0t64 \
       libcairo2 \
       libcups2t64 \
       libdbus-1-3 \
       libdrm2 \
       libgbm1 \
       libglib2.0-0t64 \
       libnspr4 \
       libnss3 \
       libpango-1.0-0 \
       libx11-6 \
       libxcb1 \
       libxcomposite1 \
       libxdamage1 \
       libxext6 \
       libxfixes3 \
       libxkbcommon0 \
       libxrandr2 \
       fonts-liberation \
       fonts-noto-color-emoji
     ```

### Passo 6: Validação rápida do Chromium

Para ter 100% de certeza de que o navegador inicia perfeitamente sem erros de bibliotecas dinâmicas ausentes:

```bash
node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); console.log('✅ Chromium iniciado com sucesso no Linux!'); await b.close(); })();"
```

Se o comando imprimir `✅ Chromium iniciado com sucesso no Linux!`, seu ambiente está 100% pronto.

### Passo 7: Configuração de Credenciais

1. Copie o arquivo de exemplo:
   ```bash
   cp credentials.env.example credentials.env
   chmod 600 credentials.env
   ```

2. Abra o arquivo no editor de sua preferência (`nano credentials.env`):
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha_do_aliexpress"
   ```

### Passo 8: Primeira Execução

Execute o modo unificado para realizar o check-in diário e todas as tarefas em sequência:

```bash
./run_all.sh
# ou:
npm start
```

---

## 4. Configuração do Agendamento Diário (Crontab)

Para garantir que suas moedas sejam coletadas diariamente sem intervenção manual, configure o `cron`.

### O problema clássico do Cron no Linux
O daemon `cron` executa tarefas com um ambiente mínimo onde a variável `$PATH` contém apenas `/usr/bin:/bin`. Se você instalou o Node via `/usr/local/bin` ou NVM, o cron falhará silenciosamente com o erro `node: command not found`.

### Como configurar corretamente:
1. Abra a edição do crontab do seu usuário:
   ```bash
   crontab -e
   ```

2. Adicione a definição explícita do `SHELL` e `PATH` no topo, seguida da linha do agendador (exemplo para rodar todo dia às 08:00):
   ```cron
   SHELL=/bin/bash
   PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

   0 8 * * * cd /caminho/completo/para/ali-coins && ./run_all.sh >> coins_daily.log 2>&1
   ```

   > Substitua `/caminho/completo/para/ali-coins` pelo diretório real obtido rodando `pwd` dentro da pasta do projeto.

3. Para verificar os logs das execuções automáticas a qualquer momento:
   ```bash
   tail -n 50 coins_daily.log
   ```

---

## 5. Resolução de Problemas Frequentes (Troubleshooting)

### A. Erro: `E: Unable to locate package libasound2t64`
- **Causa:** Esse erro ocorre ao tentar instalar um pacote exclusivo do Ubuntu 24.04 em sistemas Ubuntu 22.04 ou Debian.
- **Solução:** No Ubuntu 22.04 LTS, instale `libasound2` (sem o sufixo `t64`).

### B. Erro: `Host system is missing dependencies to run browsers`
- **Causa:** Faltam bibliotecas nativas de C/C++ exigidas pelo Chromium.
- **Como diagnosticar exatamente quais bibliotecas estão faltando:**
  Execute o comando `ldd` no binário do Chromium baixado pelo Playwright:
  ```bash
  ldd ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome | grep "not found"
  ```
- **Solução:** Execute `sudo npx playwright install-deps chromium` ou instale os pacotes listados no [Passo 5](#passo-5-instala%C3%A7%C3%A3o-do-chromium-e-depend%C3%AAncias-nativas-do-so).

### C. Erro: `SyntaxError: Unexpected token '?'` ou falha no npm
- **Causa:** Você está utilizando uma versão legada do Node.js (como a versão 12 padrão do Ubuntu 22.04).
- **Solução:** Siga o [Passo 2](#passo-2-instala%C3%A7%C3%A3o-do-nodejs-20-lts) para instalar o **Node.js 20 LTS**.

### D. Servidores com Pouca Memória RAM (VPS de 512 MB ou 1 GB)
- **Causa:** O navegador Chromium pode ser finalizado pelo kernel Linux (*Out of Memory Killer*) se a memória esgotar durante a renderização de páginas pesadas do AliExpress.
- **Solução:** Crie um arquivo de Swap de 1 GB ou 2 GB:
  ```bash
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

### E. Servidores em Nuvem (Oracle Cloud, AWS, VPS): Desafio de Captcha ou Bloqueio no Login
- **Causa:** O AliExpress implementa um controle rigoroso anti-bot (Baxia). Quando uma tentativa de login (usuário e senha) parte de um IP de Datacenter/Nuvem (como Oracle Cloud, AWS ou DigitalOcean), o AliExpress quase sempre bloqueia o envio exibindo um Slide Captcha de alta precisão ou solicitando código de confirmação 2FA por e-mail/SMS.
- **Por que isso não afeta computadores locais?** Em conexões residenciais (seu PC com Windows, macOS ou Linux Desktop), o IP é considerado confiável e o login ocorre com facilidade.
- **Como resolver em 10 segundos:**
  1. Em seu computador local (onde o IP residencial não é bloqueado), execute:
     ```bash
     node export_session.js
     ```
     O script exibirá um comando de importação contendo o token compacto da sessão.
  2. No terminal do seu servidor na nuvem (Oracle Cloud / VPS), dentro da pasta `ali-coins`, cole e execute o comando exibido:
     ```bash
     node import_session.js '<TOKEN_GERADO>'
     ```
  3. Pronto! Os arquivos `session.json` e `session_meta.json` serão gravados e o `./run_all.sh` rodará diariamente na nuvem reutilizando a sessão sem necessidade de refazer login por semanas ou meses.

---

