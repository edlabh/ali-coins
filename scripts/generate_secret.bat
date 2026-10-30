@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "ROOT=%CD%"

REM Idioma dos scripts: APP_LANGUAGE, credentials.env ou --lang=...
set "ALI_LANG=%APP_LANGUAGE%"
if not defined ALI_LANG if defined BOT_LANGUAGE set "ALI_LANG=%BOT_LANGUAGE%"
if not defined ALI_LANG if exist "%ROOT%\credentials.env" for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%\credentials.env") do if /i "%%A"=="APP_LANGUAGE" set "ALI_LANG=%%~B"
echo %* | findstr /i /r /c:"--lang en" /c:"--lang=en" >nul && set "ALI_LANG=en"
echo %* | findstr /i /r /c:"--lang pt" /c:"--lang=pt" >nul && set "ALI_LANG=pt"
if /i "%ALI_LANG%"=="en" (set "ALI_LANG=en") else (set "ALI_LANG=pt")

echo ======================================================================
call "%ROOT%\libs\i18n\scripts.bat" msg "   Gerador de Chave de Criptografia AES-256 (SESSION_SECRET)" "   AES-256 Encryption Key Generator (SESSION_SECRET)"
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
        if defined SECRET if /i "%ALI_LANG%"=="en" (set "METHOD=Native Node.js Crypto (no need to install OpenSSL)") else (set "METHOD=Node.js Crypto nativo (sem necessidade de instalar OpenSSL)")
    )
)

REM 3. Fallback adicional via PowerShell caso Node e OpenSSL nao estejam prontos
if not defined SECRET (
    for /f "delims=" %%k in ('powershell -NoProfile -Command "[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))" 2^>nul') do set "SECRET=%%k"
    if defined SECRET if /i "%ALI_LANG%"=="en" (set "METHOD=Native PowerShell Cryptography") else (set "METHOD=PowerShell Cryptography nativo")
)

if defined SECRET (
    call "%ROOT%\libs\i18n\scripts.bat" msg "[Metodo utilizado: %METHOD%]" "[Method used: %METHOD%]"
    echo.
    call "%ROOT%\libs\i18n\scripts.bat" msg "Chave de 32 bytes (Base64) gerada com sucesso:" "32-byte key (Base64) generated successfully:"
    echo.
    echo    %SECRET%
    echo.
    call "%ROOT%\libs\i18n\scripts.bat" msg "Copie o valor acima e cole na variavel SESSION_SECRET do arquivo credentials.env:" "Copy the value above and paste it into the SESSION_SECRET variable in credentials.env:"
    echo    SESSION_SECRET="%SECRET%"
) else (
    call "%ROOT%\libs\i18n\scripts.bat" msg "[ERRO] Nao foi possivel gerar a chave automaticamente." "[ERROR] Could not generate the key automatically."
    call "%ROOT%\libs\i18n\scripts.bat" msg "Certifique-se de ter o Node.js 22 ou OpenSSL instalado." "Make sure Node.js 22 or OpenSSL is installed."
)

echo.
echo ======================================================================
echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul
if not errorlevel 1 pause
