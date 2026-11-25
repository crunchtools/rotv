#!/usr/bin/env bash
# CI setup, run inside the rotv:test container by the `backend` check
# (pyproject.toml): write the environment file production mounts.
#
# server.js refuses to start without PGPASSWORD (#920). The bundled Postgres
# trusts local connections, so a per-run value will do, and none is committed
# (a525). No OPENROUTER_API_KEY: the one test that calls OpenRouter skips
# without it.
set -euo pipefail
install -d -m 0755 /etc/rotv
umask 077
printf '%s\n' "DISABLE_LIVE_BOAT_TRACKER=true" \
  "PGPASSWORD=$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')" > /etc/rotv/environment
