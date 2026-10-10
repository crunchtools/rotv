#!/bin/bash
# Replace the dev database with a scrubbed copy of production's. Runs on the
# host that has both containers (./run.sh dev-host seed sends it over ssh).
#
# The dev database is dropped and recreated, then the dump and the scrub go
# through one psql transaction that stops on the first error. So the database
# is either empty or a complete, scrubbed copy: unscrubbed production data is
# never committed to it. A fresh database rather than pg_dump --clean, whose
# DROPs fail on pg-boss's partitioned tables ("cannot drop inherited constraint").
set -euo pipefail

PROD="${PRODUCTION_CONTAINER:-rootsofthevalley.org}"
DEV="${DEV_CONTAINER:-dev.rootsofthevalley.org}"

# Everyone who reaches the dev site is an admin, and so is the Claude session
# inside it. Accounts keep their rows, so the UI has realistic data, but lose
# what identifies or authenticates a person, and the trips people wrote are
# dropped (favorites and visits are only POI ids). Third-party credentials go too:
# set one in the dev admin settings if a manual collection run needs it. Jobs
# production had queued must not run a second time from here.
scrub_sql() {
    cat <<'SQL'
-- pg_dump leaves the session with an empty search_path
SET search_path = public;
TRUNCATE sessions, email_login_tokens, user_passwords, user_passkeys, user_identities;
TRUNCATE trips CASCADE;
UPDATE users SET
    email = 'user' || id || '@example.invalid',
    name = 'User ' || id,
    username = NULL,
    picture_url = NULL,
    oauth_provider_id = 'dev-' || id,
    oauth_credentials = NULL,
    mcp_token = NULL;
UPDATE newsletter_subscriptions SET email = gen_random_uuid() || '@example.invalid';
UPDATE admin_settings SET value = NULL
    WHERE key ~ '(key|token|secret|password|credential|cookie|email)';
DELETE FROM pgboss.job WHERE state NOT IN ('completed', 'failed', 'cancelled');
SQL
}

podman exec "$DEV" systemctl stop rotv-backend.service

echo "Copying the rotv database from $PROD to $DEV..."
podman exec "$DEV" psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS rotv WITH (FORCE)" -c "CREATE DATABASE rotv"
{
    podman exec "$PROD" pg_dump -U rotv --no-owner --no-acl rotv
    scrub_sql
} | podman exec -i "$DEV" psql -q -U postgres -d rotv -v ON_ERROR_STOP=1 --single-transaction >/dev/null

# The checkout may be ahead of production's schema, and the dump replaced the
# test admin: rotv-init reapplies both.
podman exec "$DEV" systemctl restart rotv-init.service
podman exec "$DEV" systemctl start rotv-backend.service
echo "Done: $(podman exec "$DEV" psql -At -U postgres -d rotv -c 'SELECT count(*) FROM pois') POIs"
