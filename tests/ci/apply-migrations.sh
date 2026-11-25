#!/usr/bin/env bash
# CI setup, run inside the rotv:test container by the `backend` check
# (pyproject.toml), after the seed import: run every migration over the
# seeded database, as rotv-init does on every boot after a restore.
#
# The whole history replays over today's schema, so old migrations name
# columns since renamed and insert rows the seed already holds. Their errors
# are printed, as the deleted tests.yml did, but do not fail the step; what
# must hold is that the seed left POIs to test against.
set -euo pipefail

for m in /app/migrations/*.sql; do
  [ -f "$m" ] || continue
  errors=$(psql -U postgres -d rotv -f "$m" 2>&1 | grep 'ERROR:' | grep -v 'already exists' || true)
  [ -z "$errors" ] || printf '%s:\n%s\n' "$(basename "$m")" "$errors"
done

pois=$(psql -U postgres -d rotv -tAc 'SELECT COUNT(*) FROM pois;')
if [ "${pois:-0}" -eq 0 ]; then
  echo "apply-migrations: the seed left no POIs"
  exit 1
fi
