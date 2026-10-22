#!/usr/bin/env bash
# Fail on an unbraced `|| true` in the middle of a RUN && chain.
#
#   a && b || true && c      runs c even when a fails: the build goes green
#   a && { b || true; } && c  what was meant
#
# This exact line shipped an image with no PostgreSQL on 2026-10-22.
set -euo pipefail
cd "$(dirname "$0")/../.."

status=0
for f in Containerfile*; do
  awk -v f="$f" '
    # || true followed by && on the same line
    /\|\|[[:space:]]*true[[:space:]]*&&/ { bad(FNR) }
    # || true ending a continued line whose next line starts with &&
    prev_cont && /^[[:space:]]*&&/ { bad(prev_line) }
    { prev_cont = ($0 ~ /\|\|[[:space:]]*true[[:space:]]*\\[[:space:]]*$/); prev_line = FNR }
    function bad(n) { printf "%s:%d: unbraced `|| true` inside an && chain; use { cmd || true; }\n", f, n; found = 1 }
    END { exit found }
  ' "$f" || status=1
done
exit $status
