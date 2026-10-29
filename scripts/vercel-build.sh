#!/bin/sh
# Build script for Vercel.
#
# Every preview deploy syncs the database schema: the Neon Vercel integration gives each
# git branch its own database, and the E2E run reads that same database, so a branch that
# adds a column fails every case until the column exists there. The Telegram side
# (command menu, webhook) is global to the one bot, so only production and the dev preview
# touch it; any other preview would repoint the bot at itself.

set -e

is_production() { [ "$VERCEL_ENV" = "production" ]; }
is_preview() { [ "$VERCEL_ENV" = "preview" ]; }
is_dev_preview() { is_preview && [ "$VERCEL_GIT_COMMIT_REF" = "dev" ]; }

if is_production || is_preview; then
  echo "[vercel-build] applying data migrations..."
  pnpm db:migrate

  echo "[vercel-build] syncing database schema..."
  pnpm db:push
fi

if is_production || is_dev_preview; then
  echo "[vercel-build] updating bot command menu..."
  pnpm bot:set-commands

  echo "[vercel-build] setting Telegram webhook..."
  pnpm bot:set-webhook "$NEXT_PUBLIC_MINI_APP_URL"
fi

exec next build
