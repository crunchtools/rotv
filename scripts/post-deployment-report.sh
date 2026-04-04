#!/bin/bash
# Generate post-deployment report
# Run after deployment to generate comprehensive health report

CONTAINER_NAME="rootsofthevalley.org"
DB_NAME="rotv"
DB_USER="postgres"

# Color codes for terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Markdown-friendly output (no color codes in report file)
REPORT_FILE="/tmp/deployment-report-$(date +%Y%m%d_%H%M%S).md"

# Helper functions
log_header() {
    echo "" | tee -a "$REPORT_FILE"
    echo "## $1" | tee -a "$REPORT_FILE"
    echo "" | tee -a "$REPORT_FILE"
}

log_item() {
    echo "- $1" | tee -a "$REPORT_FILE"
}

log_code() {
    echo '```' | tee -a "$REPORT_FILE"
    echo "$1" | tee -a "$REPORT_FILE"
    echo '```' | tee -a "$REPORT_FILE"
}

echo -e "${BOLD}Generating Post-Deployment Report...${NC}"
echo ""

# Initialize report
cat > "$REPORT_FILE" << EOF
# Post-Deployment Report
**Generated:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Environment:** Production (rootsofthevalley.org)

---

EOF

# 1. Service Status
log_header "Service Status"

if systemctl is-active --quiet ${CONTAINER_NAME}; then
    log_item "✅ Service is **active** and running"
    UPTIME=$(systemctl show ${CONTAINER_NAME} -p ActiveEnterTimestamp --value)
    log_item "Started: ${UPTIME}"
else
    log_item "❌ Service is **not running**"
fi

# 2. Database Health
log_header "Database Health"

if podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -c "SELECT 1" > /dev/null 2>&1; then
    log_item "✅ Database connection: **OK**"

    POI_COUNT=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM pois;")
    MEDIA_COUNT=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media;")
    PRIMARY_COUNT=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media WHERE role='primary';")
    USER_COUNT=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM users;")

    log_item "Total POIs: **${POI_COUNT}**"
    log_item "Total Media: **${MEDIA_COUNT}**"
    log_item "Primary Images: **${PRIMARY_COUNT}**"
    log_item "Users: **${USER_COUNT}**"
else
    log_item "❌ Database connection: **FAILED**"
fi

# 3. API Health
log_header "API Endpoints"

# Health endpoint
if curl -sf https://rootsofthevalley.org/api/health > /dev/null 2>&1; then
    log_item "✅ Health endpoint: **OK**"
else
    log_item "❌ Health endpoint: **FAILED**"
fi

# POI endpoint
if curl -sf "https://rootsofthevalley.org/api/pois?limit=1" > /dev/null 2>&1; then
    log_item "✅ POI list endpoint: **OK**"
else
    log_item "❌ POI list endpoint: **FAILED**"
fi

# Media endpoint (PR #182 critical)
MEDIA_RESPONSE=$(curl -sf "https://rootsofthevalley.org/api/pois/1/media" 2>/dev/null || echo "FAILED")
if [ "$MEDIA_RESPONSE" != "FAILED" ]; then
    MEDIA_COUNT_API=$(echo "$MEDIA_RESPONSE" | jq -r '.total_count // 0' 2>/dev/null || echo "0")
    log_item "✅ Media endpoint: **OK** (POI 1 has ${MEDIA_COUNT_API} media items)"
else
    log_item "❌ Media endpoint: **FAILED**"
fi

# Thumbnail endpoint
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "https://rootsofthevalley.org/api/pois/1/thumbnail" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "404" ]; then
    log_item "✅ Thumbnail endpoint: **OK** (status: ${HTTP_CODE})"
else
    log_item "❌ Thumbnail endpoint: **FAILED** (status: ${HTTP_CODE})"
fi

# 4. Migration Status
log_header "Migration Status (PR #182)"

if podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'poi_media');" | grep -q "t"; then
    log_item "✅ Migration 015: poi_media table **exists**"
else
    log_item "❌ Migration 015: poi_media table **missing**"
fi

CAPTION_CHECK=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'poi_media'::regclass AND conname = 'poi_media_caption_length_check';" 2>/dev/null || echo "0")
if [ "$CAPTION_CHECK" -eq 1 ]; then
    log_item "✅ Migration 016: constraints **applied**"
else
    log_item "❌ Migration 016: constraints **missing**"
fi

EXPECTED_PRIMARY=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM pois WHERE has_primary_image = true;" 2>/dev/null || echo "0")
ACTUAL_PRIMARY=$(podman exec ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -tAc "SELECT COUNT(*) FROM poi_media WHERE role='primary' AND moderation_status IN ('published', 'auto_approved');" 2>/dev/null || echo "0")

if [ "$ACTUAL_PRIMARY" -eq 0 ]; then
    log_item "❌ Migration script: **NOT RUN** (0 primary images)"
