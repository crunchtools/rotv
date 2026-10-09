#!/bin/bash
set -e

# Load environment variables from .env file FIRST (before defaults)
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
elif [ -f "backend/.env" ]; then
    export $(grep -v '^#' backend/.env | xargs)
fi

BASE_IMAGE_NAME="quay.io/crunchtools/rotv-base"
IMAGE_NAME="quay.io/crunchtools/rotv"
CONTAINER_NAME="${ROTV_CONTAINER:-rotv}"
GOURMAND_IMAGE="quay.io/crunchtools/gourmand:latest"
GATEHOUSE_IMAGE="quay.io/crunchtools/gatehouse:latest"
GATEHOUSE_ENV_FILE="$HOME/.config/mcp-env/gatehouse.env"
HOST_PORT="${ROTV_PORT:-8080}"

# Development uses ephemeral storage (tmpfs) - data is thrown away on restart
# Set PERSISTENT_DATA=true in .env or environment to persist across restarts
USE_PERSISTENT="${PERSISTENT_DATA:-false}"
DATA_DIR="${DATA_DIR:-$HOME/.rotv/pgdata}"
SEED_DATA_FILE="$HOME/.rotv/seed-data.sql"
PRODUCTION_HOST="${PRODUCTION_HOST:-lotor.dc3.crunchtools.com}"
PRODUCTION_PORT="${PRODUCTION_PORT:-22422}"
PRODUCTION_CONTAINER="${PRODUCTION_CONTAINER:-rootsofthevalley.org}"

# Node tooling runs in the base image, never on the host (the host needs only git,
# podman, pre-commit and gh). The package directory is mounted at /work/src and its
# dependencies install into a named volume at /work/node_modules, one level up, where
# Node's upward module lookup finds them without a node_modules in the checkout.
# The image's entrypoint is systemd, so it is overridden.
# Usage: run_node_tool <package dir> <volume name> <shell command run in /work/src> [ro|rw] [extra podman args]
run_node_tool() {
    local pkg_dir="$1" volume="$2" tool_cmd="$3" mount_mode="${4:-ro}" extra_args="$5"
    podman run --rm --security-opt label=disable $extra_args \
        -v "$PWD/$pkg_dir":/work/src:"$mount_mode" \
        -v "$volume":/work/node_modules \
        -e TOOL_CMD="$tool_cmd" \
        --entrypoint bash "$BASE_IMAGE_NAME" -c '
            set -e
            cd /work
            lock_sha=$(sha256sum src/package-lock.json | cut -d" " -f1)
            if [ "$(cat node_modules/.lock-sha 2>/dev/null)" != "$lock_sha" ]; then
                cp src/package.json src/package-lock.json .
                npm ci --include=dev --no-audit --no-fund --loglevel=error
                echo "$lock_sha" > node_modules/.lock-sha
            fi
            export PATH="/work/node_modules/.bin:$PATH"
            cd /work/src
            eval "$TOOL_CMD"
        '
}

# ESLint over frontend and backend. Pass --fix to apply auto-fixes.
run_eslint() {
    local mount_mode=ro
    [ "$1" = "--fix" ] && mount_mode=rw
    run_node_tool . rotv-lint-node-modules \
        "(cd frontend && eslint . $1) && (cd backend && eslint . $1)" "$mount_mode"
}

# Frontend unit tests (Vitest + jsdom).
run_frontend_tests() {
    run_node_tool frontend rotv-frontend-node-modules "vitest run"
}

# Gatehouse AI code review of this branch's diff against master, from its container
# image (constitution XII). The key lives in $GATEHOUSE_ENV_FILE (GEMINI_API_KEY=...).
run_gatehouse() {
    if [ ! -f "$GATEHOUSE_ENV_FILE" ]; then
        echo "❌ $GATEHOUSE_ENV_FILE not found (it holds GEMINI_API_KEY=...)"
        return 1
    fi
    local base
    base=$(git merge-base origin/master HEAD 2>/dev/null || echo master)
    if git diff --quiet "$base"; then
        echo "No changes against master, nothing to review"
        return 0
    fi
    git diff "$base" | podman --events-backend=none run --rm --log-driver=none -i \
        --env-file "$GATEHOUSE_ENV_FILE" --security-opt label=disable \
        -v "$PWD":/src:ro -w /src "$GATEHOUSE_IMAGE" --stdin
}

