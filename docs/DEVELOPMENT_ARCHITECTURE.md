# Development Architecture

## Introduction: How It Works

The development storage system provides developers with a fast, reliable way to work with real production data while maintaining a clean, reproducible environment. This architecture eliminates common development issues like database permission conflicts, stale test data, and slow container rebuilds by combining ephemeral storage with intelligent production data caching.

### The Problem We're Solving

Traditional containerized development workflows face several challenges:

1. **Permission conflicts**: Bind-mounted database directories create UID/GID mismatches between container users and host filesystem permissions
2. **Stale development data**: Developers create test data manually, which diverges from production and becomes outdated
3. **Slow container rebuilds**: Changing version labels or application code rebuilds the entire container stack, including infrastructure layers
4. **Data persistence complexity**: Developers need different storage modes for development (throwaway) vs production (persistent)

### Our Multi-Layered Solution

**1. Ephemeral Storage with tmpfs**
Development mode uses in-memory tmpfs storage for the PostgreSQL database. This provides:
- **Lightning-fast startup**: No disk I/O bottlenecks
- **Clean slate every restart**: Data is automatically discarded when container stops
- **Zero permission issues**: tmpfs is owned by the container, no bind mount conflicts
- **Perfect for testing**: Each test run starts with known-good production data

**2. Automatic Production Data Seeding**
On first startup, the system automatically pulls a complete database dump from production via SSH:
- **One-time setup**: Developers don't need to manually create test data
- **Real production data**: Test with actual destinations, news, events, and user data
- **Cached locally**: 384MB seed data stored at `~/.rotv/seed-data.sql` for fast reuse
- **Automatic import**: Seed data is imported before the application starts, preventing schema conflicts

**3. Smart Freshness Checking**
The system monitors the age of cached seed data:
- **7-day threshold**: Warns developers if cached data is older than 7 days
- **Non-blocking**: Still starts with old data, just reminds you to refresh
- **Manual refresh**: Run `./run.sh seed` anytime to pull latest production data

**4. Optimized Container Builds**
The Containerfile is structured to maximize Docker layer caching:
- **Infrastructure layer**: PostgreSQL, Node.js, Playwright (rarely changes)
- **Application layer**: App code, frontend builds (changes frequently)
- **Version labels**: Moved to top of app stage so version bumps only rebuild app layer
- **Playwright caching**: Chromium binary installed early in infrastructure layer

**5. Dual Storage Modes**
The same container supports two deployment modes:
- **Development** (`PERSISTENT_DATA=false`): Ephemeral tmpfs + production seed data
- **Production** (`PERSISTENT_DATA=true`): Persistent bind mount to `~/.rotv/pgdata`

**6. Secure Secrets Management**
Environment variables are loaded from `.env` files that are gitignored:
- **Local secrets**: `backend/.env` contains OAuth tokens, session keys, admin email
- **Git-safe**: `.gitignore` pattern excludes all `.env` files from version control
- **Template provided**: `.env.example` documents required variables for new developers

## Architecture Overview

### Development Data Flow
```
┌──────────────────────────────────────────────────────────────┐
│  1. Developer runs: ./run.sh start                           │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  2. Check for seed data at ~/.rotv/seed-data.sql             │
│     ├─ Missing? → Auto-pull from production via SSH          │
│     └─ Exists?  → Check age (warn if > 7 days old)           │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  3. Start container with tmpfs storage                       │
│     --tmpfs /data/pgdata:rw,size=2G,mode=0700                │
│     -v ~/.rotv/seed-data.sql:/tmp/seed-data.sql:ro           │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  4. entrypoint.sh runs:                                      │
│     ├─ Fix tmpfs permissions (chown postgres:postgres)       │
│     ├─ Initialize PostgreSQL database                        │
│     ├─ Start PostgreSQL server                               │
│     ├─ Import /tmp/seed-data.sql (if exists)                 │
│     └─ Start Node.js application                             │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  5. Application ready at http://localhost:8080               │
│     ✓ 371 POIs, 647 news items, 680 events                  │
│     ✓ Real production data for testing                       │
└──────────────────────────────────────────────────────────────┘
```

