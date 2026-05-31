# Implementation Plan: Visited List & "My Valley" Hub

> **Spec ID:** 031-visited-list
> **Status:** In Progress
> **Last Updated:** 2026-05-30
> **Estimated Effort:** L

## Summary

Mirror the existing Favorites/Follow stack to add a Visited list, generalize the
shared "POI-id list in localStorage, synced on login" machinery into a reusable
framework, and surface Visited + Following + Trips in a new My Valley hub.

---

## Data Flow

1. User taps Visited on a POI → `AuthContext.toggleVisited`.
2. Signed-in → `POST/DELETE /api/visited/:id`; anonymous → `localStorage` (`rotv-visited`).
3. On first sign-in → `syncAnonSettings()` flushes local visited ids to
   `POST /api/user/settings/sync` → `syncPoiIdList()` inserts into `user_visits`.
4. Signed-in load → `/auth/user` returns `visited`; AuthContext hydrates it.
5. My Valley reads visited/following/trips and renders progress + lists.

---

## Implementation Steps

### Phase A — Framework
- [x] `createPoiIdListStore(key)` in `anonSettings.js`; reimplement favorites on it; add visited.
- [x] `syncPoiIdList(pool, userId, ids, field)` + whitelist in `userSettings.js`; wire visited.
- [x] Constitution rule + `docs/USER_DATA_FRAMEWORK.md`.

### Phase B — Visited
- [x] Migration `074_add_user_visits.sql`.
- [x] `routes/visited.js` (list / stats / mark / unmark) + mount in `server.js`.
- [x] `visited` array in `/auth/user`.
- [x] AuthContext `visited` / `isVisited` / `toggleVisited`.
- [x] `VisitedToggle.jsx` in `ReadOnlyView.jsx` + CSS.

### Phase C — My Valley
- [x] `MyValley.jsx` (+ CSS); progress bar + Visited/Following/Trips tabs.
- [x] Dropdown entries (account + login) and modal render in `App.jsx`.
- [x] Remove duplicated Favorites tab from `UserSettings.jsx`.

### Phase D — Tests
- [ ] Backend integration tests (`visited.integration.test.js`).
- [ ] E2E toggle/My Valley test.

---

## Testing Strategy

### Integration Tests
- [ ] `backend/tests/visited.integration.test.js` — POST/DELETE/GET, `/stats`,
  `/sync` visited idempotency, `/auth/user` returns `visited` (mirror
  `poiSubscriptions.integration.test.js`, `BYPASS_AUTH`).

### Manual Testing
1. Signed-out: mark visited → reload → persists; My Valley from Login dropdown.
2. Sign in → local rows sync into `user_visits`; progress matches `/api/visited/stats`.
3. Signed-in: toggle on sidebar, unmark in My Valley, check Following + Trips.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Refactor of favorites store regresses Following | Med | Favorites helpers re-exported from factory unchanged; covered by existing tests |
| `reload-app` skips migrations/utils | Med | Full `./run.sh build` before verify |
| Denominator mismatch (trails) | Low | Count `'point'` POIs; documented open question |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-30 | Initial plan |
