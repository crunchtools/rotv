# Deployment Guide - Roots of The Valley

**Target Server:** lotor.dc3.crunchtools.com:22422
**Service:** rootsofthevalley.org
**Container Registry:** quay.io/crunchtools/rotv:latest

---

## Quick Deployment (Standard Process)

### Prerequisites
- [ ] PR merged to master
- [ ] GitHub Actions build completed successfully
- [ ] All tests passing (including integration tests)
- [ ] No blocking issues identified

### Deployment Steps

```bash
# 1. SSH to production
ssh -p 22422 root@lotor.dc3.crunchtools.com

# 2. Backup database
mkdir -p /root/backups
podman exec rootsofthevalley.org pg_dump -U postgres rotv > \
  /root/backups/rotv_$(date +%Y%m%d_%H%M%S).sql

# 3. Pull latest image
podman pull quay.io/crunchtools/rotv:latest

# 4. Restart service
systemctl restart rootsofthevalley.org

# 5. Verify deployment (30-second health check)
sleep 10
systemctl status rootsofthevalley.org
curl -sf https://rootsofthevalley.org/api/health && echo "✅ Healthy" || echo "❌ Failed"
```

### Post-Deployment Verification

```bash
# Option 1: Automated verification (recommended)
bash scripts/post-deployment-report.sh

# Option 2: Run smoke tests via GitHub Actions
gh workflow run smoke-test.yml

# Option 3: Manual verification
curl https://rootsofthevalley.org/api/pois/1/media | jq
```

---

## Deployment with Migrations (e.g., PR #182)

When deploying features that include database migrations:

### Pre-Deployment Checklist
- [ ] Identify all migrations in PR
  - SQL migrations: `backend/migrations/*.sql`
  - Node.js scripts: `backend/scripts/*.js`
- [ ] Review migration order and dependencies
- [ ] Check for data migration scripts
- [ ] Verify rollback procedure

### Deployment Steps

```bash
# 1. SSH to production
ssh -p 22422 root@lotor.dc3.crunchtools.com

# 2. Backup database (CRITICAL for migrations)
mkdir -p /root/backups
BACKUP_FILE="/root/backups/rotv_$(date +%Y%m%d_%H%M%S).sql"
podman exec rootsofthevalley.org pg_dump -U postgres rotv > $BACKUP_FILE
ls -lh $BACKUP_FILE  # Verify backup created

# 3. Apply SQL migrations (in order)
# Example: For PR #182
podman exec rootsofthevalley.org psql -U postgres -d rotv \
  -f /app/migrations/015_add_poi_media.sql

podman exec rootsofthevalley.org psql -U postgres -d rotv \
  -f /app/migrations/016_fix_poi_media_constraints.sql

# 4. Run data migration scripts
# Example: For PR #182
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js

# 5. Verify migrations applied
bash scripts/verify-migrations.sh

# 6. Pull latest image
podman pull quay.io/crunchtools/rotv:latest

# 7. Restart service
systemctl restart rootsofthevalley.org
sleep 10

# 8. Verify deployment
bash scripts/post-deployment-report.sh
```

### Migration-Specific Verification

```bash
# Verify table counts match expectations
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT
  'pois' as table_name, COUNT(*)::text FROM pois UNION ALL
  SELECT 'poi_media', COUNT(*)::text FROM poi_media UNION ALL
  SELECT 'users', COUNT(*)::text FROM users;
"

# Check for migration-specific data
# Example: PR #182 - verify primary images migrated
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "
SELECT COUNT(*) as primary_images
FROM poi_media
WHERE role='primary' AND moderation_status IN ('published', 'auto_approved');
"
```

---

## Rollback Procedures

### Quick Rollback (Container Only)

Use when new container has issues but database is fine:

```bash
# Find previous image
podman images quay.io/crunchtools/rotv

# Tag previous image as latest
podman tag quay.io/crunchtools/rotv:<PREVIOUS_SHA> quay.io/crunchtools/rotv:latest

# Restart
systemctl restart rootsofthevalley.org

# Verify
curl -sf https://rootsofthevalley.org/api/health
```

### Full Rollback (Container + Database)

Use when database migration failed or caused issues:

