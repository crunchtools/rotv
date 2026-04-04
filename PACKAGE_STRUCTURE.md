# Troubleshooting Package Structure

**Visual Guide to All Resources**

---

## 📊 Package Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENTRY POINTS (Start Here)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  README_PRODUCTION.md ............... Main production guide    │
│  PRODUCTION_INCIDENT_README.md ...... Active incident? Start   │
│  DEPLOYMENT_GUIDE.md ................ Deploying? Start         │
│  TROUBLESHOOTING_PACKAGE_INDEX.md ... Package overview         │
│  NEXT_STEPS.md ...................... Action plan              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      OPERATIONAL GUIDES                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  DEPLOYMENT                      TROUBLESHOOTING               │
│  ├─ DEPLOYMENT_GUIDE.md          ├─ PROD_TROUBLESHOOT.md      │
│  ├─ DEPLOYMENT_VERIFICATION...   ├─ PROD_FIX_QUICKREF.md      │
│  └─ NEXT_STEPS.md                └─ PROD_ISSUE_FLOWCHART.md   │
│                                                                 │
│  INCIDENT RESPONSE               STAKEHOLDER COMMUNICATION     │
│  ├─ PRODUCTION_INCIDENT_...      └─ EXEC_SUMMARY.md           │
│  └─ NEXT_STEPS.md                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                       AUTOMATION TOOLS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SCRIPTS (bash)                  WORKFLOWS (GitHub Actions)    │
│  ├─ diagnose-production.sh       └─ smoke-test.yml            │
│  ├─ fix-production.sh                                          │
│  ├─ verify-migrations.sh                                       │
│  └─ post-deployment-report.sh                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 User Journey Map

### Journey 1: Incident Response (On-Call Engineer)

```
Incident Detected
    ↓
README_PRODUCTION.md (Quick links)
    ↓
PRODUCTION_INCIDENT_README.md (Choose path: Fast/Medium/Thorough)
    ↓
    ├─ Path 1: Fast Fix (5 min)
    │   └─ PROD_FIX_QUICKREF.md → Copy-paste commands → Done
    │
    ├─ Path 2: Diagnose First (10 min)
    │   └─ scripts/diagnose-production.sh
    │       ↓
    │       scripts/fix-production.sh → Done
    │
    └─ Path 3: Understand (30 min)
        └─ EXEC_SUMMARY.md
            ↓
            PROD_ISSUE_FLOWCHART.md
            ↓
            PROD_TROUBLESHOOT.md
            ↓
            Apply fix → Done
    ↓
Verify Fix
    ↓
    ├─ Quick: curl health checks
    └─ Thorough: scripts/post-deployment-report.sh
    ↓
Monitor (24 hours)
    ↓
    └─ journalctl -f
    ↓
Document Incident
    ↓
    └─ EXEC_SUMMARY.md template
    ↓
Close Incident
```

### Journey 2: Deployment (DevOps Engineer)

```
PR Merged → GitHub Actions Build
    ↓
DEPLOYMENT_GUIDE.md
    ↓
    ├─ Standard Deployment (No migrations)
    │   └─ Pull image → Restart → Verify
    │
    └─ Migration Deployment (e.g., PR #182)
        └─ Backup → Apply migrations → Verify migrations → Deploy
    ↓
DEPLOYMENT_VERIFICATION_CHECKLIST.md
    ↓
    ├─ Manual verification
    ├─ scripts/post-deployment-report.sh
    └─ smoke-test.yml (GitHub Actions)
    ↓
Monitor (24 hours)
    ↓
Document deployment
    ↓
Done
```

### Journey 3: Troubleshooting (Support Engineer)

```
Issue Reported
    ↓
README_PRODUCTION.md → Troubleshooting section
    ↓
scripts/diagnose-production.sh
    ↓
Review Output
    ↓
    ├─ Known Issue?
    │   └─ PROD_FIX_QUICKREF.md → Apply fix
    │
    └─ Unknown Issue?
        └─ PROD_TROUBLESHOOT.md → Diagnostic steps
            ↓
            Identify root cause
            ↓
            Apply fix
    ↓
Verify Fix
    ↓
Update documentation (if new issue)
    ↓
Done
```

### Journey 4: Learning (New Team Member)

```
Onboarding
    ↓
README_PRODUCTION.md (Overview)
    ↓
DEPLOYMENT_GUIDE.md (How to deploy)
    ↓
Practice: Run scripts/diagnose-production.sh
    ↓
Review: DEPLOYMENT_VERIFICATION_CHECKLIST.md
    ↓
Study: PROD_TROUBLESHOOT.md
    ↓
Understand: PROD_ISSUE_FLOWCHART.md
    ↓
Ready for on-call
```

