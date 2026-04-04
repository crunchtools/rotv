# Deployment Runbook: Multi-Image POI Support (Issue #181)

**Date:** 2026-04-04
**Feature:** Multi-Image POI Support
**PR:** #182
**Target:** rootsofthevalley.org (lotor.dc3.crunchtools.com)

---

## Pre-Deployment Checklist

- [x] All code implemented and tested
- [x] PR #182 created and reviewed
- [x] Quality gates passed (build, tests, security)
- [x] Gatehouse security review: 4 HIGH issues fixed
- [x] Gemini code review: 1 issue fixed
- [x] Integration tests: 15/15 passing
- [x] No blocking issues
- [ ] User approval for production deployment
- [ ] PR merged to master
- [ ] GHA build completed successfully

---

## Deployment Steps

### Step 1: Merge Pull Request

```bash
# Merge PR #182 to master
gh pr merge 182 --merge --delete-branch

# Confirm merge
gh pr view 182 --json state,mergedAt
```

**Expected Output:**
```json
{
  "state": "MERGED",
  "mergedAt": "2026-04-04T..."
}
```

### Step 2: Monitor GitHub Actions Build

```bash
# Find the build run triggered by the merge
gh run list --branch=master --limit=3

# Watch the build
gh run watch <RUN_ID>
```

**Success Criteria:**
- All jobs pass (build, test, publish)
- New container pushed to `quay.io/crunchtools/rotv:latest`

**If Build Fails:**
```bash
# View failed logs
gh run view <RUN_ID> --log-failed

# DO NOT PROCEED - fix issues and re-run
```

### Step 3: Backup Current Database

```bash
# SSH to production server
ssh -p 22422 root@lotor.dc3.crunchtools.com

# Create backup
podman exec rootsofthevalley.org pg_dump -U postgres rotv > /root/backups/rotv_pre_multi_image_$(date +%Y%m%d_%H%M%S).sql

# Verify backup exists
ls -lh /root/backups/rotv_pre_multi_image_*
```

**Expected:** Backup file created (~50-100MB depending on data size)

### Step 4: Apply Database Migration

```bash
# Still on lotor via SSH
# Apply migration 015
podman exec rootsofthevalley.org psql -U postgres -d rotv -f /app/migrations/015_add_poi_media.sql
```

**Expected Output:**
```
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
ALTER TABLE
CREATE OR REPLACE VIEW
```

**Verify Migration:**
```bash
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "\d poi_media"
```

**Expected:** Table schema showing all columns (id, poi_id, media_type, image_server_asset_id, youtube_url, role, sort_order, likes_count, caption, moderation_status, confidence_score, ai_reasoning, submitted_by, moderated_by, moderated_at, created_at)

### Step 5: Migrate Primary Images

```bash
# Run primary image migration script
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js
```

**Expected Output:**
```
Starting primary image migration...
Found X POIs with has_primary_image=true
Processing POI 1...
Processing POI 2...
...
Migration complete: Y images migrated
```

**Verify Migration:**
```bash
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "SELECT COUNT(*) FROM poi_media WHERE role='primary';"
```

**Expected:** Count should match number of POIs with primary images

### Step 6: Apply Data Integrity Migration

```bash
# Apply migration 016 (data integrity fixes from Gemini review)
podman exec rootsofthevalley.org psql -U postgres -d rotv -f /app/migrations/016_fix_poi_media_constraints.sql
```

**Expected Output:**
```
ALTER TABLE
ALTER TABLE
ALTER TABLE
ALTER TABLE
ALTER TABLE
CREATE INDEX
```

**Verify Constraints:**
```bash
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'poi_media'::regclass
ORDER BY conname;
"
```

**Expected:** Should show constraints including:
- `poi_media_caption_length_check`
- `poi_media_moderation_check`
- `poi_media_moderated_by_fkey` (with ON DELETE SET NULL)
- `poi_media_submitted_by_fkey` (with ON DELETE SET NULL)

### Step 7: Pull New Container Image

```bash
# Pull latest image
podman pull quay.io/crunchtools/rotv:latest

# Verify image pulled
podman images quay.io/crunchtools/rotv
```

**Expected:** New image with recent timestamp

### Step 8: Restart Service

```bash
# Restart the service
systemctl restart rootsofthevalley.org

# Wait 10 seconds for startup
sleep 10

# Check service status
systemctl status rootsofthevalley.org --no-pager -l
```

**Expected Output:**
```
● rootsofthevalley.org.service - Roots of The Valley Web Application
   Loaded: loaded
   Active: active (running) since ...
```

**If Service Failed:**
```bash
# View journal logs
journalctl -u rootsofthevalley.org --no-pager -n 50

# Common issues:
# - Database migration not applied
# - Container failed to start
# - Port conflict
```

### Step 9: Verify Deployment

```bash
# Test health endpoint
curl -s https://rootsofthevalley.org/api/health | jq

# Test media endpoint (POI #1)
curl -s https://rootsofthevalley.org/api/pois/1/media | jq '.total_count'

# Check logs for errors
journalctl -u rootsofthevalley.org --since "5 minutes ago" --no-pager | grep -i error
```

