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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   Gerador de Chave de Criptografia AES-256 (SESSION_SECRET)         " -ForegroundColor Cyan
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
        if ($secret) { $method = "Node.js Crypto nativo (sem necessidade de instalar OpenSSL)" }
    } catch {}
}

# Solucao complementar: PowerShell .NET Cryptography nativo
if (-not $secret) {
    try {
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes)
        $secret = [Convert]::ToBase64String($bytes)
        $method = "PowerShell .NET Cryptography nativo"
    } catch {}
}

if ($secret) {
    Write-Host "[Metodo utilizado: $method]" -ForegroundColor Green
    Write-Host ""
    Write-Host "Chave de 32 bytes (Base64) gerada com sucesso:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   $secret" -ForegroundColor White
    Write-Host ""
    Write-Host "Copie o valor acima e cole na variavel SESSION_SECRET do arquivo credentials.env:" -ForegroundColor Cyan
    Write-Host "   SESSION_SECRET=`"$secret`"" -ForegroundColor Cyan
} else {
    Write-Host "[ERRO] Nao foi possivel gerar a chave automaticamente." -ForegroundColor Red
    Write-Host "Certifique-se de ter o Node.js 22 ou OpenSSL instalado."
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
