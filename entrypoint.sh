#!/bin/bash
set -e

PGDATA="${PGDATA:-/data/pgdata}"
PGRUNDIR="/tmp/pgsocket"

echo "=== Roots of The Valley ==="
echo "Starting up..."

# Create PostgreSQL socket directory with correct ownership
mkdir -p "$PGRUNDIR"
chown postgres:postgres "$PGRUNDIR"
chmod 755 "$PGRUNDIR"

# Ensure data directory ownership is correct
# Both tmpfs and bind mounts need ownership fixed since container runs as root
PGDATA_OWNER=$(stat -c '%u' "$PGDATA" 2>/dev/null || echo "unknown")
if [ "$PGDATA_OWNER" != "70" ]; then
    echo "Fixing data directory permissions..."
    chown -R postgres:postgres "$PGDATA"
    chmod 700 "$PGDATA"
fi

# Remove stale PID file if it exists (from previous unclean shutdown)
rm -f "$PGDATA/postmaster.pid" 2>/dev/null || true

# Initialize PostgreSQL if needed
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "Initializing PostgreSQL database..."

    # Initialize as postgres user (PostgreSQL refuses to run as root)
    # Use runuser to preserve environment variables
    runuser -u postgres -- initdb -D "$PGDATA" -U postgres

    # Configure PostgreSQL for local connections
    cat >> "$PGDATA/pg_hba.conf" << 'EOF'
host all all 127.0.0.1/32 trust
host all all ::1/128 trust
local all all trust
EOF

    # Configure PostgreSQL to listen on localhost and use custom socket dir
    cat >> "$PGDATA/postgresql.conf" << EOF
listen_addresses = 'localhost'
unix_socket_directories = '$PGRUNDIR'
EOF

    # Start PostgreSQL temporarily to create databases (as postgres user)
    runuser -u postgres -- pg_ctl -D "$PGDATA" -l /tmp/pg_init.log start -o "-k $PGRUNDIR"
    sleep 3

    echo "Creating databases..."
    psql -h "$PGRUNDIR" -U postgres -d postgres -c "CREATE DATABASE rotv;" 2>/dev/null || true
    psql -h "$PGRUNDIR" -U postgres -d postgres -c "CREATE DATABASE rotv_test;" 2>/dev/null || true

    runuser -u postgres -- pg_ctl -D "$PGDATA" stop
    sleep 2
fi

# Start PostgreSQL as postgres user (container runs as root, but PostgreSQL as postgres)
echo "Starting PostgreSQL..."
runuser -u postgres -- pg_ctl -D "$PGDATA" -l "$PGDATA/postgresql.log" start -o "-k $PGRUNDIR"

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
    if pg_isready -h "$PGRUNDIR" -q; then
        echo "PostgreSQL is ready"
        break
    fi
    sleep 1
done

# Ensure rotv_test database exists (for testing)
psql -h "$PGRUNDIR" -U postgres -d postgres -c "CREATE DATABASE rotv_test;" 2>/dev/null || true

# Import seed data if available (before app starts to avoid schema conflicts)
if [ -f /tmp/seed-data.sql ]; then
    echo "Importing seed data..."
    psql -h "$PGRUNDIR" -U postgres -d rotv -f /tmp/seed-data.sql 2>&1 | grep -c "^COPY" | xargs echo "Imported rows from tables:"
    echo "✓ Seed data imported"
fi

# Run all numbered SQL migrations (after seed data import)
# Migrations are idempotent (IF NOT EXISTS, etc.) so safe to re-run
echo "Running database migrations..."
MIGRATION_COUNT=0
for migration in /app/migrations/[0-9]*.sql; do
    [ -f "$migration" ] || continue
    MIGRATION_NAME=$(basename "$migration")
    if psql -h "$PGRUNDIR" -U postgres -d rotv -v ON_ERROR_STOP=1 -f "$migration" > /tmp/migration_output.txt 2>&1; then
        MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
    else
        echo "ERROR: Migration $MIGRATION_NAME failed:"
        cat /tmp/migration_output.txt
        exit 1
    fi
done
echo "✓ $MIGRATION_COUNT migrations applied"

# Start the Node.js application
echo "Starting Roots of The Valley application..."
cd /app
exec node server.js
