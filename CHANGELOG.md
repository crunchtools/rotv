# Changelog

All notable changes to Roots of The Valley will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Comprehensive production troubleshooting package (17 files)
  - Automated diagnostic scripts (diagnose-production.sh, verify-migrations.sh, fix-production.sh, post-deployment-report.sh)
  - Complete incident response documentation (PRODUCTION_INCIDENT_README.md with 3 resolution paths)
  - Deployment guides (DEPLOYMENT_GUIDE.md, DEPLOYMENT_VERIFICATION_CHECKLIST.md)
  - Production operations guide (README_PRODUCTION.md)
  - Troubleshooting references (PROD_TROUBLESHOOT.md, PROD_FIX_QUICKREF.md, PROD_ISSUE_FLOWCHART.md)
  - Post-deployment smoke tests via GitHub Actions
  - Visual debugging flowcharts and data flow diagrams
  - Executive summary template for stakeholder communication
  - Complete package index and navigation guides
  - 30+ automated health checks
  - 50+ copy-paste commands for common operations
  - Prevention checklists to avoid future incidents

### Documentation
- Updated README.md with Production Operations section

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
