# Spec 050: Curated lists, starting with the Fall Hiking Spree

## Why
Summit Metro Parks runs its Fall Hiking Spree every September through November: thirteen named trails, hike any eight. A visitor doing the spree wants those thirteen trails in one place, and for each one, directions to the lot the hike starts from (#711). ROTV had eight of the trails, none of the trailheads, and no way to say "these places belong together this season".

## User stories
- As a hiker, in the fall I pick Fall Hiking Spree in Find and see this year's trails in the park district's order, with each one's length and rating.
- As a hiker, I tap a spree trail and Navigate takes me to the lot that hike starts from, not to an arbitrary end of the trail.
- As a visitor outside the season, I do not see a list I cannot use.
- As an admin, next year's spree shows up for my approval without anyone retyping it (release 2).

## Behavior

### Lists (release 1)
- A list is one edition of a series: the 2026 Fall Hiking Spree is series `fall-hiking-spree`, edition 2026. Next year's is a new list, so a draft for the coming season can sit beside the published one.
- A list has a season (`starts_on` to `ends_on`) and a status. It is shown only while it is published and today, in the valley's time zone, is inside the season.
- An item is a POI plus what the organizer says about it: the name they use, miles, rating, trail class, a note, the trailhead in words, and the trailhead's coordinates. An item may point at a trail that is much longer than the hike (the Towpath from Wilbeth Road) or one that spans two parks (Parcours).
- An item whose POI has been deleted is left out. Merging a POI moves its list items to the survivor.

### Find (release 1)
- A list in season is an entry in the Find tab's list picker, after the built-in ones, at `/find/<series>`.
- The list shows its description, the goal ("Hike any 8 of 13"), the season and a link to the organizer's page, then its items in the organizer's order. Search narrows the list by the POI's name or the organizer's name for it. Type filters do not apply.
- Each row shows the organizer's name for the hike, the park it is in, `miles · rating · class`, the note, and where to park.
- Picking a row selects the POI on the map as any Find row does. Navigate and Add to trip use the item's trailhead.
- `/find/<series>` for a list that is out of season, or does not exist, shows All places.

### The 2026 spree (release 1)
- Wood Hollow Metro Park and five trails (Black Bear, Chippewa, Downy Loop, Firefly, Willow) are added from Summit Metro Parks' public ArcGIS layers, "SMP Park Boundaries" and "SMP Trails by Name".
- The thirteen items, their miles, ratings and classes are from the district's 2026 Fall Hiking Spree form. Each trailhead is the parking lot nearest the trail at the address the form prints.

### Yearly refresh (release 2)
- Each August a job reads the district's spree page and form, matches each trail to a POI, and saves next season's list as a draft.
- The admin is notified, sees the draft with anything that did not match, fixes it and publishes. Nothing reaches visitors unapproved.

## API
| Route | Change |
|---|---|
| `GET /api/lists` | New, public. Lists in season: `{ slug, edition, name, description, goal_count, source_url, starts_on, ends_on, items[] }`. |

## Data
`poi_lists` and `poi_list_items`, in migration 101 and in `initDatabase` (a fresh database runs migrations before `pois` exists). The migration also adds the six POIs and seeds the 2026 list, each only once.

## Out of scope
- Checking hikes off against the visited list ("5 of 8 hiked").
- Showing only a list's places on the map.
- An admin screen for editing lists by hand; release 2 brings the review screen.
