#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$(uname)" = "Linux" ] && [ -d "$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu" ]; then
  export LD_LIBRARY_PATH="$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
fi

# Execução com 1 tentativa de retry e backoff caso o código de saída seja 1 (falha transitória).
# Códigos 0 (sucesso), 2 (já coletado), 3 (lock ativo), 4 (streak quebrado) e 5 (2FA no cron) não sofrem retentativa.
node "$SCRIPT_DIR/all.js" "$@"
EXIT_CODE=$?

if [ $EXIT_CODE -eq 1 ]; then
  echo ""
  echo "[run_all.sh] Execução finalizou com erro (código 1). Aguardando 10 segundos para retentativa única..."
  sleep 10
  node "$SCRIPT_DIR/all.js" "$@"
  EXIT_CODE=$?
fi

exit $EXIT_CODE
