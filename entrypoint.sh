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

# Run schema migrations (after seed data import)
echo "Running schema migrations..."
psql -h "$PGRUNDIR" -U postgres -d rotv << 'EOF'
-- Add status_url column if it doesn't exist (MTB Trail Status feature)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'pois' AND column_name = 'status_url') THEN
        ALTER TABLE pois ADD COLUMN status_url VARCHAR(500);
    END IF;
END $$;

-- Create trail_status_job_status table if it doesn't exist
CREATE TABLE IF NOT EXISTS trail_status_job_status (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(50),
  status VARCHAR(20),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  total_trails INTEGER,
  trails_processed INTEGER,
  status_found INTEGER,
  error_message TEXT,
  poi_ids TEXT,
  processed_poi_ids TEXT,
  pg_boss_job_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trail_status_job_status_status') THEN
        CREATE INDEX idx_trail_status_job_status_status ON trail_status_job_status(status);
    END IF;
END $$;

-- Create trail_status table if it doesn't exist
CREATE TABLE IF NOT EXISTS trail_status (
  id SERIAL PRIMARY KEY,
  poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  conditions TEXT,
  last_updated TIMESTAMP,
  source_name VARCHAR(200),
  source_url VARCHAR(1000),
  weather_impact TEXT,
  seasonal_closure BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for trail_status if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trail_status_poi_id') THEN
        CREATE INDEX idx_trail_status_poi_id ON trail_status(poi_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trail_status_updated') THEN
        CREATE INDEX idx_trail_status_updated ON trail_status(last_updated DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trail_status_status') THEN
        CREATE INDEX idx_trail_status_status ON trail_status(status);
    END IF;
END $$;
EOF
echo "✓ Schema migrations complete"

# Start the Node.js application
echo "Starting Roots of The Valley application..."
cd /app
exec node server.js