### Production Seed Data Pull
```
┌──────────────────────────────────────────────────────────────┐
│  Developer runs: ./run.sh seed                               │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Load production settings from backend/.env:                 │
│  ├─ PRODUCTION_HOST=sven.dc3.crunchtools.com                 │
│  ├─ PRODUCTION_PORT=22422                                    │
│  └─ PRODUCTION_CONTAINER=rootsofthevalley.org                │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  SSH to production and run pg_dump:                          │
│  ssh -p 22422 root@sven.dc3.crunchtools.com \               │
│    "podman exec rootsofthevalley.org \                       │
│     pg_dump -U rotv --clean --if-exists \                    │
│     --no-owner --no-acl rotv" \                              │
│    > ~/.rotv/seed-data.sql                                   │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  ✓ Production data cached (384M)                             │
│  Next ./run.sh start will import this data                   │
└──────────────────────────────────────────────────────────────┘
```

### Container Build Optimization
```
┌─────────────────────────────────────────────────────────────┐
│ FROM ubi10 AS infrastructure                                │
│ ├─ Install Node.js, npm (rarely changes)                    │
│ ├─ Install Playwright + Chromium (rarely changes)           │
│ ├─ Install PostgreSQL 17 (rarely changes)                   │
│ ├─ Create postgres user (UID 70)                            │
│ └─ Set environment variables                                │
│                                                              │
│ Result: Cached infrastructure layer (~1.2GB)                │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ FROM infrastructure AS application                          │
│ ├─ LABEL version="1.10.0" (bump to force rebuild)           │
│ ├─ npm install frontend dependencies                        │
│ ├─ Build frontend with Vite                                 │
│ ├─ npm install backend dependencies                         │
│ ├─ Copy backend code                                        │
│ ├─ Move frontend build to public/                           │
│ └─ Copy entrypoint.sh                                       │
│                                                              │
│ Result: Lightweight app layer (~200MB)                      │
└─────────────────────────────────────────────────────────────┘

Version bump (1.10.0 → 1.11.0):
  ✓ Infrastructure layer: CACHED (no rebuild)
  ✓ Application layer: REBUILD (fast, only ~2 minutes)
```

## Key Technologies

### Storage Technologies
- **tmpfs**: In-memory filesystem for ephemeral database storage
  - 2GB size limit (configurable)
  - 0700 permissions for security
  - Automatic cleanup on container stop

- **Bind mounts**: Persistent storage for production deployments
  - Host directory: `~/.rotv/pgdata` (default)
  - SELinux context: `:Z` flag for proper labeling
  - Ownership: Fixed with `podman unshare chown`

### Database Technologies
- **PostgreSQL 17**: Production-grade relational database
  - Unix socket directory: `/tmp/pgsocket` (custom for permissions)
  - Trust authentication: Local connections don't require password
  - postgres user: UID 70 (standard PostgreSQL user)

- **pg_dump**: PostgreSQL backup utility
  - `--clean --if-exists`: Drop objects before creating (idempotent)
  - `--no-owner --no-acl`: Ignore ownership (rotv vs postgres mismatch)
  - Output format: Plain SQL text (human-readable, compressible)

### Container Technologies
- **Podman**: Rootless container runtime
  - Privileged mode: Required for PostgreSQL to run as non-root user
  - User namespaces: `podman unshare` for UID/GID mapping
  - Network: Port 8080 exposed for web access

- **Multi-stage builds**: Separate infrastructure and application layers
  - Stage 1: `infrastructure` - rarely changes, heavily cached
  - Stage 2: `application` - changes frequently, fast rebuilds

### Shell Technologies
- **runuser**: Execute commands as different user (preserves environment)
  - Replaces `su -c` which doesn't preserve PGDATA, PGRUNDIR variables
  - Syntax: `runuser -u postgres -- command args`

- **SSH**: Secure remote command execution
  - Custom port: `-p 22422` for production server
  - Remote execution: `ssh host "command"` runs command and returns output

## Implementation Details

### File: run.sh

