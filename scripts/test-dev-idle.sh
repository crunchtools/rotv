#!/bin/bash
# Tests for scripts/dev-idle.sh, the hosted dev container's idle stop. systemctl,
# podman and nsenter are stand-ins: nsenter prints $FAKE_SS as `ss -Htni`
# would, and systemctl records what it was asked to stop.
set -euo pipefail

idle=${1:-$(dirname "$0")/dev-idle.sh}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
cat > "$work/bin/systemctl" <<'FAKE'
#!/bin/bash
case "$1" in
  is-active) [ "${FAKE_ACTIVE:-1}" = 1 ] ;;
  stop) echo "$*" >> "$FAKE_DIR/stops" ;;
esac
FAKE
cat > "$work/bin/podman" <<'FAKE'
#!/bin/bash
case "$1" in
  inspect) echo 4242 ;;
  pull) echo "$*" >> "$FAKE_DIR/pulls"; [ "${FAKE_PULL_FAILS:-0}" = 0 ] ;;
esac
FAKE
cat > "$work/bin/nsenter" <<'FAKE'
#!/bin/bash
printf '%s' "${FAKE_SS:-}"
FAKE
chmod +x "$work/bin/"*
export PATH="$work/bin:$PATH" FAKE_DIR="$work" STAMP="$work/active" WAKE="$work/wake" PULLED="$work/pulled"

fail() { echo "FAIL: $*" >&2; exit 1; }

# conn <peer> <lastrcv ms> <lastsnd ms>: one established socket as ss -Htni prints it
conn() {
  printf '0      0      10.88.0.55:5173 %s\n\t cubic wscale:7,7 rto:201 lastsnd:%s lastrcv:%s lastack:%s\n' "$1" "$3" "$2" "$2"
}

# run <stamp age min> <wake age min or -> <expect: stop|keep> <desc>
run() {
  rm -f "$work/stops" "$STAMP" "$WAKE"
  touch -d "@$(( $(date +%s) - $1 * 60 ))" "$STAMP"
  [ "$2" = - ] || touch -d "@$(( $(date +%s) - $2 * 60 ))" "$WAKE"
  IDLE_MIN=30 "$idle" > /dev/null
  if [ "$3" = stop ]; then
    [ -s "$work/stops" ] || fail "$4: expected a stop"
  else
    [ ! -s "$work/stops" ] || fail "$4: stopped, expected to keep running"
  fi
}

FAKE_SS="" run 45 - stop "no connections past the limit"
FAKE_SS="" run 29 - keep "no connections inside the limit"
FAKE_SS="" run 30 - stop "exactly at the limit"
FAKE_SS="$(conn 10.88.0.1:40000 1000 1000)" run 45 - keep "fresh proxy traffic refreshes the stamp"
FAKE_SS="$(conn 10.89.14.10:40000 9000000 5000)" run 45 - keep "recent send alone counts"
FAKE_SS="$(conn 10.88.0.1:40000 9000000 9000000)" run 45 - stop "stale pooled connection does not count"
FAKE_SS="$(conn 127.0.0.1:40000 10 10)" run 45 - stop "loopback peer does not count"
FAKE_SS="$(conn '[::1]:40000' 10 10)" run 45 - stop "IPv6 loopback does not count"
FAKE_SS="$(printf '0      0      10.88.0.55:5173 10.88.0.1:40000\n\t cubic rto:201\n')" run 45 - stop "connection without timers does not count"
FAKE_SS="" run 45 5 keep "recent wake touch counts as use"
FAKE_SS="" run 45 40 stop "old wake touch does not"
FAKE_ACTIVE=0 FAKE_SS="" run 45 - keep "stopped unit is left alone"

# Image refresh: only while stopped, and at most every PULL_EVERY seconds.
pulls() { [ -f "$work/pulls" ] && wc -l < "$work/pulls" || echo 0; }
rm -f "$work/pulls" "$work/pulled"
FAKE_ACTIVE=1 FAKE_SS="$(conn 10.88.0.1:40000 10 10)" IDLE_MIN=30 "$idle" > /dev/null
[ "$(pulls)" = 0 ] || fail "pulled while running"
FAKE_ACTIVE=0 "$idle" > /dev/null
[ "$(pulls)" = 1 ] || fail "did not pull while stopped"
FAKE_ACTIVE=0 "$idle" > /dev/null
[ "$(pulls)" = 1 ] || fail "pulled again inside PULL_EVERY"
touch -d "@$(( $(date +%s) - 7 * 3600 ))" "$work/pulled"
FAKE_ACTIVE=0 "$idle" > /dev/null
[ "$(pulls)" = 2 ] || fail "did not pull again after PULL_EVERY"
rm -f "$work/pulls" "$work/pulled"
FAKE_ACTIVE=0 FAKE_PULL_FAILS=1 "$idle" > /dev/null
[ ! -f "$work/pulled" ] || fail "a failed pull was recorded as done"
FAKE_ACTIVE=0 "$idle" > /dev/null
[ "$(pulls)" = 2 ] || fail "a failed pull was not retried on the next run"

echo "dev-idle: all cases passed"
