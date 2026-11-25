#!/usr/bin/env bash
# The `migration-compat` check (pyproject.toml): scripts/check-migrations.mjs
# against where this branch left master, as tests.yml ran it, so an edit to a
# migration at or below BASELINE is judged too. A checkout with no master in
# its history gets the numbered migrations alone, and says so.
set -euo pipefail
cd "$(dirname "$0")/../.."
base=$(git merge-base HEAD origin/master 2>/dev/null || true)
if [ -n "$base" ]; then
  exec node scripts/check-migrations.mjs --base "$base"
fi
echo "check-migrations: no origin/master in this checkout; checking the migrations above BASELINE only"
exec node scripts/check-migrations.mjs
