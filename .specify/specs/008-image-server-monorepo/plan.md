# Implementation Plan: Image Server Monorepo Migration

> **Spec ID:** 008-image-server-monorepo
> **Status:** Planning
> **Last Updated:** 2026-05-09
> **Estimated Effort:** M

## Summary

Copy the image-server source into `image-server/` as a sibling to `backend/` and `frontend/`. Add `Containerfile.images` for its container build. Update GHA with path-filtered dispatch to build both images from one repo.

---

## Architecture

### Repository Layout (After)

```
rotv/
├── Containerfile              # ROTV app (unchanged)
├── Containerfile.base         # ROTV base image (unchanged)
├── Containerfile.images       # Image server container (NEW)
├── backend/                   # ROTV Node.js backend
├── frontend/                  # ROTV React frontend
├── image-server/              # Image server Python source (NEW)
│   ├── src/image_server/      # FastAPI application
│   ├── scripts/               # Migration utilities
│   ├── tests/                 # pytest test suite
│   └── pyproject.toml         # Python project config
├── .github/workflows/
│   ├── build.yml              # ROTV container build (add path filter)
│   ├── build-images.yml       # Image server build (NEW)
│   └── tests.yml              # ROTV tests (unchanged)
```

### Build Isolation

```
Push to master
  ├── image-server/** changed? → build-images.yml → quay.io/crunchtools/images-rotv
  └── anything else changed?   → build.yml        → quay.io/crunchtools/rotv
```

---

## Implementation Steps

### Phase 1: Copy Source

- [ ] Copy image-server source into `image-server/` directory
- [ ] Copy Containerfile as `Containerfile.images`
- [ ] Verify `pyproject.toml`, source, tests, scripts all present
- [ ] Remove `.git` directory from copied source (it's now part of ROTV's git)

### Phase 2: GHA Workflows

- [ ] Create `.github/workflows/build-images.yml` with path filter on `image-server/**` and `Containerfile.images`
- [ ] Add path filter to existing `build.yml` to exclude `image-server/**` changes from triggering ROTV builds
- [ ] Ensure RHSM secrets are passed for the multi-stage Containerfile

### Phase 3: Gourmand & Quality

- [ ] Add `image-server/**` to gourmand exclusions (Python project, different lint tooling)
- [ ] Run `./run.sh build && ./run.sh test` to verify ROTV is unaffected
- [ ] Run Gourmand to verify clean

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `image-server/` (directory) | Complete image-server source tree |
| `Containerfile.images` | Multi-stage build for image server container |
| `.github/workflows/build-images.yml` | GHA workflow for image server builds |

### Modified Files

| File | Changes |
|------|---------|
| `.github/workflows/build.yml` | Add path filter to avoid building ROTV on image-server-only changes |
| `gourmand.toml` | Exclude `image-server/**` from checks |

---

## Testing Strategy

### Automated

- [ ] ROTV tests pass (`./run.sh test`) — migration must not break existing tests
- [ ] Gourmand passes — no new violations

### Manual

1. Verify `Containerfile.images` builds locally with `podman build -f Containerfile.images .`
2. Verify GHA path filters work (image-server changes only trigger image-server build)

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| RHSM secrets not available in new workflow | High | Copy secret references from existing image-server build.yml |
| Gourmand flags Python files | Med | Exclude `image-server/**` in gourmand.toml |
| Large PR size due to file copy | Low | Single commit for source copy, separate commits for config changes |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-09 | Initial plan |
