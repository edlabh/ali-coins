# AliExpress Coin Collector & Task Runner

Automação completa para **check-in diário de moedas** e **execução automática das tarefas ("Ganhe mais moedas")** do AliExpress com emulação mobile (Google Pixel 7 / Android) via Playwright.

Compatível com **Windows 10/11**, **macOS (Apple Silicon & Intel)** e **Ubuntu / Linux**.

---

## Recursos Principais

- **Novo Modo Unificado (1 Único Comando):** Executa o check-in diário e em seguida roda todas as tarefas do painel em sequência na mesma rotina, apresentando um relatório consolidado com saldo inicial, ganho por tarefa e saldo final.
- **Check-in Diário Inteligente:** Compatível com o layout de cartões diários do AliExpress. Reconhece sequências ativas (inclusive de 200+ dias) e valores progressivos (+10, +15, +20 até +40 moedas diárias após o 7º dia consecutivo).
- **Validação Automática de Login:** Confirma e exibe o status da autenticação antes da coleta. Detecta se a conta configurada no `credentials.env` foi alterada e renova a sessão sem conflitos.
- **Automação Completa de Tarefas:** Executa em lote todas as tarefas da central de moedas:
  - **Explore itens surpresa / Browse surprise items (+5 moedas por rodada):** Toque automatizado e real em 3 produtos por rodada com permanência na página para consolidar o tracking de moedas.
  - **Explore itens patrocinados / Sponsored items (+5 moedas):** Navegação e permanência por 15s com rolagem ativa.
  - **Super descontos e Retrospectiva de economia (+5 moedas):** Visualização automática por 15s.
  - **Pesquisa ativa por palavras-chave (+5 moedas):** Pesquisa produtos reais e navega por 15s.
  - **Itens de US$ 0.10 / Prize Land & Minigames:** Identifica tarefas exclusivas do app móvel ou interativas e relata com transparência no extrato final.
  - **Cupons e créditos (+5 moedas):** Navegação e permanência ativa.
- **Extrato e Saldo Fidedignos:** Consulta o extrato oficial de transações da conta no AliExpress (`mycoin.html`), garantindo que o valor resgatado e o saldo total reflitam a realidade sem distorções de vitrine.

---

## Modos de Execução

Você pode rodar tudo junto de uma só vez ou os módulos individualmente:

| Modo | Descrição | Windows CMD | Windows PowerShell | Linux / macOS | npm |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Unificado (Recomendado)** | Faz check-in e roda todas as tarefas em sequência | `run_all.bat` | `.\run_all.ps1` | `./run_all.sh` | `npm run all` ou `npm start` |
| **Apenas Check-in** | Realiza apenas o check-in diário e consulta saldo | `run.bat` | `.\run.ps1` | `./run.sh` | `npm run collect` |
| **Apenas Tarefas** | Executa apenas o painel "Ganhe mais moedas" | `run_tasks.bat` | `.\run_tasks.ps1` | `./run_tasks.sh` | `npm run tasks` |

---

## 1. Requisitos Gerais

