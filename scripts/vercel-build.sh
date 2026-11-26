#!/bin/sh
# Build script for Vercel.
#
# Only `main` and `dev` build on Vercel (vercel.json); E2E branches are migrated by e2e.yml.
#
# Every Vercel deploy that builds (production and the dev preview) syncs the database schema.
# The Telegram side (command menu, webhook) is global to the one bot, so only production and
# the dev preview touch it; any other preview would repoint the bot at itself.

set -e

is_production() { [ "$VERCEL_ENV" = "production" ]; }
is_preview() { [ "$VERCEL_ENV" = "preview" ]; }
is_dev_preview() { is_preview && [ "$VERCEL_GIT_COMMIT_REF" = "dev" ]; }

if is_production || is_preview; then
  echo "[vercel-build] applying data migrations..."
  pnpm db:migrate

  echo "[vercel-build] syncing database schema..."
  # drizzle-kit can print an error and still exit 0 (an ambiguous rename needs a prompt it
  # can't show without a TTY), which would ship a release against an unsynced schema.
  # Fail the build on its error output too, not just on the exit status.
  push_log=$(pnpm db:push 2>&1) || { printf '%s\n' "$push_log"; exit 1; }
  printf '%s\n' "$push_log"
  if printf '%s\n' "$push_log" | grep -q '^Error'; then
    echo "[vercel-build] db:push reported an error; failing the build" >&2
    exit 1
  fi
fi

if is_production || is_dev_preview; then
  # The build machine sometimes can't reach api.telegram.org (ETIMEDOUT / ENETUNREACH), which
  # failed a whole production release once. Retry, and let the cosmetic step give way.
  . "$(dirname "$0")/retry.sh"

  echo "[vercel-build] updating bot command menu..."
  # The command menu is only a convenience: if Telegram stays unreachable, ship anyway; the
  # next deploy sets it again.
  if ! retry 3 pnpm bot:set-commands; then
    echo "[vercel-build] WARNING: could not update the bot command menu; continuing" >&2
  fi

  echo "[vercel-build] setting Telegram webhook..."
  # The webhook stays fatal: a release that can't repoint it (or apply a changed
  # allowed_updates) shouldn't pass as shipped.
  retry 3 pnpm bot:set-webhook "$NEXT_PUBLIC_MINI_APP_URL" || {
    echo "[vercel-build] could not set the Telegram webhook; failing the build" >&2
    exit 1
  }
fi

exec next build