---

## 📋 Document Cross-Reference Matrix

| Document | Deployment | Troubleshoot | Incident | Learning |
|----------|------------|--------------|----------|----------|
| **README_PRODUCTION.md** | ✅ Links | ✅ Quick ref | ✅ Entry | ✅ Overview |
| **DEPLOYMENT_GUIDE.md** | ✅ Primary | ⚪ Rollback | ⚪ Context | ✅ Procedures |
| **DEPLOYMENT_VERIFICATION_CHECKLIST.md** | ✅ Post-deploy | ⚪ Prevention | ⚪ Verify | ✅ Checklist |
| **PRODUCTION_INCIDENT_README.md** | ⚪ Context | ✅ Fast path | ✅ Primary | ⚪ Examples |
| **EXEC_SUMMARY.md** | ⚪ Template | ⚪ Template | ✅ Comms | ⚪ Template |
| **PROD_TROUBLESHOOT.md** | ⚪ Issues | ✅ Primary | ✅ Diagnose | ✅ Reference |
| **PROD_FIX_QUICKREF.md** | ⚪ Quick ref | ✅ Commands | ✅ Fast fix | ⚪ Cheat sheet |
| **PROD_ISSUE_FLOWCHART.md** | ⚪ Flow | ✅ Visual | ✅ Understand | ✅ Visual aid |
| **NEXT_STEPS.md** | ⚪ Actions | ⚪ Actions | ✅ Closure | ⚪ Roadmap |

Legend: ✅ Primary use • ⚪ Secondary use

---

## 🛠️ Script Dependency Graph

```
scripts/diagnose-production.sh
    ├─ Checks: Container status
    ├─ Checks: Database tables
    ├─ Checks: Migrations applied
    ├─ Checks: API endpoints
    ├─ Checks: Error rates
    └─ Output: Pass/fail with recommendations
        ↓
        (If issues found)
        ↓
scripts/fix-production.sh
    ├─ Creates: Database backup
    ├─ Applies: Migration 016
    ├─ Runs: migrate-primary-images.js
    ├─ Restarts: Service
    └─ Calls: verify-migrations.sh
        ↓
scripts/verify-migrations.sh
    ├─ Checks: Table schemas
    ├─ Checks: Indexes
    ├─ Checks: Constraints
    ├─ Checks: Data population
    └─ Output: Migration status
        ↓
        (After deployment)
        ↓
scripts/post-deployment-report.sh
    ├─ Gathers: Service status
    ├─ Gathers: Database health
    ├─ Gathers: API status
    ├─ Gathers: Recent errors
    ├─ Analyzes: Migration status
    └─ Generates: Markdown report
```

---

## 🔄 Workflow Integration

```
GitHub Actions
    ↓
.github/workflows/build.yml
    ├─ On: Push to master
    ├─ Builds: Container image
    ├─ Pushes: To quay.io
    └─ Triggers: Test workflow
        ↓
.github/workflows/test.yml
    ├─ Runs: Unit tests
    ├─ Runs: Integration tests
    └─ Reports: Test results
        ↓
        (Manual trigger after deployment)
        ↓
.github/workflows/smoke-test.yml
    ├─ Tests: Health endpoint
    ├─ Tests: API endpoints
    ├─ Tests: Media endpoint (PR #182)
    ├─ Tests: SSRF protection
    └─ Reports: Production health
```

---

## 📂 File Organization

```
rotv/
├── Root Level (Entry points)
│   ├── README.md ............................ Main project README
│   ├── README_PRODUCTION.md ................. Production ops (START HERE)
│   ├── NEXT_STEPS.md ........................ Action plan for incident
│   └── TROUBLESHOOTING_PACKAGE_INDEX.md ..... Package overview
│
├── Deployment Documentation
│   ├── DEPLOYMENT_GUIDE.md .................. Complete deployment guide
│   └── DEPLOYMENT_VERIFICATION_CHECKLIST.md . Post-deployment checklist
│
├── Incident Response
│   ├── PRODUCTION_INCIDENT_README.md ........ Incident response guide
│   └── EXEC_SUMMARY.md ...................... Executive summary template
│
├── Troubleshooting
│   ├── PROD_TROUBLESHOOT.md ................. Comprehensive troubleshooting
│   ├── PROD_FIX_QUICKREF.md ................. Quick reference commands
│   └── PROD_ISSUE_FLOWCHART.md .............. Visual debugging guide
│
├── scripts/
│   ├── diagnose-production.sh ............... Automated diagnostics
│   ├── fix-production.sh .................... Automated fix
│   ├── verify-migrations.sh ................. Migration verification
│   └── post-deployment-report.sh ............ Deployment reporting
│
└── .github/workflows/
    └── smoke-test.yml ....................... Post-deployment smoke tests
```

