// Keeps pois.has_primary_image true only where a photo can be served (#770).
// The thumbnail route serves a published primary/gallery poi_media row, else the
// image server's primary asset; the flag is true when either exists. Safe to re-run.

const PUBLISHED_MEDIA = `
  SELECT 1 FROM poi_media m
   WHERE m.poi_id = p.id
     AND m.role IN ('primary', 'gallery')
     AND m.media_type IN ('image', 'video')
     AND m.moderation_status IN ('published', 'auto_approved')`;

// getPrimaryAsset() answers "none" for an unreachable server too. This many
// misses in a row with no hit is treated as an outage, not as 612 bare places.
const OUTAGE_MISS_THRESHOLD = 20;

const LOOKUP_CONCURRENCY = 10;

/**
 * Brings pois.has_primary_image in line with poi_media and the image server.
 * @param {import('pg').Pool} pool
 * @param {{initialized: boolean, getPrimaryAsset: (poiId: number) => Promise<object|null>}} imageServerClient
 * @param {{warn: Function}} log
 * @returns {Promise<{raised: number, cleared: number, kept: number, skipped: boolean}>}
 *   raised: flags set from poi_media; cleared: flags removed; kept: flagged places whose
 *   photo lives only on the image server; skipped: clearing was withheld (suspected outage).
 *   Database errors propagate; image server errors read as "no asset".
 */
export async function reconcilePrimaryImageFlags(pool, imageServerClient, log = console) {
  const raised = await pool.query(
    `UPDATE pois p SET has_primary_image = true
      WHERE p.has_primary_image = false AND EXISTS (${PUBLISHED_MEDIA})`
  );

  let cleared = 0;
  let kept = 0;
  let skipped = false;
  if (imageServerClient?.initialized) {
    const { rows } = await pool.query(
      `SELECT p.id FROM pois p
        WHERE p.has_primary_image = true AND NOT EXISTS (${PUBLISHED_MEDIA})
        ORDER BY p.id`
    );
    const bare = [];
    for (let i = 0; i < rows.length; i += LOOKUP_CONCURRENCY) {
      const batch = rows.slice(i, i + LOOKUP_CONCURRENCY);
      const assets = await Promise.all(batch.map(({ id }) => imageServerClient.getPrimaryAsset(id)));
      batch.forEach(({ id }, n) => {
        if (assets[n]) kept++;
        else bare.push(id);
      });
    }
    if (kept === 0 && bare.length >= OUTAGE_MISS_THRESHOLD) {
      skipped = true;
      log.warn(`Primary image flag reconcile: image server returned nothing for ${bare.length} places; assuming it is down, clearing none`);
    } else if (bare.length > 0) {
      const result = await pool.query(
        `UPDATE pois p SET has_primary_image = false
          WHERE p.id = ANY($1::int[]) AND p.has_primary_image = true AND NOT EXISTS (${PUBLISHED_MEDIA})`,
        [bare]
      );
      cleared = result.rowCount;
    }
  }

  return { raised: raised.rowCount, cleared, kept, skipped };
}