- [Node.js](https://nodejs.org/) (versão 18 ou superior)
- npm (versão 9 ou superior, já incluso no instalador do Node.js)

---

## 2. Preparação e Uso no Windows (Windows 10 e Windows 11)

> [!TIP]
> Um manual aprofundado com passo a passo para o Agendador de Tarefas do Windows, comandos do PowerShell e resolução de erros está disponível em [INSTALL_WINDOWS.md](INSTALL_WINDOWS.md).

Você pode realizar a instalação de forma **automática** através do script incluso ou seguir o **passo a passo manual detalhado**.

---

### Opção A: Instalação Automática via Script (Recomendado)

Dê um duplo clique no arquivo **`setup_windows.bat`** (ou execute-o via terminal Prompt de Comando ou PowerShell).

O script verificará sua versão do Node.js, executará o `npm install`, baixará o Chromium do Playwright, criará seu arquivo de credenciais e validará a inicialização do navegador.

---

### Opção B: Instalação Manual Passo a Passo Detalhada

#### 1. Instalar o Node.js 20 LTS
Certifique-se de possuir o Node.js 18 ou 20 LTS instalado. Caso precise instalar:
- **Via Winget (Prompt de Comando ou PowerShell):**
  ```cmd
  winget install OpenJS.NodeJS.LTS
  ```
- **Ou pelo instalador oficial:** Baixe e execute o `.msi` da versão LTS em [https://nodejs.org/](https://nodejs.org/) (garanta que a opção *"Add to PATH"* permaneça marcada).

> Feche e reabra o terminal após a instalação e confirme com:
> ```cmd
> node -v
> npm -v
> ```

#### 2. Liberar Execução de Scripts no PowerShell (Se aplicável)
Se ao executar scripts no PowerShell você receber o erro de política de execução (*ExecutionPolicy*), execute:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

#### 3. Instalar as Dependências do Projeto
Na pasta do projeto:
```cmd
npm install
```

#### 4. Instalar o Navegador Chromium do Playwright
```cmd
npx playwright install chromium
```

*(Opcional: Caso esteja em uma instalação limpa do Windows e ocorra erro de DLL, instale o pacote de redistribuição da Microsoft: `winget install Microsoft.VCRedist.2015+.x64`)*.

#### 5. Teste de Validação Rápida do Chromium
```cmd
node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); console.log('Chromium OK no Windows!'); await b.close(); })();"
```

#### 6. Configuração das Credenciais
1. Crie o arquivo `credentials.env` a partir do modelo:
   - No CMD: `copy credentials.env.example credentials.env`
   - No PowerShell: `Copy-Item credentials.env.example credentials.env`
2. Abra o arquivo no Bloco de Notas:
   ```cmd
   notepad credentials.env
   ```
3. Preencha seu usuário e senha do AliExpress:
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"
   ```

### Execução no Windows
- **Modo Unificado (Check-in + Tarefas em uma chamada):**
  ```cmd
  run_all.bat
  # ou via PowerShell:
  .\run_all.ps1
  # ou via npm:
  npm start
  ```
- **Execuções individuais:**
  ```cmd
  run.bat          :: Apenas Check-in diário
  run_tasks.bat    :: Apenas Tarefas "Ganhe mais moedas"
  ```

---

## 3. Preparação e Uso no macOS (Apple Silicon M1/M2/M3/M4 & Intel)

> [!TIP]
> Um manual aprofundado com configuração nativa via `launchd`, permissões do sistema no macOS Sequoia/Sonoma e resolução de erros está disponível em [INSTALL_MACOS.md](INSTALL_MACOS.md).

Você pode realizar a instalação de forma **automática** através do script incluso ou seguir o **passo a passo manual detalhado**.

---

### Opção A: Instalação Automática via Script (Recomendado)

Abra o aplicativo **Terminal** na pasta do projeto e execute:
```bash
chmod +x setup_macos.sh
./setup_macos.sh
```

O script detecta a arquitetura do seu processador, verifica o Node.js, roda o `npm install`, baixa o binário nativo do Chromium para ARM64 ou Intel e valida a execução.

---

### Opção B: Instalação Manual Passo a Passo Detalhada

#### 1. Instalar o Node.js 20 LTS
Abra o **Terminal** e verifique se possui o Node.js (`node -v`). Se precisar instalar:
- **Via Homebrew (Recomendado):**
  ```bash
  brew install node
  ```
- **Ou pelo instalador oficial:** Baixe o pacote `.pkg` da versão LTS em [https://nodejs.org/](https://nodejs.org/).

Confirme as versões instaladas:
```bash
node -v
npm -v
```

#### 2. Permissões de Execução dos Scripts
```bash
chmod +x *.sh
```

#### 3. Instalar Dependências do Projeto
```bash
npm install
```

#### 4. Baixar o Chromium Nativo via Playwright
O Playwright detecta automaticamente se o Mac é Apple Silicon (arm64) ou Intel (x64) e baixa o binário otimizado:
```bash
npx playwright install chromium
```

#### 5. Teste de Validação Rápida do Chromium
```bash
node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); console.log('Chromium OK no macOS!'); await b.close(); })();"
```

#### 6. Configuração das Credenciais
1. Crie o arquivo `credentials.env`:
   ```bash
   cp credentials.env.example credentials.env
   chmod 600 credentials.env
   ```
2. Edite o arquivo (`nano credentials.env` ou `open -e credentials.env`):
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"
   ```

### Execução no macOS
- **Modo Unificado (Check-in + Tarefas em uma chamada):**
  ```bash
  ./run_all.sh
  # ou via npm:
  npm start
  ```
- **Execuções individuais:**
  ```bash
  ./run.sh         # Apenas Check-in diário
  ./run_tasks.sh   # Apenas Tarefas "Ganhe mais moedas"
  ```

---

## 4. Preparação e Uso no Ubuntu / Linux (Ubuntu 20.04, 22.04, 24.04 e Debian)

> [!TIP]
> Um guia aprofundado com resolução de erros, configuração de VPS headless (Oracle Cloud, AWS, DigitalOcean) e criação de memória Swap está disponível em [INSTALL_LINUX.md](INSTALL_LINUX.md).

Você pode realizar a instalação de forma **100% automatizada** através do script incluso ou seguir o **passo a passo manual detalhado**.

---

### Opção A: Instalação Automática via Script (Recomendado)

O projeto inclui um script que detecta sua versão do Ubuntu/Debian, instala o **Node.js 20 LTS** caso não possua, baixa o Chromium, instala todas as dependências nativas do sistema, concede permissões de execução e prepara seu arquivo de credenciais:

```bash
# Na pasta do projeto:
chmod +x setup_linux.sh
./setup_linux.sh
```

---

### Opção B: Instalação Manual Passo a Passo Detalhada

Caso prefira executar cada etapa manualmente:

