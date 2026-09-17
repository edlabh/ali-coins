#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/github_token.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERRO: Arquivo github_token.env não encontrado."
  exit 1
fi

GITHUB_USER=""
GITHUB_TOKEN=""
GITHUB_REPO=""

# Ler variáveis de forma segura linha a linha sem usar eval
while IFS='=' read -r key val || [ -n "$key" ]; do
  # Remover espaços em branco no início e no fim
  key="$(echo "$key" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  case "$key" in
    \#*|"") continue ;;
  esac
  val="$(echo "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  # Remover aspas externas simples ou duplas
  val="${val#\"}"
  val="${val%\"}"
  val="${val#\'}"
  val="${val%\'}"

  case "$key" in
    GITHUB_USER) GITHUB_USER="$val" ;;
    GITHUB_TOKEN) GITHUB_TOKEN="$val" ;;
    GITHUB_REPO) GITHUB_REPO="$val" ;;
  esac
done < "$ENV_FILE"

if [ -z "$GITHUB_USER" ] || [ -z "$GITHUB_TOKEN" ]; then
  echo "ERRO: GITHUB_USER ou GITHUB_TOKEN vazios no github_token.env."
  exit 2
fi

REPO_NAME="${GITHUB_REPO:-ali-coins}"
PUBLIC_REMOTE="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"

# Garantir que mesmo em caso de falha o remote nunca contenha tokens
cleanup() {
  git remote set-url origin "$PUBLIC_REMOTE" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Configurando repositório remoto para: ${GITHUB_USER}/${REPO_NAME} ..."

if git remote | grep -q "^origin$"; then
  git remote set-url origin "$PUBLIC_REMOTE"
else
  git remote add origin "$PUBLIC_REMOTE"
fi

BASIC_AUTH="$(printf '%s:%s' "$GITHUB_USER" "$GITHUB_TOKEN" | base64 | tr -d '\n')"

echo "Enviando branch 'main'..."
# Autenticação segura via header HTTP Authorization: Basic sem expor o token na URL do remote.
# NUNCA repassar "$@" aqui: um --force destinado às tags forçaria a main por acidente.
git -c http.extraHeader="Authorization: Basic ${BASIC_AUTH}" push -u origin main

echo "Enviando tags de release..."
git -c http.extraHeader="Authorization: Basic ${BASIC_AUTH}" push origin --tags "$@"

echo ""
echo "=========================================================="
echo " Projeto enviado com sucesso para o GitHub!"
echo " URL: https://github.com/${GITHUB_USER}/${REPO_NAME}"
echo "=========================================================="
