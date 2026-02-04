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
