# Roots of The Valley — single-stage build
# When BASE_IMAGE=rotv-base, infrastructure layers are pre-baked (fast CI builds)
# When BASE_IMAGE=ubi10-core, everything builds from scratch (local dev)

ARG BASE_IMAGE=quay.io/crunchtools/ubi10-core:latest
FROM ${BASE_IMAGE}

LABEL maintainer="fatherlinux <scott.mccarty@crunchtools.com>"
LABEL description="Roots of The Valley - Cuyahoga Valley National Park destination explorer"

# Install Node.js and Playwright/Chromium system dependencies
# No RHSM needed — all packages in UBI + pgdg repos
# When using rotv-base, these are already installed (cache hit / no-op)
RUN dnf install -y nodejs npm \
    nspr nss alsa-lib atk cups-libs gtk3 \
    libXcomposite libXdamage libXrandr libxkbcommon \
    mesa-libgbm pango libdrm \
    libxshmfence libX11 libXext libXfixes \
    && dnf clean all

# Install Playwright globally with Chromium (pinned to match backend/package.json)
RUN npm install -g playwright@1.58.1 && npx playwright install chromium

# Add PostgreSQL 17 + PostGIS from official pgdg repository
# RHSM registration provides RHEL BaseOS/AppStream (required for boost-serialization)
# EPEL provides additional PostGIS dependencies (hdf5, xerces-c)
ARG RHSM_ORG_ID
ARG RHSM_ACTIVATION_KEY
RUN if [ -n "$RHSM_ORG_ID" ] && [ -n "$RHSM_ACTIVATION_KEY" ]; then \
      subscription-manager register --org="$RHSM_ORG_ID" --activationkey="$RHSM_ACTIVATION_KEY"; \
    fi && \
    dnf install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-10.noarch.rpm && \
    dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-10-x86_64/pgdg-redhat-repo-latest.noarch.rpm && \
    dnf install -y postgresql17-server postgresql17 postgis35_17 && \
    if [ -n "$RHSM_ORG_ID" ]; then subscription-manager unregister || true; fi && \
    dnf clean all

# Create symlinks for PostgreSQL commands
RUN ln -sf /usr/pgsql-17/bin/initdb /usr/local/bin/initdb && \
    ln -sf /usr/pgsql-17/bin/pg_ctl /usr/local/bin/pg_ctl && \
    ln -sf /usr/pgsql-17/bin/postgres /usr/local/bin/postgres && \
    ln -sf /usr/pgsql-17/bin/psql /usr/local/bin/psql && \
    ln -sf /usr/pgsql-17/bin/pg_isready /usr/local/bin/pg_isready

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
# BUILD_ENV=test includes devDependencies (vitest) for CI
ARG BUILD_ENV=production
COPY backend/package*.json ./
RUN if [ "$BUILD_ENV" = "test" ]; then npm install; else npm install --omit=dev; fi

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
EXPOSE 3001

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
