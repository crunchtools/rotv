# Changelog

All notable changes to Roots of The Valley will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/crunchtools/rotv/compare/v1.30.0...HEAD
[1.30.0]: https://github.com/crunchtools/rotv/compare/v1.29.2...v1.30.0
[1.29.2]: https://github.com/crunchtools/rotv/releases/tag/v1.29.2
