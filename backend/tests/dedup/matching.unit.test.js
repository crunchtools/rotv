/**
 * Matcher behavior the golden pairs do not reach: the date tie-break, how a
 * transitive group is reported, day blocking, and the POI-name loader.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMatchContext, newsPairMatch, dedupeNews, dedupeEvents, clusterBy } from '../../services/dedup/index.js';
import { loadMatchContext } from '../../services/dedup/candidates.js';

const ctx = createMatchContext();

describe('text+date tie-break', () => {
  const base = { poi_id: 1, poi_name: 'Beaver Marsh', source_url: 'https://a.org/1' };
  const a = { ...base, id: 1, title: 'Crews rebuild marsh boardwalk', summary: 'Trail crews rebuild boardwalk decking near the marsh overlook; volunteers register online.' };
  const b = { ...base, id: 2, title: 'Volunteers sought for boardwalk', source_url: 'https://b.org/2', summary: 'Volunteers sought as decking replacement continues along the boardwalk this autumn season.' };
  const on = (item, day) => ({ ...item, summary: `${item.summary} Work starts ${day}.` });
  // Put the bar just above this pair's own score, inside the date band
  const bandFor = (x, y) => {
    const score = newsPairMatch(x, y, createMatchContext({ news: { text: 2, shortTokens: 0 } })).score;
    return createMatchContext({ news: { text: score + 0.02, shortTokens: 0 } });
  };

  it('matches a borderline pair that names the same day', () => {
    const [x, y] = [on(a, 'October 24'), on(b, 'October 24')];
    const band = bandFor(x, y);
    expect(newsPairMatch(x, y, createMatchContext({ news: { text: 2, shortTokens: 0 } })).match).toBe(false);
    expect(newsPairMatch(x, y, band)).toMatchObject({ match: true, reason: 'text+date' });
  });

  it('does not match a borderline pair on different days', () => {
    const [x, y] = [on(a, 'October 24'), on(b, 'November 7')];
    expect(newsPairMatch(x, y, bandFor(x, y)).match).toBe(false);
  });
});

describe('collapsed records', () => {
  it('name the kept item and the direct match for a transitive group', () => {
    // A and C share no link; each shares one with B
    const a = { id: 1, poi_id: 1, title: 'Story one', source_url: 'https://a.org/x' };
    const b = { id: 2, poi_id: 2, title: 'Story two', source_url: 'https://b.org/y', alt_urls: ['https://a.org/x', 'https://c.org/z'] };
    const c = { id: 3, poi_id: 3, title: 'Story three', source_url: 'https://c.org/z' };
    const { kept, collapsed } = dedupeNews([a, b, c], ctx);
    expect(kept.map(k => k.id)).toEqual([1]);
    expect(collapsed).toEqual([
      { id: 2, title: 'Story two', into: 1, matched: 1, reason: 'url' },
      { id: 3, title: 'Story three', into: 1, matched: 2, reason: 'url' }
    ]);
  });
});

describe('blocking', () => {
  it('never compares items in different blocks', () => {
    const isSame = vi.fn(() => true);
    const groups = clusterBy(4, isSame, { block: i => (i < 2 ? 'a' : 'b') });
    expect(groups).toEqual([[0, 1], [2, 3]]);
    expect(isSame).toHaveBeenCalledTimes(2);
  });

  it('keeps event dedup within a day', () => {
    const fri = { id: 1, poi_id: 7, title: 'Fall Hike', start_date: '2026-10-23T14:00:00Z' };
    const sat = { id: 2, poi_id: 7, title: 'Fall Hike', start_date: '2026-10-24T14:00:00Z' };
    expect(dedupeEvents([fri, sat], ctx).kept).toHaveLength(2);
  });
});

describe('loadMatchContext', () => {
  const pool = (names) => ({ query: vi.fn(async () => ({ rows: names.map(name => ({ name })) })) });

  it('treats every POI name as a place word, skipping deleted POIs in SQL', async () => {
    const p = pool(['Primate Forest Overlook']);
    const loaded = await loadMatchContext(p, { now: 0 });
    expect(loaded.placeWords.has('overlook')).toBe(true);
    expect(p.query.mock.calls[0][0]).toContain('NOT COALESCE(deleted, false)');
  });

  it('caches per pool until the names go stale', async () => {
    const p = pool(['A Place']);
    await loadMatchContext(p, { now: 0 });
    await loadMatchContext(p, { now: 60_000 });
    expect(p.query).toHaveBeenCalledTimes(1);
    await loadMatchContext(p, { now: 11 * 60_000 });
    expect(p.query).toHaveBeenCalledTimes(2);
  });

  it('retries after a failed query', async () => {
    const p = { query: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ rows: [] }) };
    await expect(loadMatchContext(p, { now: 0 })).rejects.toThrow('down');
    await expect(loadMatchContext(p, { now: 0 })).resolves.toHaveProperty('placeWords');
  });
});