```bash
# Find backup
ls -lht /root/backups/rotv_* | head -5

# Restore database
BACKUP_FILE="/root/backups/rotv_TIMESTAMP.sql"
podman exec -i rootsofthevalley.org psql -U postgres rotv < $BACKUP_FILE

# Revert container
podman tag quay.io/crunchtools/rotv:<PREVIOUS_SHA> quay.io/crunchtools/rotv:latest

# Restart
systemctl restart rootsofthevalley.org

# Verify rollback
curl -sf https://rootsofthevalley.org/api/health
systemctl status rootsofthevalley.org
```

---

## Troubleshooting Deployments

### Service Won't Start

```bash
# Check service status
systemctl status rootsofthevalley.org --no-pager -l

# Check recent logs
journalctl -u rootsofthevalley.org --since "5 minutes ago" --no-pager

# Check container logs
podman logs rootsofthevalley.org --tail 50

# Common issues:
# - Port already in use: Check with `ss -tlnp | grep :3000`
# - Database not ready: Check `podman exec rootsofthevalley.org systemctl status postgresql`
# - Migration failed: Check logs for SQL errors
```

### Images Not Loading (PR #182 Specific)

```bash
# Quick diagnosis
bash scripts/diagnose-production.sh

# Check if migration script was run
podman exec rootsofthevalley.org psql -U postgres -d rotv -c \
  "SELECT COUNT(*) FROM poi_media WHERE role='primary';"
# Should return > 0

# If 0, run migration script
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js
systemctl restart rootsofthevalley.org
```

See **[PROD_TROUBLESHOOT.md](./PROD_TROUBLESHOOT.md)** for comprehensive troubleshooting.

---

## Monitoring After Deployment

### First Hour (Critical)

```bash
# Watch logs in real-time
journalctl -u rootsofthevalley.org -f

# Check error count every 10 minutes
journalctl -u rootsofthevalley.org --since "10 minutes ago" | grep -i error | wc -l

# Test key endpoints
curl -sf https://rootsofthevalley.org/api/health
curl -sf https://rootsofthevalley.org/api/pois/1/media | jq '.total_count'
```

### First 24 Hours

```bash
# Check every 4 hours
bash scripts/post-deployment-report.sh

# Look for patterns in logs
journalctl -u rootsofthevalley.org --since "4 hours ago" | grep -i error | sort | uniq -c | sort -rn
```

---

## Deployment Checklist

Use this checklist for every deployment:

### Pre-Deployment
- [ ] PR reviewed and approved
- [ ] All CI/CD checks passing (build, tests, security)
- [ ] Deployment runbook reviewed (if feature has one)
- [ ] Backup strategy confirmed
- [ ] Rollback procedure understood
- [ ] Estimated downtime communicated (if any)

### During Deployment
- [ ] Database backup created and verified
- [ ] All SQL migrations applied in order
- [ ] All data migration scripts executed
- [ ] Migration verification passed
- [ ] Latest container image pulled
- [ ] Service restarted successfully
- [ ] Service active and running

### Post-Deployment
- [ ] Health endpoint responding
- [ ] Key API endpoints tested
- [ ] Feature-specific tests passed
- [ ] Post-deployment report generated
- [ ] No critical errors in logs
- [ ] Smoke tests passed (via GitHub Actions)
- [ ] Monitoring in place for next 24 hours

See **[DEPLOYMENT_VERIFICATION_CHECKLIST.md](./DEPLOYMENT_VERIFICATION_CHECKLIST.md)** for detailed checklist.

---

## Automation Scripts

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `scripts/diagnose-production.sh` | Automated health check | Before and after deployment |
| `scripts/fix-production.sh` | Automated fix for common issues | When diagnosis finds issues |
| `scripts/verify-migrations.sh` | Verify all migrations applied | After migration deployment |
| `scripts/post-deployment-report.sh` | Generate deployment report | After every deployment |

### Running Scripts

```bash
# All scripts should be run on production server
ssh -p 22422 root@lotor.dc3.crunchtools.com

# Make scripts executable (if needed)
chmod +x scripts/*.sh

# Run diagnostic
bash scripts/diagnose-production.sh

# Run migration verification
bash scripts/verify-migrations.sh

# Generate post-deployment report
bash scripts/post-deployment-report.sh
```

