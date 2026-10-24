#!/usr/bin/env bash

# Proteção contra OOM Killer fora do container: hosts de 1 GB mantêm a mesma folga
# do Dockerfile (256 MB). Em máquinas com mais RAM o fluxo unificado (check-in +
# tarefas) sobe para 384/512 MB e evita o OOM de heap observado com o teto fixo.
# `ALI_HEAP_MB` e `NODE_OPTIONS` explícitos têm precedência.
_ALI_HEAP_MB=256
if [ -n "${ALI_HEAP_MB:-}" ] && [ "${ALI_HEAP_MB}" -gt 0 ] 2>/dev/null; then
  _ALI_HEAP_MB="$ALI_HEAP_MB"
elif [ -r /proc/meminfo ]; then
  _ALI_MEM_MB=$(awk '/^MemTotal:/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
  if [ "${_ALI_MEM_MB:-0}" -ge 6000 ]; then
    _ALI_HEAP_MB=512
  elif [ "${_ALI_MEM_MB:-0}" -ge 3000 ]; then
    _ALI_HEAP_MB=384
  fi
elif command -v sysctl >/dev/null 2>&1; then
  _ALI_MEM_MB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1048576 ))
  if [ "${_ALI_MEM_MB:-0}" -ge 6000 ]; then
    _ALI_HEAP_MB=512
  elif [ "${_ALI_MEM_MB:-0}" -ge 3000 ]; then
    _ALI_HEAP_MB=384
  fi
fi
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=$_ALI_HEAP_MB}"

# Cache de bytecode V8 (Node 22+): acelera o arranque; pasta isolada por UID do usuario.
export NODE_COMPILE_CACHE="${NODE_COMPILE_CACHE:-/tmp/ali-coins-compile-cache-$UID}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$HOME/.local/bin" ] && [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi
if [ "$(uname)" = "Linux" ] && [ -d "$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu" ]; then
  export LD_LIBRARY_PATH="$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
fi

# Executa o Node em background encaminhando TERM/INT para ele, de modo que um
# `kill <script>` ou stop do systemd não deixe o Node/Chromium órfãos.
# `<&0` é obrigatório: sem job control, o bash liga o stdin de comandos em background
# a /dev/null, o que desliga o --manual-login (exige stdin TTY) mesmo num terminal.
run_all_node() {
  node "$SCRIPT_DIR/all.js" "$@" <&0 &
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
  # Retentativa não deve esperar outro sorteio do atraso inicial (START_DELAY_*).
  run_all_node "$@" --no-delay
  EXIT_CODE=$?
fi

exit $EXIT_CODE
