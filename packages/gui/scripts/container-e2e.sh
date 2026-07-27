#!/usr/bin/env bash
set -euo pipefail

workspace="/workspace"
bun_runtime="/tmp/bun-runtime"

mkdir -p "$workspace/packages/gui/.artifacts" "$bun_runtime"

tar \
  --exclude=.git \
  --exclude=.artifacts \
  --exclude=dist \
  --exclude=node_modules \
  --exclude=release \
  -C /source -cf - . | tar -C "$workspace" -xf -

npm install --prefix "$bun_runtime" --no-audit --no-fund bun@1.3.14
export BUN_INSTALL_CACHE_DIR=/tmp/bun-cache
export PATH="$bun_runtime/node_modules/.bin:$PATH"

cd "$workspace"
bun install --frozen-lockfile --concurrent-scripts 2
cd packages/gui

if [ "$#" -gt 0 ]; then
  exec bunx playwright test "$@"
fi

exec bun run test:e2e
