/**
 * Geo Service - Shared PostGIS geographic grounding utilities
 *
 * Provides boundary lookup for POIs using PostGIS spatial queries.
 * Used by serperService.js (news/events search) and geminiService.js (AI research)
 * to add geographic context that eliminates location ambiguity.
 */

/**
 * Find all boundary polygons containing a POI, ordered smallest-first.
 *
 * Returns boundary names like ['Hampton Hills Park', 'Summit County', 'Akron, OH']
 * which can be used to build geographically-grounded queries or prompts.
 *
 * @param {Pool} pool - Database connection pool
 * @param {number} poiId - POI id to look up
 * @returns {Promise<string[]>} - Array of boundary names (smallest area first), empty on error
 */
export async function getContainingBoundaries(pool, poiId) {
  try {
    const boundaryQuery = await pool.query(`
      WITH poi_point AS (
        SELECT
          id,
          CASE
            WHEN 'point' = ANY(poi_roles) AND geom IS NOT NULL THEN geom
            WHEN poi_roles && ARRAY['trail','boundary','river']::text[] AND geometry IS NOT NULL THEN
              ST_StartPoint(ST_GeometryN(ST_GeomFromGeoJSON(geometry::text), 1))
            ELSE NULL
          END as point_geom
        FROM pois
        WHERE id = $1
      )
      SELECT boundary.name
      FROM poi_point
      LEFT JOIN pois AS boundary
        ON 'boundary' = ANY(boundary.poi_roles)
        AND boundary.boundary_geom IS NOT NULL
        AND ST_Contains(boundary.boundary_geom, poi_point.point_geom)
      WHERE poi_point.point_geom IS NOT NULL
      ORDER BY ST_Area(boundary.boundary_geom) ASC
    `, [poiId]);
    return boundaryQuery.rows.map(r => r.name).filter(Boolean);
  } catch (err) {
    console.warn(`[Geo] Boundary lookup unavailable for POI ${poiId}: ${err.message}`);
    return [];
  }
}

/**
 * Expand a POI id into the set of POI ids whose news/events should roll up to it.
 *
 * - A normal point POI returns just [id] (no spatial cost, no behavior change).
 * - A boundary POI (e.g. Brecksville Reservation) adds every POI whose location
 *   falls inside its polygon (ST_Contains).
 * - An organization POI (e.g. Cleveland Metroparks) adds the POIs it owns
 *   (owner_id) or is associated with (poi_associations), plus POIs geographically
 *   contained within any park boundary it owns.
 *
 * The result always includes the target id and is de-duplicated. Spatial steps
 * are wrapped so a PostGIS failure degrades to the non-spatial expansion rather
 * than erroring — mirroring getContainingBoundaries' graceful fallback.
 *
 * @param {Pool} pool - Database connection pool
 * @param {number} poiId - POI id to expand
 * @returns {Promise<number[]>} - De-duplicated POI ids (always includes poiId)
 */
export async function getRollupPoiIds(pool, poiId) {
  const id = parseInt(poiId, 10);
  if (!Number.isInteger(id) || id <= 0) return [];
  const ids = new Set([id]);

  let target;
  try {
    const targetQuery = await pool.query(
      `SELECT poi_roles, (boundary_geom IS NOT NULL) AS has_boundary
       FROM pois WHERE id = $1`,
      [id]
    );
    // Fix: non-existent POI rolls up to nothing, consistent with the invalid-input path (PR #424 review)
    if (targetQuery.rows.length === 0) return [];
    target = targetQuery.rows[0];
  } catch (err) {
    console.warn(`[Geo] Rollup target lookup failed for POI ${id}: ${err.message}`);
    return [id];
  }

  const roles = target.poi_roles || [];
  const isOrg = roles.includes('organization');
  const isBoundary = roles.includes('boundary') && target.has_boundary;

  // Organization: directly owned + associated POIs (non-spatial).
  let ownedIds = [];
  if (isOrg) {
    try {
      const ownedQuery = await pool.query(
        `SELECT id FROM pois
           WHERE owner_id = $1 AND (deleted IS NULL OR deleted = FALSE)
         UNION
         SELECT physical_poi_id AS id FROM poi_associations WHERE virtual_poi_id = $1`,
        [id]
      );
      ownedIds = ownedQuery.rows.map(row => row.id).filter(Number.isInteger);
      ownedIds.forEach(ownedId => ids.add(ownedId));
    } catch (err) {
      console.warn(`[Geo] Org ownership lookup failed for POI ${id}: ${err.message}`);
    }
  }

  // Spatial containment: a boundary target contains POIs inside its own polygon;
  // an org target contains POIs inside any park boundary it owns.
  const boundarySourceIds = [];
  if (isBoundary) boundarySourceIds.push(id);
  if (isOrg && ownedIds.length > 0) boundarySourceIds.push(...ownedIds);

  if (boundarySourceIds.length > 0) {
    try {
      // Two index-friendly paths instead of one all-POIs CTE (PR #424 review):
      // point POIs join directly on the indexed `geom` column (uses idx_pois_geom);
      // linear features parse GeoJSON only for the small trail/boundary/river subset.
      const containedQuery = await pool.query(
        `WITH boundaries AS (
           SELECT boundary_geom FROM pois
           WHERE id = ANY($1)
             AND 'boundary' = ANY(poi_roles)
             AND boundary_geom IS NOT NULL
         )
         SELECT p.id
         FROM pois p
         JOIN boundaries b ON ST_Contains(b.boundary_geom, p.geom)
         WHERE 'point' = ANY(p.poi_roles)
           AND p.geom IS NOT NULL
           AND (p.deleted IS NULL OR p.deleted = FALSE)
         UNION
         SELECT p.id
         FROM pois p
         JOIN boundaries b
           ON ST_Contains(b.boundary_geom, ST_StartPoint(ST_GeometryN(ST_GeomFromGeoJSON(p.geometry::text), 1)))
         WHERE p.poi_roles && ARRAY['trail','boundary','river']::text[]
           AND p.geometry IS NOT NULL
           AND (p.deleted IS NULL OR p.deleted = FALSE)`,
        [boundarySourceIds]
      );
      containedQuery.rows.forEach(row => { if (Number.isInteger(row.id)) ids.add(row.id); });
    } catch (err) {
      console.warn(`[Geo] Containment rollup unavailable for POI ${id}: ${err.message}`);
    }
  }

  return Array.from(ids);
}
