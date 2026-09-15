@echo off
setlocal
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
node -e "const v = parseInt(process.versions.node.split('.')[0], 10); if (isNaN(v) || v < 22) process.exit(1);" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
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

REM 5. Teste rapido do Chromium
echo.
echo [5/5] Testando inicializacao do Chromium no Windows...
node -e "const { chromium } = require('playwright'); chromium.launch({ headless: true }).then(b => b.close()).then(() => process.exit(0)).catch(e => { console.error('[ERRO CHROMIUM]', e.message || e); process.exit(1); })"
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
echo.
echo  2. Execute a automacao unificada (Check-in diario + Tarefas):
echo     run_all.bat
echo     (ou no PowerShell: .\run_all.ps1)
echo.
echo ======================================================================
pause
