#!/bin/bash
# Restart the dev units behind one control name. Run by rotv-dev-kick@.service
# when control/<name> is touched, or when a lockfile or a migration changes.
# The names are a closed set: a file with any other name does nothing.
set -euo pipefail

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

echo "$(date --iso-8601=seconds) $1: restarting ${units[*]}" | tee -a /var/lib/rotv-dev/logs/control.log
systemctl restart "${units[@]}"
echo "$(date --iso-8601=seconds) $1: done" | tee -a /var/lib/rotv-dev/logs/control.log
