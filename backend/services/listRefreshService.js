/**
 * Next season's Fall Hiking Spree, drafted from the district's own data (spec 052, #778).
 *
 * Summit Metro Parks marks each year's spree trails in its public layer "SMP
 * Trails by Name - Hiking Programs": a column per program and year (FHS_2026)
 * holding "Nuthatch Trail (Sand Run Metro Park, 3.3 miles, difficult)" for each
 * trail on that year's spree. When the column for a year appears, this saves
 * that year's list as a draft, with the rules carried over from the year before
 * and a report of what an admin has to look at. Nothing reaches visitors until
 * an admin publishes it.
 */

import { createLogger } from '../utils/logger.js';
import { normalizeName } from './smpTrailShapes.js';
import { todayInValley } from './poiListService.js';

const logger = createLogger('ListRefresh');

const PROGRAM_TRAILS_URL = 'https://services5.arcgis.com/gT94nvwhVWBDFu7Q/ArcGIS/rest/services/SMP_Trails_by_Name_-_Hiking_Programs/FeatureServer/0';
const SPREE_SERIES = 'fall-hiking-spree';

// The district's words for difficulty, in the words its form uses.
const RATINGS = { easy: 'Easy', 'easy/accessible': 'Easy', moderate: 'Moderate', difficult: 'Strenuous', strenuous: 'Strenuous' };

/**
 * One trail's entry for a program year.
 *
 * @param {string} text e.g. "Seneca Trail (F.A. Seiberling Nature Realm, 1.4 miles, moderate)" or
 *   "Towpath Trail - Between Wilbeth Road Trailhead & Summit Lake Nature Center (2.2 miles, easy)"
 * @returns {{label: string, section: string|null, park: string|null, miles: number|null, rating: string|null}|null}
 *   null when the text is not in that shape
 */
export function parseProgramEntry(text) {
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec((text || '').trim());
  if (!match) return null;
  const [, head, inner] = match;
  const parts = inner.split(',').map(part => part.trim()).filter(Boolean);
  const rating = parts.length ? RATINGS[parts[parts.length - 1].toLowerCase()] ?? null : null;
  if (rating) parts.pop();
  const milesMatch = parts.length ? /^([\d.]+)\s*miles?$/i.exec(parts[parts.length - 1]) : null;
  if (milesMatch) parts.pop();
  const [label, section] = head.split(/\s+-\s+/, 2);
  return {
    label: label.trim(),
    section: section?.trim() || null,
    park: parts.join(', ') || null,
    miles: milesMatch ? Number(milesMatch[1]) : null,
    rating
  };
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Hiking Programs layer answered HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`Hiking Programs layer: ${body.error.message || 'error'}`);
  return body;
}

/**
 * The district's spree entries for a year, or null while it has not published them.
 * @param {number} edition The year
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{districtName: string, entry: string}[]|null>}
 */
export async function fetchSpreeEntries(edition, fetchImpl = fetch) {
  const field = `FHS_${edition}`;
  const layer = await getJson(fetchImpl, `${PROGRAM_TRAILS_URL}?f=json`);
  if (!(layer.fields || []).some(f => f.name === field)) return null;
  const params = new URLSearchParams({ where: `${field} IS NOT NULL`, outFields: `NAME,${field}`, returnGeometry: 'false', f: 'json' });
  const result = await getJson(fetchImpl, `${PROGRAM_TRAILS_URL}/query?${params}`);
  return (result.features || [])
    .map(({ attributes }) => ({ districtName: (attributes.NAME || '').trim(), entry: (attributes[field] || '').trim() }))
    .filter(({ entry }) => entry);
}

/**
 * Which of our trails an entry is: by the district's name, then the entry's own;
 * among several, the one on last year's list; with none, the trail last year's
 * item of that name was on ("Towpath Trail" is last year's "Towpath Trail from
 * Wilbeth Road", on the Ohio & Erie Canal Towpath Trail).
 * @param {{id: number, name: string}[]} trails
 * @param {{districtName: string, label: string}} entry
 * @param {{poi_id: number, label: string}[]} [previousItems] Last year's items
 * @returns {{poi: object|null, candidates: object[]}}
 */
