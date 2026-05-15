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
    const result = await pool.query(`
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
    return result.rows.map(r => r.name).filter(Boolean);
  } catch (err) {
    console.warn(`[Geo] Boundary lookup unavailable for POI ${poiId}: ${err.message}`);
    return [];
  }
}
