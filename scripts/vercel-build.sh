#!/bin/sh
# Build script for Vercel. Runs on production deploys and on preview deploys
# from the dev branch. Other preview deploys skip all steps to keep builds fast.

set -e

is_production() { [ "$VERCEL_ENV" = "production" ]; }
is_dev_preview() { [ "$VERCEL_ENV" = "preview" ] && [ "$VERCEL_GIT_COMMIT_REF" = "dev" ]; }

if is_production || is_dev_preview; then
  echo "[vercel-build] syncing database schema..."
  pnpm db:push

  echo "[vercel-build] updating bot command menu..."
  pnpm bot:set-commands

  echo "[vercel-build] setting Telegram webhook..."
  pnpm bot:set-webhook "$NEXT_PUBLIC_MINI_APP_URL"
fi

exec next build
