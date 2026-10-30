#!/usr/bin/env bash
# ==============================================================================
# AliExpress Coin Collector - Script de Instalação e Configuração para macOS
# Compatível com Apple Silicon (M1/M2/M3/M4) e processadores Intel
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

# Mensagens do instalador no idioma configurado (PT padrão, EN opcional).
. "$SCRIPT_DIR/libs/i18n/scripts.sh"

echo "======================================================================"
ali_msg "    Instalação e Configuração: AliExpress Coin Collector (macOS)" "    Installation and Configuration: AliExpress Coin Collector (macOS)"
echo "======================================================================"
echo ""

ARCH=$(uname -m)
ali_msg "Arquitetura detectada: $ARCH" "Detected architecture: $ARCH"

# 1. Verificar Node.js
ali_msg "[1/5] Verificando versão do Node.js..." "[1/5] Checking Node.js version..."
NEED_NODE_INSTALL=false

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/v//' | cut -d'.' -f1)
  if [ "$NODE_MAJOR" -lt 22 ]; then
    ali_msg "Versão do Node.js detectada ($NODE_MAJOR) é inferior à versão 22 mínima necessária." "Detected Node.js version ($NODE_MAJOR) is lower than the required minimum version 22."
    NEED_NODE_INSTALL=true
  else
    ali_msg "Node.js já instalado na versão $(node -v) (compatível)." "Node.js already installed at version $(node -v) (compatible)."
  fi
else
  ali_msg "Node.js não encontrado no sistema." "Node.js not found on the system."
  NEED_NODE_INSTALL=true
fi

if [ "$NEED_NODE_INSTALL" = true ]; then
  if command -v brew >/dev/null 2>&1; then
    ali_msg "Instalando Node.js via Homebrew..." "Installing Node.js via Homebrew..."
    brew install node
  else
    ali_msg "ERRO: Node.js >= 22 é obrigatório. Por favor, instale o Homebrew (https://brew.sh) ou baixe o instalador oficial do Node.js 22 LTS em https://nodejs.org/" "ERROR: Node.js >= 22 is required. Please install Homebrew (https://brew.sh) or download the official Node.js 22 LTS installer from https://nodejs.org/"
    exit 1
  fi
fi

# 2. Instalar dependências npm
ali_msg "[2/5] Instalando dependências do projeto (npm install)..." "[2/5] Installing project dependencies (npm install)..."
npm install

# 3. Instalar navegador Chromium do Playwright
ali_msg "[3/5] Baixando binário nativo do Chromium para $ARCH..." "[3/5] Downloading the native Chromium binary for $ARCH..."
if [ -f "$SCRIPT_DIR/node_modules/playwright/cli.js" ]; then
  node "$SCRIPT_DIR/node_modules/playwright/cli.js" install chromium
else
  npx playwright install chromium
fi

# 4. Permissões de scripts e arquivo de credenciais
ali_msg "[4/5] Ajustando permissões e credenciais..." "[4/5] Adjusting permissions and credentials..."
chmod +x "$SCRIPT_DIR"/*.sh "$SCRIPT_DIR"/scripts/*.sh 2>/dev/null || true

if [ ! -f "$SCRIPT_DIR/credentials.env" ]; then
  if [ -f "$SCRIPT_DIR/credentials.env.example" ]; then
    cp "$SCRIPT_DIR/credentials.env.example" "$SCRIPT_DIR/credentials.env"
    chmod 600 "$SCRIPT_DIR/credentials.env"
    ali_msg "Arquivo 'credentials.env' criado a partir do modelo." "'credentials.env' file created from the template."
  fi
else
  chmod 600 "$SCRIPT_DIR/credentials.env" 2>/dev/null || true
  ali_msg "Arquivo 'credentials.env' já existente (mantido)." "'credentials.env' file already exists (kept)."
fi
chmod 600 "$SCRIPT_DIR"/session* "$SCRIPT_DIR"/session_token.txt 2>/dev/null || true

# Gerar chave AES-256 de 32 bytes (Base64) se SESSION_SECRET estiver vazio
GEN_KEY=""
if command -v openssl >/dev/null 2>&1; then
  GEN_KEY="$(openssl rand -base64 32 2>/dev/null || true)"
fi
if [ -z "$GEN_KEY" ] && command -v node >/dev/null 2>&1; then
  GEN_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" 2>/dev/null || true)"
fi

if [ -n "$GEN_KEY" ] && [ -f "$SCRIPT_DIR/credentials.env" ]; then
  # A chave é passada por variável de ambiente (nunca no argv, que é visível via ps)
  SCRIPT_DIR="$SCRIPT_DIR" GEN_KEY="$GEN_KEY" node -e 'const fs=require("fs");const p=require("path").join(process.env.SCRIPT_DIR,"credentials.env");if(fs.existsSync(p)){let c=fs.readFileSync(p,"utf8");if(/SESSION_SECRET=""/.test(c)){c=c.replace("SESSION_SECRET=\"\"","SESSION_SECRET=\"" + process.env.GEN_KEY + "\"");fs.writeFileSync(p,c,"utf8");console.log(process.env.ALI_LANG==="en"?"[OK] SESSION_SECRET key of 32 characters generated and configured successfully.":"[OK] Chave SESSION_SECRET de 32 caracteres gerada e configurada com sucesso.");}}'
fi

# 5. Teste de inicialização do Chromium
ali_msg "[5/5] Testando inicialização do Chromium no macOS..." "[5/5] Testing Chromium startup on macOS..."
if node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); await b.close(); })();" 2>/dev/null; then
  ali_msg "✅ Sucesso: O navegador Chromium iniciou em modo headless com sucesso!" "✅ Success: The Chromium browser started successfully in headless mode!"
else
  ali_msg "⚠️ Aviso: O Chromium encontrou dificuldades ao iniciar." "⚠️ Warning: Chromium encountered difficulties starting."
fi

echo ""
echo "======================================================================"
ali_msg "          INSTALAÇÃO CONCLUÍDA COM SUCESSO!" "          INSTALLATION COMPLETED SUCCESSFULLY!"
echo "======================================================================"
echo ""
ali_msg "Próximos passos:" "Next steps:"
ali_msg " 1. Edite o arquivo 'credentials.env' com seus dados de login do AliExpress:" " 1. Edit the 'credentials.env' file with your AliExpress login details:"
echo "    nano credentials.env"
ali_msg "    (A chave SESSION_SECRET já foi gerada e configurada com 32 caracteres)." "    (The SESSION_SECRET key has already been generated and configured with 32 characters)."
echo ""
ali_msg " 2. Execute a automação unificada (Check-in diário + Tarefas):" " 2. Run the unified automation (daily check-in + tasks):"
echo "    ./run_all.sh"
ali_msg "    # ou via npm: npm start" "    # or via npm: npm start"
echo ""
echo "======================================================================"
