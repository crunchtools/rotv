/**
 * Properties every dedup run must keep, checked over all golden items as one
 * batch: the grouping does not depend on input order, deduping twice changes
 * nothing, and page chrome appended to a summary never splits a story.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMatchContext, dedupeNews, dedupeEvents, newsPairMatch, clusterBy } from '../../services/dedup/index.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/dedup/${name}`, import.meta.url)));
const ctx = createMatchContext({ poiNames: fixture('poi-names.json') });
const newsPairs = fixture('news-pairs.json');
const allNews = [...new Map(newsPairs.flatMap(p => p.items).map(i => [i.id, i])).values()];
const allEvents = [...new Map(fixture('event-pairs.json').flatMap(p => p.items).map(i => [i.id, i])).values()];

// Deterministic shuffles, so a failure reproduces
function shuffled(items, seed) {
  const out = [...items];
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The grouping as a canonical string: each group's sorted ids, groups sorted
function partition(items, result) {
  const groupOf = new Map(result.kept.map(k => [k.id, [k.id]]));
  for (const c of result.collapsed) groupOf.get(c.into).push(c.id);
  return [...groupOf.values()].map(g => g.sort((a, b) => a - b).join(',')).sort().join(' | ');
}

describe('dedup properties', () => {
  it('groups news the same way in any input order', () => {
    const expected = partition(allNews, dedupeNews(allNews, ctx));
    for (let seed = 1; seed <= 20; seed++) {
      const order = shuffled(allNews, seed);
      expect(partition(order, dedupeNews(order, ctx))).toBe(expected);
    }
  });

  it('groups events the same way in any input order', () => {
    const expected = partition(allEvents, dedupeEvents(allEvents, ctx));
    for (let seed = 1; seed <= 20; seed++) {
      const order = shuffled(allEvents, seed);
      expect(partition(order, dedupeEvents(order, ctx))).toBe(expected);
    }
  });

  it('changes nothing when run on its own output', () => {
    const once = dedupeNews(allNews, ctx).kept;
    expect(dedupeNews(once, ctx).collapsed).toEqual([]);
    const events = dedupeEvents(allEvents, ctx).kept;
    expect(dedupeEvents(events, ctx).collapsed).toEqual([]);
  });

  it('never splits a story when page chrome is appended to a summary', () => {
    const chrome = [
      ' Published: Oct. 21, 2026 at 9:26 AM PDT|Updated: 16 hours ago.',
      ' By Jane Doe | Akron Beacon Journal | Local News',
      ' 5 min read. Share on Facebook',
      ' | Fox 8 Cleveland WJW'
    ];
    for (const { expected, items: [a, b] } of newsPairs.filter(p => p.expected === 'same')) {
      for (const tail of chrome) {
        const noisy = { ...b, summary: `${b.summary || ''}${tail}` };
        expect(newsPairMatch(a, noisy, ctx).match, `${a.id}/${b.id} + "${tail}"`).toBe(expected === 'same');
      }
    }
  });

  it('keeps short same-POI headlines apart when they only share a few words', () => {
    // Weakness noted in review: overlap scored against the shorter item makes short items cheap to merge
    const closed = { id: 1, poi_id: 5753, poi_name: 'Akron Zoo', title: 'Akron Zoo closed Monday for staff training', summary: null };
    const banquet = { id: 2, poi_id: 5753, poi_name: 'Akron Zoo', title: 'Akron Zoo staff honored at Monday training banquet', summary: null };
    expect(newsPairMatch(closed, banquet, ctx).match).toBe(false);
  });
});

describe('clusterBy', () => {
  it('joins matches transitively', () => {
    // 0~1 and 1~2 match, 0 and 2 do not: still one group
    const links = new Set(['0,1', '1,2']);
    expect(clusterBy(4, (i, j) => links.has(`${i},${j}`))).toEqual([[0, 1, 2], [3]]);
  });

  it('returns singletons when nothing matches', () => {
    expect(clusterBy(3, () => false)).toEqual([[0], [1], [2]]);
  });
});
