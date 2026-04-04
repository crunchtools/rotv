# Production Fix Quick Reference (PR #182)

## TL;DR - The One-Liner Fix

```bash
# SSH to production
ssh -p 22422 root@lotor.dc3.crunchtools.com

# Run the fix script (interactive, creates backup)
bash < <(curl -s https://raw.githubusercontent.com/crunchtools/rotv/master/scripts/fix-production.sh)

# OR manually run migration
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js
```

---

## Copy-Paste Commands (Manual Fix)

### 1. SSH to Production
```bash
ssh -p 22422 root@lotor.dc3.crunchtools.com
```

### 2. Run Diagnostics
```bash
# Check current state
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "SELECT COUNT(*) FROM poi_media WHERE role='primary';"

# Expected: 0 (problem) → Need to run migration
# Expected: 50+ (good) → Migration already done
```

### 3. Backup Database
```bash
mkdir -p /root/backups
podman exec rootsofthevalley.org pg_dump -U postgres rotv > /root/backups/rotv_$(date +%Y%m%d_%H%M%S).sql
```

### 4. Apply Migrations
```bash
# Migration 016 (constraints)
podman exec rootsofthevalley.org psql -U postgres -d rotv -f /app/migrations/016_fix_poi_media_constraints.sql

# Migration script (primary images) - DRY RUN FIRST
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js --dry-run

# If dry run looks good, run for real
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js
```

### 5. Restart Service
```bash
systemctl restart rootsofthevalley.org
sleep 10
systemctl status rootsofthevalley.org
```

### 6. Verify Fix
```bash
# Check database
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "SELECT COUNT(*) FROM poi_media WHERE role='primary';"

# Test API
curl -s https://rootsofthevalley.org/api/pois/1/media | jq '.total_count'

# Should return a number > 0
```

---

## Diagnosis in 30 Seconds

```bash
# One command to check everything
ssh -p 22422 root@lotor.dc3.crunchtools.com "podman exec rootsofthevalley.org psql -U postgres -d rotv -c \"SELECT 'Total media:' as check, COUNT(*)::text as count FROM poi_media UNION ALL SELECT 'Primary images:', COUNT(*)::text FROM poi_media WHERE role='primary' UNION ALL SELECT 'Expected primary:', COUNT(*)::text FROM pois WHERE has_primary_image = true;\""
```

**Expected output if migration needed:**
```
    check        | count
-----------------+-------
 Total media:    | 0
 Primary images: | 0
 Expected primary: | 75
```

**Expected output if already fixed:**
```
    check        | count
-----------------+-------
 Total media:    | 75
 Primary images: | 75
 Expected primary: | 75
```

---

## Troubleshooting Common Errors

### Error: "ECONNREFUSED" during migration
**Problem:** Image server is unreachable

**Fix:**
```bash
# Test connectivity
podman exec rootsofthevalley.org curl -s http://10.89.1.100:8000/api/health

# Check environment variable
podman exec rootsofthevalley.org printenv IMAGE_SERVER_URL

# Should show: http://10.89.1.100:8000
```

### Error: "relation poi_media does not exist"
**Problem:** Migration 015 not applied

**Fix:**
```bash
podman exec rootsofthevalley.org psql -U postgres -d rotv -f /app/migrations/015_add_poi_media.sql
```

### Error: Unique constraint violation
**Problem:** Trying to create duplicate primary images

**Fix:**
```bash
# Check for duplicates
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT poi_id, COUNT(*)
FROM poi_media
WHERE role = 'primary' AND moderation_status IN ('published', 'auto_approved')
GROUP BY poi_id
HAVING COUNT(*) > 1;"

# Script should skip existing entries, but if not:
# Re-run with --dry-run to see what it will do
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js --dry-run
```

---

## Monitoring After Fix

### Watch logs in real-time
```bash
journalctl -u rootsofthevalley.org -f
```

### Check for errors in last hour
```bash
journalctl -u rootsofthevalley.org --since "1 hour ago" | grep -i error | tail -20
```

### Test specific POI
```bash
# Replace 42 with actual POI ID
curl -s https://rootsofthevalley.org/api/pois/42/media | jq
```

### Check database stats
```bash
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT
  media_type,
  role,
  moderation_status,
  COUNT(*)
FROM poi_media
GROUP BY media_type, role, moderation_status
ORDER BY media_type, role, moderation_status;
"
```

---

## Rollback (If Needed)

```bash
# Find backup
ls -lht /root/backups/rotv_* | head -5

# Restore
podman exec -i rootsofthevalley.org psql -U postgres rotv < /root/backups/rotv_TIMESTAMP.sql

# Restart
systemctl restart rootsofthevalley.org
```

---

## Expected Results After Fix

### Database
- `poi_media` table has ~75 records (or however many POIs have images)
- All primary images have `role='primary'` and `moderation_status='published'`
- Migration 016 constraints are in place

### API
```bash
curl https://rootsofthevalley.org/api/pois/1/media
```
Returns:
```json
{
  "mosaic": [...],
  "all_media": [...],
  "total_count": 1
}
```

### Frontend
- Click any POI → images display correctly
- No "Failed to load image" errors in browser console
- Mosaic displays for POIs with multiple images
- Single image displays for POIs with one image
- Default thumbnail for POIs with no images

---

## File Locations

| File | Location |
|------|----------|
| Diagnostic script | `scripts/diagnose-production.sh` |
| Fix script | `scripts/fix-production.sh` |
| Migration 015 | `backend/migrations/015_add_poi_media.sql` |
| Migration 016 | `backend/migrations/016_fix_poi_media_constraints.sql` |
| Migration script | `backend/scripts/migrate-primary-images.js` |
| Full troubleshooting | `PROD_TROUBLESHOOT.md` |
| Deployment runbook | `.specify/specs/004-multi-image-poi/DEPLOYMENT_RUNBOOK.md` |

---

## Quick Tests (Frontend)

1. Open https://rootsofthevalley.org
2. Open browser DevTools (F12) → Console tab
3. Click any POI marker
4. Check for errors in console
5. Verify images display in sidebar

**Common console errors:**
- `Failed to load media:` → API endpoint issue
- `Image not found` → Thumbnail endpoint issue
- `net::ERR_FAILED` → Asset proxy issue

---

## Support

**GitHub Issue:** https://github.com/crunchtools/rotv/issues
**PR #182:** https://github.com/crunchtools/rotv/pull/182
**Server:** lotor.dc3.crunchtools.com:22422
**Service:** rootsofthevalley.org
