#!/bin/sh
# Sourced by scripts/vercel-build.sh (and tested by scripts/__tests__/retry.test.mjs).
#
#   retry <attempts> <command> [args...]
#
# Runs the command up to <attempts> times, waiting RETRY_DELAY_UNIT * <attempt> seconds
# (default unit 5) between tries. Returns the last attempt's failure, so the caller decides
# whether that is fatal. Meant for calls to Telegram from the Vercel build machine, where
# a connection to api.telegram.org now and then times out.

retry() {
  retry_attempts=$1
  shift
  retry_i=1
  while :; do
    if "$@"; then
      return 0
    fi
    if [ "$retry_i" -ge "$retry_attempts" ]; then
      return 1
    fi
    retry_wait=$((retry_i * ${RETRY_DELAY_UNIT:-5}))
    echo "[retry] '$*' failed (attempt $retry_i of $retry_attempts); trying again in ${retry_wait}s" >&2
    sleep "$retry_wait"
    retry_i=$((retry_i + 1))
  done
}
