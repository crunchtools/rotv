# Changelog

All notable changes to Roots of The Valley will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
