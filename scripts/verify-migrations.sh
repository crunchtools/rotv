#!/bin/bash
# Verify all database migrations have been applied correctly
# Run on production server: bash scripts/verify-migrations.sh

set -e

CONTAINER_NAME="rootsofthevalley.org"
DB_NAME="rotv"
DB_USER="postgres"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Database Migration Verification"
echo "=========================================="
echo ""

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

check_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

check_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

check_warn() {
    echo -e "${YELLOW}⚠ WARN${NC}: $1"
    WARN_COUNT=$((WARN_COUNT + 1))
}

# Check if running on production server
if ! podman ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${YELLOW}Note:${NC} Container ${CONTAINER_NAME} not found."
    echo "This script should be run on production server."
    echo "If running locally, update CONTAINER_NAME variable."
    exit 1
fi

echo -e "${BLUE}Checking database schema...${NC}"
echo ""

# 1. Check core tables exist
echo "1. Core Tables"
echo "--------------"

TABLES=(
    "pois"
    "users"
    "poi_news"
    "poi_events"
    "poi_media"
    "admin_settings"
    "sessions"
)

for TABLE in "${TABLES[@]}"; do
    if podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${TABLE}');" | grep -q "t"; then
        check_pass "Table '${TABLE}' exists"
    else
        check_fail "Table '${TABLE}' missing"
    fi
done
echo ""

# 2. Check poi_media table schema (Migration 015)
echo "2. Migration 015: poi_media Table Schema"
echo "-----------------------------------------"

POI_MEDIA_COLUMNS=(
    "id"
    "poi_id"
    "media_type"
    "image_server_asset_id"
    "youtube_url"
    "role"
    "sort_order"
    "likes_count"
    "caption"
    "moderation_status"
    "confidence_score"
    "ai_reasoning"
    "submitted_by"
    "moderated_by"
    "moderated_at"
    "created_at"
)

for COLUMN in "${POI_MEDIA_COLUMNS[@]}"; do
    if podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'poi_media' AND column_name = '${COLUMN}');" | grep -q "t"; then
        check_pass "Column 'poi_media.${COLUMN}' exists"
    else
        check_fail "Column 'poi_media.${COLUMN}' missing"
    fi
done
echo ""

# 3. Check poi_media indexes (Migration 015)
echo "3. Migration 015: poi_media Indexes"
echo "------------------------------------"

POI_MEDIA_INDEXES=(
    "idx_poi_media_poi_id"
    "idx_poi_media_role"
    "idx_poi_media_likes"
    "idx_poi_media_created"
    "idx_poi_media_moderation"
    "idx_poi_media_unique_primary"
)

for INDEX in "${POI_MEDIA_INDEXES[@]}"; do
    if podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT EXISTS (SELECT FROM pg_indexes WHERE indexname = '${INDEX}');" | grep -q "t"; then
        check_pass "Index '${INDEX}' exists"
    else
        check_fail "Index '${INDEX}' missing"
    fi
done
echo ""

# 4. Check Migration 016 constraints
echo "4. Migration 016: Data Integrity Constraints"
echo "---------------------------------------------"

CONSTRAINTS=(
    "poi_media_caption_length_check"
    "poi_media_moderation_check"
    "poi_media_submitted_by_fkey"
    "poi_media_moderated_by_fkey"
)

for CONSTRAINT in "${CONSTRAINTS[@]}"; do
    if podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT EXISTS (SELECT FROM pg_constraint WHERE conrelid = 'poi_media'::regclass AND conname = '${CONSTRAINT}');" | grep -q "t"; then
        check_pass "Constraint '${CONSTRAINT}' exists"
    else
        check_fail "Constraint '${CONSTRAINT}' missing"
    fi
done
echo ""

# 5. Check moderation_queue view
echo "5. Views"
echo "--------"

if podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT EXISTS (SELECT FROM information_schema.views WHERE table_name = 'moderation_queue');" | grep -q "t"; then
    check_pass "View 'moderation_queue' exists"

    # Check if view includes poi_media
    VIEW_DEF=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT pg_get_viewdef('moderation_queue', true);")
    if echo "$VIEW_DEF" | grep -q "poi_media"; then
        check_pass "View 'moderation_queue' includes poi_media"
    else
        check_fail "View 'moderation_queue' missing poi_media"
    fi
else
    check_fail "View 'moderation_queue' missing"
fi
echo ""

# 6. Check data population (Migration script)
echo "6. Data Population: Primary Images"
echo "-----------------------------------"

