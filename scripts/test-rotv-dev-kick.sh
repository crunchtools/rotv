#!/bin/bash
# The control names are the dev site's interface (docs/DEVELOPMENT_ARCHITECTURE.md,
# "Hosted dev"). Containerfile.dev runs this while building the image, with a
# stand-in systemctl, so a name that maps to the wrong units fails the build.
set -euo pipefail

kick=${1:-/usr/local/bin/rotv-dev-kick.sh}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/logs"
cat > "$work/bin/systemctl" <<'FAKE'
#!/bin/bash
echo "$*" >> "$ROTV_DEV_LOG_DIR/systemctl.calls"
[ "${FAKE_SYSTEMCTL_FAILS:-}" = 1 ] && exit 3
exit 0
FAKE
chmod +x "$work/bin/systemctl"
export PATH="$work/bin:$PATH" ROTV_DEV_LOG_DIR="$work/logs"

fail() { echo "FAIL: $*" >&2; exit 1; }

expect_units() {
  : > "$work/logs/systemctl.calls"
  "$kick" "$1" > /dev/null || fail "$1 exited non-zero"
  [ "$(cat "$work/logs/systemctl.calls")" = "restart $2" ] || fail "$1 restarted '$(cat "$work/logs/systemctl.calls")', expected '$2'"
}

expect_units ui "rotv-dev-ui"
expect_units backend "rotv-backend"
expect_units init "rotv-init rotv-backend"
expect_units deps "rotv-dev-deps rotv-backend rotv-dev-ui"

for name in "" "postgresql" "../ui" "ui backend"; do
  : > "$work/logs/systemctl.calls"
  status=0
  "$kick" "$name" > /dev/null 2>&1 || status=$?
  [ "$status" -eq 64 ] || fail "'$name' exited $status, expected 64"
  [ ! -s "$work/logs/systemctl.calls" ] || fail "'$name' reached systemctl"
done

grep -q " ui: restarting rotv-dev-ui$" "$work/logs/control.log" || fail "a kick is not in control.log"
grep -q " ui: done$" "$work/logs/control.log" || fail "a finished kick is not in control.log"

status=0
FAKE_SYSTEMCTL_FAILS=1 "$kick" ui > /dev/null || status=$?
[ "$status" -eq 3 ] || fail "a failed restart exited $status, expected systemctl's 3"
grep -q " ui: failed (3)$" "$work/logs/control.log" || fail "a failed kick is not in control.log"

for _ in $(seq 300); do "$kick" backend > /dev/null; done
[ "$(wc -l < "$work/logs/control.log")" -le 500 ] || fail "control.log grew past its cap"

# Kicks that overlap must each keep both of their lines.
: > "$work/logs/control.log"
for name in ui backend init deps ui backend init deps; do "$kick" "$name" > /dev/null & done
wait
[ "$(wc -l < "$work/logs/control.log")" -eq 16 ] || fail "concurrent kicks lost lines: $(wc -l < "$work/logs/control.log") of 16"
[ -z "$(find "$work/logs" -name '.control.log.*' -print -quit)" ] || fail "a temporary file was left behind"

echo "rotv-dev-kick: all checks passed"
