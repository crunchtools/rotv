/**
 * Unit tests for Apify social fetching (spec 036).
 * apifyService uses the global fetch, so we stub it directly.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isFacebookUrl, isInstagramUrl, isSocialUrl, toIsoDate, fetchSocialPosts
} from '../services/apifyService.js';

const tokenPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [{ value: 'tok-123' }] }) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('social URL detection', () => {
  it('detects Facebook, Instagram, and neither', () => {
    expect(isFacebookUrl('https://www.facebook.com/SummitMetroParks')).toBe(true);
    expect(isInstagramUrl('https://www.instagram.com/cuyahogavalleynps/')).toBe(true);
    expect(isSocialUrl('https://www.facebook.com/x')).toBe(true);
    expect(isSocialUrl('https://www.instagram.com/p/ABC/')).toBe(true);
    expect(isSocialUrl('https://clevelandmagazine.com/article')).toBe(false);
    expect(isSocialUrl(null)).toBe(false);
  });
});

describe('toIsoDate', () => {
  it('parses epoch seconds', () => {
    expect(toIsoDate(1700000000)).toBe('2023-11-14');
  });
  it('parses epoch milliseconds', () => {
    expect(toIsoDate(1700000000000)).toBe('2023-11-14');
  });
  it('parses numeric strings as epoch', () => {
    expect(toIsoDate('1700000000')).toBe('2023-11-14');
  });
  it('parses ISO 8601 strings', () => {
    expect(toIsoDate('2025-07-11T10:00:00.000Z')).toBe('2025-07-11');
  });
  it('returns null for garbage / empty / null', () => {
    expect(toIsoDate('not a date')).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });
});

describe('fetchSocialPosts', () => {
  it('extracts Instagram caption + timestamp into socialDates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { caption: 'Sunrise over the Ledges', timestamp: '2025-07-11T10:00:00.000Z' },
        { caption: 'Fall hiking spree kicks off', timestamp: '2025-09-23T12:00:00.000Z' }
      ])
    }));
    const r = await fetchSocialPosts(tokenPool(), 'https://www.instagram.com/cuyahogavalleynps/', 5);
    expect(r.reachable).toBe(true);
    expect(r.ogDates.socialDates).toEqual(['2025-07-11', '2025-09-23']);
    expect(r.markdown).toContain('Sunrise over the Ledges');
    expect(r.markdown).toContain('[2025-07-11]');
  });

  it('extracts Facebook message + epoch time into socialDates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { message: 'Main entrance reopens', time: '2024-01-05T12:00:00Z' },
        { message: 'Trail closure update', timestamp: 1700000000 }
      ])
    }));
    const r = await fetchSocialPosts(tokenPool(), 'https://www.facebook.com/SummitMetroParks/posts/123', 5);
    expect(r.reachable).toBe(true);
    expect(r.ogDates.socialDates).toContain('2024-01-05');
    expect(r.ogDates.socialDates).toContain('2023-11-14');
  });

  it('deduplicates identical post dates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { caption: 'a', timestamp: '2025-07-11T10:00:00Z' },
        { caption: 'b', timestamp: '2025-07-11T18:00:00Z' }
      ])
    }));
    const r = await fetchSocialPosts(tokenPool(), 'https://www.instagram.com/x/', 5);
    expect(r.ogDates.socialDates).toEqual(['2025-07-11']);
  });

  it('returns reachable:false when no Apify token is configured', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const r = await fetchSocialPosts(pool, 'https://www.facebook.com/x');
    expect(r.reachable).toBe(false);
    expect(r.reason).toMatch(/token/i);
  });

  it('reports reachable:true with reason when no posts are returned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ([]) }));
    const r = await fetchSocialPosts(tokenPool(), 'https://www.instagram.com/x/');
    expect(r.reachable).toBe(true);
    expect(r.reason).toMatch(/no posts/i);
  });
});
