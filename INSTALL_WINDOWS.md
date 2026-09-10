# Guia Detalhado de Instalação no Windows (Windows 10 e Windows 11)

Este manual descreve o passo a passo completo para instalar, configurar e rodar o **AliExpress Coin Collector & Task Runner** em sistemas **Windows 10** e **Windows 11** (64-bit), via Prompt de Comando (CMD) ou PowerShell.

---

## Sumário
1. [Requisitos Mínimos](#1-requisitos-m%C3%ADnimos)
2. [Método A: Instalação Automática (setup_windows.bat)](#2-m%C3%A9todo-a-instala%C3%A7%C3%A3o-autom%C3%A1tica-setup_windowsbat)
3. [Método B: Instalação Manual Passo a Passo](#3-m%C3%A9todo-b-instala%C3%A7%C3%A3o-manual-passo-a-passo)
   - [Passo 1: Instalação do Node.js 20 LTS](#passo-1-instala%C3%A7%C3%A3o-do-nodejs-20-lts)
   - [Passo 2: Baixar ou Clonar o Projeto](#passo-2-baixar-ou-clonar-o-projeto)
   - [Passo 3: Liberar Execução de Scripts no PowerShell (Se aplicável)](#passo-3-liberar-execu%C3%A7%C3%A3o-de-scripts-no-powershell-se-aplic%C3%A1vel)
   - [Passo 4: Instalar Dependências npm](#passo-4-instalar-depend%C3%AAncias-npm)
   - [Passo 5: Instalar o Navegador Chromium do Playwright](#passo-5-instalar-o-navegador-chromium-do-playwright)
   - [Passo 6: Teste de Validação do Chromium](#passo-6-teste-de-valida%C3%A7%C3%A3o-do-chromium)
   - [Passo 7: Configurar Credenciais](#passo-7-configurar-credenciais)
   - [Passo 8: Primeira Execução](#passo-8-primeira-execu%C3%A7%C3%A3o)
4. [Agendamento Automático Diário (Task Scheduler)](#4-agendamento-autom%C3%A1tico-di%C3%A1rio-task-scheduler)
   - [Opção 1: Criação Automática via PowerShell (1 Comando)](#op%C3%A7%C3%A3o-1-cria%C3%A7%C3%A3o-autom%C3%A1tica-via-powershell-1-comando)
   - [Opção 2: Criação Manual via Interface Gráfica](#op%C3%A7%C3%A3o-2-cria%C3%A7%C3%A3o-manual-via-interface-gr%C3%A1fica)
5. [Resolução de Problemas Frequentes no Windows](#5-resolu%C3%A7%C3%A3o-de-problemas-frequentes-no-windows)

---

## 1. Requisitos Mínimos

- **Sistema Operacional:** Windows 10 (versão 1809 ou superior) ou Windows 11 (64-bit).
- **Terminal:** Prompt de Comando (`cmd.exe`), PowerShell (`powershell.exe`) ou Windows Terminal.
- **Node.js:** Versão 18 ou 20 LTS (recomendada a versão 20 LTS).
- **Privilégios:** Acesso de usuário padrão (administrador necessário apenas para instalar o Node.js caso use o instalador global).

---

## 2. Método A: Instalação Automática (`setup_windows.bat`)

Se você já baixou ou clonou o projeto no seu computador:

1. Abra a pasta do projeto no **Explorador de Arquivos**.
2. Dê um duplo clique no arquivo **`setup_windows.bat`** (ou execute-o via CMD/PowerShell).
3. O script verificará sua versão do Node.js, executará o `npm install`, baixará o Chromium do Playwright, gerará o arquivo `credentials.env` e validará o funcionamento do navegador.
4. Ao final, abra o `credentials.env` no Bloco de Notas, coloque seu usuário e senha do AliExpress e execute `run_all.bat`.

---

## 3. Método B: Instalação Manual Passo a Passo

### Passo 1: Instalação do Node.js 20 LTS

O projeto necessita do **Node.js 18 ou superior**. A versão **Node.js 20 LTS** é a recomendada por sua estabilidade.

#### Opção 1: Via Gerenciador de Pacotes do Windows (`winget`)
Abra o Prompt de Comando ou PowerShell e digite:
```cmd
winget install OpenJS.NodeJS.LTS
```

#### Opção 2: Via Chocolatey
```cmd
choco install nodejs-lts
```

#### Opção 3: Pelo Site Oficial (Instalador .msi)
1. Acesse o site oficial: [https://nodejs.org/](https://nodejs.org/).
2. Baixe a versão recomendada **LTS** (instalador `.msi` para Windows x64).
3. Execute o instalador baixado e avance mantendo as opções padrão (certifique-se de que a opção **"Add to PATH"** esteja marcada).
4. Conclua a instalação.

> ⚠️ **IMPORTANTE:** Feche e abra novamente a janela do seu terminal (CMD ou PowerShell) após instalar o Node.js para que as novas variáveis de ambiente sejam carregadas.

#### Validar a instalação:
```cmd
node -v
npm -v
```
*(O comando `node -v` deve exibir `v20.x.x` ou superior, e o `npm -v` deve exibir versão 9 ou superior).*

---

### Passo 2: Baixar ou Clonar o Projeto

#### Via Git:
```cmd
git clone https://github.com/edlabh/ali-coins.git
cd ali-coins
```

#### Ou via Download ZIP:
1. No GitHub, clique em **Code** > **Download ZIP**.
2. Extraia o arquivo ZIP em uma pasta de sua escolha (exemplo: `C:\Users\SeuUsuario\ali-coins`).
3. Abra o terminal nessa pasta.

---

### Passo 3: Liberar Execução de Scripts no PowerShell (Se aplicável)

Se você utiliza o **PowerShell** e ao tentar rodar um script receber o erro:
> *`O arquivo ... não pode ser carregado porque a execução de scripts foi desabilitada neste sistema.`*

Execute o comando abaixo no PowerShell para liberar a execução de scripts locais para o seu usuário:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

### Passo 4: Instalar Dependências npm

No Prompt de Comando ou PowerShell, dentro da pasta do projeto:
```cmd
npm install
```
Isso instalará a biblioteca do **Playwright** (`^1.48.0`) na pasta local `node_modules`.

---

### Passo 5: Instalar o Navegador Chromium do Playwright

O Playwright gerencia o navegador em uma pasta isolada no seu perfil de usuário (`%USERPROFILE%\AppData\Local\ms-playwright`).

Execute:
```cmd
npx playwright install chromium
```

> No Windows, todas as bibliotecas necessárias para o Chromium já acompanham o instalador do sistema ou o próprio binário do Playwright. Caso seu Windows seja uma instalação limpa ou corporativa muito recente e apresente erro de DLL ausente, instale o pacote de redistribuição da Microsoft:
> ```cmd
> winget install Microsoft.VCRedist.2015+.x64
> ```

---

### Passo 6: Teste de Validação do Chromium

Para confirmar que o Chromium abre perfeitamente em segundo plano (headless):

- **No Prompt de Comando (CMD):**
  ```cmd
  node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); console.log('Chromium OK!'); await b.close(); })();"
  ```

- **No PowerShell:**
  ```powershell
  node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); console.log('Chromium OK!'); await b.close(); })();"
  ```

Se a saída exibir `Chromium OK!`, o ambiente está validado.

---

### Passo 7: Configurar Credenciais

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

3. Preencha seu usuário e senha do AliExpress:
   ```env
   ALI_USER="seu_email_ou_telefone"
   ALI_PASSWORD="sua_senha"
   ```
   *Salve o arquivo (`Ctrl + S`) e feche o Bloco de Notas.*

---

### Passo 8: Primeira Execução

- **Modo Unificado (Recomendado - Check-in diário + Tarefas):**
  - No CMD: `run_all.bat`
  - No PowerShell: `.\run_all.ps1`
  - Via npm: `npm start` (ou `npm run all`)

- **Apenas Check-in:**
  - No CMD: `run.bat`
  - No PowerShell: `.\run.ps1`

- **Apenas Tarefas:**
  - No CMD: `run_tasks.bat`
  - No PowerShell: `.\run_tasks.ps1`

---

## 4. Agendamento Automático Diário (Task Scheduler)

Para coletar as moedas todos os dias de forma 100% automática no Windows:

### Opção 1: Criação Automática via PowerShell (1 Comando)

Abra o PowerShell dentro da pasta do projeto e execute o comando abaixo (exemplo para rodar todo dia às **08:00**):

```powershell
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c run_all.bat >> coins_daily.log 2>&1" -WorkingDirectory "$PWD"
$trigger = New-ScheduledTaskTrigger -Daily -At 8:00AM
Register-ScheduledTask -TaskName "AliExpressCoinsCollector" -Action $action -Trigger $trigger -Description "Coleta diária de moedas do AliExpress"
```

A tarefa será criada imediatamente no Agendador de Tarefas do Windows.

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

## 5. Resolução de Problemas Frequentes no Windows

### A. `'node' ou 'npm' não é reconhecido como um comando interno ou externo`
- **Causa:** O instalador do Node.js não foi adicionado à variável de ambiente `PATH` ou o terminal foi aberto antes da instalação ser finalizada.
- **Solução:** Feche todas as janelas do Prompt de Comando/PowerShell e abra uma nova. Se persistir, reinicie o computador.

### B. `O arquivo ... não pode ser carregado porque a execução de scripts foi desabilitada neste sistema`
- **Causa:** Política de segurança padrão do PowerShell (*ExecutionPolicy Restricted*).
- **Solução:** Execute no PowerShell:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

### C. Alerta do Windows Defender / SmartScreen
- **Causa:** Como o Playwright executa uma versão headless do Chromium em segundo plano automatizando ações de teclado/mouse, softwares antivírus excessivamente rigorosos podem emitir um aviso na primeira inicialização.
- **Solução:** Se o Windows exibir a tela de proteção SmartScreen, clique em **"Mais informações"** e depois em **"Executar assim mesmo"**.

### D. Erro de Caminhos Longos (`Filename too long` / MAX_PATH)
- **Causa:** O Windows historicamente limita caminhos de arquivos a 260 caracteres.
- **Solução:** Execute o comando abaixo no PowerShell (como Administrador) para habilitar suporte a caminhos longos:
  ```powershell
  New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
  ```

---
