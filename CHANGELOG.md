# Changelog

All notable changes to Roots of The Valley will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **One POI per park (#712)**: production had a content-less boundary and a separate point for the
  same park, so a search returned look-alike rows. Admin MCP tools `poi_merge_candidates` and
  `poi_merge` fold the point into the boundary (content, news, events, photos, favorites, visits),
  with a dry run. Saved places, visited lists and old permalinks follow the merge. A park boundary
  is now collected for news and events, counted in visited totals, and drawn with a pin.
- **Duplicate names are refused (#712)**: creating or renaming a POI onto a name another place
  already answers to returns 409. Case, apostrophe style and a trailing county are ignored.
- **Editor's draft of the weekly digest (#734)**: two MCP tools for the Thursday edit. `digest_draft`
  returns the news and events the next send will contain, in send order, with the runners-up that
  backfill when an item is cut; it is built by the same call the email renders from.
  `digest_exclude` holds a published item out of the digest without unpublishing it, through a new
  `digest_excluded` flag on news and events (migration 096).

### Changed
- **The place card on a phone**: at half height the card is now a summary. The photo is a thumbnail
  in the header that opens the gallery, and the Info, News and History tabs sit directly under it.
  The half card no longer scrolls: dragging it up opens it in full, and dragging the full card down
  brings it back to half.
- **`./run.sh dev-ui`**: a Vite dev server with hot reload on port 5173, proxying to the running dev
  container. The dev proxy had pointed at a port the backend no longer uses.
- **Three tabs: Map, Find, Happening (#712)**: the five icon tabs are now three with words on them,
  in a bar along the bottom of a phone. News and Events share Happening; About moved to the account
  menu. Old `/results`, `/news` and `/events` links redirect.
- **Find lists every place (#712)**: the list no longer shrinks to whatever the map shows. A search
  puts the park ahead of the trails and restrooms that share its name, each row says which park it
  is in, and the search box is the same one as the map's. MTB Trail Status and Organizations are
  entries in a list picker.
- **Filters are one button (#712)**: type chips in Find, News and Events sit behind `Filters`
  instead of filling the top of the page. The mini maps on those tabs are gone.
- **The place card opens at half height on a phone (#712)**: the map stays visible above it and the
  tabs below it; a chevron expands it. Whatever is selected stays selected while you visit another
  tab, and is framed in the visible part of the map when you come back.
- **The map follows what you pick (#712)**: choosing a place from the list no longer leaves the map
  where it was. A selected trail, river or park is brought fully into view, and returning to the Map
  tab re-frames the selection. With nothing selected the map keeps its position.
- **AI research reads the web before it writes (#724)**: research drafted from the model's memory,
  so well-known places came back with unverified detail and URLs nobody had opened. It now runs one
  Serper search, renders the POI's reference page and the top four results, and may state only what
  those pages say. Sources are cited by number and resolved to the fetched URLs; the draft lists the
  pages read and the ones that could not be read, and says so when nothing was drafted. Both passes
  run concurrently.

### Fixed
- **Park name matching on the production database encoding (#712)**: `poi_name_key()` used
  `translate()`, which on a SQL_ASCII database turned one curly apostrophe into two straight ones,
  so "O’Neil Woods" never matched "O'Neil Woods". It now uses `replace()`.
- **Digest previews use the real send window (#734)**: a preview was built as of "now plus N days"
  at the current clock time, so one generated Thursday night covered a news window ending Friday
  night instead of at the 08:00 send. Previews are now built as of Friday 08:00 Eastern.
- **AI research is three times faster and stops failing on the history pass (#727)**: measured in
  prod, the research calls took 35-38s with model reasoning on and the history reply was unparseable
  twice in a row; with reasoning off they take about 10s. A timeout while reading the model's reply
  is now reported as a failed request instead of a raw TimeoutError, and a POI that is itself a
  boundary no longer repeats its own name in the search query.
- **AI research describes the POI, not its parent park (#721)**: the research prompts framed every
  POI as part of Cuyahoga Valley National Park and never said what kind of place it was, so trails
  came back with their parent park's write-up. Both passes now name the POI's type, owner and parent
  park as context only, and return null rather than borrow a description. The history pass is skipped
  when the first pass knows nothing specific to the place.

### Removed
- The "POI Research" prompt settings in the Jobs tab and `POST /api/admin/ai/prompt-preview`: research
  never read them (#728).
- The single-pass `POST /api/admin/ai/research` endpoint and its prompt, unused since the editor moved
  to `research-v2`.

### Changed
- Relicensed from GPL-3.0 to AGPL-3.0-or-later, matching Constitution I and
  what this repo's constitution already declared.

### Added
- **Connect Facebook (remote-browser login)** in Settings › Data Collection. Facebook only serves its
  Page Plugin logged-out to residential IPs, and walls lotor and every VPN exit. An admin now logs in
  through a browser running on the ROTV server (screenshots streamed into a modal, input relayed back),
  and the session is saved for Facebook trail status. The mechanism is provider-generic
  (`remoteLoginSession.js`), ready for X if cookie-paste stops working there.

### Changed
- Constitution is now a v1.18.0 manifest: fleet and profile rules apply by
  reference, and the file keeps only what is specific to this repo.
- Constitution validation is pinned to the inherited release via
  `.github/workflows/constitution.yml`.
- Dependabot auto-merges GitHub Actions minor and patch updates.
- Facebook trail status uses a dedicated non-proxied browser with the saved session, and reports
  "Facebook login required" instead of passing login-page text to the classifier.
- **Facebook trail status no longer uses Apify**: Reagan-Huffman (medinaTRAILS) status now comes
  from Facebook's Page Plugin (`facebookService.js`), with per-post dates from `[data-utime]`.
  The 30-minute cadence had exhausted Apify's free tier (403 on every fetch since 2026-09-25).

### Removed
- `apifyService.js`, the Apify API token card in Settings > Data Collection, and
  `POST /api/admin/settings/apify-api-token/test`.

## [1.38.4] - 2026-09-20

### Fixed
- **Registry drift on all three images built from this repo** (rotv, rotv-base,
  images-rotv): none of the three `build*.yml` workflows had a `tags: ['v*']`
  push trigger or emitted a semver-tagged image — only `:latest` (and, for
  rotv/images-rotv, a sha tag) — so every `vX.Y.Z` release tag from v1.31.0
  through v1.38.3 never produced a matching versioned image in either
  registry. Added `tags: ['v*']` and `type=semver` metadata tags to all three
  workflows (rotv-base now also carries a versioned tag alongside `:latest`,
  which the rotv build still consumes) so cutting this tag actually lands
  1.38.4 in both quay and ghcr for all three images.

### Changed
- **Newsletter send gate is now fail-closed**: `isSendEnabled()` requires an explicit `NEWSLETTER_SEND_ENABLED=true`
  - Previously fail-open (`!== 'false'`), so a missing variable meant sends were ENABLED — the root condition behind the duplicate [PREVIEW] emails (#440/#476)
  - A forgotten or mislocated env file now means NO send by default; only production sets the flag to `true` (added explicitly to lotor's env before this shipped). Also closes the latent risk of CI containers (which carry the prod Buttondown key via seed data) being nominally send-enabled

### Fixed
- **Duplicate events in weekly newsletter**: "Steam in the Valley!" ran twice in issue #15
  - Save-time dedup required an exact `start_date` match, so a bare-date variant (noon fallback) and a timed variant of the same event both saved
  - Title match now compares the calendar day in Eastern time; digest rendering also dedupes by POI + title + day as a safety net for rows collected before the fix
- **Duplicate news stories in weekly newsletter**: the Summit Metro Parks fishing-derby story ran twice (parks site + Spectrum News)
  - Same story from two outlets has a different URL and headline, dodging save-time dedup
  - Digest rendering now collapses same-POI stories whose significant title+summary vocabulary mostly overlaps; both digest paths overfetch so dedup does not shrink the issue below its slot count
- **Preview/digest emails sent from dev and test containers** (regression of #440)
  - `~/.rotv/environment-dev` is long-lived and only generated when missing, so files created before #440 never received `NEWSLETTER_SEND_ENABLED=false`; the test ENVFILE block never included it at all
  - run.sh now appends the kill switch to existing dev env files and includes it in the test env file; three [PREVIEW] copies on May 28 and June 11 came from prod + dev + test containers all sharing the prod Buttondown key
- **News date year corruption**: Fixed systematic 2025→2026 year shift in publication dates (#228)
  - Root cause: pg library returns `date` columns as JavaScript Date objects; `String(dateObj).slice(0,10)` produces `"Sat May 31"` (no year), which chrono-node re-parses as the next future occurrence
  - Fix: global pg type parsers (`types.setTypeParser`) for OID 1082/1114/1184 now return raw ISO strings
  - Defense-in-depth: `moderationService.js` guards with `instanceof Date` checks before slicing
  - Corrected 3 existing corrupted rows in DB (ids 8568, 8616, 8653)
- **Moderation inbox blank screen on Edit deep-link**: Fixed `ReferenceError: idFilter is not defined` crashing ModerationInbox (#227)
  - Stale `idFilter` reference left in `useCallback` dependency array after PR #226 rewrote the approach
- **Edit deep-link showing multiple results**: Fixed Edit button in Park News opening 5 related articles instead of exactly the targeted one (#229)
  - Switched from title `ILIKE` search (could match multiple) to `?id=N` exact fetch
  - Lazy state initialization (`useState(() => focusItemId)`) eliminates race condition where first fetch fired before useEffect set the filter

### Added
- **Development image proxy**: Localhost now proxies images from production when IMAGE_SERVER_URL is not configured
  - Allows viewing actual POI images during local development
  - Falls back to production asset endpoint for thumbnails
  - Only active when NODE_ENV=test or NODE_ENV=development

### Fixed
- **Image restoration**: Successfully restored 91 POI images from Immich backup (closes #200)
  - Fixed image server upload endpoint constraint violations
  - Corrected poi_media schema usage (role vs is_primary)
  - Migration checks both ROTV and image server databases for existing primaries
- **Broken image icons**: Fixed POIs showing broken image icons when has_primary_image flag was stale
  - Added onError handler to hide broken images gracefully (Sidebar destinations and linear features)
  - Added onError handler to Results tab tile thumbnails (falls back to default SVG icons)
  - Added onError handler to Map tooltip thumbnails (JSX and HTML string tooltips)
  - Added onError handler to Sidebar association item thumbnails (related POIs list)
  - Fixed HTML string tooltips for linear features using inline onerror attribute
  - Created migration to clean up 400 stale has_primary_image flags
  - Database now consistent: 60 POIs with flag match 60 POIs with actual images (53 + 7 MTB trails)
  - Fixed missing showImage prop in EditView for linear features
- **MTB trail images**: Synced 7 MTB trail images from image server to ROTV database
  - Images existed on image server but missing poi_media linking records
  - Created migration to sync East Rim, Hampton Hills, Ohio & Erie Canal, Reagan-Huffman, Bedford Reserve, Royalview, and West Creek trailheads
  - All MTB trail images now display correctly
- **Orphaned gallery images**: Promoted 37 gallery images to primary when no primary existed
  - Red Lock Trailhead, Stanford Trail, Hampton Hills locations, and 34 others were showing broken images
  - These images were incorrectly marked as 'gallery' during Immich restore migration
  - Created migration to promote sole gallery images to primary role
  - Updated has_primary_image flags for all affected POIs
  - All 37 POIs now display thumbnails correctly in Results, Map, and Sidebar

## [1.31.0] - 2026-04-09

### Changed
- **Auth bypass architecture**: Moved from container-baked to environment-file based for better separation of concerns (#199)
  - Development: `./run.sh start` enables auth bypass via `~/.rotv/environment` (localhost only)
  - Testing: `./run.sh test` uses normal authentication (tests can validate auth properly)
  - Production: Container no longer has hardcoded test configuration
  - CI: Auth bypass injected via environment variables in test workflow

### Fixed
- **POI Edit UI**: Fixed white screen crash when entering Edit mode (missing `showImage` prop in EditView component)
- **PostGIS installation**: Added fallback to handle RHEL 10 dependency regression (libboost_serialization.so.1.83.0 unavailable as of 2026-04-09)
- **Test isolation**: Properly mock node-fetch module in serperService tests to prevent real API calls during testing

### Technical
- Removed `getGeographicContext` as standalone function (inlined into `searchNewsUrls` to eliminate single-use helper)
- Created issue #200 to track POI image restoration after Immich migration failure

## [1.30.1] - 2026-04-05

### Fixed
- **Mosaic positioning**: Now renders at sidebar top (between header and tabs) instead of inside Info tab
- **POI type unification**: All POI types (destinations, linear features, virtual) now use identical media handling code
- **Mobile navigation**: Restored POI navigation chevron buttons that were accidentally removed
- **Primary image indicators**: Added grey star in mosaic, gold badge in lightbox
- **Lightbox navigation**: Now stays on same image when setting it as primary (was jumping to different index)
- **Event-driven updates**: Async badge and count updates work correctly across all components
- **Media deletion**: Wrapped in database transaction for data integrity, implements eventual consistency for image server
- **Security**: Added error handling for JSON.parse, removed internal error details from responses, removed hardcoded admin email
- **Code quality**: Re-enabled React.StrictMode, removed 4,387 lines of AI-generated summary litter

### Changed
- Caption length limit increased from 200 to 2000 characters (migration 017)
- Media deletion returns 202 Accepted when image server cleanup is pending (eventual consistency)

### Technical
- Created issue #184 to track long-term POI type architecture refactor
- Created issue #186 to track background cleanup job for orphaned image server assets

## [1.30.0] - 2026-04-04

### Added
- Multi-image POI support with mosaic display and lightbox viewer (#181)
- Support for images, videos, and YouTube embeds per POI
- Facebook-style mosaic layout (primary + 2 most liked images)
- Full-screen lightbox viewer with keyboard navigation
- User-submitted media with moderation workflow
- Admin moderation dashboard for media approval
- Like system for media (influences mosaic display)
- Rate limiting on asset proxy endpoints (100 req/15min per IP)
- In-memory mosaic caching (5min TTL with auto-invalidation)
- Database migration 015: poi_media table
- Database migration 016: Data integrity constraints
- 15 new integration tests for POI media functionality

### Fixed
- OAuth endpoints now return 501 instead of crashing when not configured
- Asset proxy returns proper HTTP status codes (404, 503) for better error handling

### Security
- SSRF protection via asset ID validation
- Path traversal prevention in filename sanitization
- Race condition prevention for primary image assignment
- Rate limiting to prevent DoS attacks on asset proxy

### Performance
- In-memory caching reduces database load for mosaic queries
- Optimized indexes for moderation queue and media retrieval
- Streaming proxy for efficient asset delivery

## [1.29.2] - 2026-03-30

### Fixed
- Pre-existing fixes and improvements (details in git history)

---

## Release Process

1. **Merge PR to master** - Ensure all tests pass
2. **Create release tag** - `git tag -a vX.Y.Z -m "Release vX.Y.Z: Description"`
3. **Push tag** - `git push origin vX.Y.Z`
4. **Update CHANGELOG.md** - Add entry under [Unreleased] → [X.Y.Z]
5. **Create GitHub Release** - `gh release create vX.Y.Z --notes-file release-notes.md`

## Versioning Guidelines

- **MAJOR** (X.0.0) - Incompatible API changes, major feature overhauls
- **MINOR** (1.X.0) - New features, backwards-compatible functionality
- **PATCH** (1.0.X) - Bug fixes, backwards-compatible improvements

[Unreleased]: https://github.com/crunchtools/rotv/compare/v1.31.0...HEAD
[1.31.0]: https://github.com/crunchtools/rotv/compare/v1.30.1...v1.31.0
[1.30.1]: https://github.com/crunchtools/rotv/compare/v1.30.0...v1.30.1
[1.30.0]: https://github.com/crunchtools/rotv/compare/v1.29.2...v1.30.0
[1.29.2]: https://github.com/crunchtools/rotv/releases/tag/v1.29.2
