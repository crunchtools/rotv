#!/usr/bin/env bash
# CI setup, run inside the rotv:test container by the `backend` check
# (pyproject.toml), after the seed import: run every migration over the
# seeded database, as rotv-init does on every boot after a restore.
#
# psql carries on past a failing statement, so its output is what fails the
# step: any ERROR but the idempotent "already exists". Then the seed must have
# left POIs to test against.
set -euo pipefail

status=0
for m in /app/migrations/*.sql; do
  [ -f "$m" ] || continue
  errors=$(psql -U postgres -d rotv -f "$m" 2>&1 | grep -i 'error' | grep -v 'already exists' || true)
  if [ -n "$errors" ]; then
    printf '%s:\n%s\n' "$(basename "$m")" "$errors"
    status=1
  fi
done

pois=$(psql -U postgres -d rotv -tAc 'SELECT COUNT(*) FROM pois;')
if [ "${pois:-0}" -eq 0 ]; then
  echo "apply-migrations: the seed left no POIs"
  status=1
fi
exit $status
