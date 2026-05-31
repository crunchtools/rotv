# User Data Framework: Local-First with Login Sync

Roots of The Valley is **local-first** for user data. Every personal feature works
for anonymous visitors (stored in `localStorage`) and syncs to the user's account
on first sign-in, so it follows them across devices. This is a constitutional rule
(see `.specify/memory/constitution.md` → *User Data: Local-First with Login Sync*).

This document is the recipe for adding the next user feature. The canonical
references are **Favorites** (`user_poi_favorites`) and **Visited** (`user_visits`),
which are both "array of POI ids" collections sharing the same primitives.

## The shape

A user feature flows through five layers:

```
localStorage store  ──┐
  (anonSettings.js)   │  anonymous
AuthContext state   ──┤  ↕ on sign-in
  (isX / toggleX)     │
/auth/user hydration  │  signed-in load
syncAnonSettings()  ──┤  flush local → server (once, on first login)
POST /sync insert   ──┘  server-wins, idempotent
DB user_* table        persistent account state
```

## Adding a "list of POI ids" feature (favorites/visited shape)

1. **Migration** — `backend/migrations/NNN_add_user_<thing>.sql`: a
   `user_<thing>(user_id, poi_id, <ts>)` table, `PRIMARY KEY (user_id, poi_id)`,
   index on `poi_id`. Idempotent (`CREATE TABLE IF NOT EXISTS`) — migrations re-run
   every container start.

2. **Backend route** — `backend/routes/<thing>.js`: `GET /` (list), `POST /:poiId`
   (`INSERT … ON CONFLICT DO NOTHING`), `DELETE /:poiId`, behind `isAuthenticated`
   with the standard rate limiter. Mount it in `backend/server.js`.

3. **Auth payload** — in `backend/routes/auth.js` `/user`, add a `<thing>` array of
   poi_ids so the client hydrates in one round trip.

4. **Sync** — add the table to `POI_ID_LIST_TABLES` in
   `backend/routes/userSettings.js` and call `syncPoiIdList(pool, userId, ids,
   '<thing>')` in `/sync`. This is the whole server side of sync — it validates ids,
   skips deleted POIs, caps the batch, and de-dupes via `ON CONFLICT DO NOTHING`.

5. **localStorage store** — in `frontend/src/utils/anonSettings.js`, add
   `const <thing>Store = createPoiIdListStore('rotv-<thing>')` and export its
   `read/write/add/remove`. Add the collection to the `syncAnonSettings()` payload
   and its clear-on-success block.

6. **AuthContext** — in `frontend/src/contexts/AuthContext.jsx`, add `<thing>`
   state (init from `read<Thing>()`), hydrate from `userData.<thing>` in
   `fetchUser()`, reset on logout, and add `isX(poiId)` / `toggleX(poiId)`. The
   toggle is optimistic: signed-in → `POST/DELETE /api/<thing>/:id` with rollback;
   anonymous → the localStorage `add/remove`.

7. **UI** — a toggle button (mirror `FavoriteToggle.jsx` / `VisitedToggle.jsx`) and
   surface the list in **My Valley** (`MyValley.jsx`).

## Non-POI-id data

Timezone, newsletter, and trips are also synced through `syncAnonSettings()` /
`/sync` but are not POI-id lists; they each have a bespoke server-wins branch. The
rule (anonymous-first + idempotent login sync) is the same; only the storage helper
differs.