**Environment variable loading** (lines 16-21):
```bash
# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
elif [ -f "backend/.env" ]; then
    export $(grep -v '^#' backend/.env | xargs)
fi
```
Loads secrets from `.env` files on the **host machine** before starting container. This keeps secrets out of container images.

**Ephemeral storage configuration** (lines 58-61):
```bash
if [ "$USE_PERSISTENT" = "true" ]; then
    STORAGE_MOUNT="-v $DATA_DIR:/data/pgdata:Z"
else
    STORAGE_MOUNT="--tmpfs /data/pgdata:rw,size=2G,mode=0700"
fi
```
Development mode uses tmpfs (in-memory), production uses bind mount.

**Automatic seed data pull** (lines 67-90):
```bash
if [ ! -f "$SEED_DATA_FILE" ]; then
    echo "⚠ No seed data found at $SEED_DATA_FILE"
    echo "Automatically pulling production data..."

    ssh -p "$PRODUCTION_PORT" root@"$PRODUCTION_HOST" \
        "podman exec $PRODUCTION_CONTAINER pg_dump -U rotv --clean --if-exists --no-owner --no-acl rotv" \
        > "$SEED_DATA_FILE"

    if [ $? -eq 0 ]; then
        SEED_SIZE=$(du -h "$SEED_DATA_FILE" | cut -f1)
        echo "✓ Production data downloaded ($SEED_SIZE)"
    else
        echo "❌ Failed to pull production data"
        echo "Cannot start in development mode without seed data"
        exit 1
    fi
fi
```
First `./run.sh start` automatically pulls production data. Exits with error if pull fails.

**Freshness check** (lines 92-99):
```bash
SEED_AGE_DAYS=$(( ($(date +%s) - $(date -r "$SEED_DATA_FILE" +%s)) / 86400 ))
if [ $SEED_AGE_DAYS -gt 7 ]; then
    echo "⚠ Seed data is $SEED_AGE_DAYS days old"
    echo "Consider running './run.sh seed' to refresh production data"
fi
```
Warns developers if cached data is stale, but doesn't block startup.

**Seed data mounting** (lines 102-103):
```bash
echo "Mounting seed data for import..."
SEED_MOUNT="-v $SEED_DATA_FILE:/tmp/seed-data.sql:ro"
```
Mounts cached seed file as read-only volume. Container imports from `/tmp/seed-data.sql`.

### File: entrypoint.sh

**Permission fixing** (lines 17-22):
```bash
PGDATA_OWNER=$(stat -c '%u' "$PGDATA" 2>/dev/null || echo "unknown")
if [ "$PGDATA_OWNER" != "70" ]; then
    echo "Fixing data directory permissions..."
    chown -R postgres:postgres "$PGDATA"
    chmod 700 "$PGDATA"
fi
```
Both tmpfs and bind mounts need ownership fixed since container runs as root. UID 70 is the standard PostgreSQL user.

**PostgreSQL initialization** (lines 28-58):
```bash
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "Initializing PostgreSQL database..."
    runuser -u postgres -- initdb -D "$PGDATA" -U postgres

    # Configure PostgreSQL for local connections
    cat >> "$PGDATA/pg_hba.conf" << 'EOF'
host all all 127.0.0.1/32 trust
host all all ::1/128 trust
local all all trust
EOF

    # Configure custom socket directory
    cat >> "$PGDATA/postgresql.conf" << EOF
listen_addresses = 'localhost'
unix_socket_directories = '$PGRUNDIR'
EOF

    # Create databases
    runuser -u postgres -- pg_ctl -D "$PGDATA" -l /tmp/pg_init.log start -o "-k $PGRUNDIR"
    psql -h "$PGRUNDIR" -U postgres -d postgres -c "CREATE DATABASE rotv;"
    psql -h "$PGRUNDIR" -U postgres -d postgres -c "CREATE DATABASE rotv_test;"
    runuser -u postgres -- pg_ctl -D "$PGDATA" stop
fi
```
Uses `runuser` instead of `su -c` to preserve environment variables (PGDATA, PGRUNDIR).

