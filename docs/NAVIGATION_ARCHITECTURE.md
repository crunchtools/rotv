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
| Find | `find` | `/find`, `/fall-hiking-spree`, `/find/<list>`, `/mtb-trail-status`, `/organizations` | A directory of every place (`FindTab.jsx`) |
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
- The list picker switches between All places, MTB Trail Status and Organizations, from `/api/results-subtabs`, followed by any curated list in season (below).
- Type chips sit behind a `Filters · n` button (`FilterSheet.jsx`), where n is the number of types hidden. News and Events use the same component.

## Curated lists and challenges

A curated list is a set of places an organizer names for a season, with the rules for completing it: the Summit Metro Parks Fall Hiking Spree (spec 050). `poi_lists` holds one row per edition of a series (`fall-hiking-spree`, 2026) with its season, goal, free choice and rewards; `poi_list_items` holds a POI plus what the organizer says about it; `user_list_checkins` holds one dated hike a person logged.

- `GET /api/lists` (`backend/routes/lists.js`, `backend/services/poiListService.js`) returns the lists that are published and in season today, in Eastern time. `?ids=` returns published lists whatever the season, which is how an earlier year's badge finds its list.
- The rules live in two places that must agree: `checkinProblem()` on the server decides what is stored, and `frontend/src/utils/listProgress.js` decides what the buttons offer and when the badge is earned. A hike is dated inside the season and not in the future; one per item; one free choice.
- Check-ins follow the local-first recipe in `docs/USER_DATA_FRAMEWORK.md`: `rotv-list-checkins` in localStorage, `listCheckins` in `AuthContext` and `/auth/user`, `syncCheckins()` on sign-in.
- Find adds each list to its picker (`parseTabPath` returns `list`). A list named in `LIST_PATHS` (`frontend/src/utils/tabPaths.js`) has a top-level address, `/fall-hiking-spree`, which must also be in `OG_RESERVED_PATHS`; any other list is at `/find/<series>`. `listPath()` gives the right one. `ListChallenge` is the header (banner, tally, badge, rules). Rows come from `curatedListRows`, plus one `choiceRow` for the free choice (`choiceCandidates` narrows the menu, `suggestChoice` fills it before the person picks), sorted by `sortListRows`; each carries a Navigate button and a `ListCheckinControl`.
- A row hands the map the POI with the item's trailhead copied onto `navigation_latitude/longitude`, so Navigate goes to the lot for that hike even when the POI is a 100-mile trail. The copy lives only on the selected object; the POI row is untouched.
- Download completed form (`frontend/src/utils/listForm.js`) writes the person's hike dates, free choice, name and email onto the organizer's own PDF in the browser. The PDF is `form_file` (kept in `frontend/public/lists/`) and `form_layout` says where each answer goes; both are per edition.
- `SeasonalFeature` is the spotlight for a `featured` list in season: a pill over the map, dismissed per edition, and a card in Find. `ListBadges` is My Valley's Badges tab.
- `mergePois` repoints `poi_list_items` and `user_list_checkins`. A deleted POI's item is left out of the response.
- A new edition is a new `poi_lists` row and its items; migration 101 seeds 2026 and shows the shape. Earlier editions are never deleted: people's badges hang off them.

## The place card on a phone

`Sidebar.jsx` adds `peek` or `expanded` on a phone. The card opens at `peek`: about 46% of the map area, above the tab bar. At `peek` it is a summary and does not scroll: the photos shrink to one thumbnail in the header (`Mosaic` with `compact`, which still opens the gallery) and the tabs sit directly under it. Dragging the card up, or the chevron in its header, expands it to cover the header but never the tab bar; dragging the expanded card down from the top of its content, or from its header, brings it back, and one more drag down on the `peek` card closes it. Editing, creating a POI, and links straight to an article or sub-tab open it expanded.

## Labels and actions on the Info tab

`ReadOnlyView.jsx` opens with two rows. `.poi-tags` says what the place is (type, era, owner, status): small grey rectangles, never tappable, with colour kept for live status only. `.poi-actions` is everything you can do: bordered pills with an icon, in the order Navigate, Share, Favorite, More info, Live tracker, Add to trip, Mark visited. Navigate is the only filled button. At `peek` the card hides Add to trip and Mark visited. Links inside the text, such as a trail status Source, are underlined `.link-button`s.

## The trip bar

`TripBuilder.jsx` renders whenever the trip in progress (`TripContext.jsx`) has a stop. On a phone it is a bar docked on the tab bar, on the tab bar's layer, so it shows over the full-height place card and on every tab; tapping it opens it upward into a sheet with the stops. `App.jsx` puts `has-trip` on `.app`, which sets `--trip-bar-height`, and everything that reaches the bottom of the screen (`.main-content`, the expanded card, the legend) ends above the bar instead of under it. On a desktop the same component floats over the bottom of the map. Its buttons are the place card's `.poi-action`s, with Navigate the one filled button.