# Build environment variable arguments for podman
ENV_ARGS=""
[ -n "$GOOGLE_CLIENT_ID" ] && ENV_ARGS="$ENV_ARGS -e GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
[ -n "$GOOGLE_CLIENT_SECRET" ] && ENV_ARGS="$ENV_ARGS -e GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET"
[ -n "$SESSION_SECRET" ] && ENV_ARGS="$ENV_ARGS -e SESSION_SECRET=$SESSION_SECRET"
[ -n "$OPENROUTER_API_KEY" ] && ENV_ARGS="$ENV_ARGS -e OPENROUTER_API_KEY=$OPENROUTER_API_KEY"
[ -n "$GOOGLE_SHEETS_CREDENTIALS" ] && ENV_ARGS="$ENV_ARGS -e GOOGLE_SHEETS_CREDENTIALS=$GOOGLE_SHEETS_CREDENTIALS"
[ -n "$FACEBOOK_APP_ID" ] && ENV_ARGS="$ENV_ARGS -e FACEBOOK_APP_ID=$FACEBOOK_APP_ID"
[ -n "$FACEBOOK_APP_SECRET" ] && ENV_ARGS="$ENV_ARGS -e FACEBOOK_APP_SECRET=$FACEBOOK_APP_SECRET"
[ -n "$FACEBOOK_LOGIN_LIVE" ] && ENV_ARGS="$ENV_ARGS -e FACEBOOK_LOGIN_LIVE=$FACEBOOK_LOGIN_LIVE"
[ -n "$SMTP_HOST" ] && ENV_ARGS="$ENV_ARGS -e SMTP_HOST=$SMTP_HOST"
[ -n "$SMTP_PORT" ] && ENV_ARGS="$ENV_ARGS -e SMTP_PORT=$SMTP_PORT"
[ -n "$SMTP_TLS_VERIFY" ] && ENV_ARGS="$ENV_ARGS -e SMTP_TLS_VERIFY=$SMTP_TLS_VERIFY"
[ -n "$MAIL_FROM" ] && ENV_ARGS="$ENV_ARGS -e MAIL_FROM=$MAIL_FROM"
[ -n "$MAIL_REPLY_TO" ] && ENV_ARGS="$ENV_ARGS -e MAIL_REPLY_TO=$MAIL_REPLY_TO"
[ -n "$MAIL_ENVELOPE_FROM" ] && ENV_ARGS="$ENV_ARGS -e MAIL_ENVELOPE_FROM=$MAIL_ENVELOPE_FROM"
[ -n "$DKIM_DOMAIN" ] && ENV_ARGS="$ENV_ARGS -e DKIM_DOMAIN=$DKIM_DOMAIN"
[ -n "$DKIM_SELECTOR" ] && ENV_ARGS="$ENV_ARGS -e DKIM_SELECTOR=$DKIM_SELECTOR"
[ -n "$ADMIN_EMAIL" ] && ENV_ARGS="$ENV_ARGS -e ADMIN_EMAIL=$ADMIN_EMAIL"
[ -n "$MCP_ADMIN_TOKEN" ] && ENV_ARGS="$ENV_ARGS -e MCP_ADMIN_TOKEN=$MCP_ADMIN_TOKEN"
[ -n "$PGUSER" ] && ENV_ARGS="$ENV_ARGS -e PGUSER=$PGUSER"
[ -n "$PGPASSWORD" ] && ENV_ARGS="$ENV_ARGS -e PGPASSWORD=$PGPASSWORD"
[ -n "$PGDATABASE" ] && ENV_ARGS="$ENV_ARGS -e PGDATABASE=$PGDATABASE"
[ -n "$NEWSLETTER_SEND_ENABLED" ] && ENV_ARGS="$ENV_ARGS -e NEWSLETTER_SEND_ENABLED=$NEWSLETTER_SEND_ENABLED"

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

        # Create environment file for systemd services (only if it doesn't exist)
        # This file is a long-lived artifact — edit it directly to add API keys
        mkdir -p ~/.rotv
        if [ ! -f ~/.rotv/environment-dev ]; then
            echo "Creating ~/.rotv/environment-dev (edit this file to add API keys)"
            cat > ~/.rotv/environment-dev <<ENVFILE
