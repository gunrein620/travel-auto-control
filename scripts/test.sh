#!/bin/sh
set -eu

NODE_BIN="${NODE_BIN:-/Users/kunwoopark/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"

if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node)"
fi

"$NODE_BIN" --test tests/*.test.js
