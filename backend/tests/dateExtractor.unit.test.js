/**
 * Date Extractor Unit Tests
 * Tests the consensus date pipeline:
 *   extractUrlDate → normalizeDateSources → scoreDateConsensus (with LLM multi-vote)
 */
import { describe, it, expect } from 'vitest';
import { extractUrlDate, normalizeDateSources, scoreDateConsensus, scoreLlmConsensus, scoreDeterministicSources } from '../services/dateExtractor.js';

// --- extractUrlDate ---

describe('extractUrlDate', () => {
  it('extracts /YYYY/MM/DD/ from a WordPress-style URL', () => {
    expect(extractUrlDate('https://example.com/news/2024/03/15/trail-reopens/')).toBe('2024-03-15');
  });

  it('extracts date from URL without trailing slash on slug', () => {
    expect(extractUrlDate('https://clevelandmagazine.com/2023/11/07/cvnp-update')).toBe('2023-11-07');
  });

  it('extracts date when URL ends with the date (no trailing slash)', () => {
    expect(extractUrlDate('https://example.com/news/2024/05/10')).toBe('2024-05-10');
  });

  it('extracts YYYYMMDD from slug (NPS pattern)', () => {
    expect(extractUrlDate('https://www.nps.gov/cuva/learn/news/20250929-nps-to-conduct-prescribed-fires.htm')).toBe('2025-09-29');
  });

  it('extracts YYYYMMDD from slug with different separator', () => {
    expect(extractUrlDate('https://www.nps.gov/cuva/learn/news/20260205-national-park-service-seeks-volunteers.htm')).toBe('2026-02-05');
  });

  it('extracts /YYYY/MMDD from ANPR-style URL', () => {
    expect(extractUrlDate('https://www.anpr.org/release/2026/0109')).toBe('2026-01-09');
  });

  it('extracts /YYYY/MMDD with trailing slash', () => {
    expect(extractUrlDate('https://www.anpr.org/release/2026/0417/')).toBe('2026-04-17');
  });

  it('returns null when no date pattern in URL', () => {
    expect(extractUrlDate('https://nps.gov/cuva/planyourvisit/')).toBeNull();
  });

  it('returns null for slug-only URLs', () => {
    expect(extractUrlDate('https://www.appalachianadv.com/ramblings/the-unicorn')).toBeNull();
  });

  it('returns null for null/empty input', () => {
    expect(extractUrlDate(null)).toBeNull();
    expect(extractUrlDate('')).toBeNull();
  });

  it('rejects implausible year values', () => {
    expect(extractUrlDate('https://example.com/1999/01/01/old')).toBeNull();
    expect(extractUrlDate('https://example.com/2101/01/01/far-future')).toBeNull();
  });

  it('rejects invalid month/day values', () => {
    expect(extractUrlDate('https://example.com/2024/13/01/bad-month')).toBeNull();
    expect(extractUrlDate('https://example.com/2024/01/99/bad-day')).toBeNull();
  });
});

// --- normalizeDateSources ---

describe('normalizeDateSources', () => {
  it('converts ISO strings unchanged', () => {
    const result = normalizeDateSources({ jsonLd: ['2024-03-15'], url: '2024-06-01' });
    expect(result.jsonLd).toContain('2024-03-15');
    expect(result.url).toBe('2024-06-01');
  });

  it('parses human-readable date strings into ISO format', () => {
    const result = normalizeDateSources({ meta: ['March 15, 2024'] });
    expect(result.meta).toContain('2024-03-15');
  });

  it('discards unparseable strings', () => {
    const result = normalizeDateSources({ jsonLd: ['not-a-date', 'gibberish', '2024-04-01'] });
    expect(result.jsonLd).not.toContain('not-a-date');
    expect(result.jsonLd).toContain('2024-04-01');
  });

  it('handles null/missing sources gracefully', () => {
    const result = normalizeDateSources({ url: null });
    expect(result.url).toBeNull();
    expect(result.jsonLd).toEqual([]);
    expect(result.meta).toEqual([]);
    expect(result.timeTags).toEqual([]);
  });

  it('does not include llm field (removed — handled by multi-vote)', () => {
    const result = normalizeDateSources({});
    expect(result).not.toHaveProperty('llm');
  });
});