NODE_ENV=test
BYPASS_AUTH=true
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
SESSION_SECRET=$SESSION_SECRET
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
GOOGLE_SHEETS_CREDENTIALS=$GOOGLE_SHEETS_CREDENTIALS
FACEBOOK_APP_ID=$FACEBOOK_APP_ID
FACEBOOK_APP_SECRET=$FACEBOOK_APP_SECRET
FACEBOOK_LOGIN_LIVE=$FACEBOOK_LOGIN_LIVE
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_TLS_VERIFY=$SMTP_TLS_VERIFY
MAIL_FROM=$MAIL_FROM
MAIL_REPLY_TO=$MAIL_REPLY_TO
MAIL_ENVELOPE_FROM=$MAIL_ENVELOPE_FROM
DKIM_DOMAIN=$DKIM_DOMAIN
DKIM_SELECTOR=$DKIM_SELECTOR
DKIM_PRIVATE_KEY_B64=$DKIM_PRIVATE_KEY_B64
ADMIN_EMAIL=$ADMIN_EMAIL
TWITTER_USERNAME=$TWITTER_USERNAME
TWITTER_PASSWORD=$TWITTER_PASSWORD
IMAGE_SERVER_URL=$IMAGE_SERVER_URL
MCP_ADMIN_TOKEN=$MCP_ADMIN_TOKEN
PGUSER=${PGUSER:-postgres}
PGPASSWORD=${PGPASSWORD:-rotv}
PGDATABASE=${PGDATABASE:-rotv}
NEWSLETTER_SEND_ENABLED=${NEWSLETTER_SEND_ENABLED:-false}
ENVFILE
        fi

        # The env file is long-lived, so files created before the
        # NEWSLETTER_SEND_ENABLED kill switch existed (#440) never got it and
        # kept sending real newsletter email from dev containers.
        if ! grep -q '^NEWSLETTER_SEND_ENABLED=' ~/.rotv/environment-dev; then
            echo "Adding NEWSLETTER_SEND_ENABLED=false to existing ~/.rotv/environment-dev"
            echo "NEWSLETTER_SEND_ENABLED=${NEWSLETTER_SEND_ENABLED:-false}" >> ~/.rotv/environment-dev
        fi

        # Use host network for default instance, bridge network for alternate ports
        if [ "$HOST_PORT" = "8080" ]; then
            NETWORK_ARGS="--network=host"
        else
            NETWORK_ARGS="-p ${HOST_PORT}:8080 -p $((HOST_PORT + 1000)):25"
        fi

        podman run -d \
            --name "$CONTAINER_NAME" \
            --privileged \
            $NETWORK_ARGS \
            --tmpfs /run \
            -v ~/.rotv/environment-dev:/etc/rotv/environment:ro \
            $STORAGE_MOUNT \
            $SEED_MOUNT \
            "$IMAGE_NAME"

        echo "Application starting at http://localhost:${HOST_PORT}"
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
        cat > ~/.rotv/environment-test <<ENVFILE
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
SESSION_SECRET=$SESSION_SECRET
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
GOOGLE_SHEETS_CREDENTIALS=$GOOGLE_SHEETS_CREDENTIALS
FACEBOOK_APP_ID=$FACEBOOK_APP_ID
FACEBOOK_APP_SECRET=$FACEBOOK_APP_SECRET
FACEBOOK_LOGIN_LIVE=$FACEBOOK_LOGIN_LIVE
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_TLS_VERIFY=$SMTP_TLS_VERIFY
MAIL_FROM=$MAIL_FROM
MAIL_REPLY_TO=$MAIL_REPLY_TO
MAIL_ENVELOPE_FROM=$MAIL_ENVELOPE_FROM
DKIM_DOMAIN=$DKIM_DOMAIN
DKIM_SELECTOR=$DKIM_SELECTOR
DKIM_PRIVATE_KEY_B64=$DKIM_PRIVATE_KEY_B64
ADMIN_EMAIL=$ADMIN_EMAIL
DISABLE_LIVE_BOAT_TRACKER=true
DISABLE_LIVE_TRAIN_TRACKER=true
NEWSLETTER_SEND_ENABLED=${NEWSLETTER_SEND_ENABLED:-false}
ENVFILE

        # Start container with ephemeral storage and seed data (use :test tag)
        echo "Starting test container with ephemeral storage..."
        podman run -d \
            --name "$CONTAINER_NAME" \
            --privileged \
            --network=host \
            -p ${HOST_PORT}:8080 \
            -p 2525:25 \
            --tmpfs /run \
            --tmpfs /data/pgdata:rw,size=2G,mode=0700 \
            -v ~/.rotv/environment-test:/etc/rotv/environment:ro,Z \
            -v "$SEED_DATA_FILE:/tmp/seed-data.sql:ro" \
            "${IMAGE_NAME}:test" >/dev/null

        # Wait for server to start and initialize database (match CI approach)
        echo "Waiting for server to start and initialize database..."
        sleep 20

        # Check if server is ready by polling the API
        for i in {1..30}; do
            if podman exec "$CONTAINER_NAME" curl -s http://localhost:8080/api/destinations > /dev/null 2>&1; then  # internal port is always 8080
                echo "✓ Server is ready"
                break
            fi
            echo "Waiting for server... ($i/30)"
            sleep 2
        done

        # Import seed data into the database the server is using
        echo "Importing seed data..."
        podman exec "$CONTAINER_NAME" psql -U postgres -d rotv -f /tmp/seed-data.sql 2>&1 | grep -c "^COPY" | xargs echo "Imported rows from tables:"

        # Re-run numbered migrations after seed import (seed data may restore old schema)
        echo "Re-running migrations..."
        podman exec "$CONTAINER_NAME" sh -c 'for m in /app/migrations/[0-9]*.sql; do [ -f "$m" ] && psql -U postgres -d rotv -f "$m"; done' 2>&1 | grep -i "notice\|error" || true

        echo "✓ Test database ready"
        echo ""

        # Run tests INSIDE container
        echo "Running tests inside container..."
        TEST_EXIT_CODE=0
        podman exec "$CONTAINER_NAME" sh -c "cd /app && npm test" || TEST_EXIT_CODE=$?

        # Clean up - stop test container
        echo ""
        echo "Stopping test container..."
        podman stop "$CONTAINER_NAME" >/dev/null 2>&1
        podman rm "$CONTAINER_NAME" >/dev/null 2>&1

        # Run Gourmand AI slop detection on the host (needs full git repo)
        GOURMAND_EXIT_CODE=0
        echo ""
        echo "Running Gourmand AI slop detection..."
        # Same image the CI gourmand job uses (crunchtools/gatehouse gourmand.yml)
        podman run --rm -v "$PWD":/src:Z -w /src "$GOURMAND_IMAGE" \
            check --full --cache-dir /tmp/gourmand-cache . || GOURMAND_EXIT_CODE=$?

        ESLINT_EXIT_CODE=0
        echo ""
        echo "Running ESLint on JavaScript/React code..."
        run_eslint || ESLINT_EXIT_CODE=$?

        FRONTEND_TEST_EXIT_CODE=0
        echo ""
        echo "Running frontend unit tests..."
        run_frontend_tests || FRONTEND_TEST_EXIT_CODE=$?

        GATEHOUSE_EXIT_CODE=0
        echo ""
        echo "Running Gatehouse AI code review..."
        run_gatehouse || GATEHOUSE_EXIT_CODE=$?

        echo ""
        if [ $TEST_EXIT_CODE -eq 0 ] && [ $GOURMAND_EXIT_CODE -eq 0 ] && [ $ESLINT_EXIT_CODE -eq 0 ] && [ $FRONTEND_TEST_EXIT_CODE -eq 0 ] && [ $GATEHOUSE_EXIT_CODE -eq 0 ]; then
            echo "✓ Tests, Gourmand, ESLint, frontend unit tests, and Gatehouse checks completed successfully"
        else
            if [ $TEST_EXIT_CODE -ne 0 ]; then
                echo "❌ Tests failed"
            fi
            if [ $GOURMAND_EXIT_CODE -ne 0 ]; then
                echo "❌ Gourmand detected issues"
            fi
            if [ $ESLINT_EXIT_CODE -ne 0 ]; then
                echo "❌ ESLint found issues"
                echo "   Try: ./run.sh lint --fix"
            fi
            if [ $FRONTEND_TEST_EXIT_CODE -ne 0 ]; then
                echo "❌ Frontend unit tests failed"
            fi
            if [ $GATEHOUSE_EXIT_CODE -ne 0 ]; then
                echo "❌ Gatehouse found blocking issues"
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
        podman run --rm -v "$PWD":/src:Z -w /src "$GOURMAND_IMAGE" \
            check --full --cache-dir /tmp/gourmand-cache .
        ;;

    gatehouse)
        echo "Running Gatehouse AI code review..."
        run_gatehouse
        ;;

    lint)
        echo "Running ESLint on JavaScript/React code..."
        if [ -n "$2" ] && [ "$2" != "--fix" ]; then
            echo "Usage: ./run.sh lint [--fix]"
            exit 1
        fi
        if run_eslint "$2"; then
            echo ""
            echo "✓ ESLint checks passed"
        else
            echo ""
            echo "❌ ESLint found issues"
            [ -z "$2" ] && echo "Try auto-fixing with: ./run.sh lint --fix"
            exit 1
        fi
        ;;

    test-frontend)
        echo "Running frontend unit tests..."
        run_frontend_tests
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

            # If container is running, import seed data directly
            if podman ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
                echo ""
                echo "Importing seed data into running container..."
                podman cp "$SEED_DATA_FILE" "$CONTAINER_NAME:/tmp/seed-data.sql"
                podman exec "$CONTAINER_NAME" psql -U postgres -d rotv -f /tmp/seed-data.sql 2>&1 | grep -c "^COPY" | xargs echo "Imported rows from tables:"
                podman exec "$CONTAINER_NAME" sh -c 'for m in /app/migrations/[0-9]*.sql; do [ -f "$m" ] && psql -U postgres -d rotv -f "$m"; done' 2>&1 | grep -i "notice\|error" || true
                echo "✓ Seed data imported into running container"
            else
                echo ""
                echo "Next steps:"
                echo "  ./run.sh start   # Start with this data"
                echo "  ./run.sh test    # Run tests with this data"
            fi
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

    dev-ui)
        # Vite dev server with HMR, proxying API calls to the running dev container.
        # Host networking lets it reach the container on localhost and lets a phone
        # on the same network load it. The cache goes in the node_modules volume
        # because the checkout is mounted read-only.
        if ! podman ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
            echo "❌ Container is not running"
            echo "Start the container first with: ./run.sh start"
            exit 1
        fi
        DEV_UI_PORT="${ROTV_DEV_UI_PORT:-5173}"
        echo "Frontend with hot reload at http://localhost:${DEV_UI_PORT} (API: localhost:${HOST_PORT})"
        run_node_tool frontend rotv-frontend-node-modules \
            "ROTV_API_TARGET=http://localhost:${HOST_PORT} VITE_CACHE_DIR=/work/node_modules/.vite exec vite --port ${DEV_UI_PORT} --strictPort" \
            ro "--init --replace --name ${CONTAINER_NAME}-dev-ui --network=host"
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
        echo "  dev-ui         Vite dev server with instant hot reload (frontend only)"
        echo "  reload-app     Rebuild frontend and restart backend in the container"
        echo "                 WARNING: Always run 'build' before creating a PR"
        echo "  seed           Pull fresh data from production server via SSH"
        echo ""
        echo "TESTING COMMANDS"
        echo "  test           Run full test suite + Gourmand + ESLint + frontend unit tests + Gatehouse"
        echo "  gourmand       Run Gourmand AI slop detection only (fast iteration)"
        echo "  lint [--fix]   Run ESLint on JavaScript/React code, in a container"
        echo "  test-frontend  Run frontend unit tests only, in a container"
        echo "  gatehouse      Run Gatehouse AI code review only (fast iteration)"
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
        echo "  3. ./run.sh start       # Start at http://localhost:\${ROTV_PORT:-8080}"
        echo "  4. ./run.sh test        # Run tests before PR"
        echo ""
        echo "DEVELOPMENT WORKFLOW"
        echo "  ./run.sh dev-ui         # Instant hot reload for frontend work"
        echo "  ./run.sh reload-app     # Rebuild frontend + restart backend"
        echo "  ./run.sh restart-db     # Restart PostgreSQL if needed (~5s)"
        echo "  ./run.sh build && ./run.sh test  # MANDATORY before PR"
        echo ""
        echo "ENVIRONMENT VARIABLES (set in .env or export)"
        echo "  OPENROUTER_API_KEY     OpenRouter API key (required for AI features)"
        echo "  GOOGLE_CLIENT_ID       Google OAuth client ID"
        echo "  GOOGLE_CLIENT_SECRET   Google OAuth client secret"
        echo "  SESSION_SECRET         Session encryption key"
        echo "  ADMIN_EMAIL            Admin user email address"
        echo "  PERSISTENT_DATA        Set 'true' for persistent storage (production)"
        echo "  DATA_DIR               PostgreSQL data dir (default: ~/.rotv/pgdata)"
        echo ""
        ;;
esac
