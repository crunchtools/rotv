# 053: POI Live Webcam Link

Issue: #791

## Behavior

- `pois.webcam_url` (`VARCHAR(500)`, nullable) holds a link to a live webcam page.
- The POI list responses (`/api/destinations` and `/api/linear-features`) return it as an optional
  `webcam_url` field: an http(s) URL string, or `null` when the POI has no webcam.
- Admins set it from the POI edit form ("Live Webcam URL") or via `PUT /api/admin/destinations/:id`.
- The sidebar shows a "Live webcam" button (new tab, `rel="noopener noreferrer"`) only when
  `webcam_url` is an http(s) URL. Other schemes are ignored.
- Link-out only: no embed, no CSP changes, no webcam POI type.

## Seed

Migration `110_add_webcam_url.sql` sets `https://liveworldwebcams.com/cuyahoga-river-webcam/` on the
POIs named exactly `Cuyahoga River` and `The Foundry` where `webcam_url` is still NULL.