EXPECTED_PRIMARY=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM pois WHERE has_primary_image = true;")
ACTUAL_PRIMARY=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media WHERE role='primary' AND moderation_status IN ('published', 'auto_approved');")

echo "   POIs with has_primary_image=true: ${EXPECTED_PRIMARY}"
echo "   poi_media with role='primary': ${ACTUAL_PRIMARY}"

if [ "$ACTUAL_PRIMARY" -eq 0 ]; then
    check_fail "No primary images in poi_media (migration script NOT run)"
    echo "   Fix: podman exec ${CONTAINER_NAME} node /app/scripts/migrate-primary-images.js"
elif [ "$ACTUAL_PRIMARY" -lt "$EXPECTED_PRIMARY" ]; then
    check_warn "Missing primary images (expected ${EXPECTED_PRIMARY}, got ${ACTUAL_PRIMARY})"
    echo "   Some POIs may be missing primary images"
elif [ "$ACTUAL_PRIMARY" -eq "$EXPECTED_PRIMARY" ]; then
    check_pass "All primary images migrated (${ACTUAL_PRIMARY}/${EXPECTED_PRIMARY})"
else
    check_warn "More primary images than expected (expected ${EXPECTED_PRIMARY}, got ${ACTUAL_PRIMARY})"
    echo "   May have duplicates or manual additions"
fi
echo ""

# 7. Check admin settings
echo "7. Admin Settings"
echo "-----------------"

SETTINGS=(
    "multi_media_enabled"
    "video_upload_max_mb"
    "media_admin_auto_approve"
)

for SETTING in "${SETTINGS[@]}"; do
    if podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT EXISTS (SELECT FROM admin_settings WHERE key = '${SETTING}');" | grep -q "t"; then
        VALUE=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT value FROM admin_settings WHERE key = '${SETTING}';")
        check_pass "Setting '${SETTING}' exists (value: ${VALUE})"
    else
        check_fail "Setting '${SETTING}' missing"
    fi
done
echo ""

# 8. Check for data integrity issues
echo "8. Data Integrity Checks"
echo "------------------------"

# Check for duplicate primary images
DUPLICATES=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM (SELECT poi_id, COUNT(*) FROM poi_media WHERE role='primary' AND moderation_status IN ('published', 'auto_approved') GROUP BY poi_id HAVING COUNT(*) > 1) dup;")

if [ "$DUPLICATES" -eq 0 ]; then
    check_pass "No duplicate primary images"
else
    check_fail "Found ${DUPLICATES} POIs with duplicate primary images"
    echo "   Run: SELECT poi_id, COUNT(*) FROM poi_media WHERE role='primary' AND moderation_status IN ('published', 'auto_approved') GROUP BY poi_id HAVING COUNT(*) > 1;"
fi

# Check for orphaned media (poi doesn't exist)
ORPHANED=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media pm LEFT JOIN pois p ON pm.poi_id = p.id WHERE p.id IS NULL;")

if [ "$ORPHANED" -eq 0 ]; then
    check_pass "No orphaned media records"
else
    check_warn "Found ${ORPHANED} orphaned media records (POI deleted but media remains)"
fi

# Check for NULL asset IDs on non-youtube media
NULL_ASSETS=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media WHERE media_type IN ('image', 'video') AND image_server_asset_id IS NULL;")

if [ "$NULL_ASSETS" -eq 0 ]; then
    check_pass "No NULL asset IDs on image/video media"
else
    check_fail "Found ${NULL_ASSETS} image/video records with NULL asset IDs"
fi

echo ""

# Summary
echo "=========================================="
echo "VERIFICATION SUMMARY"
echo "=========================================="
echo ""
echo "Total Checks: $((PASS_COUNT + FAIL_COUNT + WARN_COUNT))"
echo -e "${GREEN}Passed: ${PASS_COUNT}${NC}"
echo -e "${YELLOW}Warnings: ${WARN_COUNT}${NC}"
echo -e "${RED}Failed: ${FAIL_COUNT}${NC}"
echo ""

if [ "$FAIL_COUNT" -eq 0 ] && [ "$WARN_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✅ ALL CHECKS PASSED - Database migrations are complete${NC}"
    exit 0
elif [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e "${YELLOW}⚠️  PASSED WITH WARNINGS - Review warnings above${NC}"
    exit 0
else
    echo -e "${RED}❌ VERIFICATION FAILED - Database migrations incomplete${NC}"
    echo ""
    echo "Action Required:"
    echo "  1. Review failed checks above"
    echo "  2. Apply missing migrations"
    echo "  3. Run this script again to verify"
    echo ""
    echo "See PROD_TROUBLESHOOT.md for detailed guidance"
    exit 1
fi
