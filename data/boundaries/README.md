# Municipal Boundary Data

This directory contains GeoJSON boundary data for Akron and Cuyahoga Falls, Ohio.

## Files

- `akron.geojson` - Akron city boundary (1,605 coordinate points)
- `cuyahoga_falls.geojson` - Cuyahoga Falls city boundary (5 polygons, MultiPolygon)
- `insert_boundaries.sql` - SQL script to insert both boundaries into the database

## Data Source

- **Source:** OpenStreetMap via Nominatim API
- **License:** ODbL 1.0 (http://osm.org/copyright)
- **Retrieved:** February 4, 2026
- **OSM Relation IDs:**
  - Akron: 182644
  - Cuyahoga Falls: 182643

## Usage

### Local Development

```bash
./run.sh start
podman cp data/boundaries/insert_boundaries.sql rotv:/tmp/
podman exec rotv psql -U postgres -d rotv -f /tmp/insert_boundaries.sql
```

### Production Upload

See options below for uploading to production database.

## Database Structure

Boundaries are stored in the `pois` table with:
- `poi_type`: 'boundary'
- `geometry`: JSONB field containing GeoJSON Polygon or MultiPolygon
- `name`: Municipality name

## Total Boundaries

After adding Akron and Cuyahoga Falls, there are 11 municipal boundaries:
1. Akron (NEW)
2. Bedford
3. Brecksville
4. Cleveland
5. Cuyahoga Falls (NEW)
6. Cuyahoga Heights
7. Cuyahoga Valley National Park
8. Independence
9. Newburgh Heights
10. Valley View
11. Walton Hills

## Boundary Colors

Each municipality has a unique color for visual distinction on the map:

| Municipality | Color Code | Color Name |
|--------------|------------|------------|
| **Akron** | `#9370DB` | Medium Purple |
| Bedford | `#8B008B` | Dark Magenta |
| Brecksville | `#FF8C00` | Dark Orange |
| Cleveland | `#000080` | Navy |
| **Cuyahoga Falls** | `#20B2AA` | Light Sea Green |
| Cuyahoga Heights | `#8B4513` | Saddle Brown |
| Cuyahoga Valley National Park | `#228B22` | Forest Green |
| Independence | `#DC143C` | Crimson |
| Newburgh Heights | `#2F4F4F` | Dark Slate Gray |
| Valley View | `#4682B4` | Steel Blue |
| Walton Hills | `#8B4513` | Saddle Brown |

### Update Boundary Colors

To update the colors for Akron and Cuyahoga Falls:

```bash
podman exec rotv psql -U postgres -d rotv -f /tmp/update_colors.sql
```

Or on production:

```bash
ssh -p 22422 root@sven.dc3.crunchtools.com \
  "podman cp update_colors.sql rootsofthevalley.org:/tmp/ && \
   podman exec rootsofthevalley.org psql -U rotv rotv -f /tmp/update_colors.sql"
```
