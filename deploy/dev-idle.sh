#!/bin/bash
# dev-idle.sh — stop dev.rootsofthevalley.org once nobody has used it for
# IDLE_MIN minutes. Run by dev.rootsofthevalley.org-idle.timer. Tested by
# scripts/test-dev-idle.sh.
#
# "Used" means a client connection to Vite (:5173) or the backend (:8080) that
# moved data since the last check, seen from inside the container's network
# namespace. Counting open connections alone is not enough: Apache pools its
# backend connections and a forgotten browser tab holds the HMR websocket open,
# so either would keep the container up forever. The kernel's lastrcv/lastsnd
# timers say when each one last carried anything. Loopback peers are the
# container talking to itself (Vite proxying /api to the backend) and do not
# count. A touch of data/control/wake counts as use, so an agent that just
# woke the container gets a full window before the next check can stop it.
set -u

UNIT=dev.rootsofthevalley.org.service
NAME=dev.rootsofthevalley.org
STAMP=${STAMP:-/run/dev.rootsofthevalley.org.active}
WAKE=${WAKE:-/srv/dev.rootsofthevalley.org/data/control/wake}
IDLE_MIN=${IDLE_MIN:-30}
WINDOW_MS=${WINDOW_MS:-360000}   # a little over the timer interval

systemctl is-active -q "$UNIT" || exit 0
PID=$(podman inspect -f '{{.State.Pid}}' "$NAME" 2>/dev/null) || exit 0
[ "${PID:-0}" -gt 0 ] || exit 0

ACTIVE=$(nsenter -t "$PID" -n ss -Htni state established '( sport = :5173 or sport = :8080 )' | awk -v win="$WINDOW_MS" '
    /^[[:space:]]/ {
        if (keep) {
            r = 1e15; s = 1e15
            if (match($0, /lastrcv:[0-9]+/)) r = substr($0, RSTART + 8, RLENGTH - 8) + 0
            if (match($0, /lastsnd:[0-9]+/)) s = substr($0, RSTART + 8, RLENGTH - 8) + 0
            if (r < win || s < win) n++
        }
        keep = 0
        next
    }
    { keep = ($4 !~ /^(127\.|\[::1\]|\[::ffff:127\.)/) }
    END { print n + 0 }')

[ -f "$STAMP" ] || touch "$STAMP"
[ "${ACTIVE:-0}" -gt 0 ] && touch "$STAMP"

NOW=$(date +%s)
LAST=$(stat -c %Y "$STAMP")
WOKE=$(stat -c %Y "$WAKE" 2>/dev/null || echo 0)
[ "$WOKE" -gt "$LAST" ] && LAST=$WOKE

IDLE=$(( (NOW - LAST) / 60 ))
if [ "$IDLE" -ge "$IDLE_MIN" ]; then
    echo "idle ${IDLE}m (limit ${IDLE_MIN}m), stopping $UNIT"
    systemctl stop --no-block "$UNIT"
else
    echo "active connections: $ACTIVE, idle ${IDLE}m of ${IDLE_MIN}m"
fi
