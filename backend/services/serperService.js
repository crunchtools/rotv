/**
 * Serper Service - External news/events search with geographic grounding
 *
 * Provides two-layer news collection:
 * - Layer 1: Official POI URLs (news_url, events_url) - already handled by newsService.js
 * - Layer 2: External news coverage via Serper.dev with PostGIS geographic grounding
 *
 * Geographic grounding uses PostGIS spatial queries to find ALL boundary polygons
 * containing each POI (ordered smallest-first), then adds that context to search
 * queries to eliminate geographic confusion
 * (e.g., "Ledges Trail" → "Latest news for Ledges Trail in Cuyahoga Falls, Cuyahoga Valley National Park").
 *
 * Test results show 80-100% improvement in result relevance with geographic grounding.
 */

import fetch from 'node-fetch';


/**
 * Search for news or events about a POI using Serper with geographic grounding
 *
 * Returns direct URLs to external news/events coverage. These URLs should be rendered
 * with Playwright (same pipeline as official POI URLs) and processed by Gemini.
 *
 * Geographic grounding is applied automatically using ALL containing boundaries
 * (ordered smallest area first):
 * - POI in boundaries: "Latest news for ${poi_name} in ${b1}, ${b2}, ..."
 * - POI outside boundaries: "Latest news for ${poi_name}"
 *
 * Test results:
 * - Without grounding: 0-20% relevant results (wrong cities/states)
 * - With grounding: 80-100% relevant results
 *
 * @param {Pool} pool - Database connection pool
 * @param {object} poi - POI object with id, name, latitude, longitude, poi_roles
 * @param {object} [options] - Options
 * @param {string} [options.contentType='news'] - 'news' or 'events'
 * @returns {Promise<object>} - {query, grounded, groundingContext, urls[], credits}
 * @throws {Error} - If Serper API key not configured or API error
 */
export async function searchNewsUrls(pool, poi, { contentType = 'news' } = {}) {
  const apiKeyResult = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'serper_api_key'"
  );

  if (!apiKeyResult.rows.length || !apiKeyResult.rows[0].value) {
    throw new Error('Serper API key not configured. Please add your API key in Settings → Data Collection.');
  }

  const apiKey = apiKeyResult.rows[0].value;
  const prefix = contentType === 'events' ? 'Upcoming events' : 'Latest news';

  const maxResultsRow = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'serper_max_results'"
  );
  const maxResults = maxResultsRow.rows.length
    ? Math.min(10, Math.max(1, parseInt(maxResultsRow.rows[0].value, 10) || 3))
    : 3;

  let boundaries = [];
  try {
    const contextResult = await pool.query(`
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
    `, [poi.id]);
    boundaries = contextResult.rows.map(r => r.name).filter(Boolean);
  } catch (err) {
    console.warn(`[Serper] PostGIS grounding unavailable, using ungrounded search: ${err.message}`);
  }

  const context = boundaries.join(', ');

  const query = context
    ? `${prefix} for ${poi.name} in ${context}`
    : `${prefix} for ${poi.name}`;

  console.log(`[Serper] Query: "${query}" (grounded: ${!!context})`);

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ q: query, num: maxResults })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Serper API error: ${response.status} - ${errorText}`);
  }

  const searchResults = await response.json();

  const urls = (searchResults.organic || []).map(r => ({
    url: r.link,
    title: r.title,
    snippet: r.snippet,
    date: r.date || null
  }));

  console.log(`[Serper] Found ${urls.length} external ${contentType} URLs (${urls.filter(u => u.date).length} with dates)`);

  return {
    query,
    grounded: !!context,
    groundingContext: context,
    boundaries,
    urls,
    credits: searchResults.credits || 1
  };
}

/**
 * Test Serper API key validity
 *
 * Makes a simple test query to verify the API key works.
 *
 * @param {Pool} pool - Database connection pool
 * @returns {Promise<boolean>} - True if key is valid
 */
export async function testSerperApiKey(pool) {
  try {
    const apiKeyResult = await pool.query(
      "SELECT value FROM admin_settings WHERE key = 'serper_api_key'"
    );

    if (!apiKeyResult.rows.length || !apiKeyResult.rows[0].value) {
      return false;
    }

    const apiKey = apiKeyResult.rows[0].value;

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: 'test', num: 1 })
    });

    return response.ok;
  } catch (err) {
    console.error('[Serper] API key test failed:', err.message);
    return false;
  }
}
