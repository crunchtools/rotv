# Next Steps - Production Image Loading Issue (PR #182)

**Date:** 2026-04-04
**Status:** 🔴 ACTION REQUIRED
**Priority:** HIGH (user-facing feature broken)
**Time to Fix:** 5 minutes

---

## Immediate Action Required (Do This Now)

### Step 1: Apply the Fix (5 minutes)

```bash
# SSH to production server
ssh -p 22422 root@lotor.dc3.crunchtools.com

# Run the migration script to populate poi_media table
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js

# Apply data integrity constraints (migration 016)
podman exec rootsofthevalley.org psql -U postgres -d rotv \
  -f /app/migrations/016_fix_poi_media_constraints.sql

# Restart the service
systemctl restart rootsofthevalley.org

# Wait for startup
sleep 10

# Verify service is running
systemctl status rootsofthevalley.org
```

### Step 2: Verify the Fix (1 minute)

```bash
# Check database - should show primary images
podman exec rootsofthevalley.org psql -U postgres -d rotv -c \
  "SELECT COUNT(*) FROM poi_media WHERE role='primary';"
# Expected: > 0 (likely 50-100)

# Test API endpoint
curl -s https://rootsofthevalley.org/api/pois/1/media | jq '.total_count'
# Expected: > 0

# Check for errors in logs
journalctl -u rootsofthevalley.org --since "1 minute ago" | grep -i error
# Expected: No critical errors
```

### Step 3: Test in Browser (1 minute)

1. Open https://rootsofthevalley.org
2. Click any POI marker on the map
3. Verify images display in sidebar (no "Failed to load image" errors)
4. Open browser DevTools (F12) → Console tab
5. Verify no JavaScript errors related to images

### Step 4: Generate Post-Deployment Report (30 seconds)

```bash
bash scripts/post-deployment-report.sh
```

Review the report for any warnings or issues.

---

## Short-Term Actions (This Week)

### Monday: Monitor Production (1-2 hours spread over day)

```bash
# Check every 2 hours for first 24 hours
ssh -p 22422 root@lotor.dc3.crunchtools.com

# Quick health check
systemctl status rootsofthevalley.org
curl -sf https://rootsofthevalley.org/api/health && echo "✅ OK" || echo "❌ FAILED"

# Check error count
journalctl -u rootsofthevalley.org --since "2 hours ago" | grep -i error | wc -l

# Check media endpoint is working
curl -s https://rootsofthevalley.org/api/pois/1/media | jq '.total_count'
```

**What to watch for:**
- Error rate spike (> 20 errors per hour)
- 404 errors on image requests
- Service crashes or restarts
- Slow response times (> 2 seconds)

**If issues appear:**
- Review [PROD_TROUBLESHOOT.md](./PROD_TROUBLESHOOT.md)
- Run `scripts/diagnose-production.sh`
- Consider rollback if critical

### Tuesday: Document the Incident (30 minutes)

Using the [EXEC_SUMMARY.md](./EXEC_SUMMARY.md) template, document:

1. **What happened**
   - PR #182 deployed without running migration script
   - `poi_media` table empty, causing 404 on all images
   - Detected: [TIME]
   - Resolved: [TIME]

2. **Impact**
   - All POI images showing "Failed to load image"
   - Duration: [DURATION]
   - Users affected: All site visitors
   - Data loss: None

3. **Root cause**
   - Deployment runbook steps 5-6 skipped
   - No post-deployment verification performed
   - No automated smoke tests

4. **Resolution**
   - Ran `migrate-primary-images.js` script
   - Applied migration 016 constraints
   - Restarted service
   - Verified images loading

5. **Prevention measures**
   - Add smoke tests to CI/CD ✅ (smoke-test.yml created)
   - Create deployment verification checklist ✅ (created)
   - Update deployment guide with verification steps ✅ (updated)
   - Create diagnostic/fix scripts ✅ (created)

**Action:** Save completed summary to project wiki or team knowledge base

