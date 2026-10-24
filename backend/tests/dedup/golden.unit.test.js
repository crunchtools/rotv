/**
 * Golden pairs from real digests (May–Oct replay of the weekly send). Each
 * fixture says whether the two items are one story or one event, why, and for
 * a match, which signal should find it. Adding a regression is a JSON entry in
 * tests/fixtures/dedup/, not a new test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMatchContext, newsPairMatch, eventPairMatch, dedupeNews, dedupeEvents } from '../../services/dedup/index.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/dedup/${name}`, import.meta.url)));
const ctx = createMatchContext({ poiNames: fixture('poi-names.json') });
const newsPairs = fixture('news-pairs.json');
const eventPairs = fixture('event-pairs.json');

describe('news golden pairs', () => {
  for (const { expected, reason, why, items: [a, b] } of newsPairs) {
    it(`${expected}: ${why} (#${a.id}, #${b.id})`, () => {
      const result = newsPairMatch(a, b, ctx);
      expect(result.match).toBe(expected === 'same');
      if (reason) expect(result.reason.split(':')[0]).toBe(reason);
    });
  }

  it('gives the same verdict in both directions', () => {
    for (const { items: [a, b] } of newsPairs) {
      expect(newsPairMatch(a, b, ctx).match).toBe(newsPairMatch(b, a, ctx).match);
    }
  });

  it('collapses each same pair to one item in a batch', () => {
    for (const { expected, items } of newsPairs) {
      expect(dedupeNews(items, ctx).kept).toHaveLength(expected === 'same' ? 1 : 2);
    }
  });
});

describe('event golden pairs', () => {
  for (const { expected, reason, why, items: [a, b] } of eventPairs) {
    it(`${expected}: ${why} (#${a.id}, #${b.id})`, () => {
      const result = eventPairMatch(a, b, ctx);
      expect(result.match).toBe(expected === 'same');
      if (reason) expect(result.reason).toBe(reason);
    });
  }

  it('gives the same verdict in both directions', () => {
    for (const { items: [a, b] } of eventPairs) {
      expect(eventPairMatch(a, b, ctx).match).toBe(eventPairMatch(b, a, ctx).match);
    }
  });

  it('collapses each same pair to one event in a batch', () => {
    for (const { expected, items } of eventPairs) {
      expect(dedupeEvents(items, ctx).kept).toHaveLength(expected === 'same' ? 1 : 2);
    }
  });
});
