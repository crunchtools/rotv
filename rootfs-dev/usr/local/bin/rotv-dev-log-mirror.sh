#!/bin/bash
# Keep logs/<unit>.log holding the last lines of one unit's journal.
#
# A snapshot rewritten every few seconds, not a stream appended to: the file
# is on the host's disk and shared with another container, so it must not
# grow with uptime. It is replaced by rename, so a reader never sees half of
# one (follow it with `tail -F`).
set -euo pipefail

unit=${1:?usage: rotv-dev-log-mirror.sh <unit>}
log_dir=${ROTV_DEV_LOG_DIR:-/var/lib/rotv-dev/logs}
lines=${ROTV_DEV_LOG_LINES:-1000}
interval=${ROTV_DEV_LOG_INTERVAL:-5}

while true; do
  journalctl --no-pager --lines="$lines" --output=short-iso --unit="$unit" > "$log_dir/.$unit.log.tmp"
  mv -f "$log_dir/.$unit.log.tmp" "$log_dir/$unit.log"
  sleep "$interval"
done
