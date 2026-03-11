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

echo "Database initialization complete"
