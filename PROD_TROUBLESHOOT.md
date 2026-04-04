# Production Troubleshooting: Failed to Load Image (PR #182)

**Issue:** "Failed to load image" error in production after PR #182 deployment
**Root Cause:** Database migration script not executed
**Date:** 2026-04-04

---

## Quick Diagnosis

### Step 1: Check if `poi_media` table exists and has data

```bash
ssh -p 22422 root@lotor.dc3.crunchtools.com

# Check table exists
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "\dt poi_media"

# Check if table has any records
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "SELECT COUNT(*) FROM poi_media;"

# Check specifically for primary images
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "SELECT COUNT(*) FROM poi_media WHERE role='primary';"
```

**Expected Results:**
- Table exists: ✅ (migration 015 applied)
- Total count: Should be > 0 if migration script ran
- Primary count: Should match number of POIs with images (likely 50-100+)

**If count is 0:** The migration script was NOT run ⚠️

---

## Step 2: Verify Migration 015 Applied

```bash
# Check if poi_media table has correct schema
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "\d poi_media"
```

**Expected Columns:**
- id, poi_id, media_type
- image_server_asset_id, youtube_url
- role, sort_order, likes_count, caption
- moderation_status, confidence_score, ai_reasoning
- submitted_by, moderated_by, moderated_at, created_at

**If table doesn't exist:** Migration 015 was not applied

---

## Step 3: Verify Migration 016 Applied

```bash
# Check for caption length constraint
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT conname
FROM pg_constraint
WHERE conrelid = 'poi_media'::regclass
  AND conname = 'poi_media_caption_length_check';
"
```

**Expected:** 1 row returned with constraint name

**If not found:** Migration 016 was not applied

---

## Step 4: Check Image Server Connectivity

```bash
# Check IMAGE_SERVER_URL environment variable
podman exec rootsofthevalley.org printenv | grep IMAGE_SERVER

# Test image server from container
podman exec rootsofthevalley.org curl -s http://10.89.1.100:8000/api/health | jq

# Alternative: Check from host
curl -s http://10.89.1.100:8000/api/health | jq
```

**Expected Results:**
- `IMAGE_SERVER_URL=http://10.89.1.100:8000` (or similar)
- Health endpoint returns `{"status": "ok"}` or similar

**If connection fails:** Image server is down or unreachable

---

## Step 5: Check Application Logs

```bash
# Check for initialization errors
journalctl -u rootsofthevalley.org --since "1 hour ago" | grep -i "imageserver"

# Check for 404 errors on media endpoints
journalctl -u rootsofthevalley.org --since "1 hour ago" | grep "/api/pois/.*/media"

# Check for thumbnail endpoint errors
journalctl -u rootsofthevalley.org --since "1 hour ago" | grep "/api/pois/.*/thumbnail"
```

**Look for:**
- `[ImageServer] Initialized with server: http://10.89.1.100:8000` ✅
- `[ImageServer] Not configured - set IMAGE_SERVER_URL` ❌
- 404 errors on thumbnail requests
- Database query errors

---

## Fix Procedure

### Fix 1: Apply Missing Migrations (if `poi_media` is empty)

```bash
# DRY RUN first to see what would be migrated
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js --dry-run

# Review output, then run for real
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js

# Verify migration succeeded
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT
  media_type,
  role,
  moderation_status,
  COUNT(*)
FROM poi_media
GROUP BY media_type, role, moderation_status;
"
```

**Expected Output:**
```
 media_type |  role   | moderation_status | count
------------+---------+-------------------+-------
 image      | primary | published         |   75
(1 row)
```

### Fix 2: Apply Migration 016 (if constraints missing)

```bash
# Apply data integrity migration
podman exec rootsofthevalley.org psql -U postgres -d rotv -f /app/migrations/016_fix_poi_media_constraints.sql

# Verify constraints applied
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'poi_media'::regclass
ORDER BY conname;
"
```

**Expected Constraints:**
- `poi_media_caption_length_check` (CHECK)
- `poi_media_moderation_check` (CHECK)
- `poi_media_moderated_by_fkey` (FOREIGN KEY)
- `poi_media_submitted_by_fkey` (FOREIGN KEY)

### Fix 3: Restart Service (if needed)

