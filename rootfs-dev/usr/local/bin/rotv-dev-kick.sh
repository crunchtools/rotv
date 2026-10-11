#!/bin/bash
# Restart the dev units behind one control name. Run by rotv-dev-kick@.service
# when control/<name> is touched, or when a lockfile or a migration changes.
# The names are a closed set: a file with any other name does nothing.
set -euo pipefail

log_dir=${ROTV_DEV_LOG_DIR:-/var/lib/rotv-dev/logs}
# control.log keeps its last kicks, not every one since the disk was new
keep_lines=500

case "${1:-}" in
  ui)      units=(rotv-dev-ui) ;;
  backend) units=(rotv-backend) ;;
  # Migrations run in rotv-init; the backend holds connections to what they change
  init)    units=(rotv-init rotv-backend) ;;
  # Both dev servers load node_modules at start
  deps)    units=(rotv-dev-deps rotv-backend rotv-dev-ui) ;;
  *)
    echo "rotv-dev-kick: unknown control name" >&2
    exit 64
    ;;
esac

record() {
  echo "$(date --iso-8601=seconds) $1: $2" | tee -a "$log_dir/control.log"
}

record "$1" "restarting ${units[*]}"
status=0
systemctl restart "${units[@]}" || status=$?
record "$1" "$([ "$status" -eq 0 ] && echo done || echo "failed ($status)")"

tail -n "$keep_lines" "$log_dir/control.log" > "$log_dir/.control.log.tmp"
mv -f "$log_dir/.control.log.tmp" "$log_dir/control.log"
exit "$status"
