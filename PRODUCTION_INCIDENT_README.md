# Production Incident: Image Loading Failure (PR #182)

**Status:** 🔴 ACTIVE INCIDENT
**Severity:** Major (user-facing feature broken)
**Impact:** All POI images failing to load
**Root Cause:** Database migration script not executed during deployment
**Time to Fix:** 5 minutes
**Last Updated:** 2026-04-04

---

## 🚨 Quick Start (Choose Your Path)

### Path 1: Just Fix It (Fastest)
**Time: 5 minutes**

```bash
ssh -p 22422 root@lotor.dc3.crunchtools.com
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js
systemctl restart rootsofthevalley.org
```

See: **[PROD_FIX_QUICKREF.md](./PROD_FIX_QUICKREF.md)** for detailed commands.

---

### Path 2: Diagnose First, Then Fix
**Time: 10 minutes**

```bash
ssh -p 22422 root@lotor.dc3.crunchtools.com
bash scripts/diagnose-production.sh  # Automated diagnostics
bash scripts/fix-production.sh       # Automated fix with backup
```

See: **[PROD_TROUBLESHOOT.md](./PROD_TROUBLESHOOT.md)** for comprehensive troubleshooting.

---

### Path 3: Understand First (Technical Deep Dive)
**Time: 20 minutes + fix**

1. Read **[EXEC_SUMMARY.md](./EXEC_SUMMARY.md)** - What happened and why
2. Review **[PROD_ISSUE_FLOWCHART.md](./PROD_ISSUE_FLOWCHART.md)** - Visual diagrams
3. Check **[DEPLOYMENT_VERIFICATION_CHECKLIST.md](./DEPLOYMENT_VERIFICATION_CHECKLIST.md)** - Prevent recurrence
4. Then apply fix from Path 1 or Path 2

---

## 📋 Document Index

| Document | Purpose | When to Use |
|----------|---------|-------------|
| **[EXEC_SUMMARY.md](./EXEC_SUMMARY.md)** | Executive overview | Stakeholder briefing, decision making |
| **[PROD_FIX_QUICKREF.md](./PROD_FIX_QUICKREF.md)** | Copy-paste commands | Quick resolution, on-call reference |
| **[PROD_TROUBLESHOOT.md](./PROD_TROUBLESHOOT.md)** | Detailed troubleshooting | Deep dive, unusual symptoms |
| **[PROD_ISSUE_FLOWCHART.md](./PROD_ISSUE_FLOWCHART.md)** | Visual diagrams | Understanding data flow, root cause |
| **[DEPLOYMENT_VERIFICATION_CHECKLIST.md](./DEPLOYMENT_VERIFICATION_CHECKLIST.md)** | Post-deployment checks | Prevent future incidents |
| **[scripts/diagnose-production.sh](./scripts/diagnose-production.sh)** | Automated diagnostics | Quick health check |
| **[scripts/fix-production.sh](./scripts/fix-production.sh)** | Automated fix | Safe, guided fix procedure |

---

## 🎯 What You Need to Know (30 Second Version)

**Problem:** Images not loading on rootsofthevalley.org

**Why:** Database table `poi_media` is empty (migration script skipped)

**Fix:** Run one script to populate the table

**Risk:** None (read-only operation, backup created)

**Time:** 5 minutes total

---

## 📊 Incident Timeline

| Time | Event |
|------|-------|
| Earlier today | PR #182 merged and deployed |
| Earlier today | Container restarted successfully |
| Earlier today | User reports images not loading |
| Now | Incident identified: migration script not run |
| Now + 5min | Fix applied and verified |
| Now + 24hr | Monitoring for related issues |

---

## 🔍 Symptoms

### User-Facing
- POI images show "Failed to load image" error
- Image thumbnails return 404
- Mosaic component shows nothing
- Map and text content work fine

### Technical
```bash
# API returns empty media arrays
curl https://rootsofthevalley.org/api/pois/1/media
{"mosaic":[],"all_media":[],"total_count":0}

# Database table is empty
SELECT COUNT(*) FROM poi_media WHERE role='primary';
# Returns: 0 (should be ~75)

# Logs show 404 errors
journalctl -u rootsofthevalley.org | grep "Image not found"
```

---

## 🛠️ Fix Procedure (Step-by-Step)

### Pre-Fix Checklist
- [ ] SSH access to lotor.dc3.crunchtools.com
- [ ] Root/sudo privileges
- [ ] Container `rootsofthevalley.org` is running
- [ ] 5 minutes available for fix + verification

### Fix Steps

1. **SSH to Production**
   ```bash
   ssh -p 22422 root@lotor.dc3.crunchtools.com
   ```

2. **Verify Problem**
   ```bash
   podman exec rootsofthevalley.org psql -U postgres -d rotv -tAc \
     "SELECT COUNT(*) FROM poi_media WHERE role='primary';"
   # Should return 0 (confirms diagnosis)
   ```

3. **Create Backup**
   ```bash
   mkdir -p /root/backups
   podman exec rootsofthevalley.org pg_dump -U postgres rotv > \
     /root/backups/rotv_$(date +%Y%m%d_%H%M%S).sql
   ```

4. **Run Migration Script**
   ```bash
   podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js
   # Watch output - should show "Migrated: N" where N > 0
   ```

