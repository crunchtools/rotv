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
psql -h localhost -U postgres -d postgres -c "CREATE DATABASE rotv;" 2>/dev/null || echo "Database already exists"

if [ -f /tmp/seed-data.sql ]; then
  echo "Importing seed data (schema + data)..."
  psql -h localhost -U postgres -d rotv -f /tmp/seed-data.sql
  echo "Seed data imported"
fi

# Run all numbered SQL migrations in sorted order
# Migrations are idempotent (IF NOT EXISTS, etc.) so safe to re-run
echo "Running database migrations..."
MIGRATION_COUNT=0
for migration in /app/migrations/[0-9]*.sql; do
  [ -f "$migration" ] || continue
  MIGRATION_NAME=$(basename "$migration")
  psql -h localhost -U postgres -d rotv -f "$migration" > /tmp/migration_output.txt 2>&1
  MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
done
echo "$MIGRATION_COUNT migrations applied"

# Post-migration setup for auth bypass (test mode)
if [ "$BYPASS_AUTH" = "true" ] || [ "$NODE_ENV" = "test" ]; then
  echo "Setting up auth bypass for test mode..."
  psql -h localhost -U postgres -d rotv <<'EOF'
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

echo "Database initialization complete"
