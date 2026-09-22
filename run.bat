@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

REM Protecao contra OOM Killer fora do container: mesma folga de heap do Dockerfile.
if not defined NODE_OPTIONS set "NODE_OPTIONS=--max-old-space-size=256"

node "%~dp0collect.js" %*
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% NEQ 0 (
    echo.
    echo [ERRO] Execucao finalizada com codigo de erro %EXIT_CODE%.
    echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul
    if not errorlevel 1 pause
)

exit /b %EXIT_CODE%
