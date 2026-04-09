#!/bin/bash
set -e

echo "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
  if pg_isready -h localhost -p 5432 -U postgres >/dev/null 2>&1; then
    echo "PostgreSQL is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "PostgreSQL failed to start"
    exit 1
  fi
  sleep 1
done

echo "Creating database..."
cd /app
psql -U postgres -d postgres -c "CREATE DATABASE rotv;" 2>/dev/null || echo "Database already exists"

if [ -f /tmp/seed-data.sql ]; then
  echo "Importing seed data (schema + data)..."
  psql -U postgres -d rotv -f /tmp/seed-data.sql
  echo "Seed data imported"
fi

echo "Running schema migrations..."
for migration in /app/migrations/*.sql; do
  if [ -f "$migration" ]; then
    echo "Running migration: $(basename $migration)"
    psql -U postgres -d rotv -f "$migration"
  fi
done
echo "Migrations complete"

# Post-migration setup for auth bypass (test mode)
if [ "$BYPASS_AUTH" = "true" ] || [ "$NODE_ENV" = "test" ]; then
  echo "Setting up auth bypass for test mode..."
  psql -U postgres -d rotv <<'EOF'
-- Create test admin user for auth bypass
INSERT INTO users (id, email, name, oauth_provider, oauth_provider_id, is_admin, role)
VALUES (999, 'test-admin@rotv.local', 'Test Admin', 'test', '999', true, 'admin')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  is_admin = EXCLUDED.is_admin,
  role = EXCLUDED.role;
EOF
  echo "Auth bypass test user created (ID 999)"
fi

# Fix boundary geometry if needed (migration 019 workaround)
echo "Verifying boundary geometry..."
psql -U postgres -d rotv <<'EOF'
-- Ensure boundary_geom column exists and is MultiPolygon type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pois' AND column_name = 'boundary_geom'
  ) THEN
    ALTER TABLE pois ADD COLUMN boundary_geom geometry(MultiPolygon, 4326);
  END IF;
END $$;

-- Populate boundary geometry from GeoJSON if empty
UPDATE pois
SET boundary_geom = ST_SetSRID(
  ST_Multi(ST_GeomFromGeoJSON(geometry::text))::geometry(MultiPolygon, 4326),
  4326
)
WHERE poi_type = 'boundary'
  AND geometry IS NOT NULL
  AND boundary_geom IS NULL;

-- Create spatial index if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_pois_boundary_geom
ON pois USING GIST (boundary_geom)
WHERE poi_type = 'boundary';
EOF
echo "Boundary geometry verified"

echo "Database initialization complete"
