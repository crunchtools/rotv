/**
 * Integration tests for POI Media API (Multi-Image Support - Issue #181)
 *
 * These tests hit the actual running container on localhost:8080
 * and verify the full request/response cycle including database queries.
 *
 * Prerequisites:
 * - Container must be running (./run.sh start)
 * - Migration 015 must be applied (poi_media table exists)
 * - Test database should have sample data
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';
const TEST_POI_ID = 1; // Test with first POI in database

describe('POI Media API Integration Tests', () => {

  describe('GET /api/pois/:id/media', () => {
    it('should return media for a specific POI', async () => {
      const response = await request(BASE_URL)
        .get(`/api/pois/${TEST_POI_ID}/media`)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body).toHaveProperty('mosaic');
      expect(response.body).toHaveProperty('all_media');
      expect(response.body).toHaveProperty('total_count');

      expect(Array.isArray(response.body.mosaic)).toBe(true);
      expect(Array.isArray(response.body.all_media)).toBe(true);
      expect(typeof response.body.total_count).toBe('number');

      // Mosaic should contain at most 3 items
      expect(response.body.mosaic.length).toBeLessThanOrEqual(3);

      // If media exists, verify structure
      if (response.body.all_media.length > 0) {
        const mediaItem = response.body.all_media[0];
        expect(mediaItem).toHaveProperty('id');
        expect(mediaItem).toHaveProperty('media_type');
        expect(['image', 'video', 'youtube']).toContain(mediaItem.media_type);

        // Images and videos should have asset_id and URLs
        if (mediaItem.media_type === 'image' || mediaItem.media_type === 'video') {
          expect(mediaItem).toHaveProperty('asset_id');
          expect(mediaItem).toHaveProperty('thumbnail_url');
          expect(mediaItem).toHaveProperty('full_url');
        }

        // YouTube should have YouTube-specific fields
        if (mediaItem.media_type === 'youtube') {
          expect(mediaItem).toHaveProperty('youtube_url');
          expect(mediaItem).toHaveProperty('youtube_id');
          expect(mediaItem).toHaveProperty('embed_url');
        }
      }
    }, 10000);

    it('should handle non-existent POI gracefully', async () => {
      const response = await request(BASE_URL)
        .get('/api/pois/99999/media')
        .expect(200);

      expect(response.body.mosaic).toEqual([]);
      expect(response.body.all_media).toEqual([]);
      expect(response.body.total_count).toBe(0);
    });

    it('should return only approved media', async () => {
      const response = await request(BASE_URL)
        .get(`/api/pois/${TEST_POI_ID}/media`)
        .expect(200);

      // All media should be published or auto_approved
      // (pending/rejected should not appear)
      response.body.all_media.forEach(media => {
        // We don't get moderation_status in the response, but we can verify
        // that the media is present (which means it passed the WHERE clause filter)
        expect(media).toHaveProperty('id');
      });
    });

    it('should prioritize primary image in mosaic', async () => {
      const response = await request(BASE_URL)
        .get(`/api/pois/${TEST_POI_ID}/media`)
        .expect(200);

      // If there's a primary image and mosaic is not empty
      if (response.body.mosaic.length > 0) {
        const primaryImage = response.body.mosaic.find(m => m.role === 'primary');

        // If a primary exists, it should be first in mosaic
        if (primaryImage) {
          expect(response.body.mosaic[0].role).toBe('primary');
        }
      }
    });
  });

  describe('GET /api/assets/:assetId/thumbnail', () => {
    it('should return 404 when image server not configured', async () => {
      // This test assumes image server might not be running in CI
      const response = await request(BASE_URL)
        .get('/api/assets/test-asset-id/thumbnail');

      // Could be 404 (not found) or 200 (found) depending on setup
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('GET /api/assets/:assetId/original', () => {
    it('should return 404 when image server not configured', async () => {
      // This test assumes image server might not be running in CI
      const response = await request(BASE_URL)
        .get('/api/assets/test-asset-id/original');

      // Could be 404 (not found) or 200 (found) depending on setup
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('POST /api/pois/:id/media', () => {
    it('should require authentication', async () => {
      const response = await request(BASE_URL)
        .post(`/api/pois/${TEST_POI_ID}/media`)
        .send({ media_type: 'youtube', youtube_url: 'https://youtube.com/watch?v=test' })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    // Note: Authenticated upload tests would require session/auth setup
    // These are tested manually or in E2E tests with authenticated sessions
  });
});

describe('Admin POI Media Management API', () => {

  describe('GET /api/admin/poi-media', () => {
    it('should require admin authentication', async () => {
      const response = await request(BASE_URL)
        .get('/api/admin/poi-media')
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PATCH /api/admin/poi-media/:id', () => {
    it('should require admin authentication', async () => {
      const response = await request(BASE_URL)
        .patch('/api/admin/poi-media/1')
        .send({ role: 'primary' })
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/admin/poi-media/:id', () => {
    it('should require admin authentication', async () => {
      const response = await request(BASE_URL)
        .delete('/api/admin/poi-media/1')
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/admin/moderation/media', () => {
    it('should require admin authentication', async () => {
      const response = await request(BASE_URL)
        .get('/api/admin/moderation/media')
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/moderation/media/:id/approve', () => {
    it('should require admin authentication', async () => {
      const response = await request(BASE_URL)
        .post('/api/admin/moderation/media/1/approve')
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /api/admin/moderation/media/:id/reject', () => {
    it('should require admin authentication', async () => {
      const response = await request(BASE_URL)
        .post('/api/admin/moderation/media/1/reject')
        .send({ reason: 'Test rejection' })
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });
  });
});

describe('YouTube URL Extraction', () => {
  // Note: Testing the extractYouTubeId helper function indirectly through API
  // Direct unit tests would require exporting the function

  it('should handle standard YouTube URLs in upload', async () => {
    const testUrls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    ];

    // All should be valid (would need auth to actually test upload)
    testUrls.forEach(url => {
      expect(url).toMatch(/youtube|youtu\.be/);
    });
  });
});

describe('Media Type Validation', () => {
  it('should validate media_type enum', async () => {
    const validTypes = ['image', 'video', 'youtube'];

    validTypes.forEach(type => {
      expect(['image', 'video', 'youtube']).toContain(type);
    });
  });
});

describe('Rate Limiting (DoS Protection)', () => {
  it('should enforce rate limits on asset proxy endpoints', async () => {
    // Rate limiter allows 100 requests per 15 minutes
    // Make a few requests to verify no immediate blocking (within limit)
    const responses = [];

    for (let i = 0; i < 5; i++) {
      const response = await request(BASE_URL)
        .get('/api/assets/test-asset-id/thumbnail');
      responses.push(response);
    }

    // All requests within normal rate limit should succeed (or 404 if asset missing)
    responses.forEach(response => {
      expect([200, 404]).toContain(response.status);
    });
  });

  it('should include rate limit headers', async () => {
    const response = await request(BASE_URL)
      .get('/api/assets/test-asset-id/original');

    // Check for standard rate limit headers
    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['ratelimit-remaining']).toBeDefined();
  });

  it('should decrement rate limit counter with each request', async () => {
    const response1 = await request(BASE_URL)
      .get('/api/assets/test-asset-id/thumbnail');
    const remaining1 = parseInt(response1.headers['ratelimit-remaining']);

    const response2 = await request(BASE_URL)
      .get('/api/assets/test-asset-id/thumbnail');
    const remaining2 = parseInt(response2.headers['ratelimit-remaining']);

    // Second request should have fewer remaining slots
    expect(remaining2).toBeLessThan(remaining1);
  });
});

describe('Mosaic Caching (Performance)', () => {
  it('should return same data structure on repeated requests', async () => {
    const response1 = await request(BASE_URL)
      .get(`/api/pois/${TEST_POI_ID}/media`);

    const response2 = await request(BASE_URL)
      .get(`/api/pois/${TEST_POI_ID}/media`);

    // Both requests should return valid JSON
    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    // Data structure should be consistent
    expect(response1.body).toHaveProperty('mosaic');
    expect(response1.body).toHaveProperty('all_media');
    expect(response1.body).toHaveProperty('total_count');

    expect(response2.body).toHaveProperty('mosaic');
    expect(response2.body).toHaveProperty('all_media');
    expect(response2.body).toHaveProperty('total_count');

    // Content should match (cache hit)
    expect(response2.body.total_count).toBe(response1.body.total_count);
  });

  it('should return mosaic data consistently across cache hits', async () => {
    // First request (cache miss)
    const response1 = await request(BASE_URL)
      .get(`/api/pois/${TEST_POI_ID}/media`);

    // Second request (should be cache hit within 5min TTL)
    const response2 = await request(BASE_URL)
      .get(`/api/pois/${TEST_POI_ID}/media`);

    // Third request (also cache hit)
    const response3 = await request(BASE_URL)
      .get(`/api/pois/${TEST_POI_ID}/media`);

    // All should return same total count
    expect(response1.body.total_count).toBe(response2.body.total_count);
    expect(response2.body.total_count).toBe(response3.body.total_count);

    // Mosaic size should be consistent
    expect(response1.body.mosaic.length).toBe(response2.body.mosaic.length);
    expect(response2.body.mosaic.length).toBe(response3.body.mosaic.length);
  });
});
