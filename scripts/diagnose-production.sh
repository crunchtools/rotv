#!/bin/bash
# Production Diagnostic Script for PR #182 Image Loading Issue
# Run on lotor.dc3.crunchtools.com as root

set -e

CONTAINER_NAME="rootsofthevalley.org"
DB_NAME="rotv"
DB_USER="postgres"

echo "=========================================="
echo "ROTV Production Diagnostics (PR #182)"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
}

check_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
}

check_warn() {
    echo -e "${YELLOW}⚠ WARN${NC}: $1"
}

# 1. Check if container is running
echo "1. Container Status"
echo "-------------------"
if podman ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    check_pass "Container ${CONTAINER_NAME} is running"
    UPTIME=$(podman ps --filter "name=${CONTAINER_NAME}" --format "{{.Status}}")
    echo "   Uptime: ${UPTIME}"
else
    check_fail "Container ${CONTAINER_NAME} is NOT running"
    echo "   Run: systemctl start ${CONTAINER_NAME}"
    exit 1
fi
echo ""

# 2. Check if poi_media table exists
echo "2. Database: poi_media Table"
echo "----------------------------"
if podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'poi_media');" | grep -q "t"; then
    check_pass "Table poi_media exists"
else
    check_fail "Table poi_media does NOT exist"
    echo "   Migration 015 was not applied"
    echo "   Fix: podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -f /app/migrations/015_add_poi_media.sql"
    exit 1
fi
echo ""

# 3. Check if poi_media has records
echo "3. Database: poi_media Record Count"
echo "------------------------------------"
TOTAL_COUNT=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media;")
PRIMARY_COUNT=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media WHERE role='primary';")
PUBLISHED_COUNT=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media WHERE moderation_status IN ('published', 'auto_approved');")

echo "   Total records: ${TOTAL_COUNT}"
echo "   Primary images: ${PRIMARY_COUNT}"
echo "   Published: ${PUBLISHED_COUNT}"

if [ "$PRIMARY_COUNT" -eq 0 ]; then
    check_fail "No primary images in poi_media table"
    echo "   Migration script was NOT run"
    echo "   Fix: podman exec ${CONTAINER_NAME} node /app/scripts/migrate-primary-images.js"
    NEEDS_MIGRATION=true
else
    check_pass "Primary images found in poi_media"
    NEEDS_MIGRATION=false
fi
echo ""

# 4. Check expected vs actual primary images
echo "4. Database: Primary Image Consistency"
echo "---------------------------------------"
EXPECTED_PRIMARY=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM pois WHERE has_primary_image = true;")
echo "   POIs with has_primary_image=true: ${EXPECTED_PRIMARY}"
echo "   poi_media with role='primary': ${PRIMARY_COUNT}"

if [ "$EXPECTED_PRIMARY" -eq "$PRIMARY_COUNT" ]; then
    check_pass "Primary image counts match"
elif [ "$PRIMARY_COUNT" -eq 0 ]; then
    check_fail "Migration script needs to run"
else
    check_warn "Mismatch: Expected ${EXPECTED_PRIMARY}, got ${PRIMARY_COUNT}"
    echo "   Some POIs may be missing primary images"
fi
echo ""

# 5. Check Migration 016 constraints
echo "5. Database: Migration 016 Constraints"
echo "---------------------------------------"
CAPTION_CHECK=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'poi_media'::regclass AND conname = 'poi_media_caption_length_check';")
MODERATION_CHECK=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'poi_media'::regclass AND conname = 'poi_media_moderation_check';")

if [ "$CAPTION_CHECK" -eq 1 ]; then
    check_pass "Caption length constraint exists"
else
    check_fail "Caption length constraint missing"
    echo "   Migration 016 needs to be applied"
    NEEDS_016=true
fi

if [ "$MODERATION_CHECK" -eq 1 ]; then
    check_pass "Moderation status constraint exists"
else
    check_fail "Moderation status constraint missing"
    echo "   Migration 016 needs to be applied"
    NEEDS_016=true
fi
echo ""

# 6. Check IMAGE_SERVER_URL environment variable
echo "6. Environment: IMAGE_SERVER_URL"
echo "---------------------------------"
IMAGE_SERVER_URL=$(podman exec ${CONTAINER_NAME} printenv IMAGE_SERVER_URL 2>/dev/null || echo "")

if [ -n "$IMAGE_SERVER_URL" ]; then
    check_pass "IMAGE_SERVER_URL is set"
    echo "   Value: ${IMAGE_SERVER_URL}"
