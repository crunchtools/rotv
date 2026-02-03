# Application layer for Roots of The Valley
# Builds on top of rotv-base which contains PostgreSQL, Node.js, and Playwright
# For local development: run ./run.sh build-base first if base image doesn't exist

# Use the base image from quay.io (or local build)
ARG BASE_IMAGE=quay.io/fatherlinux/rotv-base:latest
FROM ${BASE_IMAGE}

# Labels - bump version here to force app layer rebuild
LABEL maintainer="fatherlinux"
LABEL description="Roots of The Valley - Cuyahoga Valley National Park destination explorer"
LABEL version="1.14.2"

# Build environment: 'production' (default) or 'test' (includes dev deps)
ARG BUILD_ENV=production

WORKDIR /app

# Build frontend
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Install backend dependencies
COPY backend/package*.json ./
RUN if [ "$BUILD_ENV" = "test" ]; then \
      npm install; \
    else \
      npm install --only=production; \
    fi

# Install Playwright npm package matching the base image version
# Browsers are pre-installed in base image, this just adds the npm package
RUN PLAYWRIGHT_VERSION=$(cat /etc/playwright-version) && \
    npm install playwright@$PLAYWRIGHT_VERSION

# Copy backend code
COPY backend/ ./

# Move built frontend to public directory
RUN mv frontend/dist public && rm -rf frontend

# Create systemd unit file for backend Node.js server
RUN cat > /etc/systemd/system/rotv-backend.service <<'EOF'
[Unit]
Description=Roots of The Valley Backend API Server
After=postgresql.service
Requires=postgresql.service

[Service]
Type=simple
WorkingDirectory=/app
Environment=NODE_ENV=development
Environment=NODE_PATH=/usr/local/lib/node_modules
Environment=PORT=8080
Environment=STATIC_PATH=/app/public
Environment=PGHOST=localhost
Environment=PGPORT=5432
Environment=PGDATABASE=rotv
Environment=PGUSER=postgres
Environment=PGPASSWORD=rotv

# Pass through environment variables from container
EnvironmentFile=-/etc/rotv/environment

# Start Node.js server
ExecStart=/usr/bin/node /app/server.js

# Auto-restart on failure
Restart=always
RestartSec=5s

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Create initialization script for database setup
RUN cat > /usr/local/bin/rotv-init.sh <<'EOF'
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

# Create database
echo "Creating database..."
cd /app
psql -U postgres -d postgres -c "CREATE DATABASE rotv;" 2>/dev/null || echo "Database already exists"

# Import seed data if available (contains schema + data)
if [ -f /tmp/seed-data.sql ]; then
  echo "Importing seed data (schema + data)..."
  psql -U postgres -d rotv -f /tmp/seed-data.sql
  echo "Seed data imported"
fi

# Run migrations to add new columns
echo "Running schema migrations..."
for migration in /app/migrations/*.sql; do
  if [ -f "$migration" ]; then
    echo "Running migration: $(basename $migration)"
    psql -U postgres -d rotv -f "$migration"
  fi
done
echo "Migrations complete"

echo "Database initialization complete"
EOF
RUN chmod +x /usr/local/bin/rotv-init.sh

# Create oneshot systemd service for database initialization
RUN cat > /etc/systemd/system/rotv-init.service <<'EOF'
[Unit]
Description=Initialize ROTV Database
After=postgresql.service
Before=rotv-backend.service
Requires=postgresql.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rotv-init.sh
RemainAfterExit=yes

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Enable services
RUN systemctl enable rotv-init.service rotv-backend.service

# Create directory for environment file
RUN mkdir -p /etc/rotv

EXPOSE 8080

# systemd is already set as CMD in base image
