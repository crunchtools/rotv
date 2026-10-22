#!/usr/bin/env bash
# Boot test: start an image under systemd and assert what production
# monitoring asserts (the Nagios checks on ctr-rootsofthevalley.org).
#
#   tests/image/boot.sh <image-ref> <profile>     profile: app | images
#
# Ephemeral storage only; no secrets needed. CONTAINER_ENGINE as contract.sh.
set -euo pipefail

image=${1:?usage: boot.sh <image-ref> <profile>}
profile=${2:?usage: boot.sh <image-ref> <profile>}
engine=${CONTAINER_ENGINE:-podman}
name=boot-test-$$

case "$profile" in
  app)
    port=8080
    # rsyslog is left out: it exits 1 under Docker on GitHub's runners (fine
    # under podman), and the contract test already asserts it is enabled
    units="postgresql rotv-init rotv-backend rotv-display umami"
    pg_check="pg_isready -h localhost -p 5432"
    procs="weston"
    urls="/api/health /"
    # The production unit mounts the same tmpfs for rsyslog's state
    mounts=(--tmpfs /data/pgdata:rw,size=1G,mode=0700 --tmpfs /var/lib/rsyslog:rw,size=8m)
    ;;
  images)
    port=8000
    units="postgresql imageserver-db-init image-server"
    pg_check="pg_isready -h localhost -p 5432"
    procs=""
    urls="/api/health"
    mounts=(--tmpfs /var/lib/pgsql/data:rw,size=1G --tmpfs /data/media:rw,size=256m)
    ;;
  *) echo "boot: no boot profile '$profile'" >&2; exit 2 ;;
esac

envfile=$(mktemp)
# umami's setup waits for a PGPASSWORD (prod sets one in rotv.env). The test
# database is fresh and local-trust, so any per-run value will do.
printf '%s\n' "DISABLE_LIVE_BOAT_TRACKER=true" \
  "PGPASSWORD=$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')" > "$envfile"
trap '"$engine" rm -f "$name" >/dev/null 2>&1 || true; rm -f "$envfile"' EXIT

# systemd as PID 1: same flags tests.yml has used since it was written.
# No network: the image must come up on its own, and nothing it schedules
# at boot can reach a real API or mail server.
"$engine" run -d --name "$name" --privileged --cgroupns=host --network none \
  --memory 3g \
  --tmpfs /run --tmpfs /run/lock "${mounts[@]}" \
  -v "$envfile:/etc/rotv/environment:ro" \
  "$image" >/dev/null

in_ctr() { "$engine" exec "$name" "$@"; }
fail=0
check() { local d=$1; shift; if "$@" >/dev/null 2>&1; then echo "ok   $d"; else echo "FAIL $d"; fail=1; fi; }

# One deadline for the whole boot: a broken image fails in minutes, not
# one timeout per unit. Stop early once every unit is up or any has failed.
deadline=$((SECONDS + ${BOOT_TIMEOUT:-300}))
while [ $SECONDS -lt $deadline ]; do
  # is-active with several units succeeds if any one is active, so count
  [ "$(in_ctr systemctl is-active $units 2>/dev/null | grep -cx active)" = "$(wc -w <<<"$units")" ] && break
  [ -n "$(in_ctr systemctl list-units --state=failed --no-legend 2>/dev/null)" ] && break
  sleep 3
done
echo "boot: settled after ${SECONDS}s"

for u in $units; do
  check "unit $u active" in_ctr systemctl is-active --quiet "$u"
done

check "no failed units" in_ctr sh -c '[ -z "$(systemctl list-units --state=failed --no-legend)" ]'

check "postgresql accepting connections" in_ctr sh -c "$pg_check"

for p in $procs; do
  check "process $p running" in_ctr pgrep -x "$p"
done

# The backend can lag its unit going active by a few seconds
for u in $urls; do
  check "GET $u returns 200" in_ctr sh -c "for i in \$(seq 15); do [ \"\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$port$u)\" = 200 ] && exit 0; sleep 2; done; exit 1"
done

if [ "$fail" -ne 0 ]; then
  echo "=== failed units ==="; in_ctr systemctl list-units --state=failed --no-pager || true
  for u in $units; do
    in_ctr systemctl is-active --quiet "$u" || in_ctr systemctl status "$u" --no-pager -n 20 || true
  done
  echo "=== journal (errors) ==="; in_ctr journalctl -p err --no-pager -n 60 || true
  echo "boot: FAIL"; exit 1
fi
echo "boot: PASS"