else
    check_fail "IMAGE_SERVER_URL is NOT set"
    echo "   Migration script will fail"
    echo "   Check systemd service file for Environment= setting"
fi
echo ""

# 7. Test image server connectivity
echo "7. Network: Image Server Connectivity"
echo "--------------------------------------"
if [ -n "$IMAGE_SERVER_URL" ]; then
    if podman exec ${CONTAINER_NAME} curl -sf "${IMAGE_SERVER_URL}/api/health" > /dev/null 2>&1; then
        check_pass "Image server is reachable"
        HEALTH=$(podman exec ${CONTAINER_NAME} curl -s "${IMAGE_SERVER_URL}/api/health")
        echo "   Health check: ${HEALTH}"
    else
        check_fail "Cannot reach image server"
        echo "   URL: ${IMAGE_SERVER_URL}/api/health"
        echo "   Migration script will fail"
    fi
else
    check_warn "Skipping (IMAGE_SERVER_URL not set)"
fi
echo ""

# 8. Check application logs for errors
echo "8. Logs: Recent Errors"
echo "----------------------"
ERROR_COUNT=$(journalctl -u ${CONTAINER_NAME} --since "1 hour ago" --no-pager | grep -i "error" | wc -l)
MEDIA_ERRORS=$(journalctl -u ${CONTAINER_NAME} --since "1 hour ago" --no-pager | grep -i "Failed to fetch media\|Image not found" | wc -l)

echo "   Total errors (1 hour): ${ERROR_COUNT}"
echo "   Media-related errors: ${MEDIA_ERRORS}"

if [ "$MEDIA_ERRORS" -gt 0 ]; then
    check_warn "${MEDIA_ERRORS} media-related errors found"
    echo ""
    echo "   Recent media errors:"
    journalctl -u ${CONTAINER_NAME} --since "1 hour ago" --no-pager | grep -i "Failed to fetch media\|Image not found" | tail -5 | sed 's/^/   /'
else
    check_pass "No recent media errors"
fi
echo ""

# 9. Test API endpoint
echo "9. API: Test Media Endpoint"
echo "----------------------------"
TEST_POI_ID=1
if curl -sf "https://rootsofthevalley.org/api/pois/${TEST_POI_ID}/media" > /dev/null 2>&1; then
    check_pass "Media endpoint is responding"
    RESPONSE=$(curl -s "https://rootsofthevalley.org/api/pois/${TEST_POI_ID}/media")
    TOTAL=$(echo "$RESPONSE" | jq -r '.total_count // 0' 2>/dev/null || echo "0")
    echo "   POI ${TEST_POI_ID} total_count: ${TOTAL}"

    if [ "$TOTAL" -eq 0 ]; then
        check_warn "Endpoint returns 0 media items"
    fi
else
    check_fail "Media endpoint returned error"
fi
echo ""

# Summary and recommendations
echo ""
echo "=========================================="
echo "SUMMARY AND RECOMMENDATIONS"
echo "=========================================="
echo ""

if [ "$NEEDS_MIGRATION" = true ]; then
    echo -e "${RED}ACTION REQUIRED:${NC} Run primary image migration"
    echo ""
    echo "  # Dry run first (see what will happen)"
    echo "  podman exec ${CONTAINER_NAME} node /app/scripts/migrate-primary-images.js --dry-run"
    echo ""
    echo "  # Run migration for real"
    echo "  podman exec ${CONTAINER_NAME} node /app/scripts/migrate-primary-images.js"
    echo ""
fi

if [ "${NEEDS_016}" = true ]; then
    echo -e "${RED}ACTION REQUIRED:${NC} Apply migration 016"
    echo ""
    echo "  podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -f /app/migrations/016_fix_poi_media_constraints.sql"
    echo ""
fi

if [ "$NEEDS_MIGRATION" = true ] || [ "${NEEDS_016}" = true ]; then
    echo -e "${YELLOW}After applying migrations:${NC}"
    echo ""
    echo "  # Restart service"
    echo "  systemctl restart ${CONTAINER_NAME}"
    echo ""
    echo "  # Verify fix"
    echo "  curl -s https://rootsofthevalley.org/api/pois/1/media | jq '.total_count'"
    echo ""
else
    echo -e "${GREEN}All checks passed!${NC}"
    echo ""
    echo "If images are still failing to load, check:"
    echo "  1. Browser console for frontend errors"
    echo "  2. Image server logs for asset serving errors"
    echo "  3. Asset IDs in poi_media match assets on image server"
fi

echo "=========================================="
