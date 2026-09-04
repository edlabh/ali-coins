#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/github_token.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERRO: Arquivo github_token.env não encontrado."
  exit 1
fi

# Ler variáveis sem aspas e sem problemas de formatação
eval $(node -e "
const fs = require('fs');
const content = fs.readFileSync('$ENV_FILE', 'utf-8');
for (const line of content.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq !== -1) {
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('\"') && v.endsWith('\"')) || (v.startsWith('\'') && v.endsWith('\''))) {
      v = v.slice(1, -1);
    }
    console.log(k + '=\"' + v + '\"');
  }
}
")

if [ -z "$GITHUB_USER" ] || [ -z "$GITHUB_TOKEN" ]; then
  echo "ERRO: GITHUB_USER ou GITHUB_TOKEN vazios no github_token.env."
  exit 2
fi

REPO_NAME="${GITHUB_REPO:-ali-coins}"

echo "Configurando repositório remoto para: ${GITHUB_USER}/${REPO_NAME} ..."
REMOTE_URL="https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git"

if git remote | grep -q "^origin$"; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

echo "Enviando branch 'master'..."
git push -u origin master

echo "Enviando tags de release..."
git push origin --tags

# Mascarar token no remote por segurança
PUBLIC_REMOTE="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"
git remote set-url origin "$PUBLIC_REMOTE"

echo ""
echo "=========================================================="
echo " Projeto enviado com sucesso para o GitHub!"
echo " URL: https://github.com/${GITHUB_USER}/${REPO_NAME}"
echo "=========================================================="
