#!/usr/bin/env bash
# ==============================================================================
# AliExpress Coin Collector - Script de Instalação e Configuração para Linux
# Compatível com Ubuntu 20.04, 22.04, 24.04 e Debian 11/12
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

# Mensagens do instalador no idioma configurado (PT padrão, EN opcional).
. "$SCRIPT_DIR/libs/i18n/scripts.sh"

echo "======================================================================"
ali_msg "    Instalação e Configuração: AliExpress Coin Collector (Linux)" "    Installation and Configuration: AliExpress Coin Collector (Linux)"
echo "======================================================================"
echo ""

# Determinar comando sudo se não for root
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    ali_msg "ERRO: Este instalador requer privilégios de root ou comando 'sudo'." "ERROR: This installer requires root privileges or the 'sudo' command."
    exit 1
  fi
fi

# 1. Verificar e instalar ferramentas essenciais (curl, git, ca-certificates)
ali_msg "[1/8] Verificando ferramentas básicas do sistema..." "[1/8] Checking basic system tools..."
if ! command -v curl >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  ali_msg "Instalando curl, git e utilitários..." "Installing curl, git, and utilities..."
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq curl git ca-certificates gnupg
fi

# 2. Verificar versão do Node.js
ali_msg "[2/8] Verificando versão do Node.js..." "[2/8] Checking Node.js version..."
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
  ali_msg "Instalando Node.js 22 LTS via repositório oficial NodeSource..." "Installing Node.js 22 LTS via the official NodeSource repository..."
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y -qq nodejs
  ali_msg "Node.js instalado com sucesso: $(node -v)" "Node.js installed successfully: $(node -v)"
fi

# 3. Instalar dependências npm
ali_msg "[3/8] Instalando dependências do projeto (npm install)..." "[3/8] Installing project dependencies (npm install)..."
npm install

# 4. Instalar navegador Chromium do Playwright
ali_msg "[4/8] Baixando binário do Chromium via Playwright..." "[4/8] Downloading the Chromium binary via Playwright..."
if [ -f "$SCRIPT_DIR/node_modules/playwright/cli.js" ]; then
  node "$SCRIPT_DIR/node_modules/playwright/cli.js" install chromium
else
  npx playwright install chromium
fi

# 5. Instalar dependências de sistema para o Chromium no Linux
ali_msg "[5/8] Instalando bibliotecas do sistema para o Chromium..." "[5/8] Installing system libraries for Chromium..."
INSTALL_DEPS_SUCCESS=false
if [ -n "$SUDO" ]; then
  if $SUDO env "PATH=$PATH" npx playwright install-deps chromium; then
    INSTALL_DEPS_SUCCESS=true
  fi
else
  if npx playwright install-deps chromium; then
    INSTALL_DEPS_SUCCESS=true
  fi
fi

if [ "$INSTALL_DEPS_SUCCESS" = true ]; then
  ali_msg "Dependências do Playwright instaladas com sucesso." "Playwright dependencies installed successfully."
else
  ali_msg "Aviso: 'playwright install-deps' não pôde ser executado automaticamente. Tentando instalação via apt-get..." "Warning: 'playwright install-deps' could not run automatically. Trying installation via apt-get..."
  # Detectar versão do Ubuntu
  if [ -f /etc/os-release ]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    UBUNTU_CODENAME="${VERSION_CODENAME:-jammy}"
  else
    UBUNTU_CODENAME="jammy"
  fi

  # Pacotes base para Chromium
  $SUDO apt-get update -qq
  if [ "$UBUNTU_CODENAME" = "noble" ] || [ "$UBUNTU_CODENAME" = "trixie" ]; then
    $SUDO apt-get install -y -qq \
      libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
      libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
      libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
      fonts-liberation fonts-noto-color-emoji
  else
    $SUDO apt-get install -y -qq \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
      libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
      libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
      fonts-liberation fonts-noto-color-emoji
  fi
fi

# 6. Configurar perfil AppArmor se Ubuntu 23.10 / 24.04+ com restrição de userns
ali_msg "[6/8] Verificando restrições de User Namespaces (AppArmor)..." "[6/8] Checking User Namespace restrictions (AppArmor)..."
if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  RESTRICT_USERNS="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo "0")"
  if [ "$RESTRICT_USERNS" = "1" ] && [ -d /etc/apparmor.d ] && command -v apparmor_parser >/dev/null 2>&1; then
    ali_msg "Detectada restrição de User Namespaces ativa no kernel (Ubuntu 23.10 / 24.04+)." "Detected an active User Namespace restriction in the kernel (Ubuntu 23.10 / 24.04+)."
    if [ -n "$SUDO" ] || [ "$(id -u)" -eq 0 ]; then
      ali_msg "Configurando perfil AppArmor para o Chromium do Playwright (/etc/apparmor.d/playwright-chrome)..." "Configuring AppArmor profile for Playwright Chromium (/etc/apparmor.d/playwright-chrome)..."
      $SUDO tee /etc/apparmor.d/playwright-chrome >/dev/null << 'EOF'
# Perfil AppArmor para o Chromium do Playwright (Ubuntu 23.10 / 24.04 LTS)
abi <abi/4.0>,
include <tunables/global>

profile playwright-chrome /**/.cache/ms-playwright/**/chrome flags=(unconfined) {
  userns,

  include if exists <local/playwright-chrome>
}
EOF
      $SUDO apparmor_parser -r /etc/apparmor.d/playwright-chrome 2>/dev/null || true
      ali_msg "Perfil AppArmor configurado com sucesso." "AppArmor profile configured successfully."
    fi
  fi
fi

# 7. Permissões de scripts e arquivo de credenciais
ali_msg "[7/8] Ajustando permissões e credenciais..." "[7/8] Adjusting permissions and credentials..."
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

# 8. Teste de inicialização do Chromium
ali_msg "[8/8] Testando inicialização do Chromium no ambiente..." "[8/8] Testing Chromium startup in the environment..."
if [ -d "$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu" ]; then
  export LD_LIBRARY_PATH="$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
fi
if node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); await b.close(); })();" 2>/dev/null; then
  ali_msg "✅ Sucesso: O navegador Chromium iniciou normalmente com sandbox ativado!" "✅ Success: The Chromium browser started normally with the sandbox enabled!"
elif node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); await b.close(); })();" 2>/dev/null; then
  ali_msg "✅ Sucesso: O navegador Chromium iniciou em modo sem sandbox (--no-sandbox)." "✅ Success: The Chromium browser started without the sandbox (--no-sandbox)."
  ali_msg "   Nota: Caso encontre restrições no Ubuntu 24.04, configure o AppArmor ou use NO_SANDBOX=true (veja INSTALL_LINUX.md)." "   Note: If you encounter restrictions on Ubuntu 24.04, configure AppArmor or use NO_SANDBOX=true (see INSTALL_LINUX.en.md)."
else
  ali_msg "⚠️ Aviso: O Chromium encontrou dificuldades ao iniciar." "⚠️ Warning: Chromium encountered difficulties starting."
  ali_msg "Para verificar bibliotecas faltantes no sistema, execute:" "To check for missing system libraries, run:"
  echo "  ldd ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome* | grep 'not found'"
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
