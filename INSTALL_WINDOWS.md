# Guia Detalhado de Instalação no Windows (Windows 10 e Windows 11)

Este manual descreve o passo a passo completo para instalar, configurar e rodar o **AliExpress Coin Collector & Task Runner** em sistemas **Windows 10** e **Windows 11** (64-bit), via Prompt de Comando (CMD) ou PowerShell.

---

## Sumário

1. [Requisitos Mínimos](#1-requisitos-m%C3%ADnimos)
2. [Método A: Instalação Automática (setup_windows.bat ou setup_windows.ps1)](#2-m%C3%A9todo-a-instala%C3%A7%C3%A3o-autom%C3%A1tica-setup_windowsbat-ou-setup_windowsps1)
3. [Método B: Instalação Manual Passo a Passo](#3-m%C3%A9todo-b-instala%C3%A7%C3%A3o-manual-passo-a-passo)
   - [Passo 1: Instalação do Node.js 22 LTS](#passo-1-instala%C3%A7%C3%A3o-do-nodejs-22-lts)
   - [Passo 2: Baixar ou Clonar o Projeto](#passo-2-baixar-ou-clonar-o-projeto)
   - [Passo 3: Liberar Execução de Scripts no PowerShell (Se aplicável)](#passo-3-liberar-execu%C3%A7%C3%A3o-de-scripts-no-powershell-se-aplic%C3%A1vel)
   - [Passo 4: Instalar Dependências npm](#passo-4-instalar-depend%C3%AAncias-npm)
   - [Passo 5: Instalar o Navegador Chromium do Playwright](#passo-5-instalar-o-navegador-chromium-do-playwright)
   - [Passo 6: Teste de Validação do Chromium](#passo-6-teste-de-valida%C3%A7%C3%A3o-do-chromium)
   - [Passo 7: Configurar Credenciais e Criptografia](#passo-7-configurar-credenciais-e-criptografia)
   - [Passo 8: Primeira Execução](#passo-8-primeira-execu%C3%A7%C3%A3o)
4. [Exportação e Importação de Sessão Autenticada](#4-exporta%C3%A7%C3%A3o-e-importa%C3%A7%C3%A3o-de-sess%C3%A3o-autenticada)
5. [Agendamento Automático Diário (Task Scheduler)](#5-agendamento-autom%C3%A1tico-di%C3%A1rio-task-scheduler)
   - [Opção 1: Criação Automática via PowerShell (1 Comando)](#op%C3%A7%C3%A3o-1-cria%C3%A7%C3%A3o-autom%C3%A1tica-via-powershell-1-comando)
   - [Opção 2: Criação Manual via Interface Gráfica](#op%C3%A7%C3%A3o-2-cria%C3%A7%C3%A3o-manual-via-interface-gr%C3%A1fica)
6. [Resolução de Problemas Frequentes no Windows](#6-resolu%C3%A7%C3%A3o-de-problemas-frequentes-no-windows)

---

## 1. Requisitos Mínimos

- **Sistema Operacional:** Windows 10 (versão 1809 ou superior) ou Windows 11 (64-bit).
- **Terminal:** Prompt de Comando (`cmd.exe`), PowerShell (`powershell.exe`) ou Windows Terminal.
- **Node.js:** Versão 22 LTS ou superior (`node >= 22`).
- **Privilégios:** Usuário padrão (administrador necessário apenas para instalar pacotes globais ou alterar execution policies).

---

## 2. Método A: Instalação Automática (`setup_windows.bat` ou `setup_windows.ps1`)

O projeto inclui instaladores automatizados que verificam a versão do Node.js, executam o `npm install`, instalam o binário do Chromium, geram o modelo `credentials.env` e validam o funcionamento headless do navegador.

### Opção 1: Via Prompt de Comando ou Duplo-Clique (CMD)

1. Abra a pasta do projeto no **Explorador de Arquivos**.
2. Dê um duplo clique no arquivo **`setup_windows.bat`** (ou execute `setup_windows.bat` no CMD).
3. Aguarde a finalização com a mensagem `INSTALACAO CONCLUIDA COM SUCESSO!`.

### Opção 2: Via PowerShell

Abra o terminal PowerShell na pasta do projeto e execute:

```powershell
.\setup_windows.ps1
```

> Se o PowerShell exibir erro de execução desabilitada, execute antes:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

Ao final, configure suas credenciais em `credentials.env` e execute `run_all.bat` (ou `.\run_all.ps1`).

---

## 3. Método B: Instalação Manual Passo a Passo

### Passo 1: Instalação do Node.js 22 LTS

O projeto requer **Node.js 22 ou superior**.

#### Opção 1: Via Gerenciador de Pacotes do Windows (`winget`)

```cmd
winget install OpenJS.NodeJS.LTS
```

#### Opção 2: Via Chocolatey

```cmd
choco install nodejs-lts
```

#### Opção 3: Pelo Site Oficial (Instalador .msi)

1. Acesse: [https://nodejs.org/](https://nodejs.org/).
2. Baixe a versão recomendada **22 LTS** (instalador `.msi` para Windows x64).
3. Execute o instalador mantendo as opções padrão (certifique-se de que **"Add to PATH"** esteja selecionada).
4. Feche e reabra o terminal para recarregar o `PATH`.

#### Validar a instalação:

```cmd
node -v
npm -v
```

_(O comando `node -v` deve exibir `v22.x.x` ou superior, e o `npm -v` deve exibir versão 10 ou superior)._

---

### Passo 2: Baixar ou Clonar o Projeto

#### Via Git:

```cmd
git clone https://github.com/edlabh/ali-coins.git
cd ali-coins
```

#### Ou via Download ZIP:

1. No GitHub, clique em **Code** > **Download ZIP**.
2. Extraia o arquivo ZIP em uma pasta (exemplo: `C:\Users\SeuUsuario\ali-coins`).
3. Abra o terminal nessa pasta.

---

### Passo 3: Liberar Execução de Scripts no PowerShell (Se aplicável)

Se for utilizar o PowerShell e receber aviso de scripts desabilitados:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

### Passo 4: Instalar Dependências npm

Na raiz da pasta do projeto:

```cmd
npm install
```

Isso instalará as dependências necessárias (`playwright`, `zod`, `pino`, `commander`, etc.).

---

### Passo 5: Instalar o Navegador Chromium do Playwright

O Playwright gerencia o navegador de forma isolada em `%USERPROFILE%\AppData\Local\ms-playwright`.

Execute:

```cmd
npx playwright install chromium
```

> Em instalações limpas do Windows ou máquinas virtuais sem pacotes de runtime C++, pode ser necessário instalar o Microsoft Visual C++ Redistributable:
>
> ```cmd
> winget install Microsoft.VCRedist.2015+.x64
> ```

---

### Passo 6: Teste de Validação do Chromium

Para confirmar que o Chromium inicializa em modo headless:

- **No Prompt de Comando (CMD):**

  ```cmd
  node -e "const { chromium } = require('playwright'); chromium.launch({ headless: true }).then(b => b.close()).then(() => console.log('Chromium OK!')).catch(e => { console.error(e); process.exit(1); })"
  ```

- **No PowerShell:**
  ```powershell
  node -e "const { chromium } = require('playwright'); chromium.launch({ headless: true }).then(b => b.close()).then(() => console.log('Chromium OK!')).catch(e => { console.error(e); process.exit(1); })"
  ```

Se a saída exibir `Chromium OK!`, seu ambiente está pronto.

---

### Passo 7: Configurar Credenciais e Criptografia

1. Crie o arquivo `credentials.env` a partir do modelo de exemplo:
   - **No CMD:**
     ```cmd
     copy credentials.env.example credentials.env
     ```
   - **No PowerShell:**
     ```powershell
     Copy-Item credentials.env.example credentials.env
     ```

2. Abra o arquivo no Bloco de Notas:

   ```cmd
   notepad credentials.env
   ```

3. Preencha as configurações principais:

   ```env
   # Credenciais do AliExpress
   # Mantenha sempre entre aspas duplas. Senhas com #, espacos ou ! sem aspas
   # sao truncadas silenciosamente. Ex.: ALI_PASSWORD="abc#123!"
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"

   # Suporte Multi-Conta Sequencial (opcional - até 20 contas):
   # ALI_USER_2="segunda_conta@email.com"
   # ALI_PASSWORD_2="senha_da_segunda_conta"

   # Chave de criptografia AES-256-GCM para repouso (at-rest) e exportação (mínimo 32 caracteres)
   # Como gerar usando Node.js no Windows: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   SESSION_SECRET="sua_chave_secreta_com_pelo_menos_32_caracteres"

   # Criptografia local at-rest da sessão em disco (session.json.enc)
   ENCRYPT_LOCAL_SESSION=true

   # Identificador do computador nas mensagens do Telegram (opcional)
   # NOTIFY_HOST_LABEL="meu-desktop-windows"

   # Dead Man's Switch / Uptime Heartbeat (opcional, ex: Healthchecks.io)
   # HEARTBEAT_URL="https://hc-ping.com/seu-uuid"

   # Segurança de destinos externos (SSRF): webhook e heartbeat bloqueiam por padrão
   # endereços loopback/privados (127.0.0.1, 10.x, 192.168.x, 169.254.169.254, ::1 etc.)
   # Em testes locais, libere destinos privados explicitamente:
   # ALLOW_PRIVATE_WEBHOOKS=true
   ```

   _Salve o arquivo (`Ctrl + S`) e feche o Bloco de Notas._

#### Como gerar a chave de 32 caracteres (`SESSION_SECRET`):

Você pode obter sua chave criptográfica por qualquer um dos seguintes métodos:

- **Opção 1 (Recomendada no Windows - Via Node.js nativo, sem OpenSSL):**
  Como o Node.js já está instalado no seu sistema, execute diretamente no CMD ou PowerShell:
  ```cmd
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
  Isso gerará instantaneamente uma chave aleatória criptograficamente segura de 32 bytes em Base64 (44 caracteres) pronta para colar no `credentials.env`.
- **Opção 2 (Via Script de 1 Clique):**
  Execute o utilitário gerador de chaves incluído na raiz do projeto:
  - No Prompt de Comando (CMD): `generate_secret.bat`
  - No PowerShell: `.\generate_secret.ps1`
- **Opção 3 (Via OpenSSL - se instalado no sistema ou no Git for Windows):**
  Se você já possui o OpenSSL instalado no sistema ou o Git for Windows, execute no terminal:
  ```cmd
  openssl rand -base64 32
  ```
- **Opção 4 (Geração Automática pelo Instalador):**
  Se você utilizou o instalador `setup_windows.bat` ou `setup_windows.ps1` (Método A), a chave `SESSION_SECRET` de 32 caracteres já foi gerada e configurada automaticamente no seu arquivo `credentials.env`.

---

### Passo 8: Primeira Execução

- **Modo Unificado (Recomendado - Check-in diário + Tarefas):**
  - No CMD: `run_all.bat`
  - No PowerShell: `.\run_all.ps1`
  - Via npm: `npm start`

- **Apenas Check-in:**
  - No CMD: `run.bat`
  - No PowerShell: `.\run.ps1`

- **Apenas Tarefas:**
  - No CMD: `run_tasks.bat`
  - No PowerShell: `.\run_tasks.ps1`

---

## 4. Exportação e Importação de Sessão Autenticada

Caso seu login no AliExpress encontre Slide Captcha ou você queira transferir a sessão entre computadores sem expor credenciais:

### Exportar sessão criptografada (AES-256-GCM v2):

- **Conta única ou padrão:**
  ```cmd
  node export_session.js
  ```
- **Exportar todas as contas (multi-conta):**
  ```cmd
  node export_session.js --all
  ```
- **Exportar apenas uma conta específica:**
  ```cmd
  node export_session.js --account=2
  ```

Os tokens criptografados serão gravados em `session_token.txt` (Conta 1), `session_token_2.txt` (Conta 2), etc.

### Importar sessão criptografada:

- **Importar todas as contas de uma vez:**
  ```cmd
  node import_session.js --all
  ```
- **Importar conta individual (Prompt de Comando - CMD):**
  ```cmd
  node import_session.js --from-file=session_token.txt
  node import_session.js --from-file=session_token_2.txt
  ```
- **Importar conta individual (PowerShell):**
  ```powershell
  Get-Content session_token.txt | node import_session.js
  Get-Content session_token_2.txt | node import_session.js
  ```

> O importador realiza **auto-roteamento inteligente**: ele identifica a qual conta o token pertence e salva nos arquivos isolados correspondentes (`session.json.enc` para a Conta 1, `session_<hash>.json.enc` para as demais), nunca sobrescrevendo outras contas.

---

## 5. Agendamento Automático Diário (Task Scheduler)

### Opção 1: Criação Automática via PowerShell (1 Comando)

Abra o PowerShell na pasta do projeto e execute (exemplo para rodar diariamente às **08:00**):

```powershell
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c set "NODE_OPTIONS=--max-old-space-size=256" && set "NODE_COMPILE_CACHE=%TEMP%\ali-coins-compile-cache" && run_all.bat >> coins_daily.log 2>&1' -WorkingDirectory "$PWD"
$trigger = New-ScheduledTaskTrigger -Daily -At 8:00AM
Register-ScheduledTask -TaskName "AliExpressCoinsCollector" -Action $action -Trigger $trigger -Description "Coleta diária de moedas do AliExpress"
```

---

### Opção 2: Criação Manual via Interface Gráfica

1. Pressione as teclas `Win + R`, digite `taskschd.msc` e clique em **OK**.
2. No menu à direita, clique em **Criar Tarefa Básica...**.
3. **Nome:** Digite `AliExpress Coins Collector` e clique em **Avançar**.
4. **Disparador:** Selecione **Diariamente** e defina o horário de execução desejado (ex: `08:00:00`).
5. **Ação:** Selecione **Iniciar um programa**.
6. **Configuração da Ação:**
   - **Programa/script:** `cmd.exe`
   - **Adicione argumentos (opcional):** `/c run_all.bat >> coins_daily.log 2>&1`
   - **Iniciar em (opcional):** Caminho completo da pasta do projeto (exemplo: `C:\Users\SeuUsuario\ali-coins`).
7. Clique em **Avançar** e depois em **Concluir**.

---

## 6. Resolução de Problemas Frequentes no Windows

### A. `'node' ou 'npm' não é reconhecido como um comando interno ou externo`

- **Causa:** O Node.js não foi adicionado à variável de ambiente `PATH` ou o terminal foi aberto antes da conclusão da instalação.
- **Solução:** Feche todas as janelas do terminal e abra uma nova. Se persistir, reinicie o computador.

### B. `Erro ao inicializar o Chromium: MSVCP140.dll / VCRUNTIME140.dll ausente`

- **Causa:** Ambientes Windows sem o Microsoft Visual C++ Redistributable instalado não conseguem carregar as dependências de compilação do Chromium headless.
- **Solução:** Execute no terminal:
  ```cmd
  winget install Microsoft.VCRedist.2015+.x64
  ```

### C. `O arquivo ... não pode ser carregado porque a execução de scripts foi desabilitada neste sistema`

- **Causa:** Política de restrição padrão do PowerShell (`ExecutionPolicy Restricted`).
- **Solução:** Execute no PowerShell:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

### D. Executar `setup_windows.bat` como Administrador muda o diretório de trabalho

- **Causa:** Por padrão, o Windows define `C:\Windows\System32` como diretório de trabalho ao escolher "Executar como Administrador".
- **Solução:** O `setup_windows.bat` já inclui o comando de ancoragem `cd /d "%~dp0"` para garantir que as dependências sejam instaladas sempre na pasta correta do projeto.

### E. Alerta do Windows Defender / SmartScreen

- **Causa:** Como o Playwright abre um processo de navegador em background com controle de eventos, antivírus rigorosos podem exibir alerta na primeira execução.
- **Solução:** Clique em **"Mais informações"** e depois em **"Executar assim mesmo"**.

### F. Erro de Caminhos Longos (`Filename too long` / MAX_PATH)

- **Causa:** O Windows limita caminhos de arquivos a 260 caracteres por padrão.
- **Solução:** Habilite caminhos longos no PowerShell (como Administrador):
  ```powershell
  New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
  ```

### G. Caracteres Estranhos ou Emojis Quebrados nos Logs (Mojibake / Codificação)

- **Causa:** Por padrão, os terminais clássicos do Windows (CMD e PowerShell 5.1) utilizam páginas de código legadas (CP850 ou CP437), que não renderizam nativamente strings UTF-8 ou emojis como `🪙`, `💰`, `⏱️`, `✅`, `🚨`.
- **Solução:**
  - Utilize os scripts fornecidos (`run_all.bat` ou `.\run_all.ps1`), que configuram automaticamente a página de código UTF-8 (`chcp 65001`) e os encodings de console.
  - Caso prefira rodar comandos `node` manualmente em um terminal aberto, basta executar antes:
    - No Prompt de Comando (CMD): `chcp 65001`
    - No PowerShell: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 > $null`
  - Recomendamos também o uso do **Windows Terminal** (nativo no Windows 11 ou instalável via `winget install Microsoft.WindowsTerminal`), que possui suporte moderno e renderização completa de emojis por padrão.
- **Arquivo de log com acentuação quebrada:** no **PowerShell 5.1**, redirecionar com `>`/`>>`
  grava o arquivo em **UTF-16LE** (parece "quebrado" em ferramentas que esperam UTF-8). Prefira:
  - **CMD (recomendado, gera UTF-8):** `run_all.bat >> coins_daily.log 2>&1`
  - **PowerShell (força UTF-8):** `.\run_all.ps1 2>&1 | Out-File -FilePath coins_daily.log -Append -Encoding utf8`
  - Para **visualizar** o log, use o Bloco de Notas ou o VS Code (detectam UTF-8). No CMD, `type coins_daily.log` pode exibir errado se a página de código não estiver em 65001.

### H. Otimização para Ambientes com Pouca Memória RAM (1 GB a 2 GB ou VMs Windows)

Se você executa a automação em máquinas virtuais Windows compactas ou computadores com pouca memória disponível:

1. **Memória Virtual (Arquivo de Paginação - Pagefile):**
   - Certifique-se de que o Windows possui arquivo de paginação habilitado e gerenciado pelo sistema (ou fixado em pelo menos 2 GB).
   - Verifique em: **Configurações > Sistema > Sobre > Configurações avançadas do sistema > Avançado > Desempenho (Configurações) > Avançado > Memória virtual**.

2. **Flags de Baixo Consumo do Chromium Nativas:**
   - O `browser.js` já aplica por padrão os argumentos `--disable-gpu`, `--disable-software-rasterizer`, `--renderer-process-limit=1`, `--js-flags=--max-old-space-size=128`, `--disk-cache-size=10485760` e `ALLOW_MEDIA=false` em execuções via `run_all.bat` e `run_all.ps1`.

3. **Limite de Heap do Node.js (`NODE_OPTIONS`):**
   - Para forçar o Garbage Collector do Node.js a manter o consumo compacto (256 MB):
     - No Prompt de Comando (CMD):
       ```cmd
       set "NODE_OPTIONS=--max-old-space-size=256" && set "NODE_COMPILE_CACHE=%TEMP%\ali-coins-compile-cache" && run_all.bat
       ```
     - No PowerShell:
       ```powershell
       $env:NODE_OPTIONS = "--max-old-space-size=256"
       $env:NODE_COMPILE_CACHE = Join-Path $env:TEMP "ali-coins-compile-cache"
       .\run_all.ps1
       ```

   > Os scripts `run_all.bat`/`run.ps1`/`run_tasks.*` já definem `NODE_OPTIONS` e `NODE_COMPILE_CACHE` (cache de bytecode V8 no `%TEMP%`) automaticamente.

4. **Reduzir o Custo Criptográfico do `scrypt`:**
   - No `credentials.env`, configure `SCRYPT_N=32768` (ou `16384`) para limitar o pico de derivação de chave de ~134 MB para ~33 MB durante a leitura/gravação da sessão `.enc`.
