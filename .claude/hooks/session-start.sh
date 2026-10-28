#!/bin/bash
set -euo pipefail

# Web sessions only: a laptop already has its own Node and pnpm.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Node comes from the repo's own .nvmrc, not from the environment's setup
# script, which runs before the repo is checked out and can't read it.
export NVM_DIR="${NVM_DIR:-/opt/nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # nvm.sh's last statement can return non-zero; that is not a failure here.
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
fi
if ! command -v nvm >/dev/null 2>&1; then
  echo "session-start: nvm not found under $NVM_DIR, cannot install Node" >&2
  exit 1
fi

NODE_VERSION="$(cat .nvmrc)"
nvm install "$NODE_VERSION" >/dev/null
NODE_BIN_DIR="$(dirname "$(nvm which "$NODE_VERSION")")"

# Later Bash calls in the session pick up this PATH, so `node` and `pnpm`
# (which runs under whichever node is first on PATH) use the pinned version.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$NODE_BIN_DIR:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
export PATH="$NODE_BIN_DIR:$PATH"

# --frozen-lockfile: the hook must never rewrite pnpm-lock.yaml in a session.
pnpm install --frozen-lockfile