---

## GitHub Actions Workflows

### Smoke Tests (Manual Trigger)

```bash
# Trigger smoke tests from local machine
gh workflow run smoke-test.yml

# Monitor workflow
gh run watch

# View results
gh run view
```

### Build Status

```bash
# Check recent builds
gh run list --workflow=build.yml --limit 5

# View specific build
gh run view <RUN_ID>

# Re-run failed build
gh run rerun <RUN_ID>
```

---

## Common Deployment Scenarios

### Scenario 1: Simple Code Change (No Migrations)

```bash
# 1. Wait for GHA build
gh run watch

# 2. Deploy
ssh -p 22422 root@lotor.dc3.crunchtools.com
podman pull quay.io/crunchtools/rotv:latest
systemctl restart rootsofthevalley.org

# 3. Verify
curl -sf https://rootsofthevalley.org/api/health && echo "✅ OK"
```

**Duration:** 2-3 minutes

### Scenario 2: Database Migration (e.g., PR #182)

```bash
# 1. Backup
ssh -p 22422 root@lotor.dc3.crunchtools.com
podman exec rootsofthevalley.org pg_dump -U postgres rotv > /root/backups/rotv_$(date +%Y%m%d_%H%M%S).sql

# 2. Apply migrations
podman exec rootsofthevalley.org psql -U postgres -d rotv -f /app/migrations/015_add_poi_media.sql
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js
podman exec rootsofthevalley.org psql -U postgres -d rotv -f /app/migrations/016_fix_poi_media_constraints.sql

# 3. Verify migrations
bash scripts/verify-migrations.sh

# 4. Deploy
podman pull quay.io/crunchtools/rotv:latest
systemctl restart rootsofthevalley.org

# 5. Verify deployment
bash scripts/post-deployment-report.sh
```

**Duration:** 10-15 minutes

### Scenario 3: Emergency Rollback

```bash
# 1. Identify issue
journalctl -u rootsofthevalley.org --since "10 minutes ago" | grep -i error

# 2. Rollback database (if needed)
podman exec -i rootsofthevalley.org psql -U postgres rotv < /root/backups/rotv_LATEST.sql

# 3. Rollback container
podman images quay.io/crunchtools/rotv
podman tag quay.io/crunchtools/rotv:<PREVIOUS_SHA> quay.io/crunchtools/rotv:latest

# 4. Restart
systemctl restart rootsofthevalley.org

# 5. Verify
curl -sf https://rootsofthevalley.org/api/health
```

**Duration:** 3-5 minutes

---

## Reference Documents

| Document | Purpose |
|----------|---------|
| **[DEPLOYMENT_VERIFICATION_CHECKLIST.md](./DEPLOYMENT_VERIFICATION_CHECKLIST.md)** | Detailed post-deployment checklist |
| **[PROD_TROUBLESHOOT.md](./PROD_TROUBLESHOOT.md)** | Comprehensive troubleshooting guide |
| **[PROD_FIX_QUICKREF.md](./PROD_FIX_QUICKREF.md)** | Quick reference for common fixes |
| **[PROD_ISSUE_FLOWCHART.md](./PROD_ISSUE_FLOWCHART.md)** | Visual diagrams for debugging |
| **[PRODUCTION_INCIDENT_README.md](./PRODUCTION_INCIDENT_README.md)** | Incident response guide |
| **[EXEC_SUMMARY.md](./EXEC_SUMMARY.md)** | Executive summary template |

---

## Support & Escalation

### For Deployment Issues
1. Check **[PROD_TROUBLESHOOT.md](./PROD_TROUBLESHOOT.md)**
2. Run `scripts/diagnose-production.sh`
3. Review deployment logs
4. Consider rollback if critical

### For Production Incidents
1. Follow **[PRODUCTION_INCIDENT_README.md](./PRODUCTION_INCIDENT_README.md)**
2. Generate incident report
3. Document resolution
4. Create prevention measures

### Contact
- **GitHub Issues:** https://github.com/crunchtools/rotv/issues
- **Deployment Owner:** Scott McCarty (@fatherlinux)

---

**Last Updated:** 2026-04-04
**Version:** 1.0 (based on learnings from PR #182 deployment)
