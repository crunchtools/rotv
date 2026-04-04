# Production Operations - Roots of The Valley

**Quick Links:** [Deploy](#deployment) • [Troubleshoot](#troubleshooting) • [Incident Response](#incident-response) • [Monitoring](#monitoring) • [Rollback](#rollback)

---

## 🚀 Deployment

### Quick Deploy (No Migrations)
```bash
ssh -p 22422 root@lotor.dc3.crunchtools.com
podman pull quay.io/crunchtools/rotv:latest && systemctl restart rootsofthevalley.org
curl -sf https://rootsofthevalley.org/api/health && echo "✅ OK"
```

### Full Deployment Guide
See **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** for:
- Standard deployment process
- Deployment with migrations
- Rollback procedures
- Monitoring guidelines
- Common scenarios

### Post-Deployment Verification
```bash
# Automated report (recommended)
bash scripts/post-deployment-report.sh

# Or run smoke tests
gh workflow run smoke-test.yml
```

---

## 🔍 Troubleshooting

### Quick Health Check (30 seconds)
```bash
ssh -p 22422 root@lotor.dc3.crunchtools.com "podman exec rootsofthevalley.org psql -U postgres -d rotv -c \"SELECT 'Total POIs:' as check, COUNT(*)::text FROM pois UNION ALL SELECT 'Media records:', COUNT(*)::text FROM poi_media;\""
```

### Automated Diagnostics
```bash
# Run comprehensive diagnostics
ssh -p 22422 root@lotor.dc3.crunchtools.com
bash scripts/diagnose-production.sh
```

### Troubleshooting Resources

| Issue | Resource |
|-------|----------|
| General issues | **[PROD_TROUBLESHOOT.md](./PROD_TROUBLESHOOT.md)** |
| Quick fixes | **[PROD_FIX_QUICKREF.md](./PROD_FIX_QUICKREF.md)** |
| Images not loading | **[PRODUCTION_INCIDENT_README.md](./PRODUCTION_INCIDENT_README.md)** |
| Understanding data flow | **[PROD_ISSUE_FLOWCHART.md](./PROD_ISSUE_FLOWCHART.md)** |
| Migration issues | Run `scripts/verify-migrations.sh` |

---

## 🚨 Incident Response

### Active Incident? Start Here

**[PRODUCTION_INCIDENT_README.md](./PRODUCTION_INCIDENT_README.md)** - Choose your path:

1. **Just Fix It (5 min)** - Copy-paste commands for immediate resolution
2. **Diagnose First (10 min)** - Run automated diagnostics then fix
3. **Understand First (20 min)** - Deep dive then fix

### Incident Response Checklist

- [ ] Identify symptoms (what's broken?)
- [ ] Check service status: `systemctl status rootsofthevalley.org`
- [ ] Review recent logs: `journalctl -u rootsofthevalley.org --since "1 hour ago"`
- [ ] Run diagnostics: `bash scripts/diagnose-production.sh`
- [ ] Determine severity (critical? major? minor?)
- [ ] Follow appropriate fix procedure
- [ ] Verify fix worked
- [ ] Document incident (use **[EXEC_SUMMARY.md](./EXEC_SUMMARY.md)** template)

### Common Incidents

#### Images Not Loading
```bash
# Diagnosis
podman exec rootsofthevalley.org psql -U postgres -d rotv -tAc "SELECT COUNT(*) FROM poi_media WHERE role='primary';"

# Fix (if count is 0)
podman exec rootsofthevalley.org node /app/scripts/migrate-primary-images.js
systemctl restart rootsofthevalley.org
```

See **[PROD_FIX_QUICKREF.md](./PROD_FIX_QUICKREF.md)** for more quick fixes.

#### Service Won't Start
```bash
# Check logs
journalctl -u rootsofthevalley.org --no-pager -n 50

# Common causes:
# - Database not ready
# - Port conflict
# - Migration failure
# - Configuration error

# See DEPLOYMENT_GUIDE.md → Troubleshooting Deployments
```

---

## 📊 Monitoring

### Real-Time Monitoring
```bash
# Watch logs
journalctl -u rootsofthevalley.org -f

# Watch resource usage
podman stats rootsofthevalley.org
```

### Periodic Health Checks

```bash
# Every 10 minutes (first hour after deployment)
curl -sf https://rootsofthevalley.org/api/health

# Every 4 hours (first 24 hours)
bash scripts/post-deployment-report.sh

# Weekly
gh workflow run smoke-test.yml
```

### Key Metrics to Monitor

| Metric | Command | Healthy Value |
|--------|---------|---------------|
| Service status | `systemctl status rootsofthevalley.org` | active (running) |
| Error rate | `journalctl -u rootsofthevalley.org --since "1 hour ago" \| grep -i error \| wc -l` | < 10 per hour |
| Response time | `time curl -s https://rootsofthevalley.org/api/pois/1/media > /dev/null` | < 1 second |
| Database size | `podman exec rootsofthevalley.org psql -U postgres -d rotv -c "SELECT pg_size_pretty(pg_database_size('rotv'));"` | Grows steadily |
| Media count | `podman exec rootsofthevalley.org psql -U postgres -d rotv -tAc "SELECT COUNT(*) FROM poi_media;"` | Grows over time |

---

## ↩️ Rollback

### Quick Rollback (Container Only)
```bash
# Revert to previous container (2 minutes)
ssh -p 22422 root@lotor.dc3.crunchtools.com
podman images quay.io/crunchtools/rotv
podman tag quay.io/crunchtools/rotv:<PREVIOUS_SHA> quay.io/crunchtools/rotv:latest
systemctl restart rootsofthevalley.org
```

### Full Rollback (Container + Database)
```bash
# Restore everything (5 minutes)
ssh -p 22422 root@lotor.dc3.crunchtools.com
ls -lht /root/backups/rotv_* | head -5
podman exec -i rootsofthevalley.org psql -U postgres rotv < /root/backups/rotv_TIMESTAMP.sql
podman tag quay.io/crunchtools/rotv:<PREVIOUS_SHA> quay.io/crunchtools/rotv:latest
systemctl restart rootsofthevalley.org
```

See **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md#rollback-procedures)** for detailed rollback procedures.

---

## 🛠️ Scripts Reference

| Script | Purpose | Usage |
|--------|---------|-------|
| **diagnose-production.sh** | Automated diagnostics | `bash scripts/diagnose-production.sh` |
| **fix-production.sh** | Automated fix with backup | `bash scripts/fix-production.sh` |
| **verify-migrations.sh** | Verify migrations applied | `bash scripts/verify-migrations.sh` |
| **post-deployment-report.sh** | Generate deployment report | `bash scripts/post-deployment-report.sh` |

All scripts should be run on production server after SSH.

---

## 📚 Documentation Index

### Deployment & Operations
- **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** - Complete deployment guide
- **[DEPLOYMENT_VERIFICATION_CHECKLIST.md](./DEPLOYMENT_VERIFICATION_CHECKLIST.md)** - Post-deployment checklist

### Troubleshooting
- **[PROD_TROUBLESHOOT.md](./PROD_TROUBLESHOOT.md)** - Comprehensive troubleshooting
- **[PROD_FIX_QUICKREF.md](./PROD_FIX_QUICKREF.md)** - Quick reference commands
- **[PROD_ISSUE_FLOWCHART.md](./PROD_ISSUE_FLOWCHART.md)** - Visual debugging guide

### Incident Response
- **[PRODUCTION_INCIDENT_README.md](./PRODUCTION_INCIDENT_README.md)** - Incident response guide
- **[EXEC_SUMMARY.md](./EXEC_SUMMARY.md)** - Executive summary template

### Development
- **[CLAUDE.md](./CLAUDE.md)** - Development guidelines
- **[docs/DEVELOPMENT_ARCHITECTURE.md](./docs/DEVELOPMENT_ARCHITECTURE.md)** - System architecture
- **[.specify/memory/constitution.md](./.specify/memory/constitution.md)** - Project constitution

---

## 🔗 Quick Reference Links

### Production Environment
- **URL:** https://rootsofthevalley.org
- **Server:** lotor.dc3.crunchtools.com:22422
- **Container:** rootsofthevalley.org
- **Registry:** quay.io/crunchtools/rotv:latest
- **Database:** PostgreSQL 17 (rotv)

### SSH Access
```bash
ssh -p 22422 root@lotor.dc3.crunchtools.com
```

### GitHub Actions
```bash
# Trigger smoke tests
gh workflow run smoke-test.yml

# Check recent builds
gh run list --workflow=build.yml --limit 5

# Monitor running workflow
gh run watch
```

### Key API Endpoints
- Health: https://rootsofthevalley.org/api/health
- POIs: https://rootsofthevalley.org/api/pois
- Media: https://rootsofthevalley.org/api/pois/{id}/media
- Thumbnails: https://rootsofthevalley.org/api/pois/{id}/thumbnail

---

## 📞 Support & Escalation

### When to Escalate
- Service down for > 15 minutes
- Data loss detected
- Security incident
- Unable to resolve using troubleshooting guides

### Escalation Path
1. Review all troubleshooting documents
2. Run automated diagnostics
3. Attempt rollback if appropriate
4. Document incident details
5. Create GitHub issue with details
6. Contact deployment owner

### Contact
- **GitHub Issues:** https://github.com/crunchtools/rotv/issues
- **Deployment Owner:** Scott McCarty (@fatherlinux)

---

## 🎓 Learning Resources

### Recent Incidents & Lessons Learned

#### PR #182: Image Loading Failure (2026-04-04)
**Issue:** Images not loading after deployment
**Cause:** Migration script not executed
**Resolution:** Run `migrate-primary-images.js` script
**Lessons:**
- Always verify migrations after deployment
- Use post-deployment verification checklist
- Automate smoke tests in CI/CD

**Full Documentation:**
- **[PRODUCTION_INCIDENT_README.md](./PRODUCTION_INCIDENT_README.md)**
- **[EXEC_SUMMARY.md](./EXEC_SUMMARY.md)**

---

## 🔄 Continuous Improvement

### After Every Deployment
- [ ] Generate post-deployment report
- [ ] Review any issues encountered
- [ ] Update runbooks if needed
- [ ] Add to lessons learned

### After Every Incident
- [ ] Document incident details
- [ ] Perform root cause analysis
- [ ] Update troubleshooting guides
- [ ] Implement prevention measures
- [ ] Add to monitoring/alerts

### Quarterly Review
- [ ] Review all incidents
- [ ] Identify patterns
- [ ] Update automation
- [ ] Improve monitoring
- [ ] Train team on new procedures

---

## 📋 Checklists

### Pre-Deployment
- [ ] All tests passing
- [ ] Security scans clean
- [ ] Migrations identified and ready
- [ ] Backup strategy confirmed
- [ ] Rollback procedure understood

### During Deployment
- [ ] Backup created
- [ ] Migrations applied
- [ ] Migrations verified
- [ ] Service restarted
- [ ] Service healthy

### Post-Deployment
- [ ] Health checks passing
- [ ] Feature tests passed
- [ ] Smoke tests run
- [ ] Report generated
- [ ] Monitoring active

See **[DEPLOYMENT_VERIFICATION_CHECKLIST.md](./DEPLOYMENT_VERIFICATION_CHECKLIST.md)** for detailed checklist.

---

## 🆘 Emergency Contacts & Quick Commands

### Immediate Response Commands

```bash
# Stop the service (emergency only)
systemctl stop rootsofthevalley.org

# Check if service is running
systemctl status rootsofthevalley.org

# View last 50 log lines
journalctl -u rootsofthevalley.org --no-pager -n 50

# Check database connection
podman exec rootsofthevalley.org psql -U postgres -d rotv -c "SELECT 1;"

# Check disk space
df -h

# Check container resource usage
podman stats --no-stream rootsofthevalley.org
```

### Emergency Rollback
```bash
# One-liner rollback to previous container
podman tag quay.io/crunchtools/rotv:$(podman images quay.io/crunchtools/rotv --format "{{.Tag}}" | grep -v latest | head -1) quay.io/crunchtools/rotv:latest && systemctl restart rootsofthevalley.org
```

---

**Last Updated:** 2026-04-04
**Version:** 1.0
**Maintainer:** Scott McCarty (@fatherlinux)
