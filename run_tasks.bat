@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

REM Protecao contra OOM Killer fora do container: mesma folga de heap do Dockerfile.
if not defined NODE_OPTIONS set "NODE_OPTIONS=--max-old-space-size=256"

REM Cache de bytecode V8 (Node 22+): arranque mais rapido (pasta no TEMP do usuario).
if not defined NODE_COMPILE_CACHE set "NODE_COMPILE_CACHE=%TEMP%\ali-coins-compile-cache"

node "%~dp0do_tasks.js" %*
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% NEQ 0 (
    echo.
    echo [ERRO] Execucao finalizada com codigo de erro %EXIT_CODE%.
    echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul
    if not errorlevel 1 pause
)

exit /b %EXIT_CODE%
