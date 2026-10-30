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
call "%ROOT%\libs\i18n\scripts.bat" msg "   Instalacao e Configuracao: AliExpress Coin Collector (Windows)" "   Installation and Configuration: AliExpress Coin Collector (Windows)"
echo ======================================================================
echo.

REM 1. Verificar Node.js
call "%ROOT%\libs\i18n\scripts.bat" msg "[1/5] Verificando instalacao do Node.js..." "[1/5] Checking Node.js installation..."
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    call "%ROOT%\libs\i18n\scripts.bat" msg "[ERRO] Node.js nao foi encontrado no sistema!" "[ERROR] Node.js was not found on the system!"
    echo.
    call "%ROOT%\libs\i18n\scripts.bat" msg "Voce pode instalar o Node.js 22 LTS de duas formas:" "You can install Node.js 22 LTS in two ways:"
    call "%ROOT%\libs\i18n\scripts.bat" msg "1. Pelo terminal com winget:" "1. From the terminal with winget:"
    echo    winget install OpenJS.NodeJS.LTS
    call "%ROOT%\libs\i18n\scripts.bat" msg "2. Pelo site oficial: https://nodejs.org/" "2. From the official website: https://nodejs.org/"
    echo.
    call "%ROOT%\libs\i18n\scripts.bat" msg "Apos instalar, feche e abra novamente este terminal e execute o instalador." "After installing, close and reopen this terminal and run the installer."
    pause
    exit /b 1
)

REM Validar que a versao do Node.js e maior ou igual a 22
set NODE_MAJOR=0
for /f "delims=" %%v in ('node -e "console.log(process.versions.node.split('.')[0])" 2^>nul') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
    echo.
    for /f "delims=" %%v in ('node -v 2^>nul') do set CURRENT_NODE_VER=%%v
    call "%ROOT%\libs\i18n\scripts.bat" msg "[ERRO] Sua versao do Node.js (%%CURRENT_NODE_VER%%) e inferior a versao 22 minima necessaria!" "[ERROR] Your Node.js version (%%CURRENT_NODE_VER%%) is lower than the required minimum version 22!"
    call "%ROOT%\libs\i18n\scripts.bat" msg "Atualize para o Node.js 22 LTS via https://nodejs.org/ ou:" "Update to Node.js 22 LTS via https://nodejs.org/ or:"
    echo    winget install OpenJS.NodeJS.LTS
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do call "%ROOT%\libs\i18n\scripts.bat" msg "Node.js encontrado: %%v (compativel)" "Node.js found: %%v (compatible)"
for /f "delims=" %%v in ('npm -v') do call "%ROOT%\libs\i18n\scripts.bat" msg "npm encontrado: %%v" "npm found: %%v"

REM 2. Instalar dependencias npm
echo.
call "%ROOT%\libs\i18n\scripts.bat" msg "[2/5] Instalando dependencias do projeto (npm install)..." "[2/5] Installing project dependencies (npm install)..."
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    call "%ROOT%\libs\i18n\scripts.bat" msg "[ERRO] Falha ao executar 'npm install'. Verifique sua conexao e tente novamente." "[ERROR] Failed to run 'npm install'. Check your connection and try again."
    pause
    exit /b 1
)

REM 3. Instalar Chromium do Playwright
echo.
call "%ROOT%\libs\i18n\scripts.bat" msg "[3/5] Baixando binario do Chromium via Playwright..." "[3/5] Downloading the Chromium binary via Playwright..."
if exist "%ROOT%\node_modules\playwright\cli.js" (
    call node "%ROOT%\node_modules\playwright\cli.js" install chromium
) else (
    call npx playwright install chromium
)
if %ERRORLEVEL% NEQ 0 (
    echo.
    call "%ROOT%\libs\i18n\scripts.bat" msg "[ERRO] Falha ao baixar o Chromium. Verifique sua conexao e tente novamente." "[ERROR] Failed to download Chromium. Check your connection and try again."
    pause
    exit /b 1
)

REM 4. Configurar arquivo de credenciais
echo.
call "%ROOT%\libs\i18n\scripts.bat" msg "[4/5] Configurando arquivo de credenciais (credentials.env)..." "[4/5] Configuring credentials file (credentials.env)..."
if not exist "%ROOT%\credentials.env" (
    if exist "%ROOT%\credentials.env.example" (
        copy "%ROOT%\credentials.env.example" "%ROOT%\credentials.env" >nul
        call "%ROOT%\libs\i18n\scripts.bat" msg "Arquivo 'credentials.env' criado com sucesso a partir do modelo." "'credentials.env' file created successfully from the template."
    )
) else (
    call "%ROOT%\libs\i18n\scripts.bat" msg "Arquivo 'credentials.env' ja existente (mantido)." "'credentials.env' file already exists (kept)."
)

REM Aplicar restricoes de permissao de arquivo no Windows (somente usuario atual)
icacls "%ROOT%\credentials.env" /inheritance:r /grant:r "%USERNAME%:(R,W)" >nul 2>nul

