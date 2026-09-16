@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

node "%~dp0collect.js" %*
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% NEQ 0 (
    echo.
    echo [ERRO] Execucao finalizada com codigo de erro %EXIT_CODE%.
    echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul
    if not errorlevel 1 pause
)

exit /b %EXIT_CODE%