export function matchTrail(trails, { districtName, label }, previousItems = []) {
  const previousPoiIds = new Set(previousItems.map(item => item.poi_id));
  const exact = (name) => trails.filter(t => t.name.trim().toLowerCase() === name.trim().toLowerCase());
  for (const found of [exact(districtName), exact(label)]) {
    if (found.length === 1) return { poi: found[0], candidates: found };
  }
  const loose = trails.filter(t => [districtName, label].some(name => normalizeName(t.name) === normalizeName(name)));
  if (loose.length === 1) return { poi: loose[0], candidates: loose };
  const lastYear = loose.filter(t => previousPoiIds.has(t.id));
  if (lastYear.length === 1) return { poi: lastYear[0], candidates: loose };
  if (loose.length === 0) {
    const named = new Set(previousItems
      .filter(item => normalizeName(item.label).startsWith(normalizeName(label)))
      .map(item => item.poi_id));
    const byLabel = trails.filter(t => named.has(t.id));
    if (byLabel.length === 1) return { poi: byLabel[0], candidates: byLabel };
  }
  return { poi: null, candidates: loose };
}

const shiftYear = (isoDate, years) => (isoDate ? `${Number(isoDate.slice(0, 4)) + years}${isoDate.slice(4)}` : null);
/** Last year's description for this year: "63rd annual" becomes "64th annual". */
export function nextDescription(description, years) {
  return (description || '').replace(/\b(\d+)(st|nd|rd|th) annual\b/i, (_, n) => {
    const count = Number(n) + years;
    const suffix = ['th', 'st', 'nd', 'rd'][(count % 100 >= 11 && count % 100 <= 13) || count % 10 >= 4 ? 0 : count % 10];
    return `${count}${suffix} annual`;
  }) || null;
}

/**
 * Save a year's spree as a draft for an admin to review, unless that year
 * already has a list or the district has not published it yet.
 *
 * @param {import('pg').Pool} pool
 * @param {{edition?: number, fetchImpl?: typeof fetch, mailer?: {enabled: boolean, send: Function}, adminEmail?: string}} [options]
 *   `edition` defaults to this year in the valley
 * @returns {Promise<{status: 'exists'|'not-published-yet'|'no-earlier-list'|'created', listId?: number, report?: object}>}
 */