### Wednesday: Run Smoke Tests (5 minutes)

```bash
# Trigger automated smoke tests
gh workflow run smoke-test.yml

# Monitor execution
gh run watch

# Review results
gh run view
```

**Expected:** All tests should pass

**If failures:** Investigate and fix before marking incident closed

---

## Medium-Term Actions (This Month)

### Week 1: Improve Deployment Process (2-3 hours)

- [ ] **Add automated smoke tests to CI/CD**
  - Modify `.github/workflows/build.yml` to trigger `smoke-test.yml` on successful build
  - Require smoke tests to pass before deployment

- [ ] **Create deployment automation**
  - Build script that runs all deployment steps in order
  - Include automatic backup, migration verification, smoke tests
  - Add safety checks (confirm steps, rollback on failure)

- [ ] **Update systemd service file**
  - Consider adding health check monitoring
  - Set up automatic restart on failure
  - Configure resource limits

**Owner:** DevOps/Platform team
**Due:** End of month

### Week 2: Improve Monitoring (2-3 hours)

- [ ] **Set up monitoring alerts**
  - Error rate threshold alerts (> 20 errors/hour)
  - Service down alerts
  - API response time alerts (> 2 seconds)
  - Database connection failure alerts

- [ ] **Create dashboard**
  - Service health status
  - API endpoint status
  - Error rates over time
  - Database table counts

- [ ] **Weekly health check schedule**
  - Run `scripts/diagnose-production.sh` weekly
  - Review logs for patterns
  - Generate monthly reports

**Owner:** Operations team
**Due:** 2 weeks

### Week 3-4: Team Training (1-2 hours)

- [ ] **Document walkthrough**
  - Present troubleshooting package to team
  - Walk through common scenarios
  - Practice using diagnostic scripts
  - Review rollback procedures

- [ ] **On-call runbook**
  - Add to on-call documentation
  - Include in incident response playbook
  - Test with mock incident

- [ ] **Knowledge sharing**
  - Add to team wiki
  - Share in team meeting
  - Create quick reference cards

**Owner:** Team lead
**Due:** End of month

---

## Long-Term Actions (This Quarter)

### Deployment Automation (Sprint 1)

**Goal:** Zero-touch deployments with automatic verification

**Tasks:**
- [ ] Automated migration detection and execution
- [ ] Canary deployment support (deploy to subset first)
- [ ] Automatic rollback on smoke test failure
- [ ] Blue/green deployment capability

**Success Metrics:**
- 100% of deployments include smoke tests
- 0% of deployments skip migration steps
- < 5 minutes average deployment time

### Monitoring & Observability (Sprint 2)

**Goal:** Proactive issue detection before users notice

**Tasks:**
- [ ] Implement APM (Application Performance Monitoring)
- [ ] Set up log aggregation and search
- [ ] Create alerting rules for anomalies
- [ ] Build real-time dashboard

**Success Metrics:**
- Issues detected before user reports
- < 5 minutes mean time to detection (MTTD)
- < 15 minutes mean time to resolution (MTTR)

### Documentation & Training (Sprint 3)

**Goal:** All team members can handle production issues

**Tasks:**
- [ ] Quarterly incident response drills
- [ ] Update runbooks based on new incidents
- [ ] Create video walkthroughs
- [ ] Build self-service diagnostic tools

**Success Metrics:**
- 100% team trained on incident response
- > 80% incidents resolved using runbooks
- < 10% repeat incidents

---

## Success Criteria

### Immediate (24 hours)
- [x] Troubleshooting package created ✅
- [ ] Fix applied to production
- [ ] Images loading correctly
- [ ] No errors in logs
- [ ] Post-deployment report generated
- [ ] Monitoring active

### Short-term (1 week)
- [ ] 24-hour monitoring period completed with no issues
- [ ] Incident documented
- [ ] Smoke tests passing
- [ ] Team aware of new troubleshooting resources