#### 1. Instalar o Node.js 20 LTS
> [!IMPORTANT]
> No Ubuntu 22.04 LTS, o comando padrão `sudo apt install nodejs` instala a versão legada `v12.22.9`, incompatível com o Playwright (que exige Node >= 18).
>
> Se você já tiver instalado essa versão antiga, remova-a primeiro:
> ```bash
> sudo apt-get remove -y nodejs npm && sudo apt-get autoremove -y
> ```

**Instalação via NodeSource (Recomendado para servidores/VPS):**
```bash
# Atualizar repositórios e instalar utilitários básicos
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git

# Adicionar repositório oficial do Node.js 20 LTS e instalar
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Confirmar versões (Node >= 18 e npm >= 9)
node -v
npm -v
```

*(Alternativa via NVM - gerenciamento no espaço de usuário sem sudo):*
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20 && nvm use 20
```

#### 2. Permissões de Execução dos Scripts
Garanta que os scripts do projeto tenham permissão de execução:
```bash
chmod +x *.sh
```

#### 3. Instalar Dependências do Projeto
```bash
npm install
```

#### 4. Instalar o Chromium do Playwright
```bash
npx playwright install chromium
```

#### 5. Instalar Dependências do Sistema Operacional para o Chromium

Mesmo em modo headless (sem interface gráfica), o Chromium requer bibliotecas nativas do sistema para renderização e decodificação:

- **Método Oficial Playwright (Recomendado):**
  ```bash
  sudo npx playwright install-deps chromium
  ```

- **Ou via `apt-get` manual:**
  - **Para Ubuntu 22.04 LTS (Jammy) e Debian 11/12:**
    ```bash
    sudo apt-get update && sudo apt-get install -y \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
      libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
      libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
      fonts-liberation fonts-noto-color-emoji
    ```

  - **Para Ubuntu 24.04 LTS (Noble):**
    ```bash
    sudo apt-get update && sudo apt-get install -y \
      libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
      libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
      libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
      fonts-liberation fonts-noto-color-emoji
    ```

#### 6. Teste de Validação Rápida do Chromium
Para certificar-se de que o navegador inicia perfeitamente sem erros de bibliotecas ausentes:
```bash
node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); console.log('✅ Chromium iniciado com sucesso!'); await b.close(); })();"
```

> [!TIP]
> Caso algum erro de biblioteca ocorra, execute `ldd ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome | grep "not found"` para identificar exatamente qual pacote `.so` falta.

#### 7. Configuração das Credenciais
1. Crie o arquivo `credentials.env`:
   ```bash
   cp credentials.env.example credentials.env
   chmod 600 credentials.env
   ```
2. Abra e preencha suas credenciais do AliExpress:
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"
   ```

### Execução no Ubuntu / Linux
- **Modo Unificado (Check-in + Tarefas em uma chamada):**
  ```bash
  ./run_all.sh
  # ou via npm:
  npm start
  ```
- **Execuções individuais:**
  ```bash
  ./run.sh         # Apenas Check-in diário
  ./run_tasks.sh   # Apenas Tarefas "Ganhe mais moedas"
  ```

---

## 5. Agendamento Automático Diário (Piloto Automático)

Para manter a sequência ativa de check-in ininterrupta sem precisar rodar manualmente todo dia:

### No Linux e macOS (via Cron)
Abra a edição do seu agendador:
```bash
crontab -e
```
Adicione a linha para executar todo dia, por exemplo, às 08:00 da manhã via modo unificado (recomendamos incluir as variáveis `SHELL` e `PATH` no topo da crontab para garantir que o binário do Node.js seja localizado corretamente pelo daemon cron):
```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

0 8 * * * cd /caminho/completo/para/ali-coins && ./run_all.sh >> coins_daily.log 2>&1
```

### No Windows (via Agendador de Tarefas / Task Scheduler)
1. Pressione `Win + R`, digite `taskschd.msc` e tecle `Enter`.
2. Clique em **Criar Tarefa Básica**.
3. Defina o disparador como **Diariamente** no horário desejado.
4. Na ação, selecione **Iniciar um programa**:
   - Programa/script: `cmd.exe`
   - Argumentos: `/c run_all.bat`
   - Iniciar em: pasta completa do projeto `ali-coins`.

---

## 6. Persistência de Sessão e Troca de Conta

- **Login inicial:** Na primeira execução, o script realiza a autenticação com as credenciais do `credentials.env` e salva os tokens e cookies em `session.json`.
- **Reutilização transparente:** Nas execuções seguintes, a sessão em `session.json` é aproveitada diretamente, evitando telas de login e verificações redundantes.
- **Troca de Conta:** Se você alterar o `ALI_USER` no arquivo `credentials.env`, o script detecta automaticamente a mudança e descarta a sessão antiga, realizando um novo login transparente com a nova conta.
- **Segurança:** Nunca envie nem comite os arquivos `credentials.env` ou `session.json`. Eles já estão protegidos pelo `.gitignore`.
