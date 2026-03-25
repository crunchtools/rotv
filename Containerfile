# Roots of The Valley — single-stage build on ubi10-core
# Services: PostgreSQL 17 (pgdg), Node.js, Playwright/Chromium

FROM quay.io/crunchtools/ubi10-core:latest

LABEL maintainer="fatherlinux <scott.mccarty@crunchtools.com>"
LABEL description="Roots of The Valley - Cuyahoga Valley National Park destination explorer"

# Install Node.js and Playwright/Chromium system dependencies
# No RHSM needed — all packages in UBI + pgdg repos
RUN dnf install -y nodejs npm \
    nspr nss alsa-lib atk cups-libs gtk3 \
    libXcomposite libXdamage libXrandr libxkbcommon \
    mesa-libgbm pango libdrm \
    libxshmfence libX11 libXext libXfixes \
    && dnf clean all

# Install Playwright globally with Chromium
RUN npm install -g playwright && npx playwright install chromium

# Add PostgreSQL 17 from official pgdg repository (no RHSM needed)
RUN dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-10-x86_64/pgdg-redhat-repo-latest.noarch.rpm && \
    dnf install -y postgresql17-server postgresql17 && \
    dnf clean all

# Create symlinks for PostgreSQL commands
RUN ln -s /usr/pgsql-17/bin/initdb /usr/local/bin/initdb && \
    ln -s /usr/pgsql-17/bin/pg_ctl /usr/local/bin/pg_ctl && \
    ln -s /usr/pgsql-17/bin/postgres /usr/local/bin/postgres && \
    ln -s /usr/pgsql-17/bin/psql /usr/local/bin/psql && \
    ln -s /usr/pgsql-17/bin/pg_isready /usr/local/bin/pg_isready

# PostgreSQL user (runs as uid 70 for pgdg compatibility)
RUN useradd -u 70 -m -s /bin/bash postgres || true

# PostgreSQL data directory (bind-mounted at runtime)
ENV PGDATA=/data/pgdata
RUN mkdir -p /data/pgdata && chown postgres:postgres /data/pgdata

# Environment
ENV NODE_ENV=development PORT=8080 STATIC_PATH=/app/public
ENV PGHOST=localhost PGPORT=5432 PGDATABASE=rotv PGUSER=postgres PGPASSWORD=rotv

WORKDIR /app

# Build frontend
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Install backend dependencies
COPY backend/package*.json ./
RUN npm install --only=production

# Copy backend code
COPY backend/ ./

# Move built frontend to public directory
RUN mv frontend/dist public && rm -rf frontend

# Copy systemd units and scripts
COPY rootfs/ /

# Make scripts executable and enable services
RUN chmod +x /usr/local/bin/rotv-init.sh && \
    systemctl enable postgresql rotv-init rotv-backend

# Create directory for environment file
RUN mkdir -p /etc/rotv

EXPOSE 8080
EXPOSE 25
