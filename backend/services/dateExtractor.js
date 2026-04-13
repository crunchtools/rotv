/**
 * Date Extractor — chrono-node wrapper for deterministic date parsing.
 * Universal post-processor for every date entering the system.
 */

import * as chrono from 'chrono-node';

/**
 * Normalize a single date string to YYYY-MM-DD.
 * @param {string|null} raw - Raw date string
 * @param {string} timezone - IANA timezone (default: America/New_York)
 * @returns {string|null} 'YYYY-MM-DD' or null
 */
export function parseDate(raw, timezone = 'America/New_York') {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return trimmed;
    }
  }

  const results = chrono.parse(trimmed, { instant: new Date(), timezone });
  if (results.length === 0) return null;

  const d = results[0].start;
  const year = d.get('year');
  const month = d.get('month');
  const day = d.get('day');
  if (!year || !month || !day) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Normalize a datetime string to YYYY-MM-DDTHH:MM:SS.
 * @param {string|null} raw - Raw datetime string
 * @param {string} timezone - IANA timezone
 * @returns {string|null} 'YYYY-MM-DDTHH:MM:SS' or null
 */
export function parseDateTime(raw, timezone = 'America/New_York') {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)$/);
  if (isoMatch) return `${isoMatch[1]}T${isoMatch[2].length === 5 ? isoMatch[2] + ':00' : isoMatch[2]}`;

  const results = chrono.parse(trimmed, { instant: new Date(), timezone });
  if (results.length === 0) return null;

  const d = results[0].start;
  const year = d.get('year');
  const month = d.get('month');
  const day = d.get('day');
  if (!year || !month || !day) return null;

  const hour = d.get('hour') ?? 0;
  const minute = d.get('minute') ?? 0;
  const second = d.get('second') ?? 0;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

/**
 * Scan raw text and return all date references found by chrono-node.
 * @param {string} text - Raw page text / rendered markdown
 * @param {string} timezone - IANA timezone
 * @returns {Array<{text: string, start: string, end: string|null, index: number}>}
 */
export function extractDatesFromText(text, timezone = 'America/New_York') {
  if (!text || typeof text !== 'string') return [];

  const results = chrono.parse(text, { instant: new Date(), timezone });
  return results.map(r => {
    const s = r.start;
    const startStr = `${s.get('year')}-${String(s.get('month')).padStart(2, '0')}-${String(s.get('day')).padStart(2, '0')}`;
    const hasTime = s.isCertain('hour');
    const startFull = hasTime
      ? `${startStr} ${String(s.get('hour') ?? 0).padStart(2, '0')}:${String(s.get('minute') ?? 0).padStart(2, '0')}`
      : startStr;

    let endFull = null;
    if (r.end) {
      const e = r.end;
      const endStr = `${e.get('year')}-${String(e.get('month')).padStart(2, '0')}-${String(e.get('day')).padStart(2, '0')}`;
      const endHasTime = e.isCertain('hour');
      endFull = endHasTime
        ? `${endStr} ${String(e.get('hour') ?? 0).padStart(2, '0')}:${String(e.get('minute') ?? 0).padStart(2, '0')}`
        : endStr;
    }

    return { text: r.text, start: startFull, end: endFull, index: r.index };
  });
}

/**
 * Find the most likely publication date from rendered page text.
 * Checks structured patterns (bylines, metadata), title, then full text scan.
 * @param {string} text - Rendered page content
 * @param {string} title - Item title
 * @param {string} timezone - IANA timezone
 * @returns {string|null} 'YYYY-MM-DD' or null
 */
export function findPublicationDate(text, title, timezone = 'America/New_York') {
  if (!text) return null;

  const patterns = [
    /(?:published|posted|updated|written|date)\s*(?:on|:)?\s*(.+?)(?:\n|$)/i,
    /(?:^|\n)\s*[Bb]y\s+.+?[\|–—-]\s*(.+?)(?:\n|$)/,
    /(?:^|\n)\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const parsed = parseDate(match[1], timezone);
      if (parsed) return parsed;
    }
  }

  if (title) {
    const titleDate = parseDate(title, timezone);
    if (titleDate) return titleDate;
  }

  const dates = extractDatesFromText(text, timezone);
  if (dates.length > 0) return dates[0].start.slice(0, 10);

  return null;
}

/**
 * Find start/end dates and times for an event from rendered page text.
 * @param {string} text - Rendered page content
 * @param {string} title - Event title
 * @param {string} timezone - IANA timezone
 * @returns {{startDate: string|null, startTime: string|null, endDate: string|null, endTime: string|null}}
 */
export function findEventDates(text, title, timezone = 'America/New_York') {
  const result = { startDate: null, startTime: null, endDate: null, endTime: null };
  if (!text) return result;

  const dates = extractDatesFromText(text, timezone);
  if (dates.length === 0) return result;

  const first = dates[0];
  result.startDate = first.start.slice(0, 10);
  if (first.start.length > 10) {
    result.startTime = first.start.slice(11);
  }

  if (first.end) {
    result.endDate = first.end.slice(0, 10);
    if (first.end.length > 10) {
      result.endTime = first.end.slice(11);
    }
  }

  return result;
}
