#!/usr/bin/env bash
# ==============================================================================
# AliExpress Coin Collector - Script de Instalação e Configuração para Linux
# Compatível com Ubuntu 20.04, 22.04, 24.04 e Debian 11/12
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================================"
echo "    Instalação e Configuração: AliExpress Coin Collector (Linux)"
echo "======================================================================"
echo ""

# Determinar comando sudo se não for root
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "ERRO: Este instalador requer privilégios de root ou comando 'sudo'."
    exit 1
  fi
fi

# 1. Verificar e instalar ferramentas essenciais (curl, git, ca-certificates)
echo "[1/6] Verificando ferramentas básicas do sistema..."
if ! command -v curl >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  echo "Instalando curl, git e utilitários..."
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq curl git ca-certificates gnupg
fi

# 2. Verificar versão do Node.js
echo "[2/6] Verificando versão do Node.js..."
NEED_NODE_INSTALL=false

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/v//' | cut -d'.' -f1)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "Versão do Node.js detectada ($NODE_MAJOR) é inferior à versão 18 mínima necessária."
    NEED_NODE_INSTALL=true
  else
    echo "Node.js já instalado na versão $(node -v) (compatível)."
  fi
else
  echo "Node.js não encontrado no sistema."
  NEED_NODE_INSTALL=true
fi

if [ "$NEED_NODE_INSTALL" = true ]; then
  echo "Instalando Node.js 20 LTS via repositório oficial NodeSource..."
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y -qq nodejs
  echo "Node.js instalado com sucesso: $(node -v)"
fi

# 3. Instalar dependências npm
echo "[3/6] Instalando dependências do projeto (npm install)..."
npm install

# 4. Instalar navegador Chromium do Playwright
echo "[4/6] Baixando binário do Chromium via Playwright..."
npx playwright install chromium

# 5. Instalar dependências de sistema para o Chromium no Linux
echo "[5/6] Instalando bibliotecas do sistema para o Chromium..."
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
  echo "Dependências do Playwright instaladas com sucesso."
else
  echo "Aviso: 'playwright install-deps' não pôde ser executado automaticamente. Tentando instalação via apt-get..."
  # Detectar versão do Ubuntu
  if [ -f /etc/os-release ]; then
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

# 6. Permissões de scripts e arquivo de credenciais
echo "[6/6] Ajustando permissões e credenciais..."
chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true

if [ ! -f "$SCRIPT_DIR/credentials.env" ]; then
  if [ -f "$SCRIPT_DIR/credentials.env.example" ]; then
    cp "$SCRIPT_DIR/credentials.env.example" "$SCRIPT_DIR/credentials.env"
    chmod 600 "$SCRIPT_DIR/credentials.env"
    echo "Arquivo 'credentials.env' criado a partir do modelo."
  fi
else
  echo "Arquivo 'credentials.env' já existente (mantido)."
fi

echo ""
echo "======================================================================"
echo "          INSTALAÇÃO CONCLUÍDA COM SUCESSO!"
echo "======================================================================"
echo ""
echo "Próximos passos:"
echo " 1. Edite o arquivo 'credentials.env' com seus dados de login do AliExpress:"
echo "    nano credentials.env"
echo ""
echo " 2. Execute a automação unificada (Check-in diário + Tarefas):"
echo "    ./run_all.sh"
echo "    # ou via npm: npm start"
echo ""
echo "======================================================================"
