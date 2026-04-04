# Deployment Verification Checklist

**Purpose:** Run this checklist after EVERY production deployment to catch issues before they impact users.

**Time Required:** 3-5 minutes

**When to Run:** Immediately after `systemctl restart rootsofthevalley.org`

---

## Pre-Deployment Checklist

- [ ] PR merged to master
- [ ] GitHub Actions build completed successfully
- [ ] All tests passing (including integration tests)
- [ ] No security scan failures
- [ ] Database backup created
- [ ] All required migrations identified and ready
- [ ] Deployment runbook reviewed

---

## Deployment Steps

### 1. Database Migrations ✅

- [ ] All SQL migrations applied (check `backend/migrations/` directory)
- [ ] All Node.js migration scripts run (check `backend/scripts/` directory)
- [ ] Migration logs reviewed for errors
- [ ] Table counts verified (if applicable)

**Commands:**
```bash
# Check which migrations exist
ls -1 backend/migrations/*.sql | tail -5

# Verify each migration was applied
# (Check timestamps, no errors in output)

# For PR #182 specifically:
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "\d poi_media"
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "SELECT COUNT(*) FROM poi_media;"
```

### 2. Container Deployment ✅

- [ ] Latest image pulled from registry
- [ ] Image tag/SHA matches expected version
- [ ] Service restarted successfully
- [ ] Container running without immediate crashes

**Commands:**
```bash
# Pull latest
podman pull quay.io/crunchtools/rotv:latest

# Check image timestamp
podman images quay.io/crunchtools/rotv --format "{{.CreatedAt}}"

# Restart service
systemctl restart rootsofthevalley.org
sleep 10

# Verify running
systemctl status rootsofthevalley.org --no-pager
```

### 3. Service Health ✅

- [ ] Service is active and running
- [ ] No errors in startup logs
- [ ] Process listening on expected port
- [ ] Container has been up for at least 30 seconds

**Commands:**
```bash
# Check service status
systemctl is-active rootsofthevalley.org

# Check recent logs
journalctl -u rootsofthevalley.org --since "1 minute ago" --no-pager | tail -30

# Check for errors
journalctl -u rootsofthevalley.org --since "1 minute ago" --no-pager | grep -i error

# Verify port
ss -tlnp | grep :3000
```

---

## Post-Deployment Verification

### 4. Database Health ✅

- [ ] Database connection established
- [ ] All tables exist
- [ ] Expected record counts correct
- [ ] Recent migrations reflected in schema

**Commands:**
```bash
# Test database connection
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "SELECT version();"

# Check table count
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';"

# Check specific critical tables (adjust for your deployment)
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT
  'pois' as table_name, COUNT(*)::text as count FROM pois UNION ALL
  SELECT 'poi_media', COUNT(*)::text FROM poi_media UNION ALL
  SELECT 'poi_news', COUNT(*)::text FROM poi_news UNION ALL
  SELECT 'users', COUNT(*)::text FROM users;
"
```

### 5. API Endpoints ✅

- [ ] Health endpoint responding
- [ ] Public API endpoints working
- [ ] Authentication endpoints working
- [ ] Admin API endpoints working (if applicable)

**Commands:**
```bash
# Health check
curl -sf https://rootsofthevalley.org/api/health || echo "FAILED"

# Test public API
curl -sf https://rootsofthevalley.org/api/pois?limit=1 | jq '.[0].id' || echo "FAILED"

# Test media endpoint (PR #182 specific)
curl -sf https://rootsofthevalley.org/api/pois/1/media | jq '.total_count' || echo "FAILED"

# Test thumbnail endpoint
curl -I https://rootsofthevalley.org/api/pois/1/thumbnail 2>&1 | grep "HTTP" || echo "FAILED"

# Test auth status
curl -sf https://rootsofthevalley.org/api/auth/status | jq '.authenticated' || echo "FAILED"
```

### 6. Frontend Functionality ✅

- [ ] Website loads without errors
- [ ] Map displays correctly
- [ ] POI markers visible
- [ ] Sidebar opens when clicking markers
- [ ] Images load correctly
- [ ] No console errors in browser DevTools

**Manual Steps:**
1. Open https://rootsofthevalley.org in browser
2. Open DevTools (F12) → Console tab
3. Verify map loads and displays POIs
4. Click a POI marker
5. Verify sidebar opens with POI details
6. Verify images display (no "Failed to load image" errors)
7. Check console for JavaScript errors
8. Check Network tab for failed requests (red lines)

### 7. Feature-Specific Tests ✅

**For PR #182 (Multi-Image POI):**

- [ ] Mosaic displays for POIs with multiple images
- [ ] Single image displays for POIs with one image
- [ ] Default thumbnail for POIs with no images
- [ ] Lightbox opens when clicking mosaic
- [ ] Keyboard navigation works in lightbox (arrows, ESC)
- [ ] Upload modal opens for authenticated users
- [ ] Admin can see moderation queue

**Commands:**
```bash
# Check media counts
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT
  media_type,
  role,
  COUNT(*)
FROM poi_media
GROUP BY media_type, role;
"

# Check for any pending moderation items
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT COUNT(*) FROM moderation_queue WHERE content_type = 'photo';
"
```

### 8. Performance & Resources ✅

- [ ] Response times acceptable (<1s for most endpoints)
- [ ] Memory usage normal
- [ ] CPU usage normal
- [ ] No resource exhaustion warnings

