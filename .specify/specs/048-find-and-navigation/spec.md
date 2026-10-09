# Spec 048: Find a place and get to it

## Why
Searching ROTV for Furnace Run Metro Park on a phone returned several look-alike rows, the map would not show which was which, and the visitor ended up at Furnace Run Trail by way of Google (#712). Three causes:

- **Duplicate parks.** Production held a content-less boundary POI and a separate point POI for the same park, sometimes under the same name, sometimes with a county suffix.
- **The list fought the user.** Results was scoped to the map viewport, sorted alphabetically, and buried under a chip row and a mini map, with its own search box.
- **The map did not follow the selection.** Picking from Results suppressed the fly-to, outlines were never framed, changing tabs cleared the selection, and on a phone the POI panel covered the navigation.

## User stories
- As a visitor, I type a park's name and see that park once, first, with its description.
- As a visitor, I tap a place in the list and the map shows me exactly that place, outlined if it is a park or trail.
- As a visitor, I can move between the map and the list without losing the place I picked, and the navigation never disappears.
- As a visitor, I get directions to the park's lot from the park itself.
- As a visitor with a place saved on my phone, I still have it after the duplicates are cleaned up.
- As an admin, I cannot create a second POI for a place that already has one.

## Behavior

### One POI per park (release 1)
- A park is a single POI with the `boundary` role and `boundary_type = 'park'`. It carries the description, news, events, photos and coordinates. A park with no polygon stays a point.
- A park boundary is a first-class place: it is collected for news and events and counts toward visited totals, like a point. Municipal, county and state boundaries are not.
- A park with coordinates draws a pin under the same legend and search rules as other markers. Tapping the pin selects the park, draws its outline and frames it.
- Directions on a park use its navigation coordinates, which the merge fills from the old point.
- Names carry no county suffix. Creating or renaming a POI onto a name another live POI answers to is refused with 409. Names compare without case, apostrophe style or a trailing county. Saving a POI without renaming it is never refused.
- Merging is an admin action (MCP `poi_merge_candidates`, `poi_merge`), run pair by pair with a dry run first. The retired point is soft-deleted, renamed with a `[merged into #id]` suffix, and remembers its survivor in `merged_into_id`.
- Anything holding the retired id or permalink follows it: saved and visited ids on a device are rewritten on load, login sync stores the survivor, and the old permalink redirects (301) to the park.

### The map follows the selection (release 1)
- Selecting a trail, river or boundary from anywhere but a tap on its own line brings all of it into view, unless it already is.
- Returning to the Map tab with a place selected puts it in view. With nothing selected the map stays where it was.

### Map / Find / Happening (release 2)
- Three labeled tabs. Map is the map. Find is every POI. Happening is news and events behind a toggle. About moves to the account menu. On a phone the tabs are a bottom bar with labels always visible.
- Find lists all POIs regardless of the map view, with one search shared with the map, a list picker (All places, MTB trail status, Organizations, and later seasonal lists), and a collapsed Filters menu.
- With a query, parks rank first, then destinations, then trails and rivers, then amenities; name-starts-with before name-contains. Each row says what it is and which park it is in.
- The POI card shows only on Map. Selecting a place elsewhere switches to Map. Moving to Find or Happening keeps the selection and hides the card.
- On a phone a selected place opens as a card over the lower part of the map, expandable, never over the bottom bar.
- Mini maps are removed from every tab. News and events are no longer tied to the map view. Their type chips move into the Filters menu.
- Old `/results`, `/news` and `/events` links keep working.

## API
| Route | Change |
|---|---|
| `GET /api/pois/merged?ids=` | New, public. `{ retiredId: liveId }` for ids that were merged. |
| `GET /:slug`, `/?poi=` | A retired POI's slug redirects 301 to the survivor. |
| `POST/PUT /api/admin/pois`, `/destinations`, `/linear-features` | 409 `{ error, existing_id }` on a name another live POI answers to. |
| `POST /api/user/settings/sync` | Favorites and visited ids resolve through `merged_into_id`. |
| MCP | `poi_merge_candidates`, `poi_merge { loser_id, winner_id, dry_run }`; `poi_create` applies the name guard. |

## Data
`pois.merged_into_id INTEGER REFERENCES pois(id)`, added idempotently at boot.

## Out of scope
- Seasonal lists such as the Fall Hiking Spree (#711).
- Rebuilding the unique index on `pois.name`, which cannot build while duplicate names exist.
