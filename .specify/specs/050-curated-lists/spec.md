# Spec 050: Seasonal challenges, starting with the Fall Hiking Spree

## Why
Summit Metro Parks runs its Fall Hiking Spree every September through November: thirteen named trails, hike any eight, date each one, earn the hiking staff and shield. A visitor doing the spree wants those trails in one place, directions to the lot each hike starts from, and a tally they can check off as they go and keep from year to year (#711). ROTV had eight of the trails, none of the trailheads, and no way to say "these places belong together this season" or "I did this one".

## User stories
- As a hiker, in the fall the spree is put in front of me on the map and in Find, and I open this year's trails in the park district's order, with each one's length and rating.
- As a hiker, I tap a spree trail and Navigate takes me to the lot that hike starts from, not to an arbitrary end of the trail.
- As a hiker, I mark a trail hiked in one tap, correct the date if I logged it late, and see how many I have left and how many days remain.
- As a hiker, I use my Hiker's Choice on any trail I like, once.
- As a hiker, I earn the year's badge when I reach the goal, and I can still see it, and the hikes behind it, in later years.
- As a hiker who has not signed in, my hikes stay on my phone and move to my account when I sign in.
- As a visitor outside the season, I am not offered a list I cannot use.
- As an admin, next year's spree shows up for my approval without anyone retyping it (release 2).

## Rules
These are the spree's, held as data on the list so another program can differ.

| Rule | Where it lives |
|---|---|
| The season runs September 1 through November 30 | `starts_on`, `ends_on` |
| Hike at least eight different designated trails | `goal_count`; one check-in per item |
| One hike may be a trail of the hiker's own choosing | `choice_label`, `choice_description`; one check-in with no item |
| Date each hike; it must fall inside the season | check-in `done_on`, refused outside the season or in the future |
| Rewards, who pays, where and until when to collect them | `rewards`, `rewards_until`, `form_url` |
| The program is promoted while it runs | `featured` |

ROTV keeps the tally and awards its own badge. The staff and shield are the park district's, awarded from its form; the list says so and links the form.

## Behavior

### Lists
- A list is one edition of a series: the 2026 Fall Hiking Spree is series `fall-hiking-spree`, edition 2026. Next year's is a new list, so a draft for the coming season can sit beside the published one, and last year's stays for the badges earned on it.
- A list is offered only while it is published and today, in the valley's time zone, is inside the season.
- An item is a POI plus what the organizer says about it: the name they use, miles, rating, trail class, a note, the trailhead in words, and the trailhead's coordinates. An item may point at a trail much longer than the hike (the Towpath from Wilbeth Road) or one that spans two parks (Parcours).
- An item whose POI has been deleted is left out. Merging a POI moves its list items and check-ins to the survivor.

### Check-ins
- A check-in is one dated hike: a list item, or the list's free choice with the trail chosen. A person has at most one per item and one free choice per list.
- Marking a hike logs today's date, or the season's last day once the season has ended. The date then shows beside the button and can be set to any day inside the season up to today. Tapping the checked button removes the hike.
- A hike cannot be logged before the season opens. After it ends, hikes from the season can still be filled in.
- Progress is the number of check-ins against the goal. The badge is earned when the goal is reached, on the date of the hike that reached it. Hikes past the goal still count toward the total shown.
- Check-ins are local-first (`docs/USER_DATA_FRAMEWORK.md`): on the device when signed out, on the account when signed in, folded into the account on sign-in. The account's date wins over the device's, and a check-in the rules refuse is dropped.
- Check-ins are never removed at the end of a season. Deleting the account deletes them.

### Seasonal spotlight
- While a featured list is in season, the map shows a pill with its name and the person's tally, and Find's All places shows a card. Both open the list.
- The pill can be dismissed; it stays dismissed for that edition on that device. The card and the list picker entry stay.

### Find
- A list in season is an entry in the Find tab's list picker, after the built-in ones. The spree lives at `/fall-hiking-spree`; a list without an address of its own lives at `/find/<series>`, and `/find/fall-hiking-spree` redirects.
- The list opens with its description, the badge, the tally with a progress bar, what is left and how many days remain, the free choice, and a "How it works" section with the rules and rewards. Its items follow in the organizer's order, and can be sorted by trail name or by park. Search narrows them by the POI's name or the organizer's name for it. Type filters do not apply.
- Each row shows the organizer's name for the hike, the park it is in, `miles · rating · class`, the note, where to park, a Navigate button to that hike's trailhead, and the check-in button with its date.
- Picking a row selects the POI on the map as any Find row does. Navigate and Add to trip use the item's trailhead. The place card of a POI on a list in season carries the same check-in button.
- A list's address, when the list is out of season or does not exist, shows All places.

### My Valley
- A Badges tab lists every list the person has a check-in on, plus those in season: the badge, the tally or the date earned, the dated hikes, and which year of the series this is for them.

### The 2026 spree
- Wood Hollow Metro Park and five trails (Black Bear, Chippewa, Downy Loop, Firefly, Willow) are added from Summit Metro Parks' public ArcGIS layers, "SMP Park Boundaries" and "SMP Trails by Name".
- The thirteen items, their miles, ratings and classes, the Hiker's Choice and the rewards are from the district's 2026 Fall Hiking Spree form. Each trailhead is the parking lot nearest the trail at the address the form prints.

### Yearly refresh (release 2)
- Each August a job reads the district's spree page and form, matches each trail to a POI, and saves next season's list as a draft.
- The admin is notified, sees the draft with anything that did not match, fixes it and publishes. Nothing reaches visitors unapproved.

## API
| Route | Change |
|---|---|
| `GET /api/lists` | New, public. Lists in season, each with its rules and `items[]`. |
| `GET /api/lists?ids=` | New, public. Those published lists whatever the season, for earlier years' badges. |
| `PUT /api/lists/:listId/checkins` | New, signed in. `{ item_id, poi_id, done_on }`; `item_id` null is the free choice. Answers with the stored check-in. 400 `{ error }` for a list id that is not a number or a check-in the rules refuse (the reason is the message); 404 for a list that does not exist or is not published; 401 signed out. |
| `DELETE /api/lists/:listId/checkins/:itemId` | New, signed in. `:itemId` is an item id or `choice`. 400 when either id is neither; removing a check-in that is not there succeeds; 401 signed out. |
| `GET /auth/user` | Adds `listCheckins`. |
| `POST /api/user/settings/sync` | Accepts `listCheckins` from the device. |

## Data
`poi_lists`, `poi_list_items` and `user_list_checkins`, in migration 101 and in `initDatabase` (a fresh database runs migrations before `pois` exists). The migration also adds the six POIs and seeds the 2026 list, each only once.

## Out of scope
- Showing only a list's places on the map.
- Requiring the free choice to be one of the organizer's trails: many of the district's trails carry no owner, so the list states the rule and takes any trail.
- An admin screen for editing lists by hand; release 2 brings the review screen.
