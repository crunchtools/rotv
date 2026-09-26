import * as chrono from 'chrono-node';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DateExtractor');

// chrono-node can throw on pathological input; treat that as "no dates found" but keep it visible.
function chronoParse(text, timezone) {
  try {
    return chrono.parse(text, { instant: new Date(), timezone });
  } catch (err) {
    logger.debug(`chrono.parse failed on ${JSON.stringify(text.slice(0, 80))}: ${err.message}`);
    return [];
  }
}

export function parseDate(raw, timezone = 'America/New_York') {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    if (y < 2000 || y > 2100) return null;
    const probe = new Date(y, m - 1, d);
    if (probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d) {
      return trimmed;
    }
  }

  const parsedDates = chronoParse(trimmed, timezone);
  if (parsedDates.length === 0) return null;

  const d = parsedDates[0].start;
  const year = d.get('year');
  const month = d.get('month');
  const day = d.get('day');
  if (!year || !month || !day) return null;
  if (year < 2000 || year > 2100) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDateTime(raw, timezone = 'America/New_York') {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // chrono-node ignores the timezone parameter for bare ISO strings (no Z, no ±offset)
  // and treats them as UTC. Use localToUTC for correct interpretation.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed) &&
      !/[Zz]/.test(trimmed) &&
      !/[+-]\d{2}(:\d{2})?$/.test(trimmed)) {
    return localToUTC(trimmed, timezone);
  }

  const parsedDates = chronoParse(trimmed, timezone);
  if (parsedDates.length === 0) return null;

  const d = parsedDates[0].start.date();
  return d.toISOString().substring(0, 19);
}


export function extractUrlDate(url) {
  if (!url) return null;
  let path;
  try { path = new URL(url).pathname; } catch { path = url; }

  const validateDateParts = (yearStr, m, d) => {
    const year = parseInt(yearStr, 10), month = parseInt(m, 10), day = parseInt(d, 10);
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${yearStr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const wpMatch = path.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
  if (wpMatch) {
    const isoDate = validateDateParts(wpMatch[1], wpMatch[2], wpMatch[3]);
    if (isoDate) return isoDate;
  }

  const compactMatch = path.match(/\/(\d{4})(\d{2})(\d{2})[^/\d]/);
  if (compactMatch) {
    const isoDate = validateDateParts(compactMatch[1], compactMatch[2], compactMatch[3]);
    if (isoDate) return isoDate;
  }

  const anprMatch = path.match(/\/(\d{4})\/(\d{2})(\d{2})(?:\/|$)/);
  if (anprMatch) {
    const isoDate = validateDateParts(anprMatch[1], anprMatch[2], anprMatch[3]);
    if (isoDate) return isoDate;
  }

  return null;
}

export function normalizeDateSources(rawSources = {}, timezone = 'America/New_York', mode = 'date') {
  const parser = mode === 'datetime' ? parseDateTime : parseDate;
  const norm = (raw) => {
    const parsed = raw ? parser(String(raw), timezone) : null;
    if (parsed && mode === 'datetime') return parsed.substring(0, 16);
    return parsed;
  };
  const normList = (arr) => (arr || []).map(norm).filter(Boolean);

  return {
    jsonLd:    normList(rawSources.jsonLd),
    meta:      normList(rawSources.meta),
    timeTags:  normList(rawSources.timeTags),
    url:       norm(rawSources.url),
    searchDate: norm(rawSources.searchDate),
    social:    normList(rawSources.social)
  };
}

function scoreDeterministicSources(sources = {}) {
  const today = new Date().toISOString().substring(0, 10);
  const scores = {};
  const sourceMap = {};

  const add = (date, weight, label) => {
    if (!date) return;
    scores[date] = (scores[date] || 0) + weight;
    if (!sourceMap[date]) sourceMap[date] = [];
    sourceMap[date].push(label);
  };

  for (const d of (sources.jsonLd || [])) add(d, 4, 'json-ld');
  for (const d of (sources.meta || [])) add(d, 1, 'meta');
  for (const d of (sources.timeTags || [])) add(d, 1, 'time-tag');
  add(sources.url, 1, 'url');
  // Search-engine dates have proven reliable in moderation (often dead-on, even for
  // Facebook/blog sources with no on-page date), so weight them on par with JSON-LD —
  // an SE date alone then clears the date gate. (spec 030)
  add(sources.searchDate, 4, 'search-date');
  // Facebook/Instagram post timestamps (publish_time/taken_at/uploadDate) are the post's
  // authoritative structural date — weight them on par with JSON-LD so a real social
  // timestamp clears the gate on its own, instead of leaving social content (~half the
  // moderation queue) to LLM date guesses that the date gate then distrusts. (PR #496)
  for (const d of (sources.social || [])) add(d, 4, 'social-timestamp');

  return { scores, sourceMap };
}

export function scoreDateConsensus(deterministicSources = {}, llmResults = []) {
  const { scores, sourceMap } = scoreDeterministicSources(deterministicSources);

  for (const r of llmResults) {
    if (r && /^\d{4}-\d{2}-\d{2}/.test(r)) {
      scores[r] = (scores[r] || 0) + 1;
      if (!sourceMap[r]) sourceMap[r] = [];
      sourceMap[r].push('llm-vote');
    }
  }

  if (Object.keys(scores).length === 0) {
    return { date: null, score: 0, sourceMap: {} };
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const isTied = sorted.length > 1 && sorted[0][1] === sorted[1][1];

  if (isTied) {
    return { date: sorted[0][0], score: 0, sourceMap };
  }

  return { date: sorted[0][0], score: sorted[0][1], sourceMap };
}

export function localToUTC(localStr, timezone = 'America/New_York') {
  if (!localStr || !localStr.includes('T')) return null;
  // Eastern is either -04:00 (EDT) or -05:00 (EST). Try both, verify with round-trip.
  for (const offset of ['-04:00', '-05:00']) {
    const needsSeconds = (localStr.match(/:/g) || []).length < 2;
    const d = new Date(localStr + (needsSeconds ? ':00' : '') + offset);
    if (isNaN(d.getTime())) continue;
    const rt = d.toLocaleString('sv-SE', { timeZone: timezone }).replace(' ', 'T').substring(0, 16);
    if (rt === localStr.substring(0, 16)) {
      return d.toISOString().substring(0, 19);
    }
  }
  return null;
}
