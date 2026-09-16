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
  if [ "$NODE_MAJOR" -lt 22 ]; then
    echo "Versão do Node.js detectada ($NODE_MAJOR) é inferior à versão 22 mínima necessária."
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
    echo "ERRO: Node.js >= 22 é obrigatório. Por favor, instale o Homebrew (https://brew.sh) ou baixe o instalador oficial do Node.js 22 LTS em https://nodejs.org/"
    exit 1
  fi
fi

# 2. Instalar dependências npm
echo "[2/5] Instalando dependências do projeto (npm install)..."
npm install

# 3. Instalar navegador Chromium do Playwright
echo "[3/5] Baixando binário nativo do Chromium para $ARCH..."
if [ -f "$SCRIPT_DIR/node_modules/playwright/cli.js" ]; then
  node "$SCRIPT_DIR/node_modules/playwright/cli.js" install chromium
else
  npx playwright install chromium
fi

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
  chmod 600 "$SCRIPT_DIR/credentials.env" 2>/dev/null || true
  echo "Arquivo 'credentials.env' já existente (mantido)."
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
  node -e "const fs=require('fs');const p=require('path').join(process.argv[1],'credentials.env');if(fs.existsSync(p)){let c=fs.readFileSync(p,'utf8');if(/SESSION_SECRET=\"\"/.test(c)){c=c.replace('SESSION_SECRET=\"\"','SESSION_SECRET=\"' + process.argv[2] + '\"');fs.writeFileSync(p,c,'utf8');console.log('[OK] Chave SESSION_SECRET de 32 caracteres gerada e configurada com sucesso.');}}" "$SCRIPT_DIR" "$GEN_KEY"
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
echo "    (A chave SESSION_SECRET já foi gerada e configurada com 32 caracteres)."
echo ""
echo " 2. Execute a automação unificada (Check-in diário + Tarefas):"
echo "    ./run_all.sh"
echo "    # ou via npm: npm start"
echo ""
echo "======================================================================"
