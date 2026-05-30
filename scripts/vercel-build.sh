#!/bin/sh
# Build script for Vercel. On production deploys, sync the DB schema and
# update the Telegram bot command menu before running Next.js build.
# Preview deploys skip both steps to avoid touching the production database
# and to keep preview builds fast.

set -e

if [ "$VERCEL_ENV" = "production" ]; then
  echo "[vercel-build] syncing database schema..."
  pnpm db:push

  echo "[vercel-build] updating bot command menu..."
  pnpm bot:set-commands
fi

exec next build
