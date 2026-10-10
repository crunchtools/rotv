#!/bin/bash
# The only thing the hosted dev container's SSH key can run on the production
# host (docs/DEVELOPMENT_ARCHITECTURE.md, "Hosted dev"). Installed outside the
# directories that container mounts and named as command= on the key's
# authorized_keys line, so sshd runs this whatever the client asked for and
# passes the request in SSH_ORIGINAL_COMMAND. It takes one word and no arguments.
set -uo pipefail
PATH=/usr/sbin:/usr/bin

SERVICE=rootsofthevalley.org
HEALTH_URL=http://127.0.0.1:8082/api/health
# The container boots PostgreSQL and runs every migration before the backend listens
HEALTH_TRIES=60
HEALTH_INTERVAL=5

running_image() {
    podman inspect --format '{{printf "%.12s" .Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$SERVICE" 2>/dev/null \
        || echo "not running"
}

show_status() {
    echo "service: $(systemctl is-active "$SERVICE")"
    echo "image:   $(running_image)"
}

case "${SSH_ORIGINAL_COMMAND:-}" in
    deploy)
        echo "before:  $(running_image)"
        # The unit pulls :latest in ExecStartPre, so a restart is the deploy
        if ! systemctl restart "$SERVICE"; then
            journalctl -u "$SERVICE" --no-pager -n 30
            exit 1
        fi
        for _ in $(seq "$HEALTH_TRIES"); do
            if curl -fs -o /dev/null --max-time 3 "$HEALTH_URL"; then
                show_status
                exit 0
            fi
            sleep "$HEALTH_INTERVAL"
        done
        echo "No answer from $HEALTH_URL after $((HEALTH_TRIES * HEALTH_INTERVAL))s"
        show_status
        journalctl -u "$SERVICE" --no-pager -n 30
        exit 1
        ;;
    status)
        show_status
        ;;
    logs)
        journalctl -u "$SERVICE" --no-pager -n 50
        ;;
    *)
        echo "Usage: ssh rotv-prod <deploy|status|logs>"
        exit 1
        ;;
esac