```bash
# Restart to clear any caching issues
systemctl restart rootsofthevalley.org

# Wait for startup
sleep 10

# Verify service is running
systemctl status rootsofthevalley.org --no-pager

# Check logs for errors
journalctl -u rootsofthevalley.org --since "1 minute ago" --no-pager
```

---

## Verification Tests

### Test 1: API Endpoints

```bash
# Test media endpoint for POI #1
curl -s https://rootsofthevalley.org/api/pois/1/media | jq

# Should return:
# {
#   "mosaic": [...],
#   "all_media": [...],
#   "total_count": N
# }

# Test legacy thumbnail endpoint
curl -I https://rootsofthevalley.org/api/pois/1/thumbnail
# Should return: 200 OK (with image data)
```

### Test 2: Frontend UI

1. Navigate to https://rootsofthevalley.org
2. Click any POI marker on the map
3. Sidebar should show:
   - Mosaic display (Facebook-style grid) if multiple images
   - Single image if only one image
   - No broken image icons

### Test 3: Database Queries

```bash
# Check media for a specific POI
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT
  id,
  media_type,
  role,
  image_server_asset_id,
  moderation_status
FROM poi_media
WHERE poi_id = 1;
"

# Check moderation queue
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT COUNT(*)
FROM moderation_queue
WHERE content_type = 'photo';
"
```

---

## Common Issues

### Issue: "Image server not configured"

**Symptoms:** Logs show `[ImageServer] Not configured - set IMAGE_SERVER_URL`

**Fix:**
```bash
# Check systemd service file for IMAGE_SERVER_URL environment variable
systemctl cat rootsofthevalley.org | grep -i image

# If missing, edit service file and add:
# Environment="IMAGE_SERVER_URL=http://10.89.1.100:8000"

# Reload and restart
systemctl daemon-reload
systemctl restart rootsofthevalley.org
```

### Issue: Migration script fails with "ECONNREFUSED"

**Symptoms:** `migrate-primary-images.js` can't connect to image server

**Fix:**
```bash
# Test connectivity from container
podman exec rootsofthevalley.org curl -v http://10.89.1.100:8000/api/health

# If connection refused, check:
# 1. Image server is running
# 2. Firewall rules allow 10.89.1.100:8000
# 3. Network routing is correct
```

### Issue: Migration script creates duplicates

**Symptoms:** Unique constraint violation on `idx_poi_media_unique_primary`

**Fix:** The script checks for existing entries and skips them. If duplicates occur:
```bash
# Find duplicates
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT poi_id, COUNT(*)
FROM poi_media
WHERE role = 'primary'
  AND moderation_status IN ('published', 'auto_approved')
GROUP BY poi_id
HAVING COUNT(*) > 1;
"

# Manually clean up (keep oldest, delete newer)
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
DELETE FROM poi_media
WHERE id IN (
  SELECT id
  FROM (
    SELECT id, poi_id,
           ROW_NUMBER() OVER (PARTITION BY poi_id ORDER BY created_at ASC) as rn
    FROM poi_media
    WHERE role = 'primary'
      AND moderation_status IN ('published', 'auto_approved')
  ) sub
  WHERE rn > 1
);
"
```

---

## Rollback (if needed)

If deployment is broken beyond repair:

```bash
# Find backup file
ls -lh /root/backups/rotv_pre_multi_image_*

# Restore database
podman exec -i rootsofthevalley.org psql -U postgres rotv < /root/backups/rotv_pre_multi_image_<TIMESTAMP>.sql

# Revert to previous container image
podman images quay.io/crunchtools/rotv
podman tag quay.io/crunchtools/rotv:<PREVIOUS_SHA> quay.io/crunchtools/rotv:latest

# Restart service
systemctl restart rootsofthevalley.org
```

---

## Success Checklist

- [ ] `poi_media` table exists
- [ ] `poi_media` has records (COUNT > 0)
- [ ] Primary images migrated (role='primary' count matches POIs with images)
- [ ] Migration 016 constraints applied
- [ ] Image server connectivity verified
- [ ] API endpoint `/api/pois/1/media` returns data
- [ ] Frontend displays mosaic/images correctly
- [ ] No errors in service logs
- [ ] Legacy thumbnail endpoint works

---

## Contact

**Issue:** PR #182 - Multi-Image POI Support
**PR Link:** https://github.com/crunchtools/rotv/pull/182
**Deployment Runbook:** `.specify/specs/004-multi-image-poi/DEPLOYMENT_RUNBOOK.md`
