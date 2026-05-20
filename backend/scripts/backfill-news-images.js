#!/usr/bin/env node
import pg from 'pg';

const { Pool } = pg;

const CONCURRENCY = 5;
const REQUEST_TIMEOUT = 15000;
const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'rotv',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres'
});

const EXPIRING_HOST = /(fbcdn\.net|cdninstagram\.com|lookaside\.[a-z0-9-]+\.(?:facebook|fbcdn)\.com)/i;

function decodeEntities(s) {
  return s.replace(/&amp;/gi, '&').replace(/&#0*38;/g, '&').replace(/&#x0*26;/gi, '&');
}

function extractOgImage(html, pageUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      try {
        const url = new URL(decodeEntities(m[1].trim()), pageUrl).href;
        // Skip signed/expiring CDN URLs — they break after days; POI photo is more stable.
        if (EXPIRING_HOST.test(url)) return null;
        return url;
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function fetchOgImage(url) {
  if (!/^https?:\/\//i.test(url || '')) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'ROTV-OG-Backfill/1.0' }
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;
    const html = (await res.text()).slice(0, 200000);
    return extractOgImage(html, url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function processTable(table) {
  const { rows } = await pool.query(
    `SELECT id, source_url FROM ${table}
     WHERE moderation_status IN ('published', 'auto_approved')
       AND image_url IS NULL
       AND source_url IS NOT NULL AND source_url <> ''`
  );
  console.log(`[${table}] ${rows.length} rows to backfill`);

  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (row) => {
      const image = await fetchOgImage(row.source_url);
      return { id: row.id, image, source_url: row.source_url };
    }));
    for (const r of results) {
      if (!r.image) { skipped++; continue; }
      if (DRY_RUN) {
        console.log(`[${table}] would set ${r.id} -> ${r.image}`);
      } else {
        await pool.query(`UPDATE ${table} SET image_url = $1 WHERE id = $2`, [r.image, r.id]);
      }
      updated++;
    }
    console.log(`[${table}] progress ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length}`);
  }
  console.log(`[${table}] done: ${updated} ${DRY_RUN ? 'would be updated' : 'updated'}, ${skipped} had no og:image`);
}

async function main() {
  console.log(`Backfilling news/event source images${DRY_RUN ? ' (DRY RUN)' : ''}...`);
  await processTable('poi_news');
  await processTable('poi_events');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Backfill failed:', err);
  await pool.end();
  process.exit(1);
});
