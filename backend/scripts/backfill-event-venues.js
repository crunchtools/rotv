#!/usr/bin/env node
// Re-derive poi_events.location_details from schema.org JSON-LD for rows saved
// before extraction preferred it (v1.39.0). Covers every Summit Metro Parks
// event, where the model had copied the Nature Realm contact line, plus every
// upcoming event from any source. Re-renders each page, bypassing the
// forever-cache, and refreshes that cache row's og_dates.
//
//   node scripts/backfill-event-venues.js --dry-run
//   node scripts/backfill-event-venues.js
import pg from 'pg';
import { extractPageContent } from '../services/contentExtractor.js';
import { jsonLdVenueFor } from '../services/eventVenue.js';

const { Pool } = pg;

const DRY_RUN = process.argv.includes('--dry-run');
const PAGE_DELAY_MS = 2000;

/** Reads standard PG* env vars (PGHOST/PGUSER/PGPASSWORD/...); no hardcoded credentials. */
const pool = new Pool();

// CLI output: this script's report is its stdout
const say = (line) => process.stdout.write(`${line}\n`);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const { rows } = await pool.query(`
    SELECT id, title, source_url, location_details
    FROM poi_events
    WHERE source_url IS NOT NULL
      AND (source_url ILIKE '%summitmetroparks.org%' OR start_date >= NOW())
    ORDER BY source_url, id
  `);

  const byUrl = new Map();
  for (const row of rows) {
    if (!byUrl.has(row.source_url)) byUrl.set(row.source_url, []);
    byUrl.get(row.source_url).push(row);
  }
  say(`${rows.length} events across ${byUrl.size} pages${DRY_RUN ? ' (dry run)' : ''}`);

  let changed = 0;
  let unreachable = 0;
  let noJsonLd = 0;
  for (const [url, events] of byUrl) {
    const page = await extractPageContent(url, {});
    await sleep(PAGE_DELAY_MS);
    if (!page.reachable) {
      unreachable++;
      say(`UNREACHABLE ${url} (${page.reason || 'no content'})`);
      continue;
    }

    const jsonLdEvents = page.ogDates?.jsonLdEvents || [];
    if (jsonLdEvents.length === 0) noJsonLd++;

    for (const event of events) {
      const venue = jsonLdVenueFor(event, jsonLdEvents);
      if (!venue || venue === event.location_details) continue;
      changed++;
      say(`#${event.id} ${event.title}\n  was: ${event.location_details}\n  now: ${venue}`);
      if (!DRY_RUN) {
        await pool.query('UPDATE poi_events SET location_details = $1, updated_at = NOW() WHERE id = $2', [venue, event.id]);
      }
    }

    if (!DRY_RUN) {
      await pool.query('UPDATE rendered_page_cache SET og_dates = $2 WHERE url = $1', [url, JSON.stringify(page.ogDates || {})]);
    }
  }

  say(`\n${changed} venue changes, ${unreachable} unreachable pages, ${noJsonLd} pages without JSON-LD events`);
}

await main();
await pool.end();
// The shared Playwright browser pool keeps the event loop alive
process.exit(0);