**Commands:**
```bash
# Check response time
time curl -s https://rootsofthevalley.org/api/pois/1/media > /dev/null

# Check container resource usage
podman stats --no-stream rootsofthevalley.org

# Check system resources
free -h
df -h
```

### 9. Error Rates ✅

- [ ] No spike in 500 errors
- [ ] No spike in 404 errors
- [ ] No database connection errors
- [ ] No authentication failures

**Commands:**
```bash
# Check for errors in last 5 minutes
journalctl -u rootsofthevalley.org --since "5 minutes ago" --no-pager | grep -c "error"

# Check for specific error types
journalctl -u rootsofthevalley.org --since "5 minutes ago" --no-pager | grep -E "500|404|ECONNREFUSED|ETIMEDOUT" | wc -l

# Sample recent logs
journalctl -u rootsofthevalley.org --since "5 minutes ago" --no-pager | tail -50
```

### 10. External Dependencies ✅

- [ ] Image server connectivity verified
- [ ] Database server connectivity verified
- [ ] Any third-party APIs responding
- [ ] OAuth providers working (if applicable)

**Commands:**
```bash
# Check image server
podman exec rootsofthevalley.org curl -sf http://10.89.1.100:8000/api/health || echo "FAILED"

# Check IMAGE_SERVER_URL env var
podman exec rootsofthevalley.org printenv IMAGE_SERVER_URL

# Test asset fetch
curl -I https://rootsofthevalley.org/api/assets/test-id/thumbnail 2>&1 | grep "HTTP"
# Should return 400 (bad request) which proves validation is working
```

---

## Rollback Decision Matrix

| Symptom | Severity | Rollback? |
|---------|----------|-----------|
| Service won't start | 🔴 Critical | **YES** - Immediate rollback |
| Database migration failed | 🔴 Critical | **YES** - Restore backup |
| 500 errors on all endpoints | 🔴 Critical | **YES** - Immediate rollback |
| Images not loading | 🟡 Major | **NO** - Fix forward (run migration script) |
| Single feature broken | 🟡 Major | **MAYBE** - Evaluate impact |
| Minor UI glitch | 🟢 Minor | **NO** - Fix forward |
| Performance degradation | 🟡 Major | **MAYBE** - Monitor and decide |

---

## Rollback Procedure (If Needed)

### Quick Rollback (Container Only)
```bash
# Find previous working image
podman images quay.io/crunchtools/rotv

# Tag previous image as latest
podman tag quay.io/crunchtools/rotv:<PREVIOUS_SHA> quay.io/crunchtools/rotv:latest

# Restart
systemctl restart rootsofthevalley.org
```

### Full Rollback (Container + Database)
```bash
# Find backup
ls -lht /root/backups/rotv_* | head -5

# Restore database
podman exec -i rootsofthevalley.org psql -U postgres rotv < /root/backups/rotv_TIMESTAMP.sql

# Revert container (same as above)
podman tag quay.io/crunchtools/rotv:<PREVIOUS_SHA> quay.io/crunchtools/rotv:latest
systemctl restart rootsofthevalley.org

# Verify rollback worked
curl -sf https://rootsofthevalley.org/api/health
```

---

## Monitoring (First 24 Hours)

### Hour 1 (Critical)
- [ ] Check logs every 10 minutes
- [ ] Monitor error rates
- [ ] Watch for user reports

### Hours 2-6 (Important)
- [ ] Check logs every hour
- [ ] Review error patterns
- [ ] Test key workflows manually

### Hours 7-24 (Normal)
- [ ] Check logs every 4 hours
- [ ] Review metrics/stats
- [ ] Note any anomalies

**Commands:**
```bash
# Watch logs live
journalctl -u rootsofthevalley.org -f

# Check error rate (run periodically)
journalctl -u rootsofthevalley.org --since "1 hour ago" --no-pager | grep -i error | wc -l

# Check for specific issues
journalctl -u rootsofthevalley.org --since "1 hour ago" --no-pager | grep -i "failed to\|error\|exception"
```

---

## Sign-Off

**Deployment Date:** ________________
**Deployed By:** ________________
**PR/Version:** ________________

**All checks passed:** ☐ YES ☐ NO
**Issues found:** ________________
**Issues resolved:** ☐ YES ☐ NO ☐ N/A
**Rollback performed:** ☐ YES ☐ NO

**Notes:**
```
_________________________________________________________________________
_________________________________________________________________________
_________________________________________________________________________
```

---

## Automation Ideas (Future)

1. **Smoke Test Script**
   - Runs all verification commands automatically
   - Exits with error code if any check fails
   - Can be triggered by CI/CD or manually

2. **Health Dashboard**
   - Real-time status of all checks
   - Historical metrics
   - Alert on anomalies

3. **Automated Rollback**
   - Detect critical failures automatically
   - Trigger rollback without human intervention
   - Send alerts to ops team

4. **Canary Deployments**
   - Deploy to subset of users first
   - Monitor metrics before full rollout
   - Auto-rollback if issues detected

---

## Resources

- **Deployment Runbook:** `.specify/specs/004-multi-image-poi/DEPLOYMENT_RUNBOOK.md`
- **Troubleshooting Guide:** `PROD_TROUBLESHOOT.md`
- **Fix Quick Reference:** `PROD_FIX_QUICKREF.md`
- **Diagnostic Script:** `scripts/diagnose-production.sh`
- **Fix Script:** `scripts/fix-production.sh`
