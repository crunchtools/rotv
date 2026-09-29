#!/bin/bash
# Umami wants a DATABASE_URL; build it from the same PG* variables the backend
# uses (/etc/rotv/environment) so no credential lives in the unit file.
set -euo pipefail
if [ -z "${PGPASSWORD:-}" ]; then
  echo "umami: PGPASSWORD not set in /etc/rotv/environment, analytics stays off"
  exit 0
fi
cd /opt/umami
enc() { node -p 'encodeURIComponent(process.argv[1])' "$1"; }
export DATABASE_URL="postgresql://$(enc "$PGUSER"):$(enc "$PGPASSWORD")@${PGHOST}:${PGPORT}/umami"
# Umami owns its schema: check-db runs its Prisma migrations
node scripts/check-db.js
exec node server.js
