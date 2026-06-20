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

## Architecture Map

### Frontend (React 18 + Vite 5)
- `frontend/src/App.jsx` — main app component, routing, state management (~2500 lines)
- `frontend/src/App.css` — all styles including media queries (mobile breakpoint: 768px)
- `frontend/src/components/Map.jsx` — Leaflet map with marker clusters
- `frontend/src/components/Sidebar.jsx` — POI detail panel with tabs (info, news, events, media)
- `frontend/src/components/BackButton.jsx` — shared back navigation
- `frontend/src/utils/anonSettings.js` — localStorage helpers for anonymous user state

### Backend (Node.js 20 + Express)
- `backend/server.js` — Express app setup, route mounting, MCP server startup
- `backend/routes/` — API route handlers (admin, auth, pois, news, events, media, etc.)
- `backend/services/` — business logic (collection, moderation, newsletter, geocoding, MCP)
- `backend/services/mcpServer.js` — MCP admin server on port 3001 (30 tools)
- `backend/services/moderationService.js` — AI moderation with Gemini scoring
- `backend/services/newsService.js` — News/events web crawling pipeline

### Database (PostgreSQL 17 + PostGIS)
- Schema created by `backend/server.js` initDatabase() on first run
- Migrations in `backend/migrations/*.sql` — run by rotv-init.service, NOT on every restart
- Seed data: `backend/tests/fixtures/test-seed-data.sql` (INSERT-only, no schema, no poi_media rows)

### Tests
- `backend/tests/*.integration.test.js` — Playwright integration tests against live app
- `backend/tests/*.unit.test.js` — Vitest unit tests
- ALWAYS use `./run.sh test`, never `npx vitest run` directly
- Test seed has NO poi_media rows — tests needing media must handle absence gracefully

### Key Relationships
- Carousel rendering requires `hasNavigatedPoi=true` (marker click alone won't show it)
- Mobile layout triggers at `max-width: 768px` in App.css media queries
- `./run.sh reload-app` copies code only — does NOT reload env vars (use stop/start for env changes)
- Image serving: `IMAGE_SERVER_URL` → images.rootsofthevalley.org (container-to-container)

---

## Agent Guidance

### For test-fix issues
1. Read the failing test file(s) named in the issue
2. Read the component/service under test to understand current behavior
3. Fix the tests to match current behavior
4. Do NOT explore unrelated files (CSS, git history, other components) unless the test failure points there

### For frontend issues
- Start with App.jsx for state/routing, then the specific component
- Check App.css for styling — all styles are in this one file
- Mobile issues: look at the 768px media query block in App.css

### For backend/API issues
- Start with the route handler in backend/routes/
- Business logic is in backend/services/ (same name as the route usually)
- Database schema is created in server.js initDatabase()

### Gotchas
- `CREATE OR REPLACE VIEW` fails if columns changed — must DROP first
- Migrations only run on fresh DB init, not on restart — apply manually on deploy
- Test seed data is INSERT-only with no schema (server creates schema)
- Multiple Claude Code sessions clobber each other's containers (same name/port)

---

## Architecture Documentation

| Document | Contents |
|----------|----------|
| `docs/DEVELOPMENT_ARCHITECTURE.md` | Container workflow, ephemeral storage |
| `docs/NEWS_EVENTS_ARCHITECTURE.md` | AI-powered content collection |
| `docs/TRAIL_STATUS_ARCHITECTURE.md` | Trail condition monitoring |
| `docs/RIVER_LEVELS_ARCHITECTURE.md` | USGS river gauge levels for kayakers |
| `docs/CI_CD_TESTING.md` | GitHub Actions, test suite, code quality tools |

---

## Recent Changes

- See `git tag --sort=-v:refname` for version history
- See git log for recent commits
- See `.specify/specs/` for feature specifications
