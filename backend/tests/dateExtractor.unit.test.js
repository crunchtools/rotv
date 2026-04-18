/**
 * Date Extractor Unit Tests
 * Tests the three-stage consensus date pipeline:
 *   extractUrlDate → normalizeDateSources → scoreDateConsensus
 */
import { describe, it, expect } from 'vitest';
import { extractUrlDate, normalizeDateSources, scoreDateConsensus } from '../services/dateExtractor.js';

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

  it('extracts date when URL has .html after the date segment', () => {
    expect(extractUrlDate('https://example.com/2023/05/10/article.html')).toBe('2023-05-10');
  });

  it('returns null when no date pattern in URL', () => {
    expect(extractUrlDate('https://nps.gov/cuva/planyourvisit/')).toBeNull();
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
    expect(result.jsonLd).not.toContain('gibberish');
    expect(result.jsonLd).toContain('2024-04-01');
  });

  it('handles null/missing sources gracefully', () => {
    const result = normalizeDateSources({ llm: null, url: null });
    expect(result.llm).toBeNull();
    expect(result.url).toBeNull();
    expect(result.jsonLd).toEqual([]);
    expect(result.meta).toEqual([]);
    expect(result.timeTags).toEqual([]);
  });

  it('returns empty arrays for empty source lists', () => {
    const result = normalizeDateSources({});
    expect(result.jsonLd).toEqual([]);
    expect(result.meta).toEqual([]);
    expect(result.timeTags).toEqual([]);
  });
});

describe('scoreDateConsensus', () => {
  it('returns unknown confidence when no sources provided', () => {
    const result = scoreDateConsensus({});
    expect(result.date).toBeNull();
    expect(result.confidence).toBe('unknown');
    expect(result.score).toBe(0);
  });

  it('scores JSON-LD at 3 pts — reaches exact threshold alone with any other source', () => {
    const result = scoreDateConsensus({
      jsonLd: ['2024-03-15'],
      url: '2024-03-15'
    });
    expect(result.date).toBe('2024-03-15');
    expect(result.score).toBe(4);
    expect(result.confidence).toBe('exact');
  });

  it('scores JSON-LD alone as estimated (3 pts < 4 threshold)', () => {
    const result = scoreDateConsensus({ jsonLd: ['2024-05-20'] });
    expect(result.date).toBe('2024-05-20');
    expect(result.score).toBe(3);
    expect(result.confidence).toBe('estimated');
  });

  it('reaches exact threshold with LLM + meta + URL (2+1+1=4)', () => {
    const result = scoreDateConsensus({
      llm: '2024-06-01',
      meta: ['2024-06-01'],
      url: '2024-06-01'
    });
    expect(result.date).toBe('2024-06-01');
    expect(result.score).toBe(4);
    expect(result.confidence).toBe('exact');
  });

  it('breaks ties by choosing the oldest date', () => {
    const result = scoreDateConsensus({
      meta: ['2024-03-10'],
      url: '2024-03-12'
    });
    expect(result.date).toBe('2024-03-10');
  });

  it('discards future dates', () => {
    const result = scoreDateConsensus({
      jsonLd: ['2099-12-31'],
      url: '2024-01-15'
    });
    expect(result.date).toBe('2024-01-15');
    expect(result.score).toBe(1);
  });

  it('accumulates score across matching dates from different sources', () => {
    const result = scoreDateConsensus({
      jsonLd: ['2024-08-10'],
      llm: '2024-08-10',
      meta: ['2024-08-10'],
      url: '2024-08-10'
    });
    // 3 + 2 + 1 + 1 = 7
    expect(result.date).toBe('2024-08-10');
    expect(result.score).toBe(7);
    expect(result.confidence).toBe('exact');
  });

  it('handles multiple JSON-LD dates — picks oldest on tie', () => {
    const result = scoreDateConsensus({
      jsonLd: ['2024-05-01', '2024-06-15'],
    });
    expect(result.date).toBe('2024-05-01');
    expect(result.score).toBe(3);
  });

  it('includes sourceMap in result', () => {
    const result = scoreDateConsensus({
      jsonLd: ['2024-03-15'],
      url: '2024-03-15'
    });
    expect(result.sourceMap['2024-03-15']).toContain('json-ld');
    expect(result.sourceMap['2024-03-15']).toContain('url');
  });
});
