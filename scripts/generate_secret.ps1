<#
.SYNOPSIS
    Gerador de chaves criptograficas AES-256 (SESSION_SECRET) para Windows PowerShell.
.DESCRIPTION
    Gera uma chave aleatoria forte de 32 bytes codificada em Base64.
    Suporta opcionalmente OpenSSL ('openssl rand -base64 32'), fallback nativo via Node.js crypto
    ou .NET RandomNumberGenerator, sem obrigar o usuario a instalar ferramentas externas.
#>

$null = chcp 65001
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ScriptDir

# Mensagens no idioma configurado (PT padrao, EN opcional).
. (Join-Path $ScriptDir "libs/i18n/scripts.ps1")
Initialize-AliLanguage -Root $ScriptDir -Arguments $args

Write-Host "======================================================================" -ForegroundColor Cyan
Write-AliMsg "   Gerador de Chave de Criptografia AES-256 (SESSION_SECRET)         " "   AES-256 Encryption Key Generator (SESSION_SECRET)                " -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verificar se openssl esta no PATH ou no Git for Windows
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

$secret = $null
$method = $null

# Tentar OpenSSL
if (Get-Command openssl -ErrorAction SilentlyContinue) {
    try {
        $secret = (& openssl rand -base64 32 2>$null).Trim()
        if ($secret) { $method = "OpenSSL (openssl rand -base64 32)" }
    } catch {}
}

# Solucao complementar: Node.js Crypto nativo (sem necessidade de instalar OpenSSL)
if (-not $secret -and (Get-Command node -ErrorAction SilentlyContinue)) {
    try {
        $secret = (& node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" 2>$null).Trim()
        if ($secret) {
            $method = if ($script:AliLang -eq 'en') { "Native Node.js Crypto (no need to install OpenSSL)" } else { "Node.js Crypto nativo (sem necessidade de instalar OpenSSL)" }
        }
    } catch {}
}

# Solucao complementar: PowerShell .NET Cryptography nativo
if (-not $secret) {
    try {
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes)
        $secret = [Convert]::ToBase64String($bytes)
        $method = if ($script:AliLang -eq 'en') { "Native PowerShell .NET Cryptography" } else { "PowerShell .NET Cryptography nativo" }
    } catch {}
}

if ($secret) {
    Write-AliMsg "[Metodo utilizado: $method]" "[Method used: $method]" -ForegroundColor Green
    Write-Host ""
    Write-AliMsg "Chave de 32 bytes (Base64) gerada com sucesso:" "32-byte key (Base64) generated successfully:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   $secret" -ForegroundColor White
    Write-Host ""
    Write-AliMsg "Copie o valor acima e cole na variavel SESSION_SECRET do arquivo credentials.env:" "Copy the value above and paste it into the SESSION_SECRET variable in credentials.env:" -ForegroundColor Cyan
    Write-Host "   SESSION_SECRET=`"$secret`"" -ForegroundColor Cyan
} else {
    Write-AliMsg "[ERRO] Nao foi possivel gerar a chave automaticamente." "[ERROR] Could not generate the key automatically." -ForegroundColor Red
    Write-AliMsg "Certifique-se de ter o Node.js 22 ou OpenSSL instalado." "Make sure Node.js 22 or OpenSSL is installed."
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
