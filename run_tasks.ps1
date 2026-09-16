# Configurar suporte completo a UTF-8 no console e na comunicacao com processos externos
$null = chcp 65001
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

& node (Join-Path $ScriptDir "do_tasks.js") @args
exit $LASTEXITCODE
