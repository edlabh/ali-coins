# Configurar suporte completo a UTF-8 no console e na comunicacao com processos externos
$null = chcp 65001
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Proteção contra OOM Killer fora do container: mesma folga de heap do Dockerfile.
if (-not $env:NODE_OPTIONS) { $env:NODE_OPTIONS = '--max-old-space-size=256' }

& node (Join-Path $ScriptDir "all.js") @args
exit $LASTEXITCODE
