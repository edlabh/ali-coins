#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$SCRIPT_DIR/libs/i18n/scripts.sh"
cd "$SCRIPT_DIR"
ENV_FILE="$SCRIPT_DIR/github_token.env"

if [ ! -f "$ENV_FILE" ]; then
  ali_msg "ERRO: Arquivo github_token.env não encontrado." "ERROR: github_token.env file not found."
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
  ali_msg "ERRO: GITHUB_USER ou GITHUB_TOKEN vazios no github_token.env." "ERROR: GITHUB_USER or GITHUB_TOKEN is empty in github_token.env."
  exit 2
fi

REPO_NAME="${GITHUB_REPO:-ali-coins}"
PUBLIC_REMOTE="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"

# Garantir que mesmo em caso de falha o remote nunca contenha tokens
cleanup() {
  git remote set-url origin "$PUBLIC_REMOTE" 2>/dev/null || true
  unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0
}
trap cleanup EXIT INT TERM

ali_msg "Configurando repositório remoto para: ${GITHUB_USER}/${REPO_NAME} ..." "Configuring remote repository for: ${GITHUB_USER}/${REPO_NAME} ..."

if git remote | grep -q "^origin$"; then
  git remote set-url origin "$PUBLIC_REMOTE"
else
  git remote add origin "$PUBLIC_REMOTE"
fi

BASIC_AUTH="$(printf '%s:%s' "$GITHUB_USER" "$GITHUB_TOKEN" | base64 | tr -d '\n')"

# Autenticação via variáveis de ambiente do git (GIT_CONFIG_*): o header NÃO aparece no
# argv do processo (visível a outros usuários locais via `ps`), apenas no ambiente do próprio git.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=http.extraHeader
export GIT_CONFIG_VALUE_0="Authorization: Basic ${BASIC_AUTH}"

ali_msg "Enviando branch 'main'..." "Pushing branch 'main'..."
# NUNCA repassar "$@" aqui: um --force destinado às tags forçaria a main por acidente.
git push -u origin main

ali_msg "Enviando tags de release..." "Pushing release tags..."
git push origin --tags "$@"

echo ""
echo "=========================================================="
ali_msg " Projeto enviado com sucesso para o GitHub!" " Project pushed successfully to GitHub!"
echo " URL: https://github.com/${GITHUB_USER}/${REPO_NAME}"
echo "=========================================================="
