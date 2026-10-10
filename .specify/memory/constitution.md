# rotv Constitution

> **Version:** 2.3.0
> **Ratified:** 2026-03-10
> **Amended:** 2026-10-10
> **Status:** Active
> **Inherits:** [crunchtools/constitution](https://github.com/crunchtools/constitution) v1.22.0
> **Profile:** Web Application

Roots of The Valley: an interactive map exploring Cuyahoga Valley National
Park history. Node.js + Express backend, React frontend, PostgreSQL 17.

This file holds what is specific to rotv. The fleet rules and the Web
Application profile apply at the inherited version and are checked against
this repo's files by `constitution.yml`. They are not restated here.

## User Data: Local-First with Login Sync

Every user-specific experience (saved places, visited lists, trips,
preferences, and anything personal added later) MUST work for **anonymous
visitors** without sign-in. State is persisted in `localStorage` first and
MUST **sync to the user's account on first sign-in** so it follows them
across devices.

- **Anonymous path:** persist to `localStorage` through the helpers in
  `frontend/src/utils/anonSettings.js`. For "list of POI ids" collections use
  the shared `createPoiIdListStore(key)` factory rather than re-implementing
  read/write.
- **Sync path:** the freshly signed-in client flushes accumulated state to
  `POST /api/user/settings/sync`, which MUST be **server-wins, idempotent and
  re-runnable** (`ON CONFLICT DO NOTHING`, fill gaps only, never clobber
  account data). POI-id collections use the shared `syncPoiIdList()` helper
  against a whitelisted `user_*` table.
- **Hydration:** the signed-in client loads its server state from
  `/auth/user` and tracks it in `AuthContext`.

New user features extend this framework instead of inventing a parallel
storage or sync mechanism. The recipe is in `docs/USER_DATA_FRAMEWORK.md`.

## Image Chain

- **Parent image for cascade:** `quay.io/crunchtools/ubi10-core`.
- `Containerfile.base` builds `quay.io/crunchtools/rotv-base` (infrastructure
  layers, including an Umami build stage); `Containerfile.images` builds
  `quay.io/crunchtools/images-rotv` (pgvector and Python build stages). Build
  stages compile on UBI and only their output is copied into a final
  `ubi10-core` stage, so toolchains never ship.
- `Containerfile` builds `quay.io/crunchtools/rotv`. CI passes
  `BASE_IMAGE=quay.io/crunchtools/rotv-base:latest` for fast builds; the
  default, `ubi10-core`, builds everything from scratch for local dev. The app
  build listens for `parent-image-updated` and `rotv-base-updated`.
- `Containerfile.dev` builds `quay.io/crunchtools/rotv-dev` on top of the app
  image, for dev.rootsofthevalley.org: git, gh, Claude Code, and the
  `rootfs-dev/` units (`rotv-dev-deps`, `rotv-dev-ui`, `rotv-dev-claude`) that
  run a mounted checkout. `build-dev.yml` rebuilds it after every app build. It
  is never deployed as production. See `docs/DEVELOPMENT_ARCHITECTURE.md`.
- The frontend is built in the image (`npm run build` into `/app/public/`).
- PostgreSQL 17 + PostGIS come from the pgdg RPM repo. PostGIS's SFCGAL
  dependency needs boost-serialization, so the build registers with RHSM
  through `--mount=type=secret`; CI passes `activation_key` and `org_id`, and
  local builds skip registration.
- Playwright with Chromium is installed globally for testing.

## Services

Entry point `/sbin/init` (systemd); units come from `rootfs/`.

- `postgresql.service`: PostgreSQL 17.
- `rotv-init.service`: Type=oneshot, After=postgresql, Before=rotv-backend.
  Creates the database if absent, imports seed data from
  `/tmp/seed-data.sql`, runs migrations from `/app/migrations/`.
- `rotv-backend.service`: the Express API on port 8080.
- `rotv-display.service`: `weston`, the virtual display for the headed
  Facebook browser.
- `umami.service`: Umami analytics.

## Host Layout and Storage

Under `/srv/rotv/`:

- `code/`: backend source and built frontend assets, bind-mounted `:ro,Z`.
- `config/`: the environment file, mounted as `/etc/rotv/environment` `:ro,Z`
  and loaded with systemd `EnvironmentFile=`. PostgreSQL connection uses the
  standard `PG*` variables.
- `data/`: the PostgreSQL data directory (`/data/pgdata`) and seed data,
  bind-mounted `:Z`. PostgreSQL holds all application data.

dev.rootsofthevalley.org has no `code/`: its git checkout is working state,
edited in place by the session inside the container, so it lives in
`data/checkout`. Nothing under that container's `data/` is backed up. The
database is a scrubbed copy of production (`scripts/dev-seed.sh`) and the rest
is rebuilt by cloning and logging in again.

**Exception:** `.env.test` may carry hardcoded credentials, for local testing
against ephemeral tmpfs-backed databases only.

## Monitoring Coverage

Nagios: HTTP check of the backend on 8080, TCP check of PostgreSQL on 5432,
`pg_isready`, and a process check for `weston` (`rotv-display.service`).

dev.rootsofthevalley.org: container running, container memory, the vhost on
the proxy, and the external HTTPS path expecting 302 (the Cloudflare Access
login redirect). Its inner
services are not paged on: it is a workbench, and a stopped unit there is
often deliberate.

## Smoke Tests

The backend answers HTTP 200, PostgreSQL accepts connections and the `rotv`
database exists, and Playwright end-to-end tests exercise the core map.
Dependabot PR runs build without pushing: registry credentials are
deliberately not shared with them.

## Code Review Regression Prevention

Gemini Code Assist reviews every PR. To keep later PRs from undoing reviewed
fixes:

1. **Check before modifying:** when substantially modifying a file, check
   recent PRs for unresolved review feedback on it
   (`gh api repos/crunchtools/rotv/pulls/{N}/comments`) and address or
   preserve those fixes.
2. **Mark reviewed fixes:** a fix for a bug caught in review carries an inline
   comment `// Fix: <description> (PR #NNN review)`.
3. **Don't silently revert:** if a reviewed fix must change, say why in the PR
   description.

## History

| Version | Date | Changes |
|---------|------|---------|
| 2.3.0 | 2026-10-10 | `rotv-dev` image and its units added to the image chain (#748) |
| 2.2.0 | 2026-10-02 | Manifest under constitution v1.18.0: fleet and profile restatement removed; image chain and service list updated to match the Containerfiles and `rootfs/` |

Earlier versions, from ratification on 2026-03-10 through 2.1.3, are in git
history.