REM Detectar openssl no PATH ou no Git for Windows para possibilitar uso opcional de "openssl rand -base64 32"
where openssl >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if exist "%ProgramFiles%\Git\usr\bin\openssl.exe" set "PATH=%ProgramFiles%\Git\usr\bin;%PATH%"
    if exist "%ProgramFiles(x86)%\Git\usr\bin\openssl.exe" set "PATH=%ProgramFiles(x86)%\Git\usr\bin;%PATH%"
    if exist "%LOCALAPPDATA%\Programs\Git\usr\bin\openssl.exe" set "PATH=%LOCALAPPDATA%\Programs\Git\usr\bin;%PATH%"
)

REM Gerar chave AES-256 de 32 bytes (Base64) se SESSION_SECRET estiver vazio
set "GEN_KEY="
where openssl >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    for /f "delims=" %%k in ('openssl rand -base64 32 2^>nul') do set "GEN_KEY=%%k"
)
if not defined GEN_KEY (
    for /f "delims=" %%k in ('node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" 2^>nul') do set "GEN_KEY=%%k"
)

if defined GEN_KEY (
    node -e "const fs=require('fs');const p=require('path').join('%ROOT%\','credentials.env');if(fs.existsSync(p)){let c=fs.readFileSync(p,'utf8');if(/SESSION_SECRET=\"\"/.test(c)){c=c.replace('SESSION_SECRET=\"\"','SESSION_SECRET=\"' + process.env.GEN_KEY + '\"');fs.writeFileSync(p,c,'utf8');console.log(process.env.ALI_LANG==='en'?'[OK] SESSION_SECRET key of 32 characters configured successfully.':'[OK] Chave SESSION_SECRET de 32 caracteres configurada com sucesso.');}}"
)

REM 5. Teste rapido do Chromium
echo.
call "%ROOT%\libs\i18n\scripts.bat" msg "[5/5] Testando inicializacao do Chromium no Windows..." "[5/5] Testing Chromium startup on Windows..."
node -e "const { chromium } = require('playwright'); chromium.launch({ headless: true }).then(function(b) { return b.close(); }).then(function() { process.exit(0); }).catch(function(e) { console.error(process.env.ALI_LANG==='en'?'[CHROMIUM ERROR]':'[ERRO CHROMIUM]', e && e.message ? e.message : e); process.exit(1); });"
if %ERRORLEVEL% EQU 0 (
    call "%ROOT%\libs\i18n\scripts.bat" msg "[OK] O navegador Chromium iniciou em modo headless com sucesso!" "[OK] The Chromium browser started successfully in headless mode!"
) else (
    echo.
    call "%ROOT%\libs\i18n\scripts.bat" msg "[AVISO] Nao foi possivel inicializar o Chromium em modo headless." "[WARNING] Could not start Chromium in headless mode."
    call "%ROOT%\libs\i18n\scripts.bat" msg "Se esta for uma instalacao nova do Windows ou maquina virtual," "If this is a new Windows installation or a virtual machine,"
    call "%ROOT%\libs\i18n\scripts.bat" msg "pode ser necessario instalar o Microsoft Visual C++ Redistributable 2015-2022:" "you may need to install Microsoft Visual C++ Redistributable 2015-2022:"
    echo.
    echo    winget install Microsoft.VCRedist.2015+.x64
    echo.
)

echo.
echo ======================================================================
call "%ROOT%\libs\i18n\scripts.bat" msg "          INSTALACAO CONCLUIDA COM SUCESSO!" "          INSTALLATION COMPLETED SUCCESSFULLY!"
echo ======================================================================
echo.
call "%ROOT%\libs\i18n\scripts.bat" msg "Proximos passos:" "Next steps:"
call "%ROOT%\libs\i18n\scripts.bat" msg " 1. Abra o arquivo 'credentials.env' no Bloco de Notas e preencha seus dados:" " 1. Open the 'credentials.env' file in Notepad and fill in your data:"
echo     notepad credentials.env
call "%ROOT%\libs\i18n\scripts.bat" msg "    (A chave SESSION_SECRET ja foi gerada de forma segura com 32 caracteres)." "    (The SESSION_SECRET key has already been generated securely with 32 characters)."
call "%ROOT%\libs\i18n\scripts.bat" msg "    Para gerar novas chaves futuramente:" "    To generate new keys in the future:"
echo       - Via OpenSSL: openssl rand -base64 32
call "%ROOT%\libs\i18n\scripts.bat" msg "      - Sem OpenSSL (Node nativo): scripts\generate_secret.bat" "      - Without OpenSSL (native Node): scripts\generate_secret.bat"
echo.
call "%ROOT%\libs\i18n\scripts.bat" msg " 2. Execute a automacao unificada (Check-in diario + Tarefas):" " 2. Run the unified automation (daily check-in + tasks):"
echo     run_all.bat
call "%ROOT%\libs\i18n\scripts.bat" msg "    (ou no PowerShell: .\run_all.ps1)" "    (or in PowerShell: .\run_all.ps1)"
echo.
echo ======================================================================
pause
