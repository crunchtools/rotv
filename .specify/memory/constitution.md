# ROTV Constitution

> **Version:** 1.0.0
> **Ratified:** 2025-02-06
> **Status:** Active

This constitution establishes the core principles, constraints, and workflows that govern all development on the Roots of The Valley (ROTV) project.

---

## I. Core Principles

### 1. Container-First Development

All development MUST occur within containers to ensure consistency with production. This prevents environment-specific issues and guarantees reproducible builds.

**Requirements:**
- Never develop directly on the host system
- Use `./run.sh` commands for all container operations
- Test all changes within the container before committing

### 2. Branch-Based Workflow

**NEVER work directly on master branch.**

All changes flow through feature branches with pull request review.

**Branch Naming Conventions:**
| Prefix | Purpose |
|--------|---------|
| `feature/` | New features |
| `fix/` | Bug fixes |
| `refactor/` | Code refactoring |
| `docs/` | Documentation updates |
| `test/` | Test additions |

**Examples:**
- `feature/add-supertest-integration-tests`
- `fix/playwright-timeout-handling`
- `docs/update-governance-rules`

### 3. Test-First Validation

**NEVER create a Pull Request without testing locally first.**

Before any PR:
1. All automated tests must pass: `./run.sh test`
2. Container must build successfully: `./run.sh build`
3. Manual verification in browser completed

### 4. Semantic Versioning

Follow [Semantic Versioning 2.0.0](https://semver.org/) strictly.

Given `MAJOR.MINOR.PATCH`:
- **MAJOR**: Breaking changes, incompatible API changes
- **MINOR**: New features, backward-compatible
- **PATCH**: Bug fixes, backward-compatible

**Version tracking:**
- `frontend/package.json` - Source of truth for release version
- `backend/package.json` - Versions independently
- `Containerfile` LABEL - Must match frontend version

**Pre-release versions:** `X.Y.Z-alpha.1`, `X.Y.Z-beta.1`, `X.Y.Z-rc.1`

### 5. Documentation Standards

For major features or significant refactors, create architecture documentation in `docs/`.

**Architecture doc requirements:**
1. Plain English introduction explaining the problem and solution
2. Architecture overview with diagrams
3. Key technologies used
4. Implementation details
5. Testing & validation procedures
6. Future improvements

### 6. AI Code Quality

Use Gourmand for AI slop detection. All code must pass Gourmand checks before merge.

---

## II. Technology Constraints

### Stack Requirements

| Layer | Technology | Version |
|-------|------------|---------|
| Container Runtime | Podman | Latest |
| Base OS | Fedora | Latest |
| Database | PostgreSQL | 17 |
| Backend | Node.js + Express | 20.x LTS |
| Frontend | React + Vite | 18.x / 5.x |
| Testing | Vitest + Playwright + Supertest | Latest |
| Maps | Leaflet + React-Leaflet | 1.9.x / 4.x |

### Security Requirements

- All API endpoints must be authenticated where appropriate
- No secrets in code or version control
- Use `.env` files for configuration
- OAuth via Google/Facebook for user authentication

### Performance Targets

- Container cold start: < 30 seconds
- Hot reload: < 5 seconds
- Test suite completion: < 2 minutes
- Database seed import: < 10 seconds

---

## III. Development Workflow

### Code Quality Gates

Every code change must pass through these gates in order:

1. **Local Development**
   - Code changes compile without errors
   - Hot reload works (`./run.sh reload-app`)

2. **Pre-PR Validation**
   - Full container build succeeds (`./run.sh build`)
   - All 39+ tests pass (`./run.sh test`)
   - Manual testing in browser completed

3. **PR Review**
   - GitHub Actions tests pass
   - Code review approved
   - No merge conflicts

4. **Post-Merge**
   - Version bumped (if releasing)
   - Tag created (triggers CI/CD)
   - Feature branch deleted

### Development Iteration Priority

**Always start with the fastest option and escalate only if needed:**

| Priority | Command | When to Use | Speed |
|----------|---------|-------------|-------|
| 1 | `./run.sh reload-app` | Frontend/backend code changes | ~2-3s |
| 2 | `./run.sh restart-db` | Database connectivity issues | ~5s |
| 3 | `./run.sh build` + `start` | Containerfile, dependencies | ~30-60s |
| 4 | `./run.sh build-base` | Base OS, systemd, PostgreSQL | ~5-10min |

### Branching Strategy

```
master (protected)
  │
  ├── feature/add-new-feature
  │     └── Commits → PR → Merge → Delete
  │
  ├── fix/bug-description
  │     └── Commits → PR → Merge → Delete
  │
  └── docs/update-docs
        └── Commits → PR → Merge → Delete
```

### Complete PR Workflow

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Make changes + iterate with hot reload
./run.sh reload-app

# 3. Full rebuild before PR (MANDATORY)
./run.sh build && ./run.sh start

# 4. Run all tests
./run.sh test

# 5. Commit changes
git add . && git commit -m "feat: add my feature"

# 6. User verification in browser

# 7. Version bump (if releasing)
# Edit package.json files + Containerfile
git commit -m "chore: bump version to X.Y.Z"

# 8. Push and create PR
git push -u origin feature/my-feature
gh pr create --title "Add my feature" --body "..."

# 9. After PR merge
git checkout master && git pull
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push --tags  # Triggers CI/CD
git branch -d feature/my-feature
git push origin --delete feature/my-feature
```

### Release & Versioning

**GitHub Actions handles production builds automatically.**

When a tag is pushed:
1. CI/CD pipeline triggers
2. Container is rebuilt
3. Image pushed to `quay.io/fatherlinux/rotv`
4. No manual `./run.sh push` needed

---

## IV. Governance

### Amendment Process

This constitution may be amended through:
1. Create a PR with proposed changes
2. Document rationale in PR description
3. Require maintainer approval
4. Update version number upon merge

### Ratification History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-02-06 | Initial constitution |

---

## V. Quick Reference

### Essential Commands

```bash
./run.sh build      # Build container
./run.sh start      # Start container
./run.sh stop       # Stop container
./run.sh test       # Run all tests
./run.sh logs       # View logs
./run.sh shell      # Access container shell
./run.sh reload-app # Hot reload code
./run.sh restart-db # Restart PostgreSQL
```

### PR Checklist

- [ ] Tests pass locally (`./run.sh test`)
- [ ] Container builds (`./run.sh build`)
- [ ] Manual testing completed
- [ ] GitHub Actions pass
- [ ] Version bumped correctly (if releasing)
- [ ] Documentation updated (if needed)
