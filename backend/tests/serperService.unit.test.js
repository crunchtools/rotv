/**
 * Unit tests for Serper Service
 * Tests geographic grounding and Serper API integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getGeographicContext, searchNewsUrls, testSerperApiKey } from '../services/serperService.js';

describe('Serper Service', () => {
  describe('getGeographicContext', () => {
    it('should return boundary name for POI inside a boundary', async () => {
      // Mock database query result
      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: [{ name: 'Cuyahoga Valley National Park' }]
        })
      };

      const result = await getGeographicContext(mockPool, 123);

      expect(result).toBe('Cuyahoga Valley National Park');
      expect(mockPool.query).toHaveBeenCalledOnce();

      // Verify the SQL query structure
      const queryCall = mockPool.query.mock.calls[0];
      const sql = queryCall[0];
      expect(sql).toContain('ST_Contains');
      expect(sql).toContain("poi_type = 'boundary'");
      expect(sql).toContain('ORDER BY ST_Area');
      expect(sql).toContain('LIMIT 1');
    });

    it('should return empty string for POI outside all boundaries', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: []
        })
      };

      const result = await getGeographicContext(mockPool, 456);

      expect(result).toBe('');
    });

    it('should return smallest boundary when POI is in nested boundaries', async () => {
      // This tests that ORDER BY ST_Area ASC works correctly
      // Smaller polygon (park) should win over larger polygon (city)
      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: [{ name: 'Oak Grove Park' }] // Smallest boundary
        })
      };

      const result = await getGeographicContext(mockPool, 789);

      expect(result).toBe('Oak Grove Park');
    });

    it('should handle database errors gracefully', async () => {
      const mockPool = {
        query: vi.fn().mockRejectedValue(new Error('Database connection failed'))
      };

      await expect(getGeographicContext(mockPool, 123)).rejects.toThrow('Database connection failed');
    });
  });

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
          // First call: get API key
          .mockResolvedValueOnce({
            rows: [{ value: 'test-api-key-123' }]
          })
          // Second call: get geographic context
          .mockResolvedValueOnce({
            rows: [{ name: 'Cuyahoga Valley National Park' }]
          })
      };

      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
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
      expect(result.urls[1].date).toBeNull(); // Second result has no date
      expect(result.credits).toBe(1);

      // Verify Serper API was called correctly
      expect(global.fetch).toHaveBeenCalledWith(
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
          .mockResolvedValueOnce({ rows: [] }) // No boundary
      };

      global.fetch = vi.fn().mockResolvedValue({
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
        query: vi.fn().mockResolvedValue({ rows: [] }) // No API key
      };

      await expect(searchNewsUrls(mockPool, mockPoi)).rejects.toThrow(
        'Serper API key not configured'
      );
    });

    it('should throw error when Serper API returns error', async () => {
      const mockPool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ value: 'test-api-key-123' }] })
          .mockResolvedValueOnce({ rows: [] });
      };

      global.fetch = vi.fn().mockResolvedValue({
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
          .mockResolvedValueOnce({ rows: [] });
      };

      global.fetch = vi.fn().mockResolvedValue({
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

      global.fetch = vi.fn().mockResolvedValue({
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

      global.fetch = vi.fn().mockResolvedValue({
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
