#!/usr/bin/env node
/**
 * Cleanup script to remove news and events with failed URLs
 * Run with: node scripts/cleanup-failed-urls.js [--dry-run]
 */

import pg from 'pg';

const { Pool } = pg;

// Configuration
const CONCURRENT_REQUESTS = 5;
const REQUEST_TIMEOUT = 30000; // 30 seconds
const DRY_RUN = process.argv.includes('--dry-run');

// Database connection
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'rotv',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres'
});

// Patterns that indicate unresolved/broken URLs
const BROKEN_URL_PATTERNS = [
  'vertexaisearch.cloud.google.com/grounding-api-redirect',
  'google.com/url?',
  'bing.com/ck/a'
];

/**
 * Check if URL matches known broken patterns
 */
function isBrokenUrlPattern(url) {
  if (!url) return true;
  return BROKEN_URL_PATTERNS.some(pattern => url.includes(pattern));
}

/**
 * Test if a URL is accessible
 * Returns { success: boolean, status?: number, error?: string }
 */
async function testUrl(url) {
  if (!url || url.trim() === '') {
    return { success: false, error: 'Empty URL' };
  }

  // Check for known broken patterns first
  if (isBrokenUrlPattern(url)) {
    return { success: false, error: 'Unresolved redirect URL' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      redirect: 'follow'
    });

    clearTimeout(timeout);

    // Consider 2xx and 3xx as success
    if (response.status >= 200 && response.status < 400) {
      return { success: true, status: response.status };
    }

    // Some servers don't support HEAD, try GET for 405
    if (response.status === 405) {
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), REQUEST_TIMEOUT);

      const getResponse = await fetch(url, {
        method: 'GET',
        signal: controller2.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        redirect: 'follow'
      });

      clearTimeout(timeout2);

      if (getResponse.status >= 200 && getResponse.status < 400) {
        return { success: true, status: getResponse.status };
      }
      return { success: false, status: getResponse.status, error: `HTTP ${getResponse.status}` };
    }

    return { success: false, status: response.status, error: `HTTP ${response.status}` };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Timeout' };
    }
    // Simplify error message
    let errorMsg = error.message;
    if (error.cause?.code) {
      errorMsg = error.cause.code;
    }
    return { success: false, error: errorMsg };
  }
}

/**
 * Process URLs in batches with concurrency limit
 */
async function processInBatches(items, processor, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);

    // Progress update
    const processed = Math.min(i + concurrency, items.length);
    process.stdout.write(`\rProcessed ${processed}/${items.length} URLs...`);
  }
  console.log(''); // New line after progress
  return results;
}

