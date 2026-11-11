#!/bin/bash
set -e

until pg_isready -U postgres > /dev/null 2>&1; do
  sleep 1
done

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'imageserver'" | grep -q 1 || \
  sudo -u postgres createdb imageserver

sudo -u postgres psql -tc "SELECT 1 FROM pg_user WHERE usename = 'imageserver'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER imageserver WITH PASSWORD 'imageserver';"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE imageserver TO imageserver;"
sudo -u postgres psql -d imageserver -c "GRANT ALL ON SCHEMA public TO imageserver;"
sudo -u postgres psql -d imageserver -c "ALTER DATABASE imageserver OWNER TO imageserver;"
sudo -u postgres psql -d imageserver -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "Image server database initialized with pgvector"
