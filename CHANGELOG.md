# Changelog

All notable changes to Roots of The Valley will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Image restoration**: Successfully restored 91 POI images from Immich backup (closes #200)
  - Fixed image server upload endpoint constraint violations
  - Corrected poi_media schema usage (role vs is_primary)
  - Migration checks both ROTV and image server databases for existing primaries
- **Broken image icons**: Fixed POIs showing broken image icons when has_primary_image flag was stale
  - Added onError handler to hide broken images gracefully (Sidebar destinations and linear features)
  - Added onError handler to Results tab tile thumbnails (falls back to default SVG icons)
  - Added onError handler to Map tooltip thumbnails (JSX and HTML string tooltips)
  - Fixed HTML string tooltips for linear features using inline onerror attribute
  - Created migration to clean up 400 stale has_primary_image flags
  - Database now consistent: 60 POIs with flag match 60 POIs with actual images (53 + 7 MTB trails)
  - Fixed missing showImage prop in EditView for linear features
- **MTB trail images**: Synced 7 MTB trail images from image server to ROTV database
  - Images existed on image server but missing poi_media linking records
  - Created migration to sync East Rim, Hampton Hills, Ohio & Erie Canal, Reagan-Huffman, Bedford Reserve, Royalview, and West Creek trailheads
  - All MTB trail images now display correctly

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