async function main() {
  console.log('URL Cleanup Script');
  console.log('==================');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no deletions)' : 'LIVE (will delete failed entries)'}`);
  console.log(`Timeout: ${REQUEST_TIMEOUT / 1000}s per URL`);
  console.log('');

  try {
    // Fetch all news URLs
    console.log('Fetching news items with URLs...');
    const newsResult = await pool.query(
      'SELECT id, title, source_url FROM poi_news WHERE source_url IS NOT NULL ORDER BY id'
    );
    console.log(`Found ${newsResult.rows.length} news items with URLs`);

    // Fetch all event URLs
    console.log('Fetching events with URLs...');
    const eventsResult = await pool.query(
      'SELECT id, title, source_url FROM poi_events WHERE source_url IS NOT NULL ORDER BY id'
    );
    console.log(`Found ${eventsResult.rows.length} events with URLs`);
    console.log('');

    // First pass: Find items with broken URL patterns (instant, no network)
    console.log('Checking for unresolved redirect URLs...');
    const brokenPatternNews = newsResult.rows.filter(item => isBrokenUrlPattern(item.source_url));
    const brokenPatternEvents = eventsResult.rows.filter(item => isBrokenUrlPattern(item.source_url));

    console.log(`  News with unresolved redirects: ${brokenPatternNews.length}`);
    console.log(`  Events with unresolved redirects: ${brokenPatternEvents.length}`);
    console.log('');

    // Filter out broken patterns for network testing
    const newsToTest = newsResult.rows.filter(item => !isBrokenUrlPattern(item.source_url));
    const eventsToTest = eventsResult.rows.filter(item => !isBrokenUrlPattern(item.source_url));

    // Test remaining news URLs
    console.log(`Testing ${newsToTest.length} news URLs (excluding broken patterns)...`);
    const failedNewsNetwork = [];

    await processInBatches(newsToTest, async (item) => {
      const urlTest = await testUrl(item.source_url);
      if (!urlTest.success) {
        failedNewsNetwork.push({ ...item, error: urlTest.error, status: urlTest.status });
      }
      return urlTest;
    }, CONCURRENT_REQUESTS);

    // Test remaining event URLs
    console.log(`Testing ${eventsToTest.length} event URLs (excluding broken patterns)...`);
    const failedEventsNetwork = [];

    await processInBatches(eventsToTest, async (item) => {
      const urlTest = await testUrl(item.source_url);
      if (!urlTest.success) {
        failedEventsNetwork.push({ ...item, error: urlTest.error, status: urlTest.status });
      }
      return urlTest;
    }, CONCURRENT_REQUESTS);

    // Combine results
    const failedNews = [...brokenPatternNews.map(n => ({...n, error: 'Unresolved redirect URL'})), ...failedNewsNetwork];
    const failedEvents = [...brokenPatternEvents.map(e => ({...e, error: 'Unresolved redirect URL'})), ...failedEventsNetwork];

    // Report results
    console.log('');
    console.log('Results');
    console.log('=======');
    console.log(`News total: ${newsResult.rows.length}`);
    console.log(`  - Unresolved redirect URLs: ${brokenPatternNews.length}`);
    console.log(`  - Network failures: ${failedNewsNetwork.length}`);
    console.log(`  - Total failed: ${failedNews.length}`);
    console.log('');
    console.log(`Events total: ${eventsResult.rows.length}`);
    console.log(`  - Unresolved redirect URLs: ${brokenPatternEvents.length}`);
    console.log(`  - Network failures: ${failedEventsNetwork.length}`);
    console.log(`  - Total failed: ${failedEvents.length}`);
    console.log('');

    // Group failures by error type
    const errorGroups = {};
    for (const item of [...failedNews, ...failedEvents]) {
      const key = item.error || 'Unknown';
      if (!errorGroups[key]) errorGroups[key] = 0;
      errorGroups[key]++;
    }

    console.log('Failure breakdown:');
    for (const [error, count] of Object.entries(errorGroups).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${error}: ${count}`);
    }
    console.log('');

    // Show sample of network failures (not redirect URLs)
    if (failedNewsNetwork.length > 0) {
      console.log('Sample Network Failed News (first 10):');
      console.log('--------------------------------------');
      for (const item of failedNewsNetwork.slice(0, 10)) {
        console.log(`  ID ${item.id}: ${item.error || `HTTP ${item.status}`}`);
        console.log(`    Title: ${item.title?.substring(0, 50)}...`);
        console.log(`    URL: ${item.source_url?.substring(0, 80)}...`);
      }
      console.log('');
    }

    if (failedEventsNetwork.length > 0) {
      console.log('Sample Network Failed Events (first 10):');
      console.log('----------------------------------------');
      for (const item of failedEventsNetwork.slice(0, 10)) {
        console.log(`  ID ${item.id}: ${item.error || `HTTP ${item.status}`}`);
        console.log(`    Title: ${item.title?.substring(0, 50)}...`);
        console.log(`    URL: ${item.source_url?.substring(0, 80)}...`);
      }
      console.log('');
    }

    // Delete failed entries
    if (!DRY_RUN && (failedNews.length > 0 || failedEvents.length > 0)) {
      console.log('Deleting failed entries...');

      if (failedNews.length > 0) {
        const newsIds = failedNews.map(n => n.id);
        await pool.query('DELETE FROM poi_news WHERE id = ANY($1)', [newsIds]);
        console.log(`  Deleted ${failedNews.length} news items`);
      }

      if (failedEvents.length > 0) {
        const eventIds = failedEvents.map(e => e.id);
        await pool.query('DELETE FROM poi_events WHERE id = ANY($1)', [eventIds]);
        console.log(`  Deleted ${failedEvents.length} events`);
      }

      console.log('');
      console.log('Cleanup complete!');
    } else if (DRY_RUN) {
      console.log('DRY RUN - No entries were deleted.');
      console.log('Run without --dry-run to delete failed entries.');
    } else {
      console.log('No failed URLs found. Database is clean!');
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
