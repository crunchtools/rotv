# Claude Code Development Guidelines

## Required Reading

Before making any changes, read these documents in order:

1. **Constitution** - `.specify/memory/constitution.md` - Core principles and workflow rules
2. **Baseline Spec** - `.specify/specs/000-baseline/spec.md` - Current features as user stories
3. **Baseline Plan** - `.specify/specs/000-baseline/plan.md` - Technical architecture

---

## Core Principles (Summary)

| Principle | Rule |
|-----------|------|
| Container-First | All development in containers, never on host |
| Branch-Based | Never commit directly to master |
| Test-First | All tests must pass before PR |
| SemVer | MAJOR.MINOR.PATCH versioning strictly followed |
| Documentation | Architecture docs for major features |
| AI Quality | Gourmand checks for AI slop detection |
| Review Fixes | Mark reviewed fixes with `// Fix: <desc> (PR #N review)` |

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Container | Podman, Fedora |
| Database | PostgreSQL 17 |
| Backend | Node.js 20 + Express |
| Frontend | React 18 + Vite 5 |
| Maps | Leaflet + React-Leaflet |
| Testing | Vitest + Playwright + Supertest |
| AI | Google Gemini, Perplexity |

---

## Quick Reference Commands

```bash
# Development (start here)
./run.sh reload-app    # Hot reload code (~3s)
./run.sh restart-db    # Restart PostgreSQL (~5s)

# Full builds
./run.sh build         # Build container (~60s)
./run.sh start         # Start container
./run.sh stop          # Stop container

# Testing
./run.sh test          # Run all tests

# Utilities
./run.sh logs          # View logs
./run.sh shell         # Container shell
```

---

## Development Workflow

```
1. git checkout -b feature/description
2. Make changes + ./run.sh reload-app (iterate)
3. ./run.sh build (MANDATORY before PR)
4. ./run.sh test (must pass)
5. git commit
6. User verification in browser
7. git push + gh pr create
8. After merge: git tag vX.Y.Z, clean up branch
```

**Full workflow details:** See `.specify/memory/constitution.md` Section III.

---

## Version Tracking

Git tags are the single source of truth for versioning. Use `git tag --sort=-v:refname | head -1` to find the current version. Do not track versions in `package.json` or other code files.

---

## Spec-Kit Commands

When creating new features, use these templates:

```bash
# Create new spec
cp .specify/templates/spec-template.md .specify/specs/XXX-feature/spec.md

# Create implementation plan
cp .specify/templates/plan-template.md .specify/specs/XXX-feature/plan.md
```

---

## Architecture Documentation

| Document | Contents |
|----------|----------|
| `docs/DEVELOPMENT_ARCHITECTURE.md` | Container workflow, ephemeral storage |
| `docs/NEWS_EVENTS_ARCHITECTURE.md` | AI-powered content collection |
| `docs/TRAIL_STATUS_ARCHITECTURE.md` | Trail condition monitoring |
| `docs/CI_CD_TESTING.md` | GitHub Actions, test suite, code quality tools |

---

## Recent Changes

- See `git tag --sort=-v:refname` for version history
- See git log for recent commits
- See `.specify/specs/` for feature specifications