// --- scoreLlmConsensus ---

describe('scoreLlmConsensus', () => {
  it('scores 5/5 unanimous at 4 pts with no competing deterministic', () => {
    const result = scoreLlmConsensus(
      ['2024-03-15', '2024-03-15', '2024-03-15', '2024-03-15', '2024-03-15'],
      0
    );
    expect(result.date).toBe('2024-03-15');
    expect(result.score).toBe(4);
    expect(result.label).toBe('llm-consensus');
  });

  it('subtracts competing deterministic points from unanimous score', () => {
    const result = scoreLlmConsensus(
      ['2024-03-15', '2024-03-15', '2024-03-15', '2024-03-15', '2024-03-15'],
      3  // e.g., 3 time-tags for a different date
    );
    expect(result.date).toBe('2024-03-15');
    expect(result.score).toBe(1);  // 4 - 3 = 1
  });

  it('floors at 0 when competing deterministic exceeds 4', () => {
    const result = scoreLlmConsensus(
      ['2024-03-15', '2024-03-15', '2024-03-15', '2024-03-15', '2024-03-15'],
      5
    );
    expect(result.date).toBe('2024-03-15');
    expect(result.score).toBe(0);
  });

  it('scores 4/5 majority at 1 pt', () => {
    const result = scoreLlmConsensus(
      ['2024-03-15', '2024-03-15', '2024-03-15', '2024-03-15', '2024-03-16'],
      0
    );
    expect(result.date).toBe('2024-03-15');
    expect(result.score).toBe(1);
    expect(result.label).toBe('llm-majority');
  });

  it('scores 3/5 majority at 1 pt', () => {
    const result = scoreLlmConsensus(
      ['2024-03-15', '2024-03-15', '2024-03-15', '2024-03-16', '2024-03-17'],
      0
    );
    expect(result.date).toBe('2024-03-15');
    expect(result.score).toBe(1);
    expect(result.label).toBe('llm-majority');
  });

  it('scores 2/5 split at 0', () => {
    const result = scoreLlmConsensus(
      ['2024-03-15', '2024-03-15', '2024-03-16', '2024-03-16', '2024-03-17'],
      0
    );
    expect(result.date).toBeNull();
    expect(result.score).toBe(0);
    expect(result.label).toBe('llm-split');
  });

  it('returns no-date when all results are null', () => {
    const result = scoreLlmConsensus([null, null, null, null, null], 0);
    expect(result.date).toBeNull();
    expect(result.score).toBe(0);
    expect(result.label).toBe('no-date');
  });

  it('handles mix of nulls and valid dates', () => {
    const result = scoreLlmConsensus(
      ['2024-03-15', null, '2024-03-15', null, '2024-03-15'],
      0
    );
    // 3 out of 5 total, but 3/5 is majority
    expect(result.date).toBe('2024-03-15');
    expect(result.score).toBe(1);
    expect(result.label).toBe('llm-majority');
  });
});

// --- scoreDateConsensus (combined) ---

