#!/usr/bin/env bash
set -e

ENV_FILE="$(dirname "$0")/github_token.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERRO: Arquivo github_token.env não encontrado."
  exit 1
fi

# Carregar variáveis ignorando comentários e espaços
export $(grep -v '^#' "$ENV_FILE" | xargs -d '\n')

if [ -z "$GITHUB_USER" ] || [ -z "$GITHUB_TOKEN" ]; then
  echo "ERRO: GITHUB_USER ou GITHUB_TOKEN não estão preenchidos no github_token.env."
  echo "Por favor, preencha suas credenciais antes de continuar."
  exit 2
fi

REPO_NAME="${GITHUB_REPO:-ali-coins}"

echo "Configurando repositório remoto para: ${GITHUB_USER}/${REPO_NAME} ..."

# Configurar remote origin com o token
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

# Mascarar o token na configuração local após o push por segurança
PUBLIC_REMOTE="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"
git remote set-url origin "$PUBLIC_REMOTE"

echo ""
echo "=========================================================="
echo " Projeto enviado com sucesso para o GitHub!"
echo " URL: https://github.com/${GITHUB_USER}/${REPO_NAME}"
echo "=========================================================="
