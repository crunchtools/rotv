#!/usr/bin/env bash
# CI setup, run inside the rotv:test container by the `backend` check
# (pyproject.toml): wait for the backend to answer, two minutes at most.
set -euo pipefail
for _ in $(seq 60); do
  curl -sf -m 5 -o /dev/null http://localhost:8080/api/destinations && exit 0
  sleep 2
done
echo "wait-for-api: the backend never answered /api/destinations"
exit 1
