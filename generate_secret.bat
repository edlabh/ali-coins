@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ======================================================================
echo    Gerador de Chave de Criptografia AES-256 (SESSION_SECRET)
echo ======================================================================
echo.

set "SECRET="
set "METHOD="

REM 1. Verificar se openssl esta no PATH ou no Git for Windows
where openssl >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if exist "%ProgramFiles%\Git\usr\bin\openssl.exe" set "PATH=%ProgramFiles%\Git\usr\bin;%PATH%"
    if exist "%ProgramFiles(x86)%\Git\usr\bin\openssl.exe" set "PATH=%ProgramFiles(x86)%\Git\usr\bin;%PATH%"
    if exist "%LOCALAPPDATA%\Programs\Git\usr\bin\openssl.exe" set "PATH=%LOCALAPPDATA%\Programs\Git\usr\bin;%PATH%"
)

where openssl >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    for /f "delims=" %%k in ('openssl rand -base64 32 2^>nul') do set "SECRET=%%k"
    if defined SECRET set "METHOD=OpenSSL (openssl rand -base64 32)"
)

REM 2. Solucao complementar nativa via Node.js (sem necessidade de instalar OpenSSL)
if not defined SECRET (
    where node >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        for /f "delims=" %%k in ('node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" 2^>nul') do set "SECRET=%%k"
        if defined SECRET set "METHOD=Node.js Crypto nativo (sem necessidade de instalar OpenSSL)"
    )
)

REM 3. Fallback adicional via PowerShell caso Node e OpenSSL nao estejam prontos
if not defined SECRET (
    for /f "delims=" %%k in ('powershell -NoProfile -Command "[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))" 2^>nul') do set "SECRET=%%k"
    if defined SECRET set "METHOD=PowerShell Cryptography nativo"
)

if defined SECRET (
    echo [Metodo utilizado: %METHOD%]
    echo.
    echo Chave de 32 bytes (Base64) gerada com sucesso:
    echo.
    echo    %SECRET%
    echo.
    echo Copie o valor acima e cole na variavel SESSION_SECRET do arquivo credentials.env:
    echo    SESSION_SECRET="%SECRET%"
) else (
    echo [ERRO] Nao foi possivel gerar a chave automaticamente.
    echo Certifique-se de ter o Node.js 22 ou OpenSSL instalado.
)

echo.
echo ======================================================================
echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul
if not errorlevel 1 pause
