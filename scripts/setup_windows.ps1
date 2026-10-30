<#
.SYNOPSIS
    Script de instalacao e configuracao do AliExpress Coin Collector para Windows (PowerShell).
.DESCRIPTION
    Verifica se o Node.js >= 22 esta instalado, executa npm install, baixa o Chromium via Playwright,
    prepara credentials.env e valida a inicializacao headless do navegador.
#>

$ErrorActionPreference = "Stop"

# Configurar suporte UTF-8 no console e na integracao com executaveis externos
$null = chcp 65001
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ScriptDir

# Mensagens do instalador no idioma configurado (PT padrao, EN opcional).
. (Join-Path $ScriptDir "libs/i18n/scripts.ps1")
Initialize-AliLanguage -Root $ScriptDir -Arguments $args

Write-Host "======================================================================" -ForegroundColor Cyan
Write-AliMsg "   Instalacao e Configuracao: AliExpress Coin Collector (Windows/PS)  " "   Installation and Configuration: AliExpress Coin Collector (Windows/PS)  " -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verificar Node.js
Write-AliMsg "[1/5] Verificando instalacao do Node.js..." "[1/5] Checking Node.js installation..." -ForegroundColor Yellow
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host ""
    Write-AliMsg "[ERRO] Node.js nao foi encontrado no sistema!" "[ERROR] Node.js was not found on the system!" -ForegroundColor Red
    Write-AliMsg "Voce pode instalar o Node.js 22 LTS de duas formas:" "You can install Node.js 22 LTS in two ways:"
    Write-AliMsg "1. Pelo terminal com winget: winget install OpenJS.NodeJS.LTS" "1. From the terminal with winget: winget install OpenJS.NodeJS.LTS"
    Write-AliMsg "2. Pelo site oficial: https://nodejs.org/" "2. From the official website: https://nodejs.org/"
    Write-AliMsg "Apos instalar, feche e abra novamente este terminal." "After installing, close and reopen this terminal."
    Exit 1
}

$nodeVersion = (& node -v 2>$null).Trim()
$nodeMajor = [int](& node -e "console.log(process.versions.node.split('.')[0])" 2>$null)

if ($nodeMajor -lt 22) {
    Write-Host ""
    Write-AliMsg "[ERRO] Sua versao do Node.js ($nodeVersion) e inferior a versao 22 minima necessaria!" "[ERROR] Your Node.js version ($nodeVersion) is lower than the required minimum version 22!" -ForegroundColor Red
    Write-AliMsg "Atualize para o Node.js 22 LTS via https://nodejs.org/ ou: winget install OpenJS.NodeJS.LTS" "Update to Node.js 22 LTS via https://nodejs.org/ or: winget install OpenJS.NodeJS.LTS"
    Exit 1
}

$npmVersion = (& npm -v 2>$null).Trim()
Write-AliMsg "Node.js encontrado: $nodeVersion (compativel)" "Node.js found: $nodeVersion (compatible)" -ForegroundColor Green
Write-AliMsg "npm encontrado: $npmVersion" "npm found: $npmVersion" -ForegroundColor Green
# 2. Instalar dependencias npm
Write-Host ""
Write-AliMsg "[2/5] Instalando dependencias do projeto (npm install)..." "[2/5] Installing project dependencies (npm install)..." -ForegroundColor Yellow
& npm install
if ($LASTEXITCODE -ne 0) {
    Write-AliMsg "[ERRO] Falha ao executar 'npm install'. Verifique sua conexao e tente novamente." "[ERROR] Failed to run 'npm install'. Check your connection and try again." -ForegroundColor Red
    Exit 1
}

# 3. Instalar Chromium do Playwright
Write-Host ""
Write-AliMsg "[3/5] Baixando binario do Chromium via Playwright..." "[3/5] Downloading the Chromium binary via Playwright..." -ForegroundColor Yellow
$playwrightCli = Join-Path $ScriptDir "node_modules\playwright\cli.js"
if (Test-Path $playwrightCli) {
    & node $playwrightCli install chromium
} else {
    & npx playwright install chromium
}
if ($LASTEXITCODE -ne 0) {
    Write-AliMsg "[ERRO] Falha ao baixar o Chromium via Playwright." "[ERROR] Failed to download Chromium via Playwright." -ForegroundColor Red
    Exit 1
}

# 4. Configurar arquivo de credenciais
Write-Host ""
Write-AliMsg "[4/5] Configurando arquivo de credenciais (credentials.env)..." "[4/5] Configuring credentials file (credentials.env)..." -ForegroundColor Yellow
$credFile = Join-Path $ScriptDir "credentials.env"
$credExample = Join-Path $ScriptDir "credentials.env.example"

