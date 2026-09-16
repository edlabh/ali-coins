@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ======================================================================
echo    Instalacao e Configuracao: AliExpress Coin Collector (Windows)
echo ======================================================================
echo.

REM 1. Verificar Node.js
echo [1/5] Verificando instalacao do Node.js...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRO] Node.js nao foi encontrado no sistema!
    echo.
    echo Voce pode instalar o Node.js 22 LTS de duas formas:
    echo 1. Pelo terminal com winget:
    echo    winget install OpenJS.NodeJS.LTS
    echo 2. Pelo site oficial: https://nodejs.org/
    echo.
    echo Apos instalar, feche e abra novamente este terminal e execute o instalador.
    pause
    exit /b 1
)

REM Validar que a versao do Node.js e maior ou igual a 22
set NODE_MAJOR=0
for /f "delims=" %%v in ('node -e "console.log(process.versions.node.split('.')[0])" 2^>nul') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
    echo.
    for /f "delims=" %%v in ('node -v 2^>nul') do set CURRENT_NODE_VER=%%v
    echo [ERRO] Sua versao do Node.js (%%CURRENT_NODE_VER%%) e inferior a versao 22 minima necessaria!
    echo Atualize para o Node.js 22 LTS via https://nodejs.org/ ou:
    echo    winget install OpenJS.NodeJS.LTS
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo Node.js encontrado: %%v (compativel)
for /f "delims=" %%v in ('npm -v') do echo npm encontrado: %%v

REM 2. Instalar dependencias npm
echo.
echo [2/5] Instalando dependencias do projeto (npm install)...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRO] Falha ao executar 'npm install'. Verifique sua conexao e tente novamente.
    pause
    exit /b 1
)

REM 3. Instalar Chromium do Playwright
echo.
echo [3/5] Baixando binario do Chromium via Playwright...
if exist "%~dp0node_modules\playwright\cli.js" (
    call node "%~dp0node_modules\playwright\cli.js" install chromium
) else (
    call npx playwright install chromium
)
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRO] Falha ao baixar o Chromium. Verifique sua conexao e tente novamente.
    pause
    exit /b 1
)

REM 4. Configurar arquivo de credenciais
echo.
echo [4/5] Configurando arquivo de credenciais (credentials.env)...
if not exist "%~dp0credentials.env" (
    if exist "%~dp0credentials.env.example" (
        copy "%~dp0credentials.env.example" "%~dp0credentials.env" >nul
        echo Arquivo 'credentials.env' criado com sucesso a partir do modelo.
    )
) else (
    echo Arquivo 'credentials.env' ja existente (mantido).
)

REM Aplicar restricoes de permissao de arquivo no Windows (somente usuario atual)
icacls "%~dp0credentials.env" /inheritance:r /grant:r "%USERNAME%:(R,W)" >nul 2>nul

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
    node -e "const fs=require('fs');const p=require('path').join('%~dp0','credentials.env');if(fs.existsSync(p)){let c=fs.readFileSync(p,'utf8');if(/SESSION_SECRET=\"\"/.test(c)){c=c.replace('SESSION_SECRET=\"\"','SESSION_SECRET=\"' + process.env.GEN_KEY + '\"');fs.writeFileSync(p,c,'utf8');console.log('[OK] Chave SESSION_SECRET de 32 caracteres configurada com sucesso.');}}"
)

REM 5. Teste rapido do Chromium
echo.
echo [5/5] Testando inicializacao do Chromium no Windows...
node -e "const { chromium } = require('playwright'); chromium.launch({ headless: true }).then(function(b) { return b.close(); }).then(function() { process.exit(0); }).catch(function(e) { console.error('[ERRO CHROMIUM]', e && e.message ? e.message : e); process.exit(1); });"
if %ERRORLEVEL% EQU 0 (
    echo [OK] O navegador Chromium iniciou em modo headless com sucesso!
) else (
    echo.
    echo [AVISO] Nao foi possivel inicializar o Chromium em modo headless.
    echo Se esta for uma instalacao nova do Windows ou maquina virtual,
    echo pode ser necessario instalar o Microsoft Visual C++ Redistributable 2015-2022:
    echo.
    echo    winget install Microsoft.VCRedist.2015+.x64
    echo.
)

echo.
echo ======================================================================
echo          INSTALACAO CONCLUIDA COM SUCESSO!
echo ======================================================================
echo.
echo Proximos passos:
echo  1. Abra o arquivo 'credentials.env' no Bloco de Notas e preencha seus dados:
echo     notepad credentials.env
echo     (A chave SESSION_SECRET ja foi gerada de forma segura com 32 caracteres).
echo     Para gerar novas chaves futuramente:
echo       - Via OpenSSL: openssl rand -base64 32
echo       - Sem OpenSSL (Node nativo): generate_secret.bat
echo.
echo  2. Execute a automacao unificada (Check-in diario + Tarefas):
echo     run_all.bat
echo     (ou no PowerShell: .\run_all.ps1)
echo.
echo ======================================================================
pause
