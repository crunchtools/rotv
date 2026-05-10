# Specification: Image Server Monorepo Migration

> **Spec ID:** 008-image-server-monorepo
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-09

## Overview

Move the image-server Python codebase (crunchtools/image-server) into the ROTV repo as a sibling service. This eliminates cross-repo coordination for changes that touch both ROTV and image handling, while keeping the container images separate for independent deployment.

---

## User Stories

### Developer Experience

**US-001: Coordinated Changes**
> As a developer, I want the image server and ROTV in one repo so that I can make coordinated changes in a single PR.

Acceptance Criteria:
- [ ] Image server source lives at `image-server/` in the ROTV repo
- [ ] Changes to both services can be committed and reviewed together
- [ ] Original image-server repo is archived after migration

**US-002: Independent Builds**
> As a developer, I want the image server to build its own container image so that I can deploy it independently from ROTV.

Acceptance Criteria:
- [ ] `Containerfile.images` builds `quay.io/crunchtools/images-rotv`
- [ ] GHA builds the image only when `image-server/**` files change
- [ ] ROTV's main Containerfile build is unaffected

**US-003: Local Development**
> As a developer, I want to build and test the image server locally using the same tooling as ROTV.

Acceptance Criteria:
- [ ] `run.sh` gains image-server commands (build-images, start-images, etc.)
- [ ] Local development follows the same container-first pattern as ROTV

---

## Data Model

No database changes — the image server has its own PostgreSQL instance inside its container.

---

## API Endpoints

No new endpoints — the image server's existing FastAPI endpoints remain unchanged.

---

## Non-Functional Requirements

**NFR-001: Build Isolation**
- Image server GHA build must not slow down ROTV builds
- Path-based triggers ensure only relevant changes trigger image-server builds

**NFR-002: Deployment Independence**
- Image server deploys to `images.rootsofthevalley.org` independently
- ROTV deploys to `rootsofthevalley.org` independently

---

## Dependencies

- Depends on: crunchtools/image-server current source (v0.1.0)
- Blocks: Archive of crunchtools/image-server repo

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-09 | Initial draft |
