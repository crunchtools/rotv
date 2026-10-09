# Places and Navigation Architecture

How a place is modeled, how the map follows what is selected, and how duplicate places are merged. Spec: `.specify/specs/048-find-and-navigation/`.

## One place, one POI

Every place is one row in `pois`. What kind of place it is comes from `poi_roles`:

| Kind | Roles | Drawn as |
|---|---|---|
| Destination | `point` | Pin |
| Park | `boundary` with `boundary_type = 'park'` | Pin (when it has coordinates) and an outline when selected |
| Trail, river | `trail`, `river` | Line |
| Town, county, state | `boundary`, other `boundary_type` | Outline, toggled from the legend |
| Organization | `organization` | No geometry |

A park is never a boundary plus a point. A park with no polygon stays a `point`.

Code that asks "is this a place people visit" must not test for `point` alone. In JavaScript use `isCollectiblePoi` (`backend/utils/poiRoles.js`); in SQL add `OR ('boundary' = ANY(poi_roles) AND boundary_type = 'park')`. That is what keeps a park collected for news and events and counted in visited totals. On the frontend, `isParkPin` (`frontend/src/utils/poiKind.js`) decides which parks get a marker.

A park has two coordinate pairs. `latitude/longitude` place the pin. `navigation_latitude/longitude` are where Directions sends you; a boundary only gets a Directions button when that pair is set (`getNavigationStops` in `frontend/src/components/sidebar/helpers.js`).

## Names

Two live POIs may not answer to the same name. `assertPoiNameAvailable` (`backend/services/poiMergeService.js`) compares names without case, apostrophe style or a trailing county (`normalizePoiName` in JavaScript, the `poi_name_key()` function in SQL), and the admin create and update routes and MCP `poi_create` return 409 on a clash. An edit that leaves the name alone always passes, so a duplicate that predates the rule can still be edited.

The spatial import routes upsert by name on purpose and are not guarded.

## Merging a duplicate

`mergePois(pool, loserId, winnerId, { dryRun })` folds a point POI into a park boundary in one transaction:

1. Copies content onto the park where the park has none; defaulted columns take the point's value.
2. Sets the park's coordinates and navigation coordinates from the point.
3. Moves media, demoting the point's primary image when the park has one.
4. Repoints news, events, series, trail status, trip stops, favorites, visits, associations, owned POIs, route stops and the collection deny list.
5. Soft-deletes the point, sets `merged_into_id`, and suffixes its name with `[merged into #id]`.

A dry run performs the whole merge and rolls it back, so its counts are exact.

Run it through the admin MCP server: `poi_merge_candidates` lists parks that have a same-named point within a kilometer; `poi_merge` takes one pair and defaults to a dry run.

The hand-run imports in `data/boundaries/insert_*.sql` update a park's outline in place. Never delete and re-insert a park row: the delete cascades to its news, events, photos and favorites.

## Following a merge

| Holder of the old id | How it follows |
|---|---|
| Saved and visited lists on a device | `remapMergedPoiIds()` rewrites them on load from `GET /api/pois/merged` |
| Login sync | `syncPoiIdList` stores the survivor |
| Old permalink (`/old-slug`, `/?poi=old-slug`) | 301 to the survivor's permalink |

## The map follows the selection

`MapUpdater` in `frontend/src/components/Map.jsx`:

- A selected point flies to at least zoom 15.
- A selected trail, river or boundary is framed with `frameBounds` (`frontend/src/utils/mapFrame.js`) unless all of it is already in view. Tapping a line or outline on the map itself selects it without moving the map, so a long trail does not zoom out from under the tap.
- Returning to the Map tab with something selected puts it in view. With nothing selected the map is left alone.

Moves made by the app set `map._isProgrammaticMove` so the visible-POI list is not recomputed mid-animation.
