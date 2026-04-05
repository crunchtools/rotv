# rotv Constitution

> **Version:** 2.0.0
> **Ratified:** 2026-03-10
> **Status:** Active
> **Inherits:** [crunchtools/constitution](https://github.com/crunchtools/constitution) v1.3.0
> **Profile:** Web Application

Roots of The Valley — interactive map exploring Cuyahoga Valley National Park history. Node.js + Express backend with React frontend, PostgreSQL 17 database, built on ubi10-core.

---

## License

AGPL-3.0-or-later

## Versioning

Follow Semantic Versioning 2.0.0. MAJOR/MINOR/PATCH.

## Base Image

`quay.io/crunchtools/ubi10-core:latest` — inherits systemd hardening and troubleshooting tools from the crunchtools image tree.

**Parent image for cascade rebuild:** `quay.io/crunchtools/ubi10-core`

## Application Runtime

- **Language:** Node.js with Express (backend), React + Vite (frontend)
- **Dependencies:** `package.json` for both backend and frontend, installed with `npm install`
- **Database:** PostgreSQL 17 (from pgdg repository, no RHSM needed)
- **Testing tools:** Playwright with Chromium (installed globally via npm)
- **Services:**
  - `postgresql.service` — PostgreSQL 17 database server
  - `rotv-init.service` — Database initialization (Type=oneshot, After=postgresql, Before=rotv-backend)
  - `rotv-backend.service` — Node.js Express API server on port 8080
- **Entry point:** `/sbin/init` (systemd)

## Host Directory Convention

Host data lives under `/srv/rotv/`:

- `code/` — backend source and built frontend assets bind-mounted `:ro,Z`
- `config/` — environment file (`/etc/rotv/environment`) bind-mounted `:ro,Z`
- `data/` — PostgreSQL data directory (`/data/pgdata`), seed data bind-mounted `:Z`

## Data Persistence

PostgreSQL 17 stores all application data. Database initialization uses a oneshot systemd service pattern:

```
rotv-init.service (Type=oneshot)
  After=postgresql.service
  Before=rotv-backend.service
```

The init service creates the database if not present, imports seed data from `/tmp/seed-data.sql`, and runs schema migrations from `/app/migrations/`. PostgreSQL data directory at `/data/pgdata` is a persistent volume.

## Containerfile Conventions

- Single-stage build on `ubi10-core`
- Frontend built in-image: `npm run build` creates `/app/public/`
- `rootfs/` directory provides systemd units and init script
- PostgreSQL 17 installed from pgdg RPM repo (no RHSM needed)
- Playwright + Chromium installed globally for testing
- Required LABELs: `maintainer`, `description`

## Runtime Configuration

- Environment file: `/etc/rotv/environment` loaded via systemd `EnvironmentFile=`
- PostgreSQL connection via standard `PG*` environment variables
- No hardcoded credentials in production deployments
- **Test environments:** `.env.test` may contain hardcoded credentials for local testing only (ephemeral databases with tmpfs storage)

## Registry

Published to `quay.io/crunchtools/rotv`.

## Cascade Rebuild

Workflow includes `repository_dispatch` listener for `parent-image-updated` events. When `ubi10-core` is updated, rotv rebuilds automatically.

## Monitoring

Zabbix monitoring:
- Web scenario (HTTP check) for Node.js backend on port 8080
- TCP port check for PostgreSQL on port 5432
- `pg_isready` health check for database connectivity

## Testing

- **Build test**: CI builds the Containerfile on every push to main
- **Health check**: Node.js server responds with HTTP 200
- **Database connectivity**: PostgreSQL accepts connections and rotv database exists
- **Smoke test**: Playwright end-to-end tests verify core map functionality

## Quality Gates

1. Build — Containerfile builds successfully
2. Application health test — HTTP 200 from Node.js backend
3. Push — Image pushed to Quay.io

## Code Review Regression Prevention

Gemini Code Assist reviews every PR. To prevent later PRs from undoing reviewed fixes:

1. **Check before modifying**: When substantially modifying a file, check recent PRs for unresolved Gemini feedback on that file (`gh api repos/crunchtools/rotv/pulls/{N}/comments`). Address or preserve those fixes.
2. **Mark reviewed fixes**: When fixing a bug caught by code review, add an inline comment: `// Fix: <description> (PR #NNN review)`. This makes the fix visible to anyone refactoring the area later.
3. **Don't silently revert**: If a reviewed fix must be changed, explain why in the PR description.
