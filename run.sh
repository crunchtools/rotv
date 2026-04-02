#!/bin/bash
set -e

BASE_IMAGE_NAME="quay.io/crunchtools/rotv-base"
IMAGE_NAME="quay.io/crunchtools/rotv"
CONTAINER_NAME="rotv"

# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
elif [ -f "backend/.env" ]; then
    export $(grep -v '^#' backend/.env | xargs)
fi

# Development uses ephemeral storage (tmpfs) - data is thrown away on restart
# Set PERSISTENT_DATA=true in .env or environment to persist across restarts
USE_PERSISTENT="${PERSISTENT_DATA:-false}"
DATA_DIR="${DATA_DIR:-$HOME/.rotv/pgdata}"
SEED_DATA_FILE="$HOME/.rotv/seed-data.sql"
PRODUCTION_HOST="${PRODUCTION_HOST:-lotor.dc3.crunchtools.com}"
PRODUCTION_PORT="${PRODUCTION_PORT:-22422}"
PRODUCTION_CONTAINER="${PRODUCTION_CONTAINER:-rootsofthevalley.org}"

# Build environment variable arguments for podman
ENV_ARGS=""
[ -n "$GOOGLE_CLIENT_ID" ] && ENV_ARGS="$ENV_ARGS -e GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
[ -n "$GOOGLE_CLIENT_SECRET" ] && ENV_ARGS="$ENV_ARGS -e GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET"
[ -n "$SESSION_SECRET" ] && ENV_ARGS="$ENV_ARGS -e SESSION_SECRET=$SESSION_SECRET"
[ -n "$GEMINI_API_KEY" ] && ENV_ARGS="$ENV_ARGS -e GEMINI_API_KEY=$GEMINI_API_KEY"
[ -n "$PERPLEXITY_API_KEY" ] && ENV_ARGS="$ENV_ARGS -e PERPLEXITY_API_KEY=$PERPLEXITY_API_KEY"
[ -n "$GOOGLE_SHEETS_CREDENTIALS" ] && ENV_ARGS="$ENV_ARGS -e GOOGLE_SHEETS_CREDENTIALS=$GOOGLE_SHEETS_CREDENTIALS"
[ -n "$FACEBOOK_APP_ID" ] && ENV_ARGS="$ENV_ARGS -e FACEBOOK_APP_ID=$FACEBOOK_APP_ID"
[ -n "$FACEBOOK_APP_SECRET" ] && ENV_ARGS="$ENV_ARGS -e FACEBOOK_APP_SECRET=$FACEBOOK_APP_SECRET"
[ -n "$ADMIN_EMAIL" ] && ENV_ARGS="$ENV_ARGS -e ADMIN_EMAIL=$ADMIN_EMAIL"
[ -n "$MCP_ADMIN_TOKEN" ] && ENV_ARGS="$ENV_ARGS -e MCP_ADMIN_TOKEN=$MCP_ADMIN_TOKEN"
[ -n "$PGUSER" ] && ENV_ARGS="$ENV_ARGS -e PGUSER=$PGUSER"
[ -n "$PGPASSWORD" ] && ENV_ARGS="$ENV_ARGS -e PGPASSWORD=$PGPASSWORD"
[ -n "$PGDATABASE" ] && ENV_ARGS="$ENV_ARGS -e PGDATABASE=$PGDATABASE"

