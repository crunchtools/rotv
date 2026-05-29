// Unified handling for the admin-managed filter lists (mirrors the frontend's
// single News & Events Filters section). One place to load a list setting, and
// a data-driven registry of the hard-reject "deny lists" that drive both the
// per-item moderation check and the retroactive sweep. Adding a deny list is a
// single registry entry. Domain reputation (trusted/blocklist domains) and the
// crawler's content paths are deliberately NOT here — they're scoring/crawling
// mechanisms, not hard rejects.

// Load a JSON-array admin setting. Returns [] when unset or malformed.
export async function loadListSetting(pool, key) {
  const res = await pool.query('SELECT value FROM admin_settings WHERE key = $1', [key]);
  if (!res.rows.length || !res.rows[0].value) return [];
  try {
    const parsed = JSON.parse(res.rows[0].value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(`[filterLists] Failed to parse ${key}:`, e.message);
    return [];
  }
}

// Normalize a stored URL and a blocklist prefix the same way getDomainReputation does
// (drop scheme + leading www + trailing slash), so a blocklist entry that is a bare
// domain or a domain+path matches via startsWith. Kept local to avoid a circular import
// with moderationService.
function normalizeUrlForPrefix(url) {
  try {
    const u = new URL(url);
    return (u.hostname.toLowerCase().replace(/^www\./, '') + u.pathname).toLowerCase().replace(/\/+$/, '');
  } catch {
    return null;
  }
}
function normalizeBlocklistPrefix(prefix) {
  return String(prefix).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

// Registry of hard-reject deny lists, applied during moderation.
// - matches(row, values): per-item test.
// - sweepFragment(values, textCols): SQL WHERE fragment for the retroactive
//   bulk reject, built against a given table's text columns (null = skip).
// - contentTypes: which moderation content types the list applies to.
export const DENY_LISTS = [
  {
    key: 'news_collection_excluded_pois',
    reason: 'Rejected: POI is on the deny list',
    contentTypes: ['news', 'event', 'photo'],
    matches: (row, ids) => ids.includes(row.poi_id),
    sweepFragment: (ids) => ({ sql: 'poi_id = ANY($1)', params: [ids] })
  },
  {
    key: 'event_content_blocklist',
    reason: 'Rejected: matches content deny list',
    contentTypes: ['news', 'event'],
    matches: (row, phrases) => {
      const haystack = [row.title, row.description, row.summary, row.location_details]
        .filter(Boolean).join(' ').toLowerCase();
      return phrases.some(p => typeof p === 'string' && p.trim() && haystack.includes(p.trim().toLowerCase()));
    },
    sweepFragment: (phrases, textCols) => {
      const valid = phrases.filter(p => typeof p === 'string' && p.trim());
      if (!valid.length) return null;
      const conds = valid.flatMap((_, i) => textCols.map(c => `${c} ILIKE $${i + 1}`)).join(' OR ');
      return { sql: `(${conds})`, params: valid.map(p => `%${p.trim()}%`) };
    }
  },
  {
    // Domain/URL blocklist. Previously enforced only at collection time (URLs skipped
    // before fetching); now also a retroactive hard reject so blocking a domain cleans
    // up items already collected from it.
    key: 'blocklist_urls',
    reason: 'Rejected: source domain is on the URL blocklist',
    contentTypes: ['news', 'event'],
    matches: (row, prefixes) => {
      const norm = normalizeUrlForPrefix(row.source_url);
      if (!norm) return false;
      return prefixes.some(p => typeof p === 'string' && p.trim() && norm.startsWith(normalizeBlocklistPrefix(p)));
    },
    sweepFragment: (prefixes) => {
      const valid = prefixes.filter(p => typeof p === 'string' && p.trim());
      if (!valid.length) return null;
      const conds = valid.map((_, i) => `regexp_replace(lower(source_url), '^https?://(www\\.)?|/+$', '', 'g') LIKE $${i + 1}`).join(' OR ');
      return { sql: `source_url IS NOT NULL AND (${conds})`, params: valid.map(p => normalizeBlocklistPrefix(p) + '%') };
    }
  }
];

// Per-item moderation check. Returns a rejection reason string, or null.
export async function denyReason(pool, contentType, row) {
  for (const list of DENY_LISTS) {
    if (!list.contentTypes.includes(contentType)) continue;
    const values = await loadListSetting(pool, list.key);
    if (values.length && list.matches(row, values)) return list.reason;
  }
  return null;
}

// Retroactive sweep: reject any stored (non-rejected) news/event matching a deny
// list, so adding to a list cleans up already-approved items. Returns counts.
export async function sweepDenyLists(pool, { runId, logInfo } = {}) {
  const tables = [
    { name: 'poi_events', textCols: ['title', 'description'] },
    { name: 'poi_news', textCols: ['title', 'summary'] }
  ];
  let events = 0;
  let news = 0;
  for (const list of DENY_LISTS) {
    const values = await loadListSetting(pool, list.key);
    if (!values.length) continue;
    for (const table of tables) {
      const frag = list.sweepFragment(values, table.textCols);
      if (!frag) continue;
      const reasonIdx = frag.params.length + 1;
      const res = await pool.query(
        `UPDATE ${table.name} SET moderation_status = 'rejected', moderation_processed = true, ai_reasoning = $${reasonIdx}
         WHERE moderation_status <> 'rejected' AND ${frag.sql}`,
        [...frag.params, list.reason]
      );
      if (table.name === 'poi_events') events += res.rowCount;
      else news += res.rowCount;
    }
  }
  if ((events + news) > 0) {
    console.log(`[Moderation] Deny-list sweep rejected ${events} events, ${news} news`);
    if (runId != null && logInfo) {
      logInfo(runId, 'moderation', null, null, `Deny-list sweep: rejected ${events} events, ${news} news`);
    }
  }
  return { events, news };
}
