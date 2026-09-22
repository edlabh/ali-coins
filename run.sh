#!/usr/bin/env bash

# Proteção contra OOM Killer fora do container: mesma folga de heap do Dockerfile.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=256}"

# Cache de bytecode V8 (Node 22+): acelera o arranque; pasta isolada por UID do usuario.
export NODE_COMPILE_CACHE="${NODE_COMPILE_CACHE:-/tmp/ali-coins-compile-cache-$UID}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$(uname)" = "Linux" ] && [ -d "$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu" ]; then
  export LD_LIBRARY_PATH="$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
fi
exec node "$SCRIPT_DIR/collect.js" "$@"
