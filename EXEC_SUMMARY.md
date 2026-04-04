# Executive Summary: Production Image Loading Issue (PR #182)

**Date:** 2026-04-04
**Status:** 🔴 BROKEN - Images not loading in production
**Impact:** All POI images failing to load with "Failed to load image" error
**Time to Fix:** ~5 minutes
**Difficulty:** Low (single script execution)

---

## Problem

PR #182 (Multi-Image POI Support) changed how images are served from direct image server queries to database-backed queries using a new `poi_media` table. The database migration created the table structure, but **the script to populate the table with existing images was not run during deployment**.

### User Impact
- ❌ All POI images show "Failed to load image" error
- ❌ Image thumbnails return 404
- ❌ Mosaic display shows nothing
- ✅ Map and text content work fine
- ✅ No data loss (images exist on image server)

---

## Root Cause

```
New Code Path:
  /api/pois/:id/thumbnail
    → SELECT FROM poi_media WHERE role='primary'  ← Empty table!
    → Returns 404 "Image not found"

Missing Step:
  migrate-primary-images.js script not run
    → Table structure exists (migration 015 ✅)
    → Table has ZERO records ❌
    → Expected: ~75 records
```

---

## The Fix (Copy-Paste Solution)

### Option 1: Automated Fix Script (Recommended)

```bash
# SSH to production
ssh -p 22422 root@lotor.dc3.crunchtools.com

# Run fix script (interactive, creates backup, safe)
cd /path/to/rotv  # wherever repo is checked out
bash scripts/fix-production.sh
```

**Duration:** 2-3 minutes (includes backup, migration, restart, verification)

### Option 2: Manual Fix (If Automated Script Unavailable)

```bash
# SSH to production
ssh -p 22422 root@lotor.dc3.crunchtools.com

# 1. Backup (30 seconds)
mkdir -p /root/backups
podman exec rootsofthevalley.org pg_dump -U postgres rotv > /root/backups/rotv_backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Run migration script (1-2 minutes)
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js

# 3. Apply data integrity migration (10 seconds)
podman exec rootsofthevalley.org psql -U postgres -d rotv -f /app/migrations/016_fix_poi_media_constraints.sql

# 4. Restart service (30 seconds)
systemctl restart rootsofthevalley.org
sleep 10

# 5. Verify (10 seconds)
curl -s https://rootsofthevalley.org/api/pois/1/media | jq '.total_count'
# Should return a number > 0
```

**Duration:** 3-4 minutes total

---

## Verification

### Quick Check (30 seconds)
```bash
ssh -p 22422 root@lotor.dc3.crunchtools.com \
  "podman exec rootsofthevalley.org psql -U postgres -d rotv -tAc 'SELECT COUNT(*) FROM poi_media WHERE role='\''primary'\'';'"

# Current (broken): 0
# After fix: 75 (or similar number)
```

### Full Verification (2 minutes)
1. Open https://rootsofthevalley.org
2. Click any POI marker
3. Images should display in sidebar
4. No errors in browser console

---

## What Happened

### Deployment Checklist
- ✅ PR #182 merged
- ✅ Container built and published
- ✅ Database backed up
- ✅ Migration 015 applied (creates `poi_media` table)
- ❌ **migrate-primary-images.js script NOT run** ← ROOT CAUSE
- ❌ Migration 016 may not have been applied
- ✅ New container deployed
- ✅ Service restarted
- ❌ Verification not performed (would have caught this)

### Why It Was Missed
- Deployment runbook steps 5-6 were skipped
- No automated post-deployment verification
- Dev/CI environments work (ephemeral databases always run full migration)
- Production requires manual data migration step

---

## Risk Assessment

| Aspect | Risk Level | Notes |
|--------|-----------|-------|
| **Data Loss** | 🟢 None | Images exist on image server, just not indexed in database |
| **Service Downtime** | 🟡 Low | Fix requires service restart (~30s downtime) |
| **Rollback Complexity** | 🟢 Simple | Restore database backup if needed |
| **User Data Impact** | 🟢 None | Read-only operation, no user data affected |
| **Fix Complexity** | 🟢 Trivial | Single script execution |