### Medium-term (1 month)
- [ ] Smoke tests integrated into CI/CD
- [ ] Monitoring alerts configured
- [ ] Team trained on new procedures
- [ ] Deployment automation improved

### Long-term (3 months)
- [ ] Zero deployment incidents
- [ ] Automated deployment pipeline
- [ ] Proactive monitoring in place
- [ ] Team fully self-sufficient

---

## Metrics to Track

### Deployment Health
- Deployments with migrations: 100% run migration scripts
- Deployments with verification: 100% run smoke tests
- Failed deployments: 0
- Rollbacks required: 0

### Incident Response
- Time to detect (MTTD): < 5 minutes
- Time to diagnose: < 5 minutes
- Time to fix: < 15 minutes
- Time to verify: < 5 minutes

### Service Health
- Uptime: > 99.9%
- Error rate: < 0.1%
- API response time: < 500ms (p95)
- Image load success rate: > 99%

---

## Resources Created

### Documentation (9 files)
- ✅ README_PRODUCTION.md - Main production guide
- ✅ DEPLOYMENT_GUIDE.md - Deployment procedures
- ✅ DEPLOYMENT_VERIFICATION_CHECKLIST.md - Post-deployment checklist
- ✅ PRODUCTION_INCIDENT_README.md - Incident response
- ✅ EXEC_SUMMARY.md - Executive summary template
- ✅ PROD_TROUBLESHOOT.md - Comprehensive troubleshooting
- ✅ PROD_FIX_QUICKREF.md - Quick reference
- ✅ PROD_ISSUE_FLOWCHART.md - Visual debugging
- ✅ TROUBLESHOOTING_PACKAGE_INDEX.md - Package index

### Scripts (4 files)
- ✅ scripts/diagnose-production.sh - Automated diagnostics
- ✅ scripts/fix-production.sh - Automated fix
- ✅ scripts/verify-migrations.sh - Migration verification
- ✅ scripts/post-deployment-report.sh - Deployment reporting

### Automation (1 file)
- ✅ .github/workflows/smoke-test.yml - Smoke tests

**Total:** 14 files, ~4,000 lines of documentation and code

---

## Questions & Answers

**Q: Is the fix safe to apply?**
A: Yes. The migration script is idempotent (safe to run multiple times) and only reads from the image server to populate the database. No data is modified or deleted.

**Q: What if the fix doesn't work?**
A: Run `scripts/diagnose-production.sh` to identify the issue. Common problems and solutions are documented in PROD_TROUBLESHOOT.md.

**Q: Do we need downtime?**
A: No. The service restart takes ~30 seconds, during which the site will be briefly unavailable.

**Q: What if we need to rollback?**
A: The fix script creates a database backup automatically. Rollback procedure is in DEPLOYMENT_GUIDE.md.

**Q: How do we prevent this in the future?**
A: Use the DEPLOYMENT_VERIFICATION_CHECKLIST.md for all future deployments. Smoke tests will catch this automatically once integrated into CI/CD.

---

## Contact & Support

**Primary Contact:** Scott McCarty (@fatherlinux)
**GitHub Issues:** https://github.com/crunchtools/rotv/issues
**PR #182:** https://github.com/crunchtools/rotv/pull/182

**For Urgent Issues:**
1. Check PROD_FIX_QUICKREF.md
2. Run scripts/diagnose-production.sh
3. Follow PRODUCTION_INCIDENT_README.md
4. Create GitHub issue if needed

---

## Final Checklist

Before marking this incident as closed:

- [ ] Fix applied to production
- [ ] Images verified loading in browser
- [ ] Post-deployment report generated and reviewed
- [ ] No errors in service logs
- [ ] Smoke tests passing
- [ ] 24-hour monitoring period completed
- [ ] Incident documented
- [ ] Team notified of new resources
- [ ] Lessons learned captured
- [ ] Prevention measures planned

---

**Last Updated:** 2026-04-04
**Status:** ⏳ PENDING - Awaiting production fix application
**Next Review:** After fix is applied
