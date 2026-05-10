#!/bin/bash
# Migration script: Immich -> Image Server
# Runs on Lotor — downloads from Immich API, uploads to image server API
#
# Usage: ./migrate-from-immich.sh
#
# Prerequisites:
#   - Both containers running on Lotor
#   - image-server health endpoint responds
#   - Immich API key available

set -uo pipefail

IMMICH_URL="http://127.0.0.1:8088"
IMMICH_API_KEY="MosNnoHDjChjHA5y6v86HOFNmwZKFRB0zZakM4oy4"
IMAGE_SERVER_URL="http://127.0.0.1:8094"
ROTV_DB_CONTAINER="rootsofthevalley.org"
TMPDIR="/tmp/immich-migration"

mkdir -p "$TMPDIR"

echo "=== Immich -> Image Server Migration ==="
echo ""

# Check both services are up
echo "Checking services..."
if ! curl -sf "$IMAGE_SERVER_URL/api/health" > /dev/null 2>&1; then
    echo "ERROR: Image server not responding at $IMAGE_SERVER_URL/api/health"
    exit 1
fi
echo "  Image server: OK"

if ! curl -sf -H "x-api-key: $IMMICH_API_KEY" "$IMMICH_URL/api/server/about" > /dev/null 2>&1; then
    echo "ERROR: Immich not responding at $IMMICH_URL"
    exit 1
fi
echo "  Immich: OK"

# Get all POIs with Immich assets from ROTV database
echo ""
echo "Querying ROTV database for POIs with Immich assets..."
POIS=$(podman exec "$ROTV_DB_CONTAINER" psql -U postgres -d rotv -t -A -F'|' \
    -c "SELECT id, immich_primary_asset_id, image_mime_type FROM pois WHERE immich_primary_asset_id IS NOT NULL ORDER BY id")

TOTAL=$(echo "$POIS" | wc -l)
echo "Found $TOTAL POIs with Immich assets"
echo ""

# Migrate each POI's primary image
COUNT=0
ERRORS=0
SKIPPED=0

while IFS='|' read -r POI_ID ASSET_ID MIME_TYPE; do
    COUNT=$((COUNT + 1))

    # Skip empty lines
    [ -z "$POI_ID" ] && continue

    echo "[$COUNT/$TOTAL] POI $POI_ID — Immich asset $ASSET_ID"

    # Check if already migrated (asset exists for this POI in image server)
    EXISTING=$(curl -sf "$IMAGE_SERVER_URL/api/assets?poi_id=$POI_ID&role=primary" 2>/dev/null || echo "[]")
    if [ "$EXISTING" != "[]" ] && echo "$EXISTING" | python3.12 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if len(d)>0 else 1)" 2>/dev/null; then
        echo "  SKIP: Already has primary image in image server"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    # Download original from Immich
    TMPFILE="$TMPDIR/${ASSET_ID}"
    HTTP_CODE=$(curl -s -w '%{http_code}' -o "$TMPFILE" \
        -H "x-api-key: $IMMICH_API_KEY" \
        "$IMMICH_URL/api/assets/$ASSET_ID/original" 2>/dev/null || echo "000")

    if [ "$HTTP_CODE" != "200" ] || [ ! -s "$TMPFILE" ]; then
        echo "  ERROR: Failed to download from Immich (HTTP $HTTP_CODE)"
        ERRORS=$((ERRORS + 1))
        rm -f "$TMPFILE"
        continue
    fi

    FILESIZE=$(stat -c%s "$TMPFILE" 2>/dev/null || echo "0")
    echo "  Downloaded: $(( FILESIZE / 1024 )) KB"

    # Determine extension from MIME type
    case "$MIME_TYPE" in
        image/webp)  EXT="webp" ;;
        image/jpeg)  EXT="jpg" ;;
        image/png)   EXT="png" ;;
        image/gif)   EXT="gif" ;;
        *)           EXT="webp" ;;
    esac

    # Upload to image server
    UPLOAD_RESPONSE=$(curl -s -X POST \
        -F "file=@${TMPFILE};type=${MIME_TYPE};filename=poi-${POI_ID}.${EXT}" \
        -F "poi_id=$POI_ID" \
        -F "role=primary" \
        "$IMAGE_SERVER_URL/api/assets" 2>&1 || echo "UPLOAD_FAILED")

    if echo "$UPLOAD_RESPONSE" | grep -q "UPLOAD_FAILED\|error\|Error"; then
        echo "  ERROR: Upload failed — $UPLOAD_RESPONSE"
        ERRORS=$((ERRORS + 1))
    else
        NEW_ID=$(echo "$UPLOAD_RESPONSE" | python3.12 -c "import sys,json; print(json.load(sys.stdin).get('id','unknown'))" 2>/dev/null || echo "unknown")
        echo "  Uploaded: image server asset $NEW_ID"
    fi

    rm -f "$TMPFILE"

done <<< "$POIS"

echo ""
echo "=== Migration Complete ==="
echo "  Total: $TOTAL"
echo "  Migrated: $((COUNT - ERRORS - SKIPPED))"
echo "  Skipped: $SKIPPED"
echo "  Errors: $ERRORS"

# Cleanup
rm -rf "$TMPDIR"
