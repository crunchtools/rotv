# Analytics Architecture (#637)

## Introduction: How It Works

ROTV counts visitors and records which features they use with [Umami](https://github.com/umami-software/umami),
a self-hosted, cookieless analytics server. Umami runs inside the ROTV container
and keeps its data in the container's PostgreSQL. Express proxies it at `/stats`,
so the tracker script, the collection endpoint and the dashboard are all first-party
on rootsofthevalley.org. No third-party request is made, and no cookie is set.

```
browser ──/stats/script.js, /stats/api/send (public)──┐
admin   ──/stats/share/rotv, /stats/api/* (isAdmin)───┤
                                                      ▼
                           Express statsProxy (backend/services/analyticsService.js)
                                                      ▼
                           umami.service  127.0.0.1:3000, BASE_PATH=/stats
                                                      ▼
                           PostgreSQL 17, database "umami" (Prisma migrations owned by Umami)
```

## Build

Umami is built in a stage of `Containerfile.base` from the pinned upstream tag
(`UMAMI_VERSION`, currently 3.4.0). The stage uses the same ubi10-core userland
as the runtime, and mirrors upstream's Dockerfile builder and runner stages.
`BASE_PATH=/stats` is baked into the Next.js build. The output lands in `/opt/umami`
of `rotv-base`, so ordinary app builds never rebuild it. Upgrading Umami means
changing the ARGs in `Containerfile.base`. Merging that change triggers
`build-base.yml`, and its `rotv-base-updated` dispatch then rebuilds the app.

Local builds from plain `ubi10-core` have no `/opt/umami`.
`umami.service` has `ConditionPathExists=/opt/umami/server.js` and simply
doesn't start in that case, `/api/analytics/config` returns `websiteId: null`,
and the frontend never loads the tracker.

## Runtime

| Piece | Where |
|---|---|
| Database | `rotv-init.sh` creates `umami`. `umami-start.sh` builds `DATABASE_URL` from the backend's `PG*` variables, runs Umami's `check-db.js` (its own Prisma migrations), then the server. Without `PGPASSWORD` it exits cleanly and analytics stays off |
| Service | `rootfs/etc/systemd/system/umami.service` |
| Bootstrap | `rootfs/usr/local/bin/umami-setup.mjs` (ExecStartPost, idempotent): rotates the default `admin/umami` login to `UMAMI_ADMIN_PASSWORD` (or to a random throwaway when unset, so the default never stays live), creates the website with the fixed id `804a81bc-5731-4028-bd22-2aa2f2b159c2` and share slug `rotv` |
| Secrets | `PGPASSWORD`, `APP_SECRET`, `UMAMI_ADMIN_PASSWORD` in `/etc/rotv/environment`. The MCP tools need `UMAMI_ADMIN_PASSWORD` |
| Backups | `backupService.js` dumps `umami` next to every ROTV backup (`umami-backup-*.sql`); only `rotv-backup-*` files are offered for restore |

Retention: keep everything (Scott, 2026-09-29). Nothing prunes Umami data.

## Access

`statsProxy` matches exact paths. `/stats/script.js` and `/stats/api/send` are public.
Every other `/stats` path requires a ROTV admin session (`isAdmin`). The
ROTV session cookie is stripped before a request reaches Umami. `/stats` is exempt
from the JSON body parser so request bodies stream through untouched.

Admins see the dashboard in **Settings → Stats**. That tab embeds Umami's read-only
share page (`/stats/share/rotv`), which needs no second login. The full Umami UI
at `/stats/login` needs the Umami admin password.

The admin MCP server exposes `stats_summary` (totals, a daily series and tracker
use) and `stats_top` (top events, paths, referrers, countries, devices, or the
values of any event property).

## Privacy

- No cookies, and nothing written to a visitor's device. The one exception is admins:
  signing in as an admin sets Umami's own `umami.disabled` flag in localStorage, so
  that browser's traffic is never counted, even after logout.
- The IP address is not stored. Sessions are an anonymous hash of IP, user agent
  and a salt that rotates monthly (`SALT_ROTATION` default), which is enough to
  count returning visitors within a month.
- Country, region and city come from the bundled GeoLite2 database.
- Search text is recorded in full, up to Umami's 500-character column (Scott,
  2026-09-29). It's the best signal for POIs we're missing.
- Admin-only; no public stats.

## Events

`frontend/src/utils/analytics.js` provides `track(name, props)`. It queues events
until the tracker loads, and does nothing if the tracker never loads (tests, ad
blockers, local builds). Umami records pageviews on its own, including SPA route
changes via `history.pushState`/`replaceState`.

| Event | Properties | Fired from |
|---|---|---|
| `tracker_click` | `vehicle` (train, water_taxi), `status` (Live, Idle, Parked, Docked, Offline) | train/boat marker click, `Map.jsx` |
| `tracker_route_open` | `vehicle`, `source` | any selection of the railroad or water-taxi POI, `App.jsx` |
| `tracker_stop_click` | `vehicle`, `stop` | water-taxi stop list, `Sidebar.jsx` |
| `tracker_served_by_click` | `vehicle`, `from_poi` | "Water Taxi" link on a stop, `Sidebar.jsx` |
| `layer_toggle` | `layer`, `on` | legend POI types (including `train`) and the water-taxi layer |
| `poi_view` | `poi_id`, `name`, `kind`, `source` (map, results, news, events, sidebar, nav, link, other) | selection effect, `App.jsx` |
| `tab_view` / `sidebar_tab_view` | `tab` (+ `poi_id`, `vehicle`) | main tabs / sidebar tabs |
| `search`, `search_no_results` | `query`, `result_count` | legend search, 1.5 s after typing stops |
| `news_open`, `event_open`, `event_calendar_add` | ids, `poi` | outbound links on news/event cards |
| `media_view` | `poi_id`, `count` | lightbox open |
| `trip_save`, `trip_view` | `new_trip`, `stops`, `signed_in` / `slug` | `TripContext.jsx` |
| `tour_start`, `tour_step`, `tour_end` | `variant`, `step` / `last_step` | guided tour |
| `newsletter_subscribe`, `login` | `signed_in` / `provider` | `UserSettings.jsx`, `AuthContext.jsx` |
| `share_link_click`, `directions_click` | `url`, `method` / `stops` | `ShareButton.jsx`, `NavigateButton.jsx` |
