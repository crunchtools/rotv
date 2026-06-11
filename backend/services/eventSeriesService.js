/**
 * Event Series Service - recurring events (spec 034, issue #436).
 *
 * Recurring events are stored as a RULE (poi_event_series). `expandSeries` turns a rule
 * into concrete occurrences, and `materializeSeries` writes those occurrences as real
 * poi_events rows (linked by series_id) so recurring events appear everywhere regular
 * events do — Today/This Weekend, Future, Past, newsletter, notifications, search.
 *
 * v1 honors weekly cadence (interval 1 = weekly, 2 = biweekly, ...) over an explicit,
 * admin-entered [season_start, season_end] range with exception dates. Biweekly anchors
 * on the first matching weekday on/after season_start.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const DOW_LABEL = {
  SU: 'Sundays', MO: 'Mondays', TU: 'Tuesdays', WE: 'Wednesdays',
  TH: 'Thursdays', FR: 'Fridays', SA: 'Saturdays'
};

/** Parse a 'YYYY-MM-DD' (or Date) into a UTC-midnight Date, so calendar-date math
 *  never shifts across the local timezone. */
function toUtcDate(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** First date on/after `from` whose UTC weekday equals `targetDow`. */
function firstWeekdayOnOrAfter(from, targetDow) {
  const delta = (targetDow - from.getUTCDay() + 7) % 7;
  return new Date(from.getTime() + delta * MS_PER_DAY);
}

/**
 * Human-readable cadence, e.g. "Weekly: Saturdays" or "Every 2 weeks: Saturdays".
 * @param {object} series
 * @returns {string}
 */
export function cadenceLabel(series) {
  const interval = series.interval || 1;
  const cadence = interval === 1 ? 'Weekly' : `Every ${interval} weeks`;
  const days = (series.byday || []).map(code => DOW_LABEL[code]).filter(Boolean);
  return days.length ? `${cadence}: ${days.join(', ')}` : cadence;
}

/**
 * Expand one series into concrete occurrences within [fromDate, toDate].
 *
 * Occurrences are shaped like event rows (start_date, title, poi_id, ...) plus
 * is_recurring/series_id/cadence_label, so callers can merge them with one-off
 * poi_events transparently.
 *
 * @param {object} series - a poi_event_series row (+ poi_name if joined)
 * @param {string|Date} fromDate - window start (inclusive, calendar date)
 * @param {string|Date} toDate - window end (inclusive, calendar date)
 * @returns {Array<object>} occurrences sorted ascending by start_date
 */
export function expandSeries(series, fromDate, toDate) {
  if (!series || series.active === false) return [];
  if ((series.freq || 'WEEKLY') !== 'WEEKLY') return []; // v1: weekly only
  const interval = Math.max(1, parseInt(series.interval, 10) || 1);
  const byday = (series.byday || []).filter(code => code in DOW);
  if (byday.length === 0) return [];

  // Clip the request window to the season.
  const windowStart = toUtcDate(fromDate);
  const windowEnd = toUtcDate(toDate);
  const seasonStart = toUtcDate(series.season_start);
  const seasonEnd = toUtcDate(series.season_end);
  const start = windowStart > seasonStart ? windowStart : seasonStart;
  const end = windowEnd < seasonEnd ? windowEnd : seasonEnd;
  if (start > end) return [];

  // Exception dates (holiday closures etc.) are skipped. Normalize to 'YYYY-MM-DD'.
  const exdates = new Set((series.exdates || []).map(iso => String(iso).slice(0, 10)));

  const occurrences = [];
  for (const code of byday) {
    const targetDow = DOW[code];
    // Anchor the interval grid on the first matching weekday of the season.
    const anchor = firstWeekdayOnOrAfter(seasonStart, targetDow);
    let candidate = firstWeekdayOnOrAfter(start, targetDow);
    if (interval > 1) {
      const weeksFromAnchor = Math.round((candidate - anchor) / (7 * MS_PER_DAY));
      const remainder = ((weeksFromAnchor % interval) + interval) % interval;
      if (remainder !== 0) {
        candidate = new Date(candidate.getTime() + (interval - remainder) * 7 * MS_PER_DAY);
      }
    }
    // TIME columns come back as 'HH:MM:SS' strings; embed them into the date string so
    // the existing event card renders "Sun, Jun 7, 9:00 AM – 12:00 PM" (date-only when absent).
    const t1 = series.time_start ? String(series.time_start).slice(0, 8) : null;
    const t2 = series.time_end ? String(series.time_end).slice(0, 8) : null;
    for (let d = candidate; d <= end; d = new Date(d.getTime() + interval * 7 * MS_PER_DAY)) {
      const dateStr = d.toISOString().slice(0, 10);
      if (exdates.has(dateStr)) continue;
      occurrences.push({
        // Synthetic, stable key for React lists — occurrences are not poi_events rows.
        id: `series-${series.id}-${dateStr}`,
        series_id: series.id,
        poi_id: series.poi_id,
        poi_name: series.poi_name,
        poi_roles: series.poi_roles,
        venue_poi_id: series.venue_poi_id,
        venue_name: series.venue_name,
        title: series.title,
        description: series.description,
        event_type: series.event_type,
        location_details: series.location_details,
        source_url: series.source_url,
        image_url: series.image_url,
        occurrence_date: dateStr,
        start_date: t1 ? `${dateStr} ${t1}` : dateStr,
        end_date: t2 ? `${dateStr} ${t2}` : null,
        is_recurring: true,
        cadence_label: cadenceLabel(series)
      });
    }
  }
  occurrences.sort((a, b) => a.start_date.localeCompare(b.start_date));
  return occurrences;
}

/** The first occurrence of a series on/after `fromDate`, or null if the season is over. */
export function nextOccurrence(series, fromDate) {
  const list = expandSeries(series, fromDate, series.season_end);
  return list.length ? list[0] : null;
}

const ACTIVE_SERIES_SELECT = `
  SELECT s.*, p.name AS poi_name, p.poi_roles AS poi_roles, vp.name AS venue_name
    FROM poi_event_series s
    JOIN pois p ON p.id = s.poi_id
    LEFT JOIN pois vp ON vp.id = s.venue_poi_id
   WHERE s.active = TRUE
     AND s.moderation_status IN ('published', 'auto_approved')
     AND (p.deleted IS NULL OR p.deleted = FALSE)`;

/** All active, published series across every POI. */
export async function getAllActiveSeries(pool) {
  const seriesRows = await pool.query(ACTIVE_SERIES_SELECT);
  return seriesRows.rows;
}

/**
 * Materialize a series' occurrences into real poi_events rows so recurring events
 * appear everywhere regular events do. The rule is the source of truth: FUTURE rows
 * are regenerated (so edits to day/season/exdates take effect), PAST rows are left as
 * historical record. Idempotent via the (series_id, start_date) unique index.
 *
 * Occurrence times are local; they are stored tz-correctly — timed occurrences as the
 * given `tz` instant, date-only occurrences as UTC midnight (so they render date-only).
 *
 * @param {Pool} pool
 * @param {object} series - a poi_event_series row
 * @param {string} tz - venue timezone for timed occurrences
 * @returns {Promise<number>} rows inserted
 */
export async function materializeSeries(pool, series, tz = 'America/New_York') {
  if (!series || !series.id) return 0;
  const occurrences = expandSeries(series, series.season_start, series.season_end);
  const label = cadenceLabel(series);
  // One transaction so an edit never leaves a window with future occurrences deleted
  // but not yet re-inserted (a concurrent reader would briefly see no upcoming events).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM poi_events WHERE series_id = $1 AND start_date >= NOW()', [series.id]);
    let inserted = 0;
    for (const o of occurrences) {
      const hasTime = o.start_date.length > 10;
      const startLocal = hasTime ? o.start_date : `${o.start_date} 00:00:00`;
      const startTz = hasTime ? tz : 'UTC';
      const insertResult = await client.query(
        `INSERT INTO poi_events
           (poi_id, venue_poi_id, series_id, title, description, start_date, end_date,
            event_type, location_details, source_url, image_url, recurrence_label,
            content_source, moderation_status, collection_date)
         VALUES ($1, $2, $3, $4, $5,
                 ($6::text)::timestamp AT TIME ZONE $8,
                 CASE WHEN $7::text IS NULL THEN NULL ELSE ($7::text)::timestamp AT TIME ZONE $9 END,
                 $10, $11, $12, $13, $14, 'recurring', 'published', NOW())
         ON CONFLICT (series_id, start_date) DO NOTHING`,
        [series.poi_id, series.venue_poi_id || null, series.id, series.title, series.description || null,
         startLocal, o.end_date || null, startTz, tz,
         series.event_type || null, series.location_details || null, series.source_url || null,
         series.image_url || null, label]
      );
      inserted += insertResult.rowCount;
    }
    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Materialize every active series — run on backend boot so deploy/seed self-populates. */
export async function materializeAllSeries(pool) {
  try {
    const series = await getAllActiveSeries(pool);
    let total = 0;
    for (const s of series) total += await materializeSeries(pool, s);
    if (total > 0) console.log(`[EventSeries] Materialized ${total} recurring occurrence(s) across ${series.length} series`);
    return total;
  } catch (err) {
    console.warn(`[EventSeries] materializeAllSeries skipped: ${err.message}`);
    return 0;
  }
}