**Expected:**
- Health endpoint returns OK
- Media endpoint returns JSON with count
- No critical errors in logs

### Step 10: Sync Secondary Checkout

```bash
# Exit SSH, return to local machine
exit

# Sync main checkout
cd /var/home/fatherlinux/Documents/Professional/Projects/crunchtools/rotv
git checkout master
git pull

# Sync secondary checkout (if exists)
cd /home/fatherlinux/Projects/rotv 2>/dev/null && git checkout master && git pull || echo "Secondary checkout not found"
```

### Step 11: Cleanup Worktree

```bash
# Return to main checkout
cd /var/home/fatherlinux/Documents/Professional/Projects/crunchtools/rotv

# Remove feature worktree
git worktree remove ../rotv-feature-181-multi-image-poi --force

# Clean up local branch (already deleted remotely)
git branch -d feature/181-multi-image-poi
```

---

## Post-Deployment Verification

### Functional Tests

```bash
# Test public media endpoint
curl -s https://rootsofthevalley.org/api/pois/1/media | jq

# Test asset proxy
curl -I https://rootsofthevalley.org/api/assets/test-asset-id/thumbnail
# Expected: 400 Bad Request (invalid asset ID - validates our SSRF protection)

# Test legacy thumbnail endpoint
curl -I https://rootsofthevalley.org/api/pois/1/thumbnail
# Expected: 200 OK or 404 (depending on whether POI 1 has primary image)
```

### Manual UI Tests

1. Navigate to https://rootsofthevalley.org
2. Click any POI with images
3. Verify mosaic displays (Facebook-style layout)
4. Click mosaic → lightbox should open
5. Test keyboard navigation (arrows, ESC)
6. Log in as admin
7. Click "Add Photo/Video" button
8. Upload test image
9. Verify appears in moderation queue
10. Approve → verify appears in mosaic

### Database Health Check

```bash
ssh -p 22422 root@lotor.dc3.crunchtools.com

# Check poi_media table
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT
  media_type,
  moderation_status,
  COUNT(*)
FROM poi_media
GROUP BY media_type, moderation_status;
"

# Check moderation queue view
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT COUNT(*)
FROM moderation_queue
WHERE content_type = 'photo';
"
```

---

## Rollback Procedure

**If deployment fails or critical issues found:**

### Quick Rollback (Revert to Previous Container)

```bash
ssh -p 22422 root@lotor.dc3.crunchtools.com

# Find previous image
podman images quay.io/crunchtools/rotv

# Tag previous image as latest
podman tag quay.io/crunchtools/rotv:<PREVIOUS_SHA> quay.io/crunchtools/rotv:latest

# Restart service
systemctl restart rootsofthevalley.org
```

### Full Rollback (Restore Database)

```bash
# Restore pre-migration backup
podman exec -i rootsofthevalley.org psql -U postgres rotv < /root/backups/rotv_pre_multi_image_<TIMESTAMP>.sql

# Restart service
systemctl restart rootsofthevalley.org
```

---

## Known Issues / Monitoring

### Post-Deployment Monitoring

**Watch for:**
1. Increased error rates in `/api/pois/:id/media` endpoint
2. Failed uploads (check moderation queue)
3. Image server connectivity issues
4. Slow mosaic loading (>1s)

**Monitoring Commands:**
```bash
# Watch error logs
journalctl -u rootsofthevalley.org -f | grep -i error

# Monitor API response times
journalctl -u rootsofthevalley.org --since "1 hour ago" | grep "GET /api/pois/.*/media"
```

### Expected Changes

**Database:**
- New table: `poi_media` with migrated data
- Updated view: `moderation_queue` includes photo submissions

**API:**
- 4 new public endpoints
- 6 new admin endpoints
- Updated `/api/pois/:id/thumbnail` logic

**Frontend:**
- New components: Mosaic, Lightbox, MediaUploadModal
- Updated: Sidebar.jsx with media integration

---

## Success Criteria

- [ ] Service running without errors
- [ ] Media endpoint returns data for POIs with images
- [ ] Mosaic displays correctly in UI
- [ ] Lightbox opens and navigates properly
- [ ] Upload flow works (authenticated users)
- [ ] Admin moderation queue shows pending media
- [ ] No increase in error rates
- [ ] Legacy endpoints still functional
- [ ] Database migration applied successfully
- [ ] Primary images migrated to poi_media table

---

## Contact Information

**Deployment Lead:** Scott McCarty (@fatherlinux)
**Implementation:** Claude Sonnet 4.5
**Server:** lotor.dc3.crunchtools.com (port 22422)
**Service:** rootsofthevalley.org
**Image:** quay.io/crunchtools/rotv:latest

**Support:**
- GitHub Issues: https://github.com/crunchtools/rotv/issues
- PR: https://github.com/crunchtools/rotv/pull/182

---

**Deployment Timestamp:** _________________
**Deployed By:** _________________
**Rollback Required:** ☐ Yes ☐ No
**Notes:** _________________