---

## 🎨 Color-Coded Priority Levels

### 🔴 Critical - Read First
- **README_PRODUCTION.md** - Production operations overview
- **PRODUCTION_INCIDENT_README.md** - Active incident response
- **NEXT_STEPS.md** - Immediate action items

### 🟡 Important - Read for Context
- **DEPLOYMENT_GUIDE.md** - Deployment procedures
- **PROD_TROUBLESHOOT.md** - Troubleshooting guide
- **DEPLOYMENT_VERIFICATION_CHECKLIST.md** - Verification checklist

### 🟢 Reference - Use as Needed
- **PROD_FIX_QUICKREF.md** - Quick commands
- **PROD_ISSUE_FLOWCHART.md** - Visual diagrams
- **EXEC_SUMMARY.md** - Communication template
- **TROUBLESHOOTING_PACKAGE_INDEX.md** - Package index

### ⚪ Automation - Run When Needed
- **scripts/*.sh** - Diagnostic and fix scripts
- **smoke-test.yml** - GitHub Actions workflow

---

## 📈 Recommended Reading Order by Role

### On-Call Engineer (First Incident)
1. README_PRODUCTION.md (5 min)
2. PRODUCTION_INCIDENT_README.md (10 min)
3. PROD_FIX_QUICKREF.md (5 min)
4. Try: scripts/diagnose-production.sh

### DevOps Engineer (Deploying)
1. DEPLOYMENT_GUIDE.md (15 min)
2. DEPLOYMENT_VERIFICATION_CHECKLIST.md (10 min)
3. Try: scripts/post-deployment-report.sh
4. Setup: smoke-test.yml automation

### Support Engineer (Troubleshooting)
1. README_PRODUCTION.md (5 min)
2. PROD_TROUBLESHOOT.md (20 min)
3. PROD_ISSUE_FLOWCHART.md (10 min)
4. Try: scripts/diagnose-production.sh

### Technical Lead (Planning)
1. EXEC_SUMMARY.md (5 min)
2. NEXT_STEPS.md (15 min)
3. TROUBLESHOOTING_PACKAGE_INDEX.md (10 min)
4. Review all automation scripts

### New Team Member (Onboarding)
1. README_PRODUCTION.md (5 min)
2. DEPLOYMENT_GUIDE.md (15 min)
3. PROD_TROUBLESHOOT.md (20 min)
4. Practice with all scripts (30 min)
5. Review DEPLOYMENT_VERIFICATION_CHECKLIST.md (10 min)

---

## 🔗 Quick Navigation Links

### Most Used Documents
- **[README_PRODUCTION.md](./README_PRODUCTION.md)** - Start here
- **[PROD_FIX_QUICKREF.md](./PROD_FIX_QUICKREF.md)** - Quick fixes
- **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** - How to deploy

### Emergency Reference
- **[PRODUCTION_INCIDENT_README.md](./PRODUCTION_INCIDENT_README.md)** - Incident response
- **[NEXT_STEPS.md](./NEXT_STEPS.md)** - Current action items
- **[EXEC_SUMMARY.md](./EXEC_SUMMARY.md)** - Stakeholder comms

### Deep Dive
- **[PROD_TROUBLESHOOT.md](./PROD_TROUBLESHOOT.md)** - Comprehensive guide
- **[PROD_ISSUE_FLOWCHART.md](./PROD_ISSUE_FLOWCHART.md)** - Visual debugging
- **[TROUBLESHOOTING_PACKAGE_INDEX.md](./TROUBLESHOOTING_PACKAGE_INDEX.md)** - Full index

---

## 📊 Package Metrics

| Metric | Value |
|--------|-------|
| Total files | 16 |
| Documentation files | 11 |
| Script files | 4 |
| Workflow files | 1 |
| Documentation lines | ~4,500 |
| Script lines | ~1,200 |
| Coverage | Complete incident lifecycle |
| Time to fix (estimated) | 5 minutes |
| Time to diagnose (automated) | 30 seconds |

---

## ✅ Quality Assurance

This package provides:
- ✅ Multiple entry points for different roles
- ✅ Clear navigation paths
- ✅ Automated diagnostics and fixes
- ✅ Visual aids (flowcharts, diagrams)
- ✅ Copy-paste commands (no guessing)
- ✅ Verification checklists
- ✅ Rollback procedures
- ✅ Stakeholder communication templates
- ✅ Prevention measures
- ✅ Cross-references between documents

---

**Created:** 2026-04-04
**Version:** 1.0
**Maintained by:** Scott McCarty (@fatherlinux)
