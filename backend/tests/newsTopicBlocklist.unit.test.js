/**
 * Unit tests for the news_topic_blocklist deny list (filterLists.js).
 * Crime/violence stories from trusted news domains auto-approve and attach to
 * park POIs; this list hard-rejects them. News-only, whole-word matching.
 */
import { describe, it, expect, vi } from 'vitest';
import { DENY_LISTS, denyReason } from '../services/filterLists.js';

const entry = DENY_LISTS.find(l => l.key === 'news_topic_blocklist');
const TERMS = ['manhunt', 'murder', 'attempted murder', 'shooting', 'arrest'];

// Mock pool where only news_topic_blocklist is populated; every other setting
// resolves empty so denyReason exercises just this list.
const poolWith = (terms) => ({
  query: vi.fn(async (_sql, params) =>
    params?.[0] === 'news_topic_blocklist'
      ? { rows: [{ value: JSON.stringify(terms) }] }
      : { rows: [] }
  )
});

describe('news_topic_blocklist registry entry', () => {
  it('is registered and scoped to news only', () => {
    expect(entry).toBeTruthy();
    expect(entry.contentTypes).toEqual(['news']);
  });

  it('matches a crime term in the title', () => {
    expect(entry.matches({ title: 'Inside multi-county manhunt and chase' }, TERMS)).toBe(true);
  });

  it('matches a multi-word phrase in the summary', () => {
    expect(entry.matches({ title: 'Morning Digest', summary: 'attempted murder suspect arrested' }, TERMS)).toBe(true);
  });

  it('matches on whole words only — no substring false positives', () => {
    // "arrest" must not fire on "arresting", "shooting" must not fire on "overshooting"
    expect(entry.matches({ title: 'An arresting sunset over the valley' }, TERMS)).toBe(false);
    expect(entry.matches({ title: 'Overshooting the trailhead by a mile' }, TERMS)).toBe(false);
  });

  it('ignores the description field (news uses title + summary)', () => {
    expect(entry.matches({ title: 'Trail cleanup', description: 'a murder of crows' }, TERMS)).toBe(false);
  });

  it('does not match with an empty term list or clean content', () => {
    expect(entry.matches({ title: 'Guided kayak trips this weekend' }, TERMS)).toBe(false);
    expect(entry.matches({ title: 'manhunt' }, [])).toBe(false);
  });

  it('sweepFragment builds a word-boundary regex over the text columns', () => {
    const frag = entry.sweepFragment(TERMS, ['title', 'summary']);
    expect(frag.sql).toBe('(title ~* $1 OR summary ~* $1)');
    expect(frag.params).toHaveLength(1);
    expect(frag.params[0]).toBe('\\y(manhunt|murder|attempted murder|shooting|arrest)\\y');
  });

  it('sweepFragment returns null when no valid terms', () => {
    expect(entry.sweepFragment([], ['title', 'summary'])).toBeNull();
    expect(entry.sweepFragment(['', '  '], ['title', 'summary'])).toBeNull();
  });
});

describe('denyReason integration', () => {
  it('rejects a matching news item', async () => {
    const reason = await denyReason(poolWith(TERMS), 'news', { title: 'multi-county manhunt' });
    expect(reason).toBe('Rejected: matches news topic deny list');
  });

  it('does not reject an event with the same wording (news-only)', async () => {
    const reason = await denyReason(poolWith(TERMS), 'event', { title: 'Murder Mystery Dinner Theater' });
    expect(reason).toBeNull();
  });

  it('passes clean news through', async () => {
    const reason = await denyReason(poolWith(TERMS), 'news', { title: 'Summit Metro Parks shredding event July 24' });
    expect(reason).toBeNull();
  });
});