case "${1:-help}" in
    build-base)
        echo "Building base container image..."
        echo "This contains PostgreSQL, Node.js, and Playwright (rarely changes)"
        podman build --security-opt label=disable -f Containerfile.base -t "$BASE_IMAGE_NAME" .
        echo ""
        echo "✓ Base image built: $BASE_IMAGE_NAME"
        echo "You can now run: ./run.sh build"
        ;;

    build)
        echo "Building application container image..."
        # Check if base image exists locally
        if ! podman image exists "$BASE_IMAGE_NAME"; then
            echo "Base image not found locally, pulling from quay.io..."
            if ! podman pull "$BASE_IMAGE_NAME"; then
                echo ""
                echo "⚠ Base image not found on quay.io"
                echo "Building base image locally (this will take longer)..."
                podman build --security-opt label=disable -f Containerfile.base -t "$BASE_IMAGE_NAME" .
            fi
        fi
        podman build --security-opt label=disable --build-arg BASE_IMAGE="$BASE_IMAGE_NAME" -t "$IMAGE_NAME" .
        ;;

    build-all)
        echo "Building both base and application images..."
        echo ""
        echo "=== Building base image ==="
        podman build --security-opt label=disable -f Containerfile.base -t "$BASE_IMAGE_NAME" .
        echo ""
        echo "=== Building application image ==="
        podman build --security-opt label=disable --build-arg BASE_IMAGE="$BASE_IMAGE_NAME" -t "$IMAGE_NAME" .
        echo ""
        echo "✓ Both images built successfully"
        ;;

    start)
        echo "Starting Roots of The Valley..."

        # Stop existing container if running
        podman stop "$CONTAINER_NAME" 2>/dev/null || true
        podman rm "$CONTAINER_NAME" 2>/dev/null || true

        # Build storage mount options
        if [ "$USE_PERSISTENT" = "true" ]; then
            echo "Using persistent storage: $DATA_DIR"
            mkdir -p "$DATA_DIR"
            # Set up permissions for bind-mounted data directory
            if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
                echo "Setting up data directory permissions..."
                podman unshare chown 70:70 "$DATA_DIR" 2>/dev/null || true
                podman unshare chmod 700 "$DATA_DIR" 2>/dev/null || true
            fi
            STORAGE_MOUNT="-v $DATA_DIR:/data/pgdata:Z"
        else
            echo "Using ephemeral storage (data will be lost on restart)"
            STORAGE_MOUNT="--tmpfs /data/pgdata:rw,size=2G,mode=0700"
        fi

        # Handle seed data in development mode
        SEED_MOUNT=""
        if [ "$USE_PERSISTENT" = "false" ]; then
            # Check if seed data exists
            if [ ! -f "$SEED_DATA_FILE" ]; then
                echo "⚠ No seed data found at $SEED_DATA_FILE"
                echo "Automatically pulling production data..."
                echo ""

                # Create cache directory
                mkdir -p "$(dirname "$SEED_DATA_FILE")"

                # Pull data from production
                echo "Running pg_dump on production container: $PRODUCTION_CONTAINER"
                ssh -p "$PRODUCTION_PORT" root@"$PRODUCTION_HOST" \
                    "podman exec $PRODUCTION_CONTAINER pg_dump -U rotv --clean --if-exists --no-owner --no-acl rotv" \
                    > "$SEED_DATA_FILE"

                if [ $? -eq 0 ]; then
                    SEED_SIZE=$(du -h "$SEED_DATA_FILE" | cut -f1)
                    echo "✓ Production data downloaded ($SEED_SIZE)"
                    echo ""
                else
                    echo "❌ Failed to pull production data"
                    echo "Cannot start in development mode without seed data"
                    rm -f "$SEED_DATA_FILE"
                    exit 1
                fi
            else
                # Check freshness of seed data (warn if older than 7 days)
                SEED_AGE_DAYS=$(( ($(date +%s) - $(date -r "$SEED_DATA_FILE" +%s)) / 86400 ))
                if [ $SEED_AGE_DAYS -gt 7 ]; then
                    echo "⚠ Seed data is $SEED_AGE_DAYS days old"
                    echo "Consider running './run.sh seed' to refresh production data"
                    echo ""
                fi
            fi

            # Mount seed data for import
            echo "Mounting seed data for import..."
            SEED_MOUNT="-v $SEED_DATA_FILE:/tmp/seed-data.sql:ro"
        fi

        # Create environment file for systemd services
        mkdir -p ~/.rotv
        cat > ~/.rotv/environment <<ENVFILE
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
SESSION_SECRET=$SESSION_SECRET
GEMINI_API_KEY=$GEMINI_API_KEY
PERPLEXITY_API_KEY=$PERPLEXITY_API_KEY
GOOGLE_SHEETS_CREDENTIALS=$GOOGLE_SHEETS_CREDENTIALS
FACEBOOK_APP_ID=$FACEBOOK_APP_ID
FACEBOOK_APP_SECRET=$FACEBOOK_APP_SECRET
ADMIN_EMAIL=$ADMIN_EMAIL
TWITTER_USERNAME=$TWITTER_USERNAME
TWITTER_PASSWORD=$TWITTER_PASSWORD
IMAGE_SERVER_URL=$IMAGE_SERVER_URL
MCP_ADMIN_TOKEN=$MCP_ADMIN_TOKEN
PGUSER=${PGUSER:-rotv}
PGPASSWORD=${PGPASSWORD:-rotv}
PGDATABASE=${PGDATABASE:-rotv}
ENVFILE

        # Build MCP port mapping if token is configured
        MCP_PORT_MAP=""
        [ -n "$MCP_ADMIN_TOKEN" ] && MCP_PORT_MAP="-p 3001:3001"

        podman run -d \
            --name "$CONTAINER_NAME" \
            --privileged \
            --network=pasta:--dns-forward,8.8.8.8 \
            -p 8080:8080 \
            -p 2525:25 \
            $MCP_PORT_MAP \
            --tmpfs /run \
            -v ~/.rotv/environment:/etc/rotv/environment:ro,Z \
            $STORAGE_MOUNT \
            $SEED_MOUNT \
            "$IMAGE_NAME"

        echo "Application starting at http://localhost:8080"
        if [ -n "$SEED_MOUNT" ]; then
            echo "Seed data will be imported during startup..."
        fi
        echo "Waiting for application to be ready..."
        sleep 10

        echo "✓ Container started successfully"
        echo ""
        echo "Useful commands:"
        echo "  ./run.sh logs   - View logs"
        echo "  ./run.sh stop   - Stop container"
        echo "  ./run.sh seed   - Pull fresh data from production"
        ;;

    test)
        echo "Running integration tests..."
        echo ""

        # Check if seed data exists
        if [ ! -f "$SEED_DATA_FILE" ]; then
            echo "⚠ No seed data found at $SEED_DATA_FILE"
            echo "Run './run.sh seed' first to pull production data"
            exit 1
        fi

        # Build test image with Playwright browsers (BUILD_ENV=test)
        echo "Building test container image with Playwright..."
        if ! podman image exists "$BASE_IMAGE_NAME"; then
            echo "Base image not found locally, pulling from quay.io..."
            if ! podman pull "$BASE_IMAGE_NAME"; then
                echo ""
                echo "⚠ Base image not found on quay.io"
                echo "Building base image locally (this will take longer)..."
                podman build --security-opt label=disable -f Containerfile.base -t "$BASE_IMAGE_NAME" .
            fi
        fi
        podman build --security-opt label=disable \
            --build-arg BASE_IMAGE="$BASE_IMAGE_NAME" \
            --build-arg BUILD_ENV=test \
            -t "${IMAGE_NAME}:test" .

        # Stop and remove existing container
        echo "Stopping main container..."
        podman stop "$CONTAINER_NAME" 2>/dev/null || true
        podman rm "$CONTAINER_NAME" 2>/dev/null || true

        # Create environment file for systemd services (use main 'rotv' database like CI)
        mkdir -p ~/.rotv
        cat > ~/.rotv/environment <<ENVFILE
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
SESSION_SECRET=$SESSION_SECRET
GEMINI_API_KEY=$GEMINI_API_KEY
PERPLEXITY_API_KEY=$PERPLEXITY_API_KEY
GOOGLE_SHEETS_CREDENTIALS=$GOOGLE_SHEETS_CREDENTIALS
FACEBOOK_APP_ID=$FACEBOOK_APP_ID
FACEBOOK_APP_SECRET=$FACEBOOK_APP_SECRET
ADMIN_EMAIL=$ADMIN_EMAIL
ENVFILE

        # Start container with ephemeral storage and seed data (use :test tag)
        echo "Starting test container with ephemeral storage..."
        podman run -d \
            --name "$CONTAINER_NAME" \
            --privileged \
            --network=pasta:--dns-forward,8.8.8.8 \
            -p 8080:8080 \
            -p 2525:25 \
            --tmpfs /run \
            --tmpfs /data/pgdata:rw,size=2G,mode=0700 \
            -v ~/.rotv/environment:/etc/rotv/environment:ro,Z \
            -v "$SEED_DATA_FILE:/tmp/seed-data.sql:ro" \
            "${IMAGE_NAME}:test" >/dev/null

        # Wait for server to start and initialize database (match CI approach)
        echo "Waiting for server to start and initialize database..."
        sleep 20

        # Check if server is ready by polling the API
        for i in {1..30}; do
            if podman exec "$CONTAINER_NAME" curl -s http://localhost:8080/api/destinations > /dev/null 2>&1; then
                echo "✓ Server is ready"
                break
            fi
            echo "Waiting for server... ($i/30)"
            sleep 2
        done

        # Import seed data into the database the server is using
        echo "Importing seed data..."
        podman exec "$CONTAINER_NAME" psql -U postgres -d rotv -f /tmp/seed-data.sql 2>&1 | grep -c "^COPY" | xargs echo "Imported rows from tables:"

        # Re-run migrations after seed import (seed data may restore old schema)
        echo "Re-running migrations..."
        podman exec "$CONTAINER_NAME" sh -c 'for m in /app/migrations/*.sql; do [ -f "$m" ] && psql -U postgres -d rotv -f "$m"; done' 2>&1 | grep -i "notice\|error" || true

        echo "✓ Test database ready"
        echo ""

        # Run tests INSIDE container
        echo "Running tests inside container..."
        podman exec "$CONTAINER_NAME" sh -c "cd /app && npm test"
        TEST_EXIT_CODE=$?

        # Clean up - stop test container
        echo ""
        echo "Stopping test container..."
        podman stop "$CONTAINER_NAME" >/dev/null 2>&1
        podman rm "$CONTAINER_NAME" >/dev/null 2>&1

        # Run Gourmand AI slop detection on the host (needs full git repo)
        GOURMAND_EXIT_CODE=0
        echo ""
        echo "Running Gourmand AI slop detection..."
        GOURMAND_BIN="$HOME/.cargo/bin/gourmand"
        if [ -x "$GOURMAND_BIN" ]; then
            "$GOURMAND_BIN" --full .
            GOURMAND_EXIT_CODE=$?
        elif command -v gourmand &> /dev/null; then
            gourmand --full .
            GOURMAND_EXIT_CODE=$?
        else
            echo "⚠ Gourmand not installed locally (skipping)"
            echo "  Install with: cargo install --git https://codeberg.org/mattdm/gourmand.git"
            echo "  CI will still run Gourmand checks on pull requests"
        fi

        # Run ESLint on JavaScript/React code
        ESLINT_EXIT_CODE=0
        echo ""
        echo "Running ESLint on JavaScript/React code..."
        if [ -d "node_modules" ]; then
            npm run lint
            ESLINT_EXIT_CODE=$?
        else
            echo "⚠ Node dependencies not installed (skipping ESLint)"
            echo "  Install with: npm install"
        fi

        echo ""
        if [ $TEST_EXIT_CODE -eq 0 ] && [ $GOURMAND_EXIT_CODE -eq 0 ] && [ $ESLINT_EXIT_CODE -eq 0 ]; then
            echo "✓ Tests, Gourmand, and ESLint checks completed successfully"
        else
            if [ $TEST_EXIT_CODE -ne 0 ]; then
                echo "❌ Tests failed"
            fi
            if [ $GOURMAND_EXIT_CODE -ne 0 ]; then
                echo "❌ Gourmand detected issues"
            fi
            if [ $ESLINT_EXIT_CODE -ne 0 ]; then
                echo "❌ ESLint found issues"
                echo "   Try: npm run lint:fix"
            fi
            exit 1
        fi
        ;;

    stop)
        echo "Stopping container..."
        podman stop "$CONTAINER_NAME" 2>/dev/null || true
        podman rm "$CONTAINER_NAME" 2>/dev/null || true
        echo "✓ Container stopped"
        ;;

    gourmand)
        echo "Running Gourmand AI slop detection..."
        GOURMAND_BIN="$HOME/.cargo/bin/gourmand"
        if [ -x "$GOURMAND_BIN" ]; then
            "$GOURMAND_BIN" --full .
        elif command -v gourmand &> /dev/null; then
            gourmand --full .
        else
            echo "❌ Gourmand not installed"
            echo ""
            echo "Install with:"
            echo "  cargo install --git https://codeberg.org/mattdm/gourmand.git"
            exit 1
        fi
        ;;

    lint)
        echo "Running ESLint on JavaScript/React code..."
        ESLINT_EXIT_CODE=0

        # Check if node_modules exists
        if [ ! -d "node_modules" ]; then
            echo "❌ Dependencies not installed"
            echo ""
            echo "Install with:"
            echo "  npm install"
            exit 1
        fi

        # Run ESLint
        npm run lint
        ESLINT_EXIT_CODE=$?

        if [ $ESLINT_EXIT_CODE -eq 0 ]; then
            echo ""
            echo "✓ ESLint checks passed"
        else
            echo ""
            echo "❌ ESLint found issues"
            echo ""
            echo "Try auto-fixing with:"
            echo "  npm run lint:fix"
            exit 1
        fi
        ;;

    logs)
        podman logs -f "$CONTAINER_NAME"
        ;;

    shell)
        echo "Opening shell in running container..."
        podman exec -it "$CONTAINER_NAME" /bin/bash
        ;;

    seed)
        echo "Pulling data from production..."
        echo "Host: $PRODUCTION_HOST:$PRODUCTION_PORT"
        echo ""

        # Create cache directory
        mkdir -p "$(dirname "$SEED_DATA_FILE")"

        # Pull data from production using pg_dump
        # --no-owner: Don't include ownership commands (rotv vs postgres user mismatch)
        # --no-acl: Don't include access privileges
        echo "Running pg_dump on production container: $PRODUCTION_CONTAINER"
        ssh -p "$PRODUCTION_PORT" root@"$PRODUCTION_HOST" \
            "podman exec $PRODUCTION_CONTAINER pg_dump -U rotv --clean --if-exists --no-owner --no-acl rotv" \
            > "$SEED_DATA_FILE"

        if [ $? -eq 0 ]; then
            SEED_SIZE=$(du -h "$SEED_DATA_FILE" | cut -f1)
            echo "✓ Production data saved to $SEED_DATA_FILE ($SEED_SIZE)"
            echo ""
            echo "Next steps:"
            echo "  ./run.sh start   # Start with this data"
            echo "  ./run.sh test    # Run tests with this data"
        else
            echo "❌ Failed to pull production data"
            rm -f "$SEED_DATA_FILE"
            exit 1
        fi
        ;;

    push)
        echo "Pushing application image to quay.io..."
        podman push "$IMAGE_NAME"
        ;;

    push-base)
        echo "Pushing base image to quay.io..."
        podman push "$BASE_IMAGE_NAME"
        ;;

    push-all)
        echo "Pushing both images to quay.io..."
        echo "Pushing base image..."
        podman push "$BASE_IMAGE_NAME"
        echo "Pushing application image..."
        podman push "$IMAGE_NAME"
        echo "✓ Both images pushed"
        ;;

    reload-app)
        echo "Hot reloading application code..."
        echo ""

        # Check if container is running
        if ! podman ps | grep -q "$CONTAINER_NAME"; then
            echo "❌ Container is not running"
            echo "Start the container first with: ./run.sh start"
            exit 1
        fi

        # Copy updated backend code
        echo "→ Copying backend source code..."
        podman cp backend/routes "$CONTAINER_NAME:/app/"
        podman cp backend/services "$CONTAINER_NAME:/app/"
        podman cp backend/server.js "$CONTAINER_NAME:/app/"

        # Copy updated frontend code to a temp build directory in container
        echo "→ Copying frontend source code..."
        podman exec "$CONTAINER_NAME" rm -rf /tmp/frontend-build
        podman exec "$CONTAINER_NAME" mkdir -p /tmp/frontend-build
        podman cp frontend/src "$CONTAINER_NAME:/tmp/frontend-build/"
        podman cp frontend/public "$CONTAINER_NAME:/tmp/frontend-build/"
        podman cp frontend/index.html "$CONTAINER_NAME:/tmp/frontend-build/"
        podman cp frontend/vite.config.js "$CONTAINER_NAME:/tmp/frontend-build/"
        podman cp frontend/package.json "$CONTAINER_NAME:/tmp/frontend-build/"
        podman cp frontend/package-lock.json "$CONTAINER_NAME:/tmp/frontend-build/" 2>/dev/null || true

        # Install dependencies and build in temp directory
        echo "→ Installing dependencies and rebuilding frontend..."
        podman exec "$CONTAINER_NAME" sh -c "cd /tmp/frontend-build && npm install --silent && npm run build"

        # Replace public directory with new build
        echo "→ Updating public directory..."
        podman exec "$CONTAINER_NAME" rm -rf /app/public
        podman exec "$CONTAINER_NAME" mv /tmp/frontend-build/dist /app/public
        podman exec "$CONTAINER_NAME" rm -rf /tmp/frontend-build

        # Restart backend Node.js server using systemctl
        echo "→ Restarting backend server..."
        podman exec "$CONTAINER_NAME" systemctl restart rotv-backend.service

        echo ""
        echo "✓ Application reloaded successfully"
        echo ""
        echo "⚠ IMPORTANT: This is for development only!"
        echo "Before creating a PR, you MUST:"
        echo "  1. ./run.sh build      # Full rebuild"
        echo "  2. ./run.sh test       # Run all tests"
        echo ""
        ;;

    restart-backend)
        echo "Restarting backend service..."
        podman exec "$CONTAINER_NAME" systemctl restart rotv-backend.service
        echo "✓ Backend restarted"
        ;;

    restart-db)
        echo "Restarting PostgreSQL service..."
        podman exec "$CONTAINER_NAME" systemctl restart postgresql.service
        echo "✓ PostgreSQL restarted"
        ;;

    status)
        echo "Service Status:"
        echo ""
        podman exec "$CONTAINER_NAME" systemctl status postgresql.service rotv-init.service rotv-backend.service --no-pager
        ;;

    logs-backend)
        echo "Backend logs (Ctrl+C to exit):"
        podman exec "$CONTAINER_NAME" journalctl -u rotv-backend.service -f --no-pager
        ;;

    logs-db)
        echo "PostgreSQL logs (Ctrl+C to exit):"
        podman exec "$CONTAINER_NAME" journalctl -u postgresql.service -f --no-pager
        ;;

    help|*)
        echo "Roots of The Valley - Container Management"
        echo ""
        echo "Usage: ./run.sh <command>"
        echo ""
        echo "BUILD COMMANDS"
        echo "  build          Build app image (~60s, pulls base from quay.io)"
        echo "  build-base     Build base image locally (PostgreSQL, Node.js, Playwright)"
        echo "  build-all      Build both base and app images from scratch"
        echo ""
        echo "DEVELOPMENT COMMANDS"
        echo "  start          Start container with ephemeral storage + seed data"
        echo "  stop           Stop and remove the running container"
        echo "  reload-app     Hot reload code changes (~3s, dev only)"
        echo "                 WARNING: Always run 'build' before creating a PR"
        echo "  seed           Pull fresh data from production server via SSH"
        echo ""
        echo "TESTING COMMANDS"
        echo "  test           Run full test suite (174 tests) + Gourmand + ESLint"
        echo "  gourmand       Run Gourmand AI slop detection only (fast iteration)"
        echo "  lint           Run ESLint on JavaScript/React code (fast iteration)"
        echo ""
        echo "DEBUGGING COMMANDS"
        echo "  logs           Follow all container logs (stdout/stderr)"
        echo "  logs-backend   Follow Node.js backend logs (systemd journal)"
        echo "  logs-db        Follow PostgreSQL logs (systemd journal)"
        echo "  status         Show status of all systemd services"
        echo "  shell          Open interactive bash shell in container"
        echo "  restart-backend  Restart Node.js backend service only"
        echo "  restart-db       Restart PostgreSQL service only"
        echo ""
        echo "DEPLOYMENT COMMANDS"
        echo "  push           Push app image to quay.io/crunchtools/rotv"
        echo "  push-base      Push base image to quay.io/crunchtools/rotv-base"
        echo "  push-all       Push both images to quay.io"
        echo ""
        echo "QUICK START"
        echo "  1. ./run.sh build       # Build container image"
        echo "  2. ./run.sh seed        # Pull production data (first time only)"
        echo "  3. ./run.sh start       # Start at http://localhost:8080"
        echo "  4. ./run.sh test        # Run tests before PR"
        echo ""
        echo "DEVELOPMENT WORKFLOW"
        echo "  ./run.sh reload-app     # Hot reload after code changes (~3s)"
        echo "  ./run.sh restart-db     # Restart PostgreSQL if needed (~5s)"
        echo "  ./run.sh build && ./run.sh test  # MANDATORY before PR"
        echo ""
        echo "ENVIRONMENT VARIABLES (set in .env or export)"
        echo "  GEMINI_API_KEY         Google Gemini API key (required for AI features)"
        echo "  PERPLEXITY_API_KEY     Perplexity API key (required for AI features)"
        echo "  GOOGLE_CLIENT_ID       Google OAuth client ID"
        echo "  GOOGLE_CLIENT_SECRET   Google OAuth client secret"
        echo "  SESSION_SECRET         Session encryption key"
        echo "  ADMIN_EMAIL            Admin user email address"
        echo "  PERSISTENT_DATA        Set 'true' for persistent storage (production)"
        echo "  DATA_DIR               PostgreSQL data dir (default: ~/.rotv/pgdata)"
        echo ""
        ;;
esac
