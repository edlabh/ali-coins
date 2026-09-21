#!/usr/bin/env bash
# ==============================================================================
# Exemplo de execução diária via Docker com baixo consumo de recursos.
# Pensado para hosts pequenos (ex: VPS de 1 GB de RAM) rodando via cron.
#
# Uso:
#   ./docker-run.example.sh [--dry-run] [--json]   # args repassados ao all.js
#
# Variáveis de ambiente opcionais:
#   ALI_COINS_DIR      diretório do projeto (padrão: $HOME/ali-coins)
#   ALI_COINS_IMAGE    imagem Docker (padrão: ali-coins:latest)
#   ALI_COINS_MEM      limite de RAM do container (padrão: 768m)
#   ALI_COINS_MEM_SWAP RAM+swap do container (padrão: 1536m)
#
# Dicas de economia aplicadas aqui:
#   --init             reaping de processos filhos do Chromium (evita zumbis)
#   --pids-limit       impede explosão de processos em caso de loop
#   --memory/--memory-swap  protege o SO do host; o pico real é registrado no log
#   --log-opt          evita crescimento infinito do log do container
#   CHROMIUM_LOW_MEMORY=true (no credentials.env) reduz renderers/heap do Chromium
#
# Permissões: a imagem roda como appuser (UID/GID 10001). Como os arquivos são
# montados do host, garanta que o UID 10001 possa lê-los/gravar:
#   chown 10001:10001 credentials.env session*.enc session_meta*.json accounts.json
# (ou use --user "$(id -u):$(id -g)" com /etc/passwd e /etc/group montados)
# ==============================================================================
set -u

DIR="${ALI_COINS_DIR:-$HOME/ali-coins}"
IMAGE="${ALI_COINS_IMAGE:-ali-coins:latest}"
RUN_NAME="ali-coins-cron"
LOG="$DIR/cron.log"
MEM_LIMIT="${ALI_COINS_MEM:-768m}"
MEM_SWAP="${ALI_COINS_MEM_SWAP:-1536m}"

# Rotação simples do log: impede crescimento indefinido em VPS pequena (cron.log não é podado).
LOG_MAX_BYTES="${ALI_COINS_LOG_MAX_BYTES:-5242880}" # 5 MB
if [ -f "$LOG" ]; then
  LOG_SIZE="$(wc -c < "$LOG" 2>/dev/null || echo 0)"
  if [ "${LOG_SIZE:-0}" -gt "$LOG_MAX_BYTES" ]; then
    mv "$LOG" "$LOG.1" 2>/dev/null || true
    : > "$LOG"
  fi
fi

MOUNTS=(-v "$DIR/credentials.env:/app/credentials.env:ro" -v "$DIR/scratch:/app/scratch")
for f in "$DIR"/session*; do
  [ -f "$f" ] && MOUNTS+=(-v "$f:/app/$(basename "$f")")
done
# Multi-conta por arquivo (accounts.json) era ignorado silenciosamente no container
[ -f "$DIR/accounts.json" ] && MOUNTS+=(-v "$DIR/accounts.json:/app/accounts.json:ro")

{
  echo "===== $(date '+%F %T %Z') inicio (args: $*) ====="

  /usr/bin/docker run --rm --name "$RUN_NAME" \
    --init \
    --pids-limit=256 \
    --cap-drop=ALL --security-opt=no-new-privileges \
    --memory="$MEM_LIMIT" --memory-swap="$MEM_SWAP" \
    --log-opt max-size=10m --log-opt max-file=3 \
    "${MOUNTS[@]}" \
    "$IMAGE" node all.js "$@" &
  RUN_PID=$!

  # Amostra o consumo do container a cada 5s para registrar o pico real
  PEAK_MEM_MB=0
  PEAK_PIDS=0
  while kill -0 "$RUN_PID" 2>/dev/null; do
    SAMPLE="$(/usr/bin/docker stats --no-stream --format '{{.MemUsage}}|{{.PIDs}}' "$RUN_NAME" 2>/dev/null | head -1)"
    if [ -n "$SAMPLE" ]; then
      MEM_RAW="$(printf '%s' "$SAMPLE" | cut -d'|' -f1 | cut -d'/' -f1 | tr -d ' ')"
      PIDS_RAW="$(printf '%s' "$SAMPLE" | cut -d'|' -f2)"
      case "$MEM_RAW" in
        *GiB) MEM_MB="$(awk -v v="${MEM_RAW%GiB}" 'BEGIN{printf "%d", v*1024}')" ;;
        *MiB) MEM_MB="${MEM_RAW%MiB}" ;;
        *) MEM_MB=0 ;;
      esac
      MEM_INT="${MEM_MB%%.*}"
      [ -n "$MEM_INT" ] && [ "$MEM_INT" -gt "$PEAK_MEM_MB" ] && PEAK_MEM_MB="$MEM_INT"
      [ -n "$PIDS_RAW" ] && [ "$PIDS_RAW" -gt "$PEAK_PIDS" ] && PEAK_PIDS="$PIDS_RAW"
    fi
    sleep 5
  done

  wait "$RUN_PID"
  EXIT=$?
  echo "pico: mem=${PEAK_MEM_MB}MiB pids=${PEAK_PIDS} (limite ${MEM_LIMIT}/${MEM_SWAP})"
  echo "exit=$EXIT fim: $(date '+%F %T %Z')"
} >> "$LOG" 2>&1

# Propaga o código de saída para o cron/monitoramento (antes era sempre 0)
exit "${EXIT:-1}"
