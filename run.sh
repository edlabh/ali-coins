#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$(uname)" = "Linux" ] && [ -d "$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu" ]; then
  export LD_LIBRARY_PATH="$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
fi
node "$SCRIPT_DIR/collect.js"
