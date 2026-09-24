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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   Instalacao e Configuracao: AliExpress Coin Collector (Windows/PS)  " -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verificar Node.js
Write-Host "[1/5] Verificando instalacao do Node.js..." -ForegroundColor Yellow
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host ""
    Write-Host "[ERRO] Node.js nao foi encontrado no sistema!" -ForegroundColor Red
    Write-Host "Voce pode instalar o Node.js 22 LTS de duas formas:"
    Write-Host "1. Pelo terminal com winget: winget install OpenJS.NodeJS.LTS"
    Write-Host "2. Pelo site oficial: https://nodejs.org/"
    Write-Host "Apos instalar, feche e abra novamente este terminal."
    Exit 1
}

$nodeVersion = (& node -v 2>$null).Trim()
$nodeMajor = [int](& node -e "console.log(process.versions.node.split('.')[0])" 2>$null)

if ($nodeMajor -lt 22) {
    Write-Host ""
    Write-Host "[ERRO] Sua versao do Node.js ($nodeVersion) e inferior a versao 22 minima necessaria!" -ForegroundColor Red
    Write-Host "Atualize para o Node.js 22 LTS via https://nodejs.org/ ou: winget install OpenJS.NodeJS.LTS"
    Exit 1
}

$npmVersion = (& npm -v 2>$null).Trim()
Write-Host "Node.js encontrado: $nodeVersion (compativel)" -ForegroundColor Green
Write-Host "npm encontrado: $npmVersion" -ForegroundColor Green

# 2. Instalar dependencias npm
Write-Host ""
Write-Host "[2/5] Instalando dependencias do projeto (npm install)..." -ForegroundColor Yellow
& npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERRO] Falha ao executar 'npm install'. Verifique sua conexao e tente novamente." -ForegroundColor Red
    Exit 1
}

# 3. Instalar Chromium do Playwright
Write-Host ""
Write-Host "[3/5] Baixando binario do Chromium via Playwright..." -ForegroundColor Yellow
$playwrightCli = Join-Path $ScriptDir "node_modules\playwright\cli.js"
if (Test-Path $playwrightCli) {
    & node $playwrightCli install chromium
} else {
    & npx playwright install chromium
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERRO] Falha ao baixar o Chromium via Playwright." -ForegroundColor Red
    Exit 1
}

# 4. Configurar arquivo de credenciais
Write-Host ""
Write-Host "[4/5] Configurando arquivo de credenciais (credentials.env)..." -ForegroundColor Yellow
$credFile = Join-Path $ScriptDir "credentials.env"
$credExample = Join-Path $ScriptDir "credentials.env.example"

if (-not (Test-Path $credFile)) {
    if (Test-Path $credExample) {
        Copy-Item -Path $credExample -Destination $credFile
        Write-Host "Arquivo 'credentials.env' criado com sucesso a partir do modelo." -ForegroundColor Green
    }
} else {
    Write-Host "Arquivo 'credentials.env' ja existente (mantido)." -ForegroundColor Cyan
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
        Write-Host "[OK] Chave SESSION_SECRET de 32 caracteres configurada com sucesso." -ForegroundColor Green
    }
}

# 5. Teste rapido do Chromium
Write-Host ""
Write-Host "[5/5] Testando inicializacao do Chromium no Windows..." -ForegroundColor Yellow
$testResult = & node -e "const { chromium } = require('playwright'); chromium.launch({ headless: true }).then(b => b.close()).then(() => process.exit(0)).catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); })" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] O navegador Chromium iniciou em modo headless com sucesso!" -ForegroundColor Green
} else {
    Write-Host "[AVISO] O Chromium encontrou dificuldades ao iniciar:" -ForegroundColor Yellow
    Write-Host "$testResult" -ForegroundColor DarkYellow
    Write-Host "Se for um Windows novo ou maquina virtual, pode ser necessario instalar o Visual C++ Redistributable:"
    Write-Host "winget install Microsoft.VCRedist.2015+.x64" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "          INSTALACAO CONCLUIDA COM SUCESSO!                           " -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Proximos passos:"
Write-Host " 1. Abra o arquivo 'credentials.env' e preencha seus dados de login:"
Write-Host "    notepad credentials.env"
Write-Host "    (A chave SESSION_SECRET ja foi gerada de forma segura com 32 caracteres)."
Write-Host "    Para gerar novas chaves futuramente:"
Write-Host "      - Via OpenSSL: openssl rand -base64 32"
Write-Host "      - Sem OpenSSL (Node nativo): .\generate_secret.ps1"
Write-Host ""
Write-Host " 2. Execute a automacao unificada (Check-in diario + Tarefas):"
Write-Host "    .\run_all.ps1   (ou run_all.bat)"
Write-Host ""
