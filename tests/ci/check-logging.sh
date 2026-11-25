#!/usr/bin/env bash
# CI setup, run inside the rotv:test container by the `backend` check
# (pyproject.toml): central logging (constitution XIII). The image carries
# the fleet's rsyslog forward and enables rsyslog to run it.
set -euo pipefail
status=0
if [ ! -f /etc/rsyslog.d/00-crunchtools-forward.conf ]; then
  echo "check-logging: /etc/rsyslog.d/00-crunchtools-forward.conf is missing"
  status=1
fi
if [ "$(systemctl is-enabled rsyslog 2>&1)" != enabled ]; then
  echo "check-logging: rsyslog is not enabled"
  status=1
fi
exit $status
