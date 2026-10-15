# Spec 052: Next season's spree, drafted from the district's data

## Why
Spec 050 left release 2 open: the Fall Hiking Spree is a new list every year, and nobody should retype it (#711, #778). Summit Metro Parks already publishes the trails of each year's spree in its public layer "SMP Trails by Name - Hiking Programs", one column per program and year (`FHS_2026`), with an entry per trail such as "Nuthatch Trail (Sand Run Metro Park, 3.3 miles, difficult)".

## User stories
- As an admin, next year's spree shows up as a draft for my approval, and I get an email saying so.
- As an admin, I see what the draft could not work out (trails it could not match, trails new since last year, changed lengths or ratings, missing trailheads) and fix each one in place.
- As a visitor, I never see a list nobody has approved.

## Behavior
- Each Monday in August at 06:30 (America/New_York), and from Settings › Seasonal Lists › "Check for the <year> spree", the year's spree is looked for. It does nothing when that year already has a list, or the layer has no `FHS_<year>` column yet.
- Each entry is read as the trail's name, an optional section ("Towpath Trail - Between Wilbeth Road Trailhead & Summit Lake Nature Center"), the park, the miles and the difficulty, in the form's words (difficult is Strenuous).
- Each entry is matched to a trail on the map: by the district's name for it, then the entry's own; between two of a name, the one on last year's list; with none, the trail last year's item of that name was on ("Towpath Trail" is last year's "Towpath Trail from Wilbeth Road"). An entry that matches nothing is reported, with any candidates.
- The draft carries last year's rules (goal, Hiker's Choice, rewards text, organizer, banner credit), the season and reward dates moved on a year, the description's "63rd annual" counted on, and the form link with the year changed. It carries no form file, form layout or banner picture: a new year's form needs a new layout (spec 050), and the download button stays hidden until it has one.
- A trail on last year's list keeps its organizer name, note, trailhead, trail class and section line; the year's miles and difficulty come from the entry. Items are in the form's order: the trail outside any park first, then by park.
- `poi_lists.refresh_report` records the source, what matched nothing, what could not be read, trails new and dropped, changed miles and ratings, items still missing a trailhead, class or section, and a to-do list.
- The admin is mailed at `ADMIN_EMAIL` when a draft is made. Without outbound mail, the draft is logged and waits in Settings.
- In Settings › Seasonal Lists a draft shows its report, each unmatched entry with a trail picker and "Add to the list", every item's fields with Save and "Remove from the list", and a green "Publish the <year> spree". A published list shows its dates and count only.

## API
| Route | |
|---|---|
| `GET /api/admin/lists` | Admin. Up to 20 lists, drafts first, each with its items and report. |
| `GET /api/admin/lists/trails` | Admin. Every live trail's id and name, for the picker. |
| `POST /api/admin/lists/refresh` | Admin. `{ edition? }`, a year within five of this one. Answers `{ status: 'exists' \| 'not-published-yet' \| 'no-earlier-list' \| 'created', listId?, report? }`; 502 when the layer cannot be read. |
| `POST /api/admin/lists/:listId/items` | Admin, drafts only. `{ poi_id, label?, ..., entry? }`; `entry` clears that unmatched entry from the report. |
| `PUT /api/admin/lists/:listId/items/:itemId` | Admin, drafts only. Any of label, note, miles, rating, trail_class, trailhead, nav_latitude, nav_longitude, poi_id. |
| `DELETE /api/admin/lists/:listId/items/:itemId` | Admin, drafts only. |
| `POST /api/admin/lists/:listId/publish` | Admin, drafts with at least one trail. A published list is 409 to all of these. |

## Data
`poi_lists.refresh_report JSONB`, in migration 105 and `initDatabase`.

## Out of scope
- Reading the district's PDF form, its layout or its banner picture; an admin adds those.
- Programs other than the Fall Hiking Spree (the layer also carries Spree For All, `SFA_<year>`).
