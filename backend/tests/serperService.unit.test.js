/**
 * Unit tests for Serper Service
 * Tests geographic grounding and Serper API integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

import { searchNewsUrls, testSerperApiKey } from '../services/serperService.js';
import fetch from 'node-fetch';

describe('Serper Service', () => {
  describe('searchNewsUrls', () => {
    const mockPoi = {
      id: 123,
      name: 'Ledges Trail',
      latitude: 41.2415,
      longitude: -81.5156
    };

    it('should construct grounded query when POI is in a boundary', async () => {
      const mockPool = {
        query: vi.fn()
          .mockResolvedValueOnce({
            rows: [{ value: 'test-api-key-123' }]
          })
          .mockResolvedValueOnce({
            rows: [{ name: 'Cuyahoga Valley National Park' }]
          })
      };

      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          organic: [
            { link: 'https://example.com/news1', title: 'News 1', snippet: 'Snippet 1', date: '2026-04-01' },
            { link: 'https://example.com/news2', title: 'News 2', snippet: 'Snippet 2' }
          ],
          credits: 1
        })
      });

      const result = await searchNewsUrls(mockPool, mockPoi);

      expect(result.query).toBe('Ledges Trail Cuyahoga Valley National Park news');
      expect(result.grounded).toBe(true);
      expect(result.groundingContext).toBe('Cuyahoga Valley National Park');
      expect(result.urls).toHaveLength(2);
      expect(result.urls[0].url).toBe('https://example.com/news1');
      expect(result.urls[0].date).toBe('2026-04-01');
      expect(result.urls[1].date).toBeNull();
      expect(result.credits).toBe(1);

      expect(fetch).toHaveBeenCalledWith(
        'https://google.serper.dev/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-API-KEY': 'test-api-key-123',
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({ q: 'Ledges Trail Cuyahoga Valley National Park news' })
        })
      );
    });

    it('should construct ungrounded query when POI is outside boundaries', async () => {
      const mockPool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ value: 'test-api-key-123' }] })
          .mockResolvedValueOnce({ rows: [] })
      };

      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          organic: [{ link: 'https://example.com/news', title: 'News', snippet: 'Snippet' }],
          credits: 1
        })
      });

      const result = await searchNewsUrls(mockPool, mockPoi);

      expect(result.query).toBe('Ledges Trail news');
      expect(result.grounded).toBe(false);
      expect(result.groundingContext).toBe('');
    });

    it('should throw error when API key not configured', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [] })
      };

      await expect(searchNewsUrls(mockPool, mockPoi)).rejects.toThrow(
        'Serper API key not configured'
      );
    });

    it('should throw error when Serper API returns error', async () => {
      const mockPool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ value: 'test-api-key-123' }] })
          .mockResolvedValueOnce({ rows: [] })
      };

      fetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized'
      });

      await expect(searchNewsUrls(mockPool, mockPoi)).rejects.toThrow(
        'Serper API error: 401'
      );
    });

    it('should handle empty search results', async () => {
      const mockPool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ value: 'test-api-key-123' }] })
          .mockResolvedValueOnce({ rows: [] })
      };

      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          organic: [],
          credits: 1
        })
      });

      const result = await searchNewsUrls(mockPool, mockPoi);

      expect(result.urls).toHaveLength(0);
      expect(result.credits).toBe(1);
    });
  });

  describe('testSerperApiKey', () => {
    it('should return true for valid API key', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: [{ value: 'valid-api-key' }]
        })
      };

      fetch.mockResolvedValue({
        ok: true
      });

      const result = await testSerperApiKey(mockPool);

      expect(result).toBe(true);
    });

    it('should return false when API key not configured', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: []
        })
      };

      const result = await testSerperApiKey(mockPool);

      expect(result).toBe(false);
    });

    it('should return false when API returns error', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: [{ value: 'invalid-api-key' }]
        })
      };

      fetch.mockResolvedValue({
        ok: false,
        status: 401
      });

      const result = await testSerperApiKey(mockPool);

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: [{ value: 'test-api-key' }]
        })
      };

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await testSerperApiKey(mockPool);

      expect(result).toBe(false);
    });
  });
});