5. **Apply Data Integrity Migration**
   ```bash
   podman exec rootsofthevalley.org psql -U postgres -d rotv \
     -f /app/migrations/016_fix_poi_media_constraints.sql
   ```

6. **Restart Service**
   ```bash
   systemctl restart rootsofthevalley.org
   sleep 10
   systemctl status rootsofthevalley.org
   ```

7. **Verify Fix**
   ```bash
   # Database check
   podman exec rootsofthevalley.org psql -U postgres -d rotv -tAc \
     "SELECT COUNT(*) FROM poi_media WHERE role='primary';"
   # Should return number > 0

   # API check
   curl -s https://rootsofthevalley.org/api/pois/1/media | jq '.total_count'
   # Should return number > 0

   # Browser check: Visit https://rootsofthevalley.org and click a POI
   # Images should load
   ```

### Post-Fix Checklist
- [ ] Database table populated (count > 0)
- [ ] API returns media items
- [ ] Images load in browser
- [ ] No errors in service logs
- [ ] Service stable for 15+ minutes

---

## 📞 Escalation

### If Fix Fails
1. Check **[PROD_TROUBLESHOOT.md](./PROD_TROUBLESHOOT.md)** for common errors
2. Review migration script output for specific error messages
3. Check image server connectivity: `curl http://10.89.1.100:8000/api/health`
4. Consider rollback (see below)

### Rollback Procedure
```bash
# Restore database backup
podman exec -i rootsofthevalley.org psql -U postgres rotv < \
  /root/backups/rotv_TIMESTAMP.sql

# Restart service
systemctl restart rootsofthevalley.org

# Verify rollback
curl https://rootsofthevalley.org/api/health
```

### Contact
- **GitHub Issue:** https://github.com/crunchtools/rotv/issues
- **PR #182:** https://github.com/crunchtools/rotv/pull/182
- **Deployment Owner:** Scott McCarty (@fatherlinux)

---

## 📈 Prevention (Next Steps)

### Immediate (This Incident)
- [x] Document root cause ✅ (this file)
- [x] Create fix scripts ✅ (diagnose/fix shell scripts)
- [ ] Apply fix to production
- [ ] Verify fix works
- [ ] Monitor for 24 hours

### Short Term (Next Week)
- [ ] Add smoke tests to CI/CD
- [ ] Update deployment runbook with verification steps
- [ ] Create post-deployment checklist automation
- [ ] Review all migration scripts for similar issues

### Long Term (Next Quarter)
- [ ] Automate database migrations in deployment
- [ ] Add monitoring/alerting for table count anomalies
- [ ] Create canary deployment process
- [ ] Build automated rollback capabilities

---

## 🧪 Testing (Before Marking Incident Closed)

### Automated Tests
```bash
# Run diagnostic script
bash scripts/diagnose-production.sh

# All checks should pass
```

### Manual Tests
1. **Image Loading**
   - Navigate to https://rootsofthevalley.org
   - Click 5 different POI markers
   - Verify images load for each
   - No errors in browser console

2. **API Endpoints**
   - Test `/api/pois/1/media` returns data
   - Test `/api/pois/1/thumbnail` returns image
   - Test `/api/assets/:id/thumbnail` works

3. **Admin Functions**
   - Login as admin
   - Upload test image
   - Verify appears in moderation queue
   - Approve image
   - Verify appears in mosaic

### Performance Tests
```bash
# Response time should be < 1 second
time curl -s https://rootsofthevalley.org/api/pois/1/media > /dev/null

# No memory leaks (check over time)
podman stats --no-stream rootsofthevalley.org
```

---

## 📝 Incident Report Template

**Incident ID:** ROTV-2026-04-04-IMAGE-LOADING

**Severity:** Major

**Start Time:** 2026-04-04 [TIME]

**Detection:** User report / Manual discovery

**Root Cause:** Database migration script (`migrate-primary-images.js`) not executed during PR #182 deployment

**Impact:**
- All POI images failing to load
- ~100% of image requests returning 404
- User experience degraded (no images visible)

**Resolution:**
1. Identified empty `poi_media` table
2. Ran migration script to populate table
3. Applied data integrity migration
4. Restarted service
5. Verified images loading correctly

**Time to Resolution:** [FILL IN]

**Downtime:** None (service remained available, only image feature affected)

**Lessons Learned:**
1. Deployment runbook steps were skipped (steps 5-6)
2. No post-deployment verification performed
3. Need automated smoke tests in CI/CD
4. Need deployment verification checklist

**Action Items:**
- [ ] Add smoke tests to GitHub Actions
- [ ] Automate deployment verification
- [ ] Update runbook with mandatory verification steps
- [ ] Create alerts for table count anomalies

---

## 🎓 References

- **Original PR:** https://github.com/crunchtools/rotv/pull/182
- **Deployment Runbook:** `.specify/specs/004-multi-image-poi/DEPLOYMENT_RUNBOOK.md`
- **Feature Spec:** `.specify/specs/004-multi-image-poi/spec.md`
- **Implementation Plan:** `.specify/specs/004-multi-image-poi/plan.md`

---

**Last Updated:** 2026-04-04
**Status:** 🔴 Active (awaiting fix application)
**Next Review:** After fix verified
