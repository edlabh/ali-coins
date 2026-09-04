#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LD_LIBRARY_PATH="$SCRIPT_DIR/libs/extracted/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
node "$SCRIPT_DIR/do_tasks.js"