export async function refreshSpree(pool, { edition, fetchImpl = fetch, mailer, adminEmail } = {}) {
  const year = edition || Number(todayInValley().slice(0, 4));
  const existing = await pool.query('SELECT id FROM poi_lists WHERE series = $1 AND edition = $2', [SPREE_SERIES, year]);
  if (existing.rows.length) return { status: 'exists', listId: existing.rows[0].id };

  const entries = await fetchSpreeEntries(year, fetchImpl);
  if (!entries || entries.length === 0) return { status: 'not-published-yet' };

  const { rows: [previous] } = await pool.query(
    `SELECT *, to_char(starts_on, 'YYYY-MM-DD') AS starts, to_char(ends_on, 'YYYY-MM-DD') AS ends,
            to_char(rewards_until, 'YYYY-MM-DD') AS rewards_by
       FROM poi_lists WHERE series = $1 AND edition < $2 ORDER BY edition DESC LIMIT 1`,
    [SPREE_SERIES, year]
  );
  if (!previous) return { status: 'no-earlier-list' };
  const years = year - previous.edition;
  const { rows: previousItems } = await pool.query('SELECT * FROM poi_list_items WHERE list_id = $1', [previous.id]);
  const { rows: trails } = await pool.query(
    `SELECT id, name FROM pois WHERE 'trail' = ANY(poi_roles) AND deleted IS NOT TRUE`
  );
  const report = {
    source: PROGRAM_TRAILS_URL, field: `FHS_${year}`, retrievedAt: new Date().toISOString(), basedOn: previous.edition,
    unmatched: [], unparsed: [], newTrails: [], changed: [], dropped: [],
    todo: [
      'Check the form link and add this year\'s form, its layout and its sample picture.',
      'Add this year\'s banner picture.',
      'Check the dates, rewards and pick-up text against the district\'s page.'
    ]
  };

  const items = [];
  for (const { districtName, entry } of entries) {
    const parsed = parseProgramEntry(entry);
    if (!parsed) { report.unparsed.push(entry); continue; }
    const { poi, candidates } = matchTrail(trails, { districtName, label: parsed.label }, previousItems);
    if (!poi) {
      report.unmatched.push({ entry, districtName, candidates: candidates.map(c => ({ id: c.id, name: c.name })) });
      continue;
    }
    const before = previousItems.find(item => item.poi_id === poi.id);
    if (!before) report.newTrails.push(parsed.label);
    for (const field of ['miles', 'rating']) {
      const was = before ? (field === 'miles' ? Number(before.miles) : before.rating) : null;
      if (before && parsed[field] != null && was !== parsed[field]) report.changed.push({ label: parsed.label, field, from: was, to: parsed[field] });
    }
    items.push({
      poi_id: poi.id,
      park: parsed.park || '',
      label: before?.label || (parsed.section ? `${parsed.label} (${parsed.section})` : parsed.label),
      note: before?.note || null,
      miles: parsed.miles ?? (before ? Number(before.miles) : null),
      rating: parsed.rating || before?.rating || null,
      trail_class: before?.trail_class || null,
      trailhead: before?.trailhead || null,
      nav_latitude: before?.nav_latitude ?? null,
      nav_longitude: before?.nav_longitude ?? null,
      geometry: before?.geometry || null,
      needs: [!before?.trailhead && 'trailhead', !before?.trail_class && 'trail class', parsed.section && !before?.geometry && 'the section hiked'].filter(Boolean)
    });
  }
  for (const item of previousItems) {
    if (!items.some(i => i.poi_id === item.poi_id)) report.dropped.push(item.label);
  }
  // The form's order: the trail outside any park first, then by park.
  items.sort((a, b) => (a.park ? 1 : 0) - (b.park ? 1 : 0) || a.park.localeCompare(b.park) || a.label.localeCompare(b.label));
  report.incomplete = items.filter(item => item.needs.length).map(item => ({ label: item.label, needs: item.needs }));

  const client = await pool.connect();
  let listId;
  try {
    await client.query('BEGIN');
    const { rows: [list] } = await client.query(
      `INSERT INTO poi_lists (series, edition, name, description, goal_count, source_url, organizer_poi_id,
                              starts_on, ends_on, status, featured, choice_label, choice_description,
                              rewards, rewards_until, form_url, hero_credit, refresh_report)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (series, edition) DO NOTHING
       RETURNING id`,
      [SPREE_SERIES, year, previous.name, nextDescription(previous.description, years), previous.goal_count,
        previous.source_url, previous.organizer_poi_id, shiftYear(previous.starts, years), shiftYear(previous.ends, years),
        previous.featured, previous.choice_label, previous.choice_description, previous.rewards,
        shiftYear(previous.rewards_by, years), (previous.form_url || '').replaceAll(String(previous.edition), String(year)) || null,
        previous.hero_credit, report]
    );
    if (!list) {
      await client.query('ROLLBACK');
      return { status: 'exists' };
    }
    listId = list.id;
    for (const [index, item] of items.entries()) {
      await client.query(
        `INSERT INTO poi_list_items (list_id, poi_id, position, label, note, miles, rating, trail_class,
                                     trailhead, nav_latitude, nav_longitude, geometry)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [listId, item.poi_id, index + 1, item.label, item.note, item.miles, item.rating, item.trail_class,
          item.trailhead, item.nav_latitude, item.nav_longitude, item.geometry ? JSON.stringify(item.geometry) : null]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  logger.info(`Drafted the ${year} spree: ${items.length} trails, ${report.unmatched.length} unmatched`);

  // Tell the admin there is a draft to review; a mail that fails does not undo it.
  if (!mailer?.enabled || !adminEmail) {
    logger.info(`The ${year} spree draft is waiting in Settings › Seasonal Lists (no mail sent)`);
  } else {
    const text = [
      `The district has published its ${year} Fall Hiking Spree, and Roots of the Valley has saved it as a draft with ${items.length} trails.`,
      report.unmatched.length ? `${report.unmatched.length} of the district's trails did not match a trail on the map.` : 'Every trail matched one on the map.',
      report.incomplete.length ? `${report.incomplete.length} need details (a trailhead, trail class or the section hiked).` : '',
      '',
      'Review it and publish it in Settings › Seasonal Lists. Visitors see nothing until then.'
    ].join('\n');
    try {
      await mailer.send({ to: adminEmail, subject: `The ${year} Fall Hiking Spree is ready for review`, text });
    } catch (error) {
      logger.error(`Could not mail the ${year} spree draft notice:`, error);
    }
  }
  return { status: 'created', listId, report };
}
