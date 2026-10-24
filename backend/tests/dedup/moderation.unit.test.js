/**
 * Moderation rejects only copies (spec 054). A rejected story leaves the site,
 * so a later update, another edition of a series, or a second take must stay.
 * Pairs are real items from the May–Oct replay.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMatchContext, bestNewsMatch, MODERATION_NEWS_THRESHOLDS } from '../../services/dedup/index.js';
import { findNewsCandidates, findEventCandidates } from '../../services/dedup/candidates.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/dedup/${name}`, import.meta.url)));
const poiNames = fixture('poi-names.json');
const strict = createMatchContext({ poiNames, news: MODERATION_NEWS_THRESHOLDS });

describe('moderation duplicate bar', () => {
  for (const { expected, why, items: [item, published] } of fixture('moderation-pairs.json')) {
    it(`${expected}: ${why} (#${item.id} vs #${published.id})`, () => {
      expect(Boolean(bestNewsMatch(item, [published], strict))).toBe(expected === 'reject');
    });
  }

  it('picks the closest of several candidates', () => {
    const [{ items: [item, copy] }] = fixture('moderation-pairs.json');
    const other = { ...copy, id: 1, title: 'Unrelated trail news', summary: 'Crews repaved a parking lot.', source_url: 'https://x.org/1', alt_urls: [] };
    expect(bestNewsMatch(item, [other, copy], strict).of.id).toBe(copy.id);
  });
});

describe('candidate queries', () => {
  const pool = () => ({ query: vi.fn(async () => ({ rows: [] })) });

  it('search all POIs by trigram title or URL, around the item date', async () => {
    const p = pool();
    await findNewsCandidates(p, { id: 5, title: 'Primate Forest opens', source_url: 'https://A.org/x/', publication_date: '2026-10-21T16:00:00Z' });
    const [sql, params] = p.query.mock.calls[0];
    expect(sql).toContain('n.title % $2');
    expect(sql).not.toMatch(/poi_id\s*=/);
    expect(params).toEqual([5, 'Primate Forest opens', 'https://a.org/x', '2026-10-21T16:00:00Z', ['published', 'auto_approved'], 14]);
  });

  it('skip an event with no start date', async () => {
    const p = pool();
    expect(await findEventCandidates(p, { title: 'Hike' })).toEqual([]);
    expect(p.query).not.toHaveBeenCalled();
  });
});
