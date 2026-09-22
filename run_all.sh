#!/usr/bin/env bash

# Proteção contra OOM Killer fora do container: mesma folga de heap do Dockerfile.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=256}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$(uname)" = "Linux" ] && [ -d "$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu" ]; then
  export LD_LIBRARY_PATH="$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
fi

# Executa o Node em background encaminhando TERM/INT para ele, de modo que um
# `kill <script>` ou stop do systemd não deixe o Node/Chromium órfãos.
run_all_node() {
  node "$SCRIPT_DIR/all.js" "$@" &
  RUN_ALL_CHILD=$!
  trap 'kill -TERM "$RUN_ALL_CHILD" 2>/dev/null' TERM INT
  wait "$RUN_ALL_CHILD"
  RUN_ALL_CODE=$?
  trap - TERM INT
  return "$RUN_ALL_CODE"
}

# Execução com 1 tentativa de retry e backoff caso o código de saída seja 1 (falha transitória).
# Códigos 0 (sucesso), 2 (já coletado), 3 (lock ativo), 4 (streak quebrado) e 5 (2FA no cron) não sofrem retentativa.
run_all_node "$@"
EXIT_CODE=$?

if [ $EXIT_CODE -eq 1 ]; then
  echo ""
  echo "[run_all.sh] Execução finalizou com erro (código 1). Aguardando 10 segundos para retentativa única..."
  sleep 10
  run_all_node "$@"
  EXIT_CODE=$?
fi

exit $EXIT_CODE