**Production data import** (lines 77-82):
```bash
if [ -f /tmp/seed-data.sql ]; then
    echo "Importing seed data..."
    psql -h "$PGRUNDIR" -U postgres -d rotv -f /tmp/seed-data.sql 2>&1 | grep -c "^COPY" | xargs echo "Imported rows from tables:"
    echo "✓ Seed data imported"
fi
```
Import happens **before** `exec node server.js` to prevent schema conflicts with application's `initDatabase()` function.

### File: Containerfile

**Infrastructure layer caching** (lines 1-16):
```dockerfile
FROM registry.access.redhat.com/ubi10/ubi:latest AS infrastructure

# Install Node.js (rarely changes)
RUN dnf install -y nodejs npm && dnf clean all

# Install Playwright BEFORE PostgreSQL (cached early)
RUN npx playwright install chromium

# Install PostgreSQL (rarely changes)
RUN dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-10-x86_64/pgdg-redhat-repo-latest.noarch.rpm && \
    dnf install -y postgresql17-server postgresql17 && dnf clean all

# Create postgres user (UID 70 is standard)
RUN useradd -u 70 -m -s /bin/bash postgres || true
```
Playwright installation moved before PostgreSQL so it's cached early. Rarely needs rebuilding.

**Application layer with version labels** (lines 18-22):
```dockerfile
FROM infrastructure AS application

# Labels at top of app stage - bump version to force app rebuild
LABEL maintainer="fatherlinux"
LABEL version="1.10.0"
```
Bumping version label only rebuilds application layer (~2 minutes), not infrastructure (~15 minutes).

### File: backend/.env

**Production seed configuration** (lines 1-4):
```bash
# Production seed data source (for ./run.sh seed)
PRODUCTION_HOST=sven.dc3.crunchtools.com
PRODUCTION_PORT=22422
PRODUCTION_CONTAINER=rootsofthevalley.org
```

**Local development database** (lines 6-11):
```bash
# Database
PGHOST=localhost
PGPORT=5432
PGDATABASE=rotv
PGUSER=rotv
PGPASSWORD=rotv
```

**OAuth and session secrets** (lines 13-27):
```bash
# Session
SESSION_SECRET=change-this-to-a-secure-random-string-at-least-32-chars

# OAuth - Google
GOOGLE_CLIENT_ID=693091366844-...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_CALLBACK_URL=http://localhost:8080/auth/google/callback

# Admin
ADMIN_EMAIL=scott.mccarty@gmail.com
```

**Git safety**: This file is excluded by `.gitignore` pattern `.env` (line 3), preventing accidental commits.

## Testing & Validation

### Test 1: Auto-pull on first start
```bash
# Remove seed data
rm ~/.rotv/seed-data.sql

# Start container (should auto-pull)
./run.sh start

# Expected output:
# ⚠ No seed data found at /home/fatherlinux/.rotv/seed-data.sql
# Automatically pulling production data...
# Running pg_dump on production container: rootsofthevalley.org
# ✓ Production data downloaded (384M)
# Mounting seed data for import...
```

### Test 2: Freshness warning
```bash
# Age seed data artificially
touch -d "10 days ago" ~/.rotv/seed-data.sql

# Start container
./run.sh start

# Expected output:
# ⚠ Seed data is 10 days old
# Consider running './run.sh seed' to refresh production data
# Mounting seed data for import...
```

### Test 3: Data integrity
```bash
# Wait for container to start
sleep 10

# Check database
podman exec rotv psql -U postgres -d rotv -c "SELECT COUNT(*) FROM pois;"
# Expected: 371

# Check API (/api/destinations was consolidated into /api/pois in #546;
# the old path now 301-redirects to /api/pois?role=point)
curl -s http://localhost:8080/api/pois?role=point | jq -r 'length'
# Expected: 178
```

### Test 4: Clean slate on restart
```bash
# Add test data
podman exec rotv psql -U postgres -d rotv -c "INSERT INTO pois (name, poi_type, location) VALUES ('Test POI', 'point', ST_MakePoint(-81.5, 41.2));"

# Verify test data exists
podman exec rotv psql -U postgres -d rotv -c "SELECT COUNT(*) FROM pois WHERE name = 'Test POI';"
# Expected: 1

# Restart container
./run.sh stop
./run.sh start
sleep 10

# Verify test data is gone (clean production data restored)
podman exec rotv psql -U postgres -d rotv -c "SELECT COUNT(*) FROM pois WHERE name = 'Test POI';"
# Expected: 0
```

