import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isFacebookUrl, toIsoDate, fetchFacebookPosts
} from '../services/apifyService.js';

const tokenPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [{ value: 'tok-123' }] }) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isFacebookUrl', () => {
  it('detects Facebook URLs', () => {
    expect(isFacebookUrl('https://www.facebook.com/SummitMetroParks')).toBe(true);
    expect(isFacebookUrl('https://www.facebook.com/medinaTRAILS/')).toBe(true);
    expect(isFacebookUrl('https://clevelandmagazine.com/article')).toBe(false);
    expect(isFacebookUrl(null)).toBe(false);
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

describe('fetchFacebookPosts', () => {
  it('extracts Facebook message + epoch time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { message: 'Main entrance reopens', time: '2024-01-05T12:00:00Z' },
        { message: 'Trail closure update', timestamp: 1700000000 }
      ])
    }));
    const r = await fetchFacebookPosts(tokenPool(), 'https://www.facebook.com/medinaTRAILS/', 5);
    expect(r.reachable).toBe(true);
    expect(r.markdown).toContain('Main entrance reopens');
    expect(r.markdown).toContain('Trail closure update');
  });

  it('returns reachable:false when no Apify token is configured', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const r = await fetchFacebookPosts(pool, 'https://www.facebook.com/x');
    expect(r.reachable).toBe(false);
    expect(r.reason).toMatch(/token/i);
  });

  it('reports reachable:true with reason when no posts are returned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ([]) }));
    const r = await fetchFacebookPosts(tokenPool(), 'https://www.facebook.com/medinaTRAILS/');
    expect(r.reachable).toBe(true);
    expect(r.reason).toMatch(/no posts/i);
  });
});
