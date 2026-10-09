/**
 * Issue #712, replayed on a phone: search for a park in Find, pick it, and
 * land on a map that shows it, with the place card open and the tabs still
 * in reach. The test brings its own park, trail and restroom, far out in the
 * Pacific, because the seed has no park outlines.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import pg from 'pg';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';

const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'rotv_test',
  user: process.env.PGUSER || 'rotv',
  password: process.env.PGPASSWORD
});

const PARK = 999970;
const TRAIL = 999971;
const RESTROOM = 999972;
const FIXTURE_IDS = [PARK, TRAIL, RESTROOM];
const PARK_NAME = 'Zzfind Run Metro Park';

const PARK_POLYGON = {
  type: 'Polygon',
  coordinates: [[[-140.02, 20.0], [-139.98, 20.0], [-139.98, 20.03], [-140.02, 20.03], [-140.02, 20.0]]]
};
const TRAIL_LINE = { type: 'LineString', coordinates: [[-140.01, 20.01], [-140.0, 20.02], [-139.99, 20.02]] };

async function removeFixtures() {
  await pool.query('DELETE FROM pois WHERE id = ANY($1)', [FIXTURE_IDS]);
}

describe('Find a park on a phone and get to it (#712)', () => {
  let browser;
  let page;

  beforeAll(async () => {
    await removeFixtures();
    await pool.query(
      `INSERT INTO pois (id, name, poi_roles, boundary_type, latitude, longitude,
                         navigation_latitude, navigation_longitude, geometry, boundary_geom, brief_description) VALUES
         ($1, $4, '{boundary}', 'park', 20.015, -140.0, 20.015, -140.0, $5::jsonb,
           ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)), 'A park for one test.'),
         ($2, 'Zzfind Run Trail', '{trail}', NULL, NULL, NULL, NULL, NULL, $6::jsonb, NULL, NULL),
         ($3, 'Zzfind Run Metro Park Restroom', '{point}', NULL, 20.012, -140.005, NULL, NULL, NULL, NULL, NULL)`,
      [PARK, TRAIL, RESTROOM, PARK_NAME, JSON.stringify(PARK_POLYGON), JSON.stringify(TRAIL_LINE)]
    );

    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await page.addInitScript(() => {
      localStorage.setItem('rotv-tour-seen', 'true');
    });
  }, 60000);

  afterAll(async () => {
    if (browser) await browser.close();
    await removeFixtures();
    await pool.end();
  });

  it('lists the park once, first, with its trail and restroom named as inside it', async () => {
    await page.goto(`${BASE_URL}/find`, { waitUntil: 'load' });
    await page.waitForSelector('.results-tab-list .results-tile', { timeout: 20000 });

    // Three labeled tabs in a bar a thumb can reach
    const tabs = await page.$$eval('.bottom-nav .tab-btn', els => els.map(el => el.textContent.trim()));
    expect(tabs).toEqual(['Map', 'Find', 'Happening']);

    await page.fill('.results-search-input', 'zzfind run');
    await page.waitForFunction(
      () => document.querySelectorAll('.results-tile').length === 3,
      null,
      { timeout: 10000 }
    );

    const rows = await page.$$eval('.results-tile', els => els.map(el => ({
      name: el.querySelector('.results-tile-name').textContent,
      park: el.querySelector('.results-tile-park')?.textContent || null
    })));
    expect(rows).toEqual([
      { name: PARK_NAME, park: null },
      { name: 'Zzfind Run Trail', park: `in ${PARK_NAME}` },
      { name: 'Zzfind Run Metro Park Restroom', park: `in ${PARK_NAME}` }
    ]);
  }, 60000);

  it('opens the park on the map: outline in view, card above the tab bar, directions offered', async () => {
    await page.click('.results-tile');
    await page.waitForSelector('.sidebar.open.peek', { timeout: 10000 });
    expect(new URL(page.url()).pathname).toBe('/zzfind-run-metro-park');
    expect(await page.textContent('.sidebar.open .sidebar-header h2')).toBe(PARK_NAME);

    // The park's outline settles inside the part of the map the card leaves showing
    await page.waitForFunction(() => {
      const header = document.querySelector('.header').getBoundingClientRect();
      const card = document.querySelector('.sidebar.open').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.leaflet-overlay-pane path')).some(path => {
        const box = path.getBoundingClientRect();
        return box.width > 40 && box.height > 40 && box.top >= header.bottom && box.bottom <= card.top
          && box.left >= 0 && box.right <= window.innerWidth;
      });
    }, null, { timeout: 15000 });

    const layout = await page.evaluate(() => {
      const card = document.querySelector('.sidebar.open').getBoundingClientRect();
      const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
      return { cardTop: card.top, cardBottom: card.bottom, navTop: nav.top, navBottom: nav.bottom, viewport: window.innerHeight };
    });
    expect(layout.cardTop).toBeGreaterThan(layout.viewport * 0.4);
    expect(layout.cardBottom).toBeLessThanOrEqual(layout.navTop + 1);
    expect(layout.navBottom).toBeLessThanOrEqual(layout.viewport);

    expect(await page.locator('.sidebar.open button[title="Open in Google Maps"]').count()).toBe(1);
  }, 60000);

  it('opens the card in full on a drag up and brings it back to half on a drag down', async () => {
    const drag = (selector, fromY, toY) => page.evaluate(({ selector, fromY, toY }) => {
      const target = document.querySelector(selector);
      const fire = (type, y) => {
        const touch = new Touch({ identifier: 1, target, clientX: 195, clientY: y });
        target.dispatchEvent(new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === 'touchend' ? [] : [touch],
          changedTouches: [touch]
        }));
      };
      fire('touchstart', fromY);
      fire('touchmove', (fromY + toY) / 2);
      fire('touchmove', toY);
      fire('touchend', toY);
    }, { selector, fromY, toY });

    // At half height the card does not scroll; the tabs lead and the photo block is hidden
    const media = await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar.open .sidebar-media')).display);
    expect(media).toBe('none');

    await drag('.sidebar.open .sidebar-tab-content', 700, 600);
    await page.waitForSelector('.sidebar.open.expanded', { timeout: 5000 });

    await drag('.sidebar.open .sidebar-header h2', 40, 200);
    await page.waitForSelector('.sidebar.open.peek', { timeout: 5000 });
  }, 60000);

  it('keeps the search and the selection across tabs, showing the card only on the map', async () => {
    await page.click('[data-nav="find"]');
    await page.waitForSelector('.results-search-input', { timeout: 10000 });
    expect(new URL(page.url()).pathname).toBe('/find');
    expect(await page.inputValue('.results-search-input')).toBe('zzfind run');
    expect(await page.locator('.sidebar').isVisible()).toBe(false);
    expect(await page.locator('.results-tile.selected .results-tile-name').textContent()).toBe(PARK_NAME);

    await page.click('[data-nav="happening"]');
    await page.waitForSelector('.happening-tab', { timeout: 10000 });
    expect(await page.locator('.sidebar').isVisible()).toBe(false);

    await page.click('[data-nav="map"]');
    await page.waitForSelector('.sidebar.open', { state: 'visible', timeout: 10000 });
    expect(new URL(page.url()).pathname).toBe('/zzfind-run-metro-park');
    expect(await page.textContent('.sidebar.open .sidebar-header h2')).toBe(PARK_NAME);
  }, 60000);
});
