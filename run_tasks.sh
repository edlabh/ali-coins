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
exec node "$SCRIPT_DIR/do_tasks.js" "$@"