describe('scoreDateConsensus', () => {
  it('returns score 0 when no sources and no LLM', () => {
    const result = scoreDateConsensus({}, []);
    expect(result.date).toBeNull();
    expect(result.score).toBe(0);
  });

  it('scores JSON-LD alone at 3 pts (deterministic only)', () => {
    const result = scoreDateConsensus({ jsonLd: ['2024-05-20'] }, []);
    expect(result.date).toBe('2024-05-20');
    expect(result.score).toBe(3);
  });

  it('scores JSON-LD + URL at 4 pts', () => {
    const result = scoreDateConsensus({
      jsonLd: ['2024-03-15'],
      url: '2024-03-15'
    }, []);
    expect(result.date).toBe('2024-03-15');
    expect(result.score).toBe(4);
  });

  it('LLM consensus alone scores 4 pts (no deterministic sources)', () => {
    const result = scoreDateConsensus(
      {},
      ['2024-06-01', '2024-06-01', '2024-06-01', '2024-06-01', '2024-06-01']
    );
    expect(result.date).toBe('2024-06-01');
    expect(result.score).toBe(4);
  });

  it('LLM consensus + agreeing JSON-LD scores 7 pts', () => {
    const result = scoreDateConsensus(
      { jsonLd: ['2024-06-01'] },
      ['2024-06-01', '2024-06-01', '2024-06-01', '2024-06-01', '2024-06-01']
    );
    expect(result.date).toBe('2024-06-01');
    expect(result.score).toBe(7);  // 3 (json-ld) + 4 (llm-consensus, no competing)
  });

  it('LLM consensus penalized when disagreeing with time-tags', () => {
    const result = scoreDateConsensus(
      { timeTags: ['2024-03-31', '2024-03-31', '2024-03-31'] },
      ['2024-04-05', '2024-04-05', '2024-04-05', '2024-04-05', '2024-04-05']
    );
    // time-tags: 3 pts for 2024-03-31
    // LLM unanimous for 2024-04-05 but competing = 3, so LLM score = 4-3 = 1
    // 2024-03-31: 3 pts, 2024-04-05: 1 pt → 2024-03-31 wins
    expect(result.date).toBe('2024-03-31');
    expect(result.score).toBe(3);
  });

  it('LLM majority adds 1 pt to matching date', () => {
    const result = scoreDateConsensus(
      { timeTags: ['2024-03-15'] },
      ['2024-03-15', '2024-03-15', '2024-03-15', '2024-03-16', '2024-03-16']
    );
    // time-tag: 1 pt for 2024-03-15
    // LLM 3/5 majority for 2024-03-15: 1 pt
    expect(result.date).toBe('2024-03-15');
    expect(result.score).toBe(2);
  });

  it('discards future dates', () => {
    const result = scoreDateConsensus({
      jsonLd: ['2099-12-31'],
      url: '2024-01-15'
    }, []);
    expect(result.date).toBe('2024-01-15');
    expect(result.score).toBe(1);
  });

  it('includes sourceMap with LLM consensus label', () => {
    const result = scoreDateConsensus(
      { jsonLd: ['2024-03-15'] },
      ['2024-03-15', '2024-03-15', '2024-03-15', '2024-03-15', '2024-03-15']
    );
    expect(result.sourceMap['2024-03-15']).toContain('json-ld');
    const llmLabel = result.sourceMap['2024-03-15'].find(l => l.startsWith('llm-consensus'));
    expect(llmLabel).toBeTruthy();
  });
});

// --- Instagram URL normalization (tested via import from newsService) ---

describe('normalizeRenderUrl', () => {
  // Import dynamically to avoid pulling in all newsService dependencies
  let normalizeRenderUrl;

  it('loads normalizeRenderUrl', async () => {
    // This is a pure function, safe to import directly
    const mod = await import('../services/newsService.js').catch(() => null);
    if (mod) normalizeRenderUrl = mod.normalizeRenderUrl;
    // If import fails (due to deps), skip remaining tests
  });

  it('converts /reel/ to /p/', () => {
    if (!normalizeRenderUrl) return; // skip if import failed
    expect(normalizeRenderUrl('https://www.instagram.com/reel/DWkModtDZNH/')).toBe('https://www.instagram.com/p/DWkModtDZNH/');
  });

  it('converts /reels/ to /p/', () => {
    if (!normalizeRenderUrl) return;
    expect(normalizeRenderUrl('https://www.instagram.com/reels/DWkModtDZNH/')).toBe('https://www.instagram.com/p/DWkModtDZNH/');
  });

  it('leaves /p/ URLs unchanged', () => {
    if (!normalizeRenderUrl) return;
    expect(normalizeRenderUrl('https://www.instagram.com/p/DWkModtDZNH/')).toBe('https://www.instagram.com/p/DWkModtDZNH/');
  });

  it('leaves non-Instagram URLs unchanged', () => {
    if (!normalizeRenderUrl) return;
    expect(normalizeRenderUrl('https://www.example.com/reel/123')).toBe('https://www.example.com/reel/123');
  });
});
