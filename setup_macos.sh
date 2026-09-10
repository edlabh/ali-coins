#!/usr/bin/env bash
# ==============================================================================
# AliExpress Coin Collector - Script de Instalação e Configuração para macOS
# Compatível com Apple Silicon (M1/M2/M3/M4) e processadores Intel
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================================"
echo "    Instalação e Configuração: AliExpress Coin Collector (macOS)"
echo "======================================================================"
echo ""

ARCH=$(uname -m)
echo "Arquitetura detectada: $ARCH"

# 1. Verificar Node.js
echo "[1/5] Verificando versão do Node.js..."
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
  if command -v brew >/dev/null 2>&1; then
    echo "Instalando Node.js via Homebrew..."
    brew install node
  else
    echo "ERRO: Node.js >= 18 é obrigatório. Por favor, instale o Homebrew (https://brew.sh) ou baixe o instalador oficial do Node.js 20 LTS em https://nodejs.org/"
    exit 1
  fi
fi

# 2. Instalar dependências npm
echo "[2/5] Instalando dependências do projeto (npm install)..."
npm install

# 3. Instalar navegador Chromium do Playwright
echo "[3/5] Baixando binário nativo do Chromium para $ARCH..."
npx playwright install chromium

# 4. Permissões de scripts e arquivo de credenciais
echo "[4/5] Ajustando permissões e credenciais..."
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

# 5. Teste de inicialização do Chromium
echo "[5/5] Testando inicialização do Chromium no macOS..."
if node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); await b.close(); })();" 2>/dev/null; then
  echo "✅ Sucesso: O navegador Chromium iniciou em modo headless com sucesso!"
else
  echo "⚠️ Aviso: O Chromium encontrou dificuldades ao iniciar."
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