### Test 5: Container rebuild optimization
```bash
# Time full rebuild
time ./run.sh build

# Bump version label in Containerfile
# Change: LABEL version="1.10.0"
# To:     LABEL version="1.11.0"

# Time incremental rebuild (should be much faster)
time ./run.sh build

# Expected:
# - Infrastructure layer: Using cache (0 seconds)
# - Application layer: Rebuild (~2 minutes)
```

## Benefits

### For Developers
- **Fast startup**: Container starts in ~10 seconds with 384MB of production data
- **Real data**: Test with actual destinations, news, events instead of synthetic data
- **Clean slate**: Every restart = fresh production data (no stale test data accumulation)
- **No permission issues**: tmpfs eliminates bind mount UID/GID conflicts
- **Fast rebuilds**: Version bumps only rebuild app layer (~2 minutes vs ~15 minutes)

### For Admins
- **Easy onboarding**: New developers run `./run.sh start` and get production data automatically
- **Consistent environments**: All developers work with identical production data snapshots
- **Secure secrets**: `.env` files are gitignored, OAuth tokens stay local
- **Production safety**: Read-only production access (pg_dump via SSH, no write access)

### For Operations
- **Dual mode support**: Same container works for development (ephemeral) and production (persistent)
- **Simple deployment**: `PERSISTENT_DATA=true ./run.sh start` on production server
- **No data loss risk**: tmpfs is only used in development mode
- **Clear separation**: Development seed data cached separately from production storage

## Future Improvements

### 1. Incremental Seed Data Updates
Instead of downloading the full 384MB database dump, implement incremental updates:
- Track last sync timestamp
- Pull only changed records since last sync
- Use PostgreSQL logical replication or CDC (Change Data Capture)
- Benefit: Faster refresh (seconds instead of minutes)

### 2. Multiple Seed Data Snapshots
Allow developers to maintain multiple named snapshots:
```bash
./run.sh seed staging      # Pull from staging environment
./run.sh seed prod-2026-01 # Named production snapshot
./run.sh start prod-2026-01 # Start with specific snapshot
```
Benefit: Test migrations, compare data across environments

### 3. Automated Seed Data Refresh
Add cron job or systemd timer to auto-refresh seed data:
```bash
# Refresh nightly at 2am
0 2 * * * /path/to/run.sh seed
```
Benefit: Developers always have fresh data without manual intervention

### 4. Seed Data Compression
Compress cached seed data to reduce disk usage:
```bash
gzip ~/.rotv/seed-data.sql → ~/.rotv/seed-data.sql.gz
```
Benefit: 384MB → ~40MB (10x compression typical for SQL dumps)

### 5. Local Playwright Browser Sharing
Share Playwright's Chromium binary across containers:
```bash
# Volume mount shared browser cache
-v ~/.cache/ms-playwright:/root/.cache/ms-playwright:ro
```
Benefit: Eliminate 300MB Chromium download per container rebuild

### 6. Environment Variable Validation
Add validation to `run.sh` startup:
```bash
# Fail fast if required secrets are missing
if [ -z "$GOOGLE_CLIENT_ID" ]; then
    echo "❌ GOOGLE_CLIENT_ID not set in .env file"
    exit 1
fi
```
Benefit: Clear error messages instead of cryptic OAuth failures

### 7. Database Schema Drift Detection
Compare seed data schema against application's migration scripts:
```bash
./run.sh validate-schema  # Warn if production schema differs from migrations
```
Benefit: Catch production schema drift before deploying migrations

### 8. Seed Data Anonymization
Strip sensitive data from seed data before importing:
- Hash email addresses
- Randomize user passwords
- Remove session tokens
Benefit: Comply with GDPR, allow seed data sharing with contractors

---

**Document Version**: 1.0
**Last Updated**: 2026-01-21
**Author**: Claude Code (with Scott McCarty)
