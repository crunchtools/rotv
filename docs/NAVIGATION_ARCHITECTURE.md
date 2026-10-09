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
3. Moves media, demoting the point's primary image when the park has one. Photos that exist only in the image server (filed under the old POI id, with no `poi_media` row) get a `poi_media` row on the park, since the image server cannot refile an asset.
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
- A selected trail, river or boundary is framed with `frameBounds` (`frontend/src/utils/mapFrame.js`) unless it is already on screen at a readable size (a park that is a speck on a region-wide view is zoomed to). Tapping a line or outline on the map itself selects it without moving the map, so a long trail does not zoom out from under the tap.
- Returning to the Map tab with something selected puts it in view. With nothing selected the map is left alone.

Moves made by the app set `map._isProgrammaticMove` so the visible-POI list is not recomputed mid-animation.

On a phone the place card covers the lower part of the map, so the selection is framed (or a point centered) in the part still showing: `cardCoverPx()` and `centerAboveCard()` in `Map.jsx`, `coveredBottom` in `frameBounds`.

## Tabs and routes

Three primary tabs, each a word and an icon (`NAV_TABS` in `frontend/src/App.jsx`):

| Tab | id | URL | What it is |
|---|---|---|---|
| Map | `view` | `/`, `/<poi-slug>` | The map and the place card |
| Find | `find` | `/find`, `/mtb-trail-status`, `/organizations` | A directory of every place (`FindTab.jsx`) |
| Happening | `happening` | `/happening`, `/happening/events` | News and events (`HappeningTab.jsx`) |

Settings and About are tabs too (`settings`, `about`) but are reached from the account menu. `/results`, `/news` and `/events` redirect in the browser to `/find`, `/happening` and `/happening/events`; `parseTabPath()` owns the mapping. The server keeps tab paths out of POI slugs with `OG_RESERVED_PATHS` in `backend/server.js`; a new top-level path must be added in both places.

On a wide screen the tabs sit in the header. At 768px and below (`useIsMobile`, same breakpoint as the CSS) they render in a bar fixed to the bottom of the screen, and the header shrinks to one row. `--bottom-nav-height` offsets everything that reaches the bottom: the map, the full-page tabs, the legend, the trip builder.

## Selection across tabs

- The place card renders only on the Map tab. Away from it the selection stays in state and the card is hidden (`.main-content-behind`).
- Picking a place anywhere (Find, a news or event card, My Valley, a permalink) switches to the Map tab, which frames it.
- Leaving the Map tab hands the URL and page title to the tab. Coming back restores the selection's URL, including an MTB or organization path (`selectionPathRef`).
- Closing the card is the only thing that clears the selection, apart from navigating to `/`.

## Find

- Lists every POI whatever the map shows. No query: alphabetical. With a query: `rankPois()` (`frontend/src/utils/poiRank.js`) puts an exact name first, then parks, destinations and organizations, trails and rivers, and amenities (restrooms, playgrounds, parking) last; a name that starts with the query beats one that contains it.
- The search box is the same value as the map legend's search (`activeFilters.search`).
- Each row names the park it is in. `buildParkIndex()` and `findContainingPark()` (`frontend/src/utils/parkContainment.js`) do point-in-polygon against the park outlines already loaded; a trail uses its first point and the smallest containing park wins. Nothing is stored and the API is unchanged.
- The list picker switches between All places, MTB Trail Status and Organizations, from `/api/results-subtabs`. Seasonal lists (#711) will be more entries here.
- Type chips sit behind a `Filters · n` button (`FilterSheet.jsx`), where n is the number of types hidden. News and Events use the same component.

## The place card on a phone

`Sidebar.jsx` adds `peek` or `expanded` on a phone. The card opens at `peek`: about 46% of the map area, above the tab bar. At `peek` it is a summary and does not scroll: the photos shrink to one thumbnail in the header (`Mosaic` with `compact`, which still opens the gallery) and the tabs sit directly under it. Dragging the card up, or the chevron in its header, expands it to cover the header but never the tab bar; dragging the expanded card down from the top of its content, or from its header, brings it back. Editing, creating a POI, and links straight to an article or sub-tab open it expanded.