elif [ "$ACTUAL_PRIMARY" -lt "$EXPECTED_PRIMARY" ]; then
    log_item "⚠️  Migration script: **INCOMPLETE** (${ACTUAL_PRIMARY}/${EXPECTED_PRIMARY} primary images)"
elif [ "$ACTUAL_PRIMARY" -eq "$EXPECTED_PRIMARY" ]; then
    log_item "✅ Migration script: **COMPLETE** (${ACTUAL_PRIMARY}/${EXPECTED_PRIMARY} primary images)"
else
    log_item "⚠️  Migration script: **UNKNOWN** (${ACTUAL_PRIMARY}/${EXPECTED_PRIMARY} primary images - more than expected)"
fi

# 5. Recent Logs
log_header "Recent Log Entries (Last 10 minutes)"

ERRORS=$(journalctl -u ${CONTAINER_NAME} --since "10 minutes ago" --no-pager 2>/dev/null | grep -i "error" | wc -l || echo "0")
log_item "Error count: **${ERRORS}**"

if [ "$ERRORS" -gt 0 ]; then
    echo "" >> "$REPORT_FILE"
    echo "Recent errors:" >> "$REPORT_FILE"
    log_code "$(journalctl -u ${CONTAINER_NAME} --since "10 minutes ago" --no-pager 2>/dev/null | grep -i "error" | tail -5 || echo "Unable to retrieve logs")"
fi

# 6. Container Info
log_header "Container Information"

IMAGE=$(podman inspect ${CONTAINER_NAME} --format '{{.Image}}' 2>/dev/null || echo "unknown")
CREATED=$(podman inspect ${CONTAINER_NAME} --format '{{.Created}}' 2>/dev/null || echo "unknown")

log_item "Image: \`${IMAGE:0:12}...\`"
log_item "Created: ${CREATED}"

# Resource usage
STATS=$(podman stats --no-stream ${CONTAINER_NAME} --format "CPU: {{.CPUPerc}} | Memory: {{.MemUsage}}" 2>/dev/null || echo "Unable to retrieve stats")
log_item "Resources: ${STATS}"

# 7. Recommendations
log_header "Recommendations"

RECOMMENDATIONS=()

# Check if migration script needs to run
if [ "$ACTUAL_PRIMARY" -eq 0 ]; then
    RECOMMENDATIONS+=("🔴 **CRITICAL**: Run migration script immediately: \`podman exec ${CONTAINER_NAME} node /app/scripts/migrate-primary-images.js\`")
fi

# Check if migration 016 needs to be applied
if [ "$CAPTION_CHECK" -eq 0 ]; then
    RECOMMENDATIONS+=("🔴 **CRITICAL**: Apply migration 016: \`podman exec ${CONTAINER_NAME} psql -U postgres -d rotv -f /app/migrations/016_fix_poi_media_constraints.sql\`")
fi

# Check for high error rates
if [ "$ERRORS" -gt 20 ]; then
    RECOMMENDATIONS+=("⚠️  **WARNING**: High error rate detected (${ERRORS} errors in 10 minutes). Review logs: \`journalctl -u ${CONTAINER_NAME} --since '10 minutes ago'\`")
fi

# Check if POIs with primary images but no media records
if [ "$EXPECTED_PRIMARY" -gt "$ACTUAL_PRIMARY" ] && [ "$ACTUAL_PRIMARY" -gt 0 ]; then
    RECOMMENDATIONS+=("⚠️  **WARNING**: Some POIs missing primary images (${ACTUAL_PRIMARY}/${EXPECTED_PRIMARY}). Consider re-running migration script.")
fi

if [ ${#RECOMMENDATIONS[@]} -eq 0 ]; then
    log_item "✅ No immediate actions required - deployment looks healthy"
else
    for REC in "${RECOMMENDATIONS[@]}"; do
        log_item "$REC"
    done
fi

# 8. Next Steps
log_header "Next Steps"

log_item "Monitor logs for the next 24 hours: \`journalctl -u ${CONTAINER_NAME} -f\`"
log_item "Run smoke tests: \`gh workflow run smoke-test.yml\`"
log_item "Verify migrations: \`bash scripts/verify-migrations.sh\`"
log_item "Check deployment verification checklist: \`DEPLOYMENT_VERIFICATION_CHECKLIST.md\`"

# Footer
cat >> "$REPORT_FILE" << EOF

---

**Generated by:** \`scripts/post-deployment-report.sh\`
**Report file:** \`${REPORT_FILE}\`
EOF

# Display report
echo ""
echo -e "${BOLD}Report generated:${NC} ${REPORT_FILE}"
echo ""
cat "$REPORT_FILE"

# Offer to copy to clipboard (if xclip is available)
if command -v xclip > /dev/null 2>&1; then
    read -p "Copy report to clipboard? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cat "$REPORT_FILE" | xclip -selection clipboard
        echo "✅ Report copied to clipboard"
    fi
fi

echo ""
echo -e "${GREEN}✅ Post-deployment report complete${NC}"
echo ""
