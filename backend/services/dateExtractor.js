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
    const probe = new Date(y, m - 1, d);
    if (probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d) {
      return trimmed;
    }
  }

  let parsedDates;
  try {
    parsedDates = chrono.parse(trimmed, { instant: new Date(), timezone });
  } catch { return null; }
  if (parsedDates.length === 0) return null;

  const d = parsedDates[0].start;
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

  let parsedDates;
  try {
    parsedDates = chrono.parse(trimmed, { instant: new Date(), timezone });
  } catch { return null; }
  if (parsedDates.length === 0) return null;

  const d = parsedDates[0].start;
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
const RELATIVE_DATE_WORDS = /^(now|today|tomorrow|yesterday|this morning|this evening|this afternoon|tonight|last night)$/i;

export function extractDatesFromText(text, timezone = 'America/New_York') {
  if (!text || typeof text !== 'string') return [];

  let parsedDates;
  try {
    parsedDates = chrono.parse(text, { instant: new Date(), timezone });
  } catch { return []; }
  parsedDates = parsedDates.filter(r => {
    const text = r.text.trim();
    if (RELATIVE_DATE_WORDS.test(text)) return false;
    if (text.length < 5) return false;
    return true;
  });
  return parsedDates.map(r => {
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
 * Extract a date from a URL path.
 * Supports multiple patterns:
 *   /YYYY/MM/DD/           — WordPress, news sites (e.g. /2024/03/15/article-slug/)
 *   /YYYYMMDD-             — NPS (e.g. /news/20250929-prescribed-fires.htm)
 *   /YYYY/MMDD             — ANPR (e.g. /release/2026/0109)
 * @param {string} url - The article URL
 * @returns {string|null} 'YYYY-MM-DD' or null
 */
export function extractUrlDate(url) {
  if (!url) return null;
  let path;
  try { path = new URL(url).pathname; } catch { path = url; }

  const validateDateParts = (y, m, d) => {
    const year = parseInt(y, 10), month = parseInt(m, 10), day = parseInt(d, 10);
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const wpMatch = path.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
  if (wpMatch) {
    const isoDate = validateDateParts(wpMatch[1], wpMatch[2], wpMatch[3]);
    if (isoDate) return isoDate;
  }

  const compactMatch = path.match(/\/(\d{4})(\d{2})(\d{2})[^\/\d]/);
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

/**
 * Normalize raw date strings from all extraction sources to ISO 8601 (YYYY-MM-DD).
 * Unparseable strings are discarded. This is the normalization step between
 * extraction and consensus scoring.
 *
 * @param {Object} rawSources - Raw extracted date strings by source
 * @param {string[]} rawSources.jsonLd   - Raw strings from JSON-LD
 * @param {string[]} rawSources.meta     - Raw strings from meta tags
 * @param {string[]} rawSources.timeTags - Raw strings from <time> elements
 * @param {string|null} rawSources.url   - Raw string from URL pattern
 * @param {string} [timezone]            - IANA timezone for chrono-node parsing
 * @returns {Object} Normalized deterministic sources with only valid YYYY-MM-DD strings
 */
export function normalizeDateSources(rawSources = {}, timezone = 'America/New_York', mode = 'date') {
  const parser = mode === 'datetime' ? parseDateTime : parseDate;
  const norm = (raw) => {
    const parsed = raw ? parser(String(raw), timezone) : null;
    if (parsed && mode === 'datetime') return parsed.substring(0, 16);
    return parsed;
  };
  const normList = (arr) => (arr || []).map(norm).filter(Boolean);

  return {
    jsonLd:   normList(rawSources.jsonLd),
    meta:     normList(rawSources.meta),
    timeTags: normList(rawSources.timeTags),
    url:      norm(rawSources.url)
  };
}

/**
 * Score deterministic date sources (everything except LLM).
 *
 * Weights:
 *   JSON-LD datePublished / startDate  — 4 pts (most authoritative structured data)
 *   Meta tags (OG, Parsely, DC)         — 1 pt  (common but editable by CMS)
 *   HTML <time datetime>                — 1 pt  (structural HTML, usually reliable)
 *   URL path date                       — 1 pt  (static, never wrong when present)
 *
 * LLM scoring is handled separately by scoreLlmConsensus() and added after.
 *
 * @param {Object} sources - Normalized date strings by source (from normalizeDateSources)
 * @param {string[]} sources.jsonLd   - ISO dates from JSON-LD (weight 4 each)
 * @param {string[]} sources.meta     - ISO dates from meta tags (weight 1 each)
 * @param {string[]} sources.timeTags - ISO dates from <time> elements (weight 1 each)
 * @param {string|null} sources.url   - ISO date from URL path (weight 1)
 * @returns {{ scores: Object, sourceMap: Object }} Raw per-date scores and source map
 */
export function scoreDeterministicSources(sources = {}) {
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

  return { scores, sourceMap };
}

/**
 * Score LLM multi-vote consensus results.
 * 5/5 unanimous → 4 pts (minus competing deterministic points)
 * 3-4/5 majority → 1 pt
 * No majority   → 0 pts
 *
 * @param {(string|null)[]} results - Array of extracted date strings from N LLM calls
 * @param {number} competingDeterministicPoints - Sum of deterministic source points for dates != consensus date
 * @returns {{ date: string|null, score: number, label: string, votes: Object }}
 */
export function scoreLlmConsensus(results, competingDeterministicPoints = 0) {
  const votes = {};
  for (const r of results) {
    if (r && /^\d{4}-\d{2}-\d{2}/.test(r)) {
      votes[r] = (votes[r] || 0) + 1;
    }
  }

  if (Object.keys(votes).length === 0) {
    return { date: null, score: 0, label: 'no-date', votes };
  }

  const total = results.length;
  const bestDate = Object.keys(votes).reduce((a, b) => votes[a] >= votes[b] ? a : b);
  const bestCount = votes[bestDate];

  if (bestCount === total) {
    const score = Math.max(0, 4 - competingDeterministicPoints);
    return { date: bestDate, score, label: 'llm-consensus', votes };
  } else if (bestCount > total / 2) {
    return { date: bestDate, score: 1, label: 'llm-majority', votes };
  } else {
    return { date: null, score: 0, label: 'llm-split', votes };
  }
}

/**
 * Combined consensus scoring: deterministic sources + LLM multi-vote.
 * Replaces the old scoreDateConsensus that included a single LLM vote at 2 pts.
 *
 * @param {Object} deterministicSources - From normalizeDateSources (without llm field)
 * @param {(string|null)[]} llmResults - Array of date strings from multi-vote LLM calls
 * @returns {{ date: string|null, score: number, sourceMap: Object }}
 */
export function scoreDateConsensus(deterministicSources = {}, llmResults = []) {
  const { scores, sourceMap } = scoreDeterministicSources(deterministicSources);

  if (llmResults.length > 0) {
    const prelimLlm = scoreLlmConsensus(llmResults, 0);

    if (prelimLlm.date && prelimLlm.score > 0) {
      // Net penalty: opposing minus supporting, so LLM breaks deterministic ties
      const supportingPoints = scores[prelimLlm.date] || 0;
      let opposingPoints = 0;
      for (const [date, pts] of Object.entries(scores)) {
        if (date !== prelimLlm.date) opposingPoints += pts;
      }
      const competingPoints = Math.max(0, opposingPoints - supportingPoints);

      const llmVote = scoreLlmConsensus(llmResults, competingPoints);
      if (llmVote.date && llmVote.score > 0) {
        const label = `${llmVote.label}(${Math.max(...Object.values(llmVote.votes))}/${llmResults.length})`;
        scores[llmVote.date] = (scores[llmVote.date] || 0) + llmVote.score;
        if (!sourceMap[llmVote.date]) sourceMap[llmVote.date] = [];
        sourceMap[llmVote.date].push(label);
      }
    }
  }

  if (Object.keys(scores).length === 0) {
    return { date: null, score: 0, sourceMap: {} };
  }

  const bestDate = Object.keys(scores).reduce((a, b) => {
    if (scores[a] !== scores[b]) return scores[a] > scores[b] ? a : b;
    const aHasLlm = (sourceMap[a] || []).some(s => s.startsWith('llm-'));
    const bHasLlm = (sourceMap[b] || []).some(s => s.startsWith('llm-'));
    if (aHasLlm !== bHasLlm) return aHasLlm ? a : b;
    return a > b ? a : b;
  });

  return { date: bestDate, score: scores[bestDate], sourceMap };
}

/**
 * Find start/end dates and times for an event from rendered page text.
 * @param {string} text - Rendered page content
 * @param {string} title - Event title
 * @param {string} timezone - IANA timezone
 * @returns {{startDate: string|null, startTime: string|null, endDate: string|null, endTime: string|null}}
 */
export function findEventDates(text, title, timezone = 'America/New_York') {
  const eventDates = { startDate: null, startTime: null, endDate: null, endTime: null };
  if (!text) return eventDates;

  const dates = extractDatesFromText(text, timezone);
  if (dates.length === 0) return eventDates;

  const first = dates[0];
  eventDates.startDate = first.start.slice(0, 10);
  if (first.start.length > 10) {
    eventDates.startTime = first.start.slice(11);
  }

  if (first.end) {
    eventDates.endDate = first.end.slice(0, 10);
    if (first.end.length > 10) {
      eventDates.endTime = first.end.slice(11);
    }
  }

  return eventDates;
}
