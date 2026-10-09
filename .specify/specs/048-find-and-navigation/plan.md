# Implementation Plan: Find a place and get to it

> **Spec ID:** 048-find-and-navigation
> **Status:** Implemented (release 1 in v1.54.0, release 2 in v1.55.0)
> **Last Updated:** 2026-10-09

## Summary

Two releases. Release 1 fixes the data and the map: a merge service folds each duplicate point into its park boundary, a park boundary becomes a place in its own right (collected, pinned, navigable), and the map frames what is selected. Release 2 replaces the navigation and the Results tab.

The merge is an admin tool, not a migration: ids differ per environment, every migration re-runs on each boot, and each pair deserves a look before it is merged.

## Release 1: changes by file

| File | Change |
|------|--------|
| `backend/utils/poiRoles.js` | New: `isCollectiblePoi` |
| `backend/services/poiMergeService.js` | New: `mergePois` (one transaction, dry run by rollback), `findParkMergeCandidates`, `assertPoiNameAvailable`, `normalizePoiName`, `resolveMergedIds` |
| `backend/services/newsService.js` | Collection gates accept park boundaries; `boundary_type` loaded with the POI |
| `backend/routes/visited.js` | Visited totals count parks |
| `backend/routes/admin.js` | `guardPoiName` middleware on POI create and update routes |
| `backend/routes/userSettings.js` | `syncPoiIdList` stores the survivor of a merged id |
| `backend/services/mcpServer.js` | `poi_merge_candidates`, `poi_merge`; name guard in `poi_create` |
| `backend/migrations/095_poi_merge.sql`, `backend/server.js` | `merged_into_id` column and `poi_name_key()` SQL function, in both places |
| `backend/server.js` | `GET /api/pois/merged`; retired slug redirects |
| `frontend/src/utils/poiKind.js`, `utils/mapFrame.js` | New: `isParkPin`; `frameBounds` |
| `frontend/src/App.jsx` | `applyMarkerFilters` shared by destinations and park pins; list selections no longer suppress the fly-to |
| `frontend/src/components/Map.jsx` | Park pins; `MapUpdater` frames linear selections and re-frames on return to the Map tab |
| `frontend/src/utils/anonSettings.js`, `contexts/AuthContext.jsx` | `remapMergedPoiIds` rewrites saved and visited ids on load |
| `data/boundaries/insert_*.sql` | Update-or-insert by name; no delete-and-reinsert, no demotion of same-named points |

### Merge order
Content, coordinates, media (demote the loser's primary before the rows change owner), collision-safe repoints (favorites, visits, associations), plain repoints, JSONB stop references and the collection deny list, `osm_id`, then retire the loser.

### Not done, and why
- The spatial import routes are upserts by name on purpose, so the name guard does not apply to them.
- No `park` icon type: the park keeps the point's name and activities, so its pin resolves to the icon the point had.

## Release 2: Map / Find / Happening

| File | Change |
|---|---|
| `frontend/src/App.jsx` | Tab ids `view`, `find`, `happening`; `parseTabPath()` reads tab URLs and redirects `/results`, `/news`, `/events`; `handleTabChange` keeps the selection; the three tabs render in the header on a wide screen and in a bottom bar on a phone; About moves to the account menu |
| `frontend/src/components/FindTab.jsx` | Replaces `ResultsTab`: every POI, the shared search, a list picker, type chips behind Filters |
| `frontend/src/components/HappeningTab.jsx` | News / Events toggle around `ParkNews` and `ParkEvents`, which lose the viewport scoping and the mini map |
| `frontend/src/components/FilterSheet.jsx` | The collapsed Filters menu: popover on a wide screen, bottom sheet on a phone |
| `frontend/src/utils/poiRank.js`, `parkContainment.js` | Search ranking; "in <park>" by point-in-polygon in the browser |
| `frontend/src/components/Sidebar.jsx`, `App.css` | Half-height place card on a phone with an expand control; never over the tab bar |
| `frontend/src/utils/mapFrame.js`, `Map.jsx` | A selection is framed in the part of the map the card leaves showing |
| `frontend/src/hooks/useIsMobile.js` | One breakpoint (768px) shared with the CSS |
| `backend/server.js` | `find`, `happening`, `organizations` reserved from POI slugs; default list renamed |
| Removed | `ResultsTab.jsx`, `MapThumbnail.jsx`, `mapState`, `bypassViewportFilter` |

### Decisions
- One DOM copy of the tabs, placed by `useIsMobile`, so selectors like `[data-nav="find"]` match once.
- The stored list config still names its first entry for the old Results tab; `FindTab` relabels it "All places" and routes it to `/find` rather than migrating a setting.
- The swipe-between-places list stays scoped to the map view. A place picked in Find may be outside it; the card then shows no position counter.

## Testing
- `backend/tests/poiMergeService.integration.test.js`: merge, dry run, refusals, candidates, name guard, merged-id and permalink resolution, against PostGIS with its own fixtures.
- `backend/tests/poiRoles.unit.test.js`; frontend `poiKind`, `mapFrame` and `anonSettings` unit tests.
- `backend/tests/findAndNavigate.integration.test.js`: the issue's steps at 390px wide with its own park, trail and restroom.
- Frontend `poiRank` and `parkContainment` unit tests; `filterIconsMatch`, `ui`, `rovingTabindex`, `accessibility` and `issue63Regression` updated for the new tabs.
- Manual: select a park from Find and confirm the outline is framed and Directions opens at the lot.

## Rollout
1. Deploy release 1.
2. `poi_merge_candidates`, review, `poi_merge` with `dry_run`, then for real, pair by pair.
3. Confirm `poi_search "furnace run"` returns one park.

## Rollback
The code is revertible. A merge is not automatically reversible: the retired row keeps its original content and `merged_into_id`, so a pair can be restored by hand, but repointed rows do not record where they came from.
