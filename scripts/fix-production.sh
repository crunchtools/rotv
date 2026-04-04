#!/bin/bash
# Production Fix Script for PR #182 Image Loading Issue
# Run on lotor.dc3.crunchtools.com as root
# This script applies the missing migrations

set -e

CONTAINER_NAME="rootsofthevalley.org"
DB_NAME="rotv"
DB_USER="postgres"
BACKUP_DIR="/root/backups"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "=========================================="
echo "ROTV Production Fix (PR #182)"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}ERROR:${NC} This script must be run as root"
    echo "Run: sudo $0"
    exit 1
fi

# Check if container is running
if ! podman ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${RED}ERROR:${NC} Container ${CONTAINER_NAME} is not running"
    echo "Run: systemctl start ${CONTAINER_NAME}"
    exit 1
fi

# Ask for confirmation
echo -e "${YELLOW}This script will:${NC}"
echo "  1. Create database backup"
echo "  2. Apply migration 016 (data integrity constraints)"
echo "  3. Run primary image migration script"
echo "  4. Verify migrations succeeded"
echo "  5. Restart service"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted"
    exit 1
fi
echo ""

# Step 1: Create backup
echo -e "${BLUE}Step 1: Creating database backup...${NC}"
mkdir -p ${BACKUP_DIR}
BACKUP_FILE="${BACKUP_DIR}/rotv_pre_fix_$(date +%Y%m%d_%H%M%S).sql"
podman exec ${CONTAINER_NAME} pg_dump -U ${DB_USER} ${DB_NAME} > ${BACKUP_FILE}

if [ -f "${BACKUP_FILE}" ]; then
    BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    echo -e "${GREEN}✓${NC} Backup created: ${BACKUP_FILE} (${BACKUP_SIZE})"
else
    echo -e "${RED}✗${NC} Backup failed"
    exit 1
fi
echo ""

# Step 2: Check and apply migration 016
echo -e "${BLUE}Step 2: Checking migration 016...${NC}"
CAPTION_CHECK=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'poi_media'::regclass AND conname = 'poi_media_caption_length_check';")

if [ "$CAPTION_CHECK" -eq 1 ]; then
    echo -e "${GREEN}✓${NC} Migration 016 already applied, skipping"
else
    echo "  Applying migration 016..."
    if podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -f /app/migrations/016_fix_poi_media_constraints.sql; then
        echo -e "${GREEN}✓${NC} Migration 016 applied successfully"
    else
        echo -e "${RED}✗${NC} Migration 016 failed"
        echo "  Backup available at: ${BACKUP_FILE}"
        exit 1
    fi
fi
echo ""

# Step 3: Check if primary migration needed
echo -e "${BLUE}Step 3: Checking primary image migration...${NC}"
PRIMARY_COUNT=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media WHERE role='primary';")
EXPECTED_COUNT=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM pois WHERE has_primary_image = true;")

echo "  Expected primary images: ${EXPECTED_COUNT}"
echo "  Current primary images: ${PRIMARY_COUNT}"

if [ "$PRIMARY_COUNT" -ge "$EXPECTED_COUNT" ]; then
    echo -e "${GREEN}✓${NC} Primary images already migrated, skipping"
else
    echo "  Running dry-run first..."
    podman exec ${CONTAINER_NAME} node /app/scripts/migrate-primary-images.js --dry-run | tail -20
    echo ""
    read -p "Proceed with actual migration? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted at migration step"
        exit 1
    fi

    echo "  Running primary image migration..."
    if podman exec ${CONTAINER_NAME} node /app/scripts/migrate-primary-images.js; then
        echo -e "${GREEN}✓${NC} Primary image migration completed"
    else
        echo -e "${RED}✗${NC} Primary image migration failed"
        echo "  Check logs above for errors"
        echo "  Backup available at: ${BACKUP_FILE}"
        exit 1
    fi
fi
echo ""

# Step 4: Verify migrations
echo -e "${BLUE}Step 4: Verifying migrations...${NC}"
NEW_PRIMARY_COUNT=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media WHERE role='primary';")
PUBLISHED_COUNT=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media WHERE moderation_status IN ('published', 'auto_approved');")

echo "  Primary images: ${NEW_PRIMARY_COUNT}"
echo "  Published media: ${PUBLISHED_COUNT}"

if [ "$NEW_PRIMARY_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓${NC} Verification passed"
else
    echo -e "${RED}✗${NC} Verification failed - no primary images found"
    exit 1
fi
echo ""

# Step 5: Restart service
echo -e "${BLUE}Step 5: Restarting service...${NC}"
systemctl restart ${CONTAINER_NAME}
echo "  Waiting 10 seconds for startup..."
sleep 10

if systemctl is-active --quiet ${CONTAINER_NAME}; then
    echo -e "${GREEN}✓${NC} Service restarted successfully"
else
    echo -e "${RED}✗${NC} Service failed to start"
    echo "  Check logs: journalctl -u ${CONTAINER_NAME} --no-pager -n 50"
    exit 1
fi
echo ""

# Step 6: Test API
echo -e "${BLUE}Step 6: Testing API endpoint...${NC}"
sleep 5  # Give it a moment to fully initialize

TEST_RESPONSE=$(curl -s https://rootsofthevalley.org/api/pois/1/media)
TEST_COUNT=$(echo "$TEST_RESPONSE" | jq -r '.total_count // 0' 2>/dev/null || echo "0")

echo "  Test POI #1 media count: ${TEST_COUNT}"

if [ "$TEST_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓${NC} API endpoint working correctly"
else
    echo -e "${YELLOW}⚠${NC} API returned 0 media items"
    echo "  This may be normal if POI #1 has no images"
fi
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}FIX COMPLETE${NC}"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - Backup: ${BACKUP_FILE}"
echo "  - Migration 016: Applied"
echo "  - Primary images: ${NEW_PRIMARY_COUNT} migrated"
echo "  - Service: Restarted"
echo ""
echo "Next steps:"
echo "  1. Test in browser: https://rootsofthevalley.org"
echo "  2. Click a POI to verify images load"
echo "  3. Monitor logs: journalctl -u ${CONTAINER_NAME} -f"
echo ""
echo "If issues persist, check:"
echo "  - Browser console for frontend errors"
echo "  - Image server connectivity"
echo "  - Application logs for errors"
echo ""
echo "Rollback (if needed):"
echo "  podman exec -i ${CONTAINER_NAME} psql -U ${DB_USER} ${DB_NAME} < ${BACKUP_FILE}"
echo "  systemctl restart ${CONTAINER_NAME}"
echo ""