if (-not (Test-Path $credFile)) {
    if (Test-Path $credExample) {
        Copy-Item -Path $credExample -Destination $credFile
        Write-AliMsg "Arquivo 'credentials.env' criado com sucesso a partir do modelo." "'credentials.env' file created successfully from the template." -ForegroundColor Green
    }
} else {
    Write-AliMsg "Arquivo 'credentials.env' ja existente (mantido)." "'credentials.env' file already exists (kept)." -ForegroundColor Cyan
}

# Detectar openssl no PATH ou no Git for Windows para possibilitar uso opcional de 'openssl rand -base64 32'
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    $gitPaths = @(
        "$env:ProgramFiles\Git\usr\bin\openssl.exe",
        "${env:ProgramFiles(x86)}\Git\usr\bin\openssl.exe",
        "$env:LOCALAPPDATA\Programs\Git\usr\bin\openssl.exe"
    )
    foreach ($p in $gitPaths) {
        if (Test-Path $p) {
            $gitBin = Split-Path -Parent $p
            $env:PATH = "$gitBin;$env:PATH"
            break
        }
    }
}

$genKey = $null
if (Get-Command openssl -ErrorAction SilentlyContinue) {
    try {
        $genKey = (& openssl rand -base64 32 2>$null).Trim()
    } catch {}
}
if (-not $genKey -and (Get-Command node -ErrorAction SilentlyContinue)) {
    try {
        $genKey = (& node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" 2>$null).Trim()
    } catch {}
}
if (-not $genKey) {
    try {
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes)
        $genKey = [Convert]::ToBase64String($bytes)
    } catch {}
}

if ($genKey -and (Test-Path $credFile)) {
    $content = Get-Content -Path $credFile -Raw
    if ($content -match 'SESSION_SECRET=""') {
        $content = $content -replace 'SESSION_SECRET=""', "SESSION_SECRET=`"$genKey`""
        [System.IO.File]::WriteAllText($credFile, $content, [System.Text.Encoding]::UTF8)
        Write-AliMsg "[OK] Chave SESSION_SECRET de 32 caracteres configurada com sucesso." "[OK] SESSION_SECRET key of 32 characters configured successfully." -ForegroundColor Green
    }
}

# 5. Teste rapido do Chromium
Write-Host ""
Write-AliMsg "[5/5] Testando inicializacao do Chromium no Windows..." "[5/5] Testing Chromium startup on Windows..." -ForegroundColor Yellow
$testResult = & node -e "const { chromium } = require('playwright'); chromium.launch({ headless: true }).then(b => b.close()).then(() => process.exit(0)).catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); })" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-AliMsg "[OK] O navegador Chromium iniciou em modo headless com sucesso!" "[OK] The Chromium browser started successfully in headless mode!" -ForegroundColor Green
} else {
    Write-AliMsg "[AVISO] O Chromium encontrou dificuldades ao iniciar:" "[WARNING] Chromium encountered difficulties starting:" -ForegroundColor Yellow
    Write-Host "$testResult" -ForegroundColor DarkYellow
    Write-AliMsg "Se for um Windows novo ou maquina virtual, pode ser necessario instalar o Visual C++ Redistributable:" "If this is a new Windows installation or a virtual machine, you may need to install the Visual C++ Redistributable:"
    Write-Host "winget install Microsoft.VCRedist.2015+.x64" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-AliMsg "          INSTALACAO CONCLUIDA COM SUCESSO!                           " "          INSTALLATION COMPLETED SUCCESSFULLY!                          " -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""
Write-AliMsg "Proximos passos:" "Next steps:"
Write-AliMsg " 1. Abra o arquivo 'credentials.env' e preencha seus dados de login:" " 1. Open the 'credentials.env' file and fill in your login data:"
Write-Host "    notepad credentials.env"
Write-AliMsg "    (A chave SESSION_SECRET ja foi gerada de forma segura com 32 caracteres)." "    (The SESSION_SECRET key has already been generated securely with 32 characters)."
Write-AliMsg "    Para gerar novas chaves futuramente:" "    To generate new keys in the future:"
Write-AliMsg "      - Via OpenSSL: openssl rand -base64 32" "      - Via OpenSSL: openssl rand -base64 32"
Write-AliMsg "      - Sem OpenSSL (Node nativo): .\scripts\generate_secret.ps1" "      - Without OpenSSL (native Node): .\scripts\generate_secret.ps1"
Write-Host ""
Write-AliMsg " 2. Execute a automacao unificada (Check-in diario + Tarefas):" " 2. Run the unified automation (daily check-in + tasks):"
Write-AliMsg "    .\run_all.ps1   (ou run_all.bat)" "    .\run_all.ps1   (or run_all.bat)"
Write-Host ""
