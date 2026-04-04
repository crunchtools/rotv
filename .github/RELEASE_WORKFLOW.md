# Release Workflow

This document describes the process for creating releases of Roots of The Valley.

## Overview

ROTV uses [Semantic Versioning](https://semver.org/) and maintains releases through:
- Git tags (source of truth for version numbers)
- GitHub Releases (user-facing release notes)
- CHANGELOG.md (historical record in repository)

## Versioning Strategy

**MAJOR.MINOR.PATCH** (e.g., v1.30.0)

- **MAJOR** (X.0.0) - Breaking changes, incompatible API changes
- **MINOR** (1.X.0) - New features, backwards-compatible functionality
- **PATCH** (1.0.X) - Bug fixes, backwards-compatible improvements

## Release Process

### 1. Prepare Release

**After PR is merged to master:**

```bash
# Ensure you're on master with latest code
git checkout master
git pull origin master

# Determine next version number based on changes
# Review commits since last tag
git log $(git tag --sort=-v:refname | head -1)..HEAD --oneline
```

### 2. Create Release Tag

```bash
# Create annotated tag with summary
git tag -a vX.Y.Z -m "Release vX.Y.Z: Brief Description

Key Features:
- Feature 1
- Feature 2

Bug Fixes:
- Fix 1
- Fix 2"

# Push tag to trigger container build
git push origin vX.Y.Z
```

### 3. Update CHANGELOG.md

Move items from `[Unreleased]` to new version section:

```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Added
- New features...

### Fixed
- Bug fixes...

### Security
- Security improvements...
```

Update comparison links at bottom:
```markdown
[Unreleased]: https://github.com/crunchtools/rotv/compare/vX.Y.Z...HEAD
[X.Y.Z]: https://github.com/crunchtools/rotv/compare/vA.B.C...vX.Y.Z
```

### 4. Create Release Notes

Create comprehensive release notes (see template below):

```bash
cat > /tmp/release-notes-vX.Y.Z.md << 'NOTES'
# vX.Y.Z - Title

**Release Date:** YYYY-MM-DD
**Issue:** #NNN
**PR:** #NNN

## 🎉 Major Features
...

## 🔒 Security Enhancements
...

## ⚡ Performance Improvements
...

## 🐛 Bug Fixes
...

## 🔄 Upgrade Instructions
...

## 🙏 Acknowledgments
...
NOTES
```

### 5. Create GitHub Release

```bash
gh release create vX.Y.Z \
  --title "vX.Y.Z - Brief Title" \
  --notes-file /tmp/release-notes-vX.Y.Z.md \
  --verify-tag
```

### 6. Commit CHANGELOG

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for v.X.Y.Z"
git push origin master
```

### 7. Deploy to Production

Follow deployment runbook or use `/deploy` skill:

```bash
# Wait for GHA container build to complete
gh run watch <run-id>

# Deploy using /deploy skill or manual process
ssh -p 22422 root@lotor.dc3.crunchtools.com "podman pull quay.io/crunchtools/rotv:latest"
ssh -p 22422 root@lotor.dc3.crunchtools.com "systemctl restart rootsofthevalley.org"

# Verify health
curl https://rootsofthevalley.org/api/health
```

## Release Notes Template

```markdown
# vX.Y.Z - Title

**Release Date:** YYYY-MM-DD  
**Issue:** #NNN (if applicable)  
**PR:** #NNN (if applicable)

## 🎉 Major Features

List new features with brief descriptions.

## 🔒 Security Enhancements

List security improvements, vulnerability fixes.

## ⚡ Performance Improvements

List performance optimizations.

## 🗄️ Database Changes

List migrations, schema changes.

## 📊 Implementation Stats

- **X commits**
- **Y files changed**
- **Z new tests**

## 🛠️ Technical Details

Brief technical summary for developers.

## 🐛 Bug Fixes

List bug fixes.

## 📚 Documentation

Link to relevant documentation.

## 🔄 Upgrade Instructions

Steps to upgrade (if any manual actions needed).

## 🙏 Acknowledgments

Credit contributors, reviewers.

---

**Full Changelog:** https://github.com/crunchtools/rotv/compare/vA.B.C...vX.Y.Z
```

## Automation Opportunities

Future improvements could include:
- GitHub Actions workflow to auto-create draft releases from tags
- Script to generate CHANGELOG entries from commit messages
- Integration with `/feature` skill to auto-create release on PR merge
- Slack/email notifications for new releases

## Historical Releases

See [CHANGELOG.md](../../CHANGELOG.md) for complete release history.