---

## Technical Details

### What the Migration Script Does
1. Queries `pois` table for all records with `has_primary_image = true`
2. For each POI, fetches primary asset from image server
3. Creates `poi_media` record with:
   - `poi_id` (foreign key to pois)
   - `media_type = 'image'`
   - `image_server_asset_id` (from image server)
   - `role = 'primary'`
   - `moderation_status = 'published'`
4. Skips POIs that already have primary entries (idempotent)

### Dependencies
- Image server must be reachable at `http://10.89.1.100:8000`
- `IMAGE_SERVER_URL` environment variable must be set
- Container must have network access to image server

### Database Changes
```sql
-- Before (broken)
SELECT COUNT(*) FROM poi_media WHERE role='primary';
-- Result: 0

-- After (fixed)
SELECT COUNT(*) FROM poi_media WHERE role='primary';
-- Result: 75 (number of POIs with images)
```

---

## Communication

### Status Update Template

**For Stakeholders:**
> Production image loading issue identified in PR #182 deployment. Root cause: database migration script was not executed. Fix is straightforward (5 minute script execution). No data loss, no user data impacted. ETA to resolution: 10 minutes.

**For Users (if needed):**
> We're aware that images are not loading on Roots of The Valley. Our team is working on a fix and expects to have this resolved within 10 minutes. Your data is safe and no information has been lost. Thank you for your patience.

---

## Prevention for Next Time

### Immediate (Next Deployment)
1. Add verification step to deployment runbook
2. Run `scripts/diagnose-production.sh` after every deployment
3. Check key metrics (table counts, API endpoints)

### Short Term (Next Sprint)
1. Add smoke test script to GitHub Actions
2. Create post-deployment checklist
3. Document all manual migration scripts in runbook

### Long Term (Future)
1. Automate database migrations in systemd service
2. Add health check endpoint that verifies table counts
3. Create monitoring alerts for 404 rates on image endpoints

---

## Resources

| Document | Purpose |
|----------|---------|
| `PROD_FIX_QUICKREF.md` | Quick reference commands |
| `PROD_TROUBLESHOOT.md` | Comprehensive troubleshooting guide |
| `PROD_ISSUE_FLOWCHART.md` | Visual diagrams and data flow |
| `scripts/diagnose-production.sh` | Automated diagnostics |
| `scripts/fix-production.sh` | Automated fix with backup |
| `.specify/specs/004-multi-image-poi/DEPLOYMENT_RUNBOOK.md` | Full deployment procedure |

---

## Questions & Answers

**Q: Is data lost?**
A: No. Images exist on the image server. The database just doesn't have references to them yet.

**Q: Will this affect other services?**
A: No. This only affects image loading on rootsofthevalley.org.

**Q: Can we roll back?**
A: Yes. Database backup will be created before fix. Can restore in under 1 minute if needed.

**Q: How long will the fix take?**
A: 3-5 minutes total (backup, migration, restart, verification).

**Q: What if the fix fails?**
A: Rollback procedure is simple: restore database backup and restart service. No lasting impact.

**Q: Why didn't testing catch this?**
A: Dev/CI use ephemeral databases that always run full migrations. Production has existing data requiring manual migration.

**Q: Will this happen again?**
A: Adding verification steps and automated smoke tests to prevent recurrence.

---

## Next Steps

1. **Immediate:** Run fix script (see "The Fix" section above)
2. **Verify:** Confirm images load in browser
3. **Monitor:** Watch logs for 24 hours for any related issues
4. **Document:** Update deployment runbook with verification steps
5. **Prevent:** Add smoke tests to CI/CD pipeline

---

**Contact:** Scott McCarty (@fatherlinux)
**PR #182:** https://github.com/crunchtools/rotv/pull/182
**Server:** lotor.dc3.crunchtools.com:22422
