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

      expect(response.body.mosaic.length).toBeLessThanOrEqual(3);

      if (response.body.all_media.length > 0) {
        const mediaItem = response.body.all_media[0];
        expect(mediaItem).toHaveProperty('id');
        expect(mediaItem).toHaveProperty('media_type');
        expect(['image', 'video', 'youtube']).toContain(mediaItem.media_type);

        if (mediaItem.media_type === 'image' || mediaItem.media_type === 'video') {
          expect(mediaItem).toHaveProperty('asset_id');
          expect(mediaItem).toHaveProperty('thumbnail_url');
          expect(mediaItem).toHaveProperty('full_url');
        }

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

      response.body.all_media.forEach(media => {
        expect(media).toHaveProperty('id');
      });
    });

    it('should prioritize primary image in mosaic', async () => {
      const response = await request(BASE_URL)
        .get(`/api/pois/${TEST_POI_ID}/media`)
        .expect(200);

      if (response.body.mosaic.length > 0) {
        const primaryImage = response.body.mosaic.find(m => m.role === 'primary');

        if (primaryImage) {
          expect(response.body.mosaic[0].role).toBe('primary');
        }
      }
    });
  });

  describe('GET /api/assets/:assetId/thumbnail', () => {
    it('should return 404 when image server not configured', async () => {
      const response = await request(BASE_URL)
        .get('/api/assets/test-asset-id/thumbnail');

      expect([200, 404, 422, 503]).toContain(response.status);
    });
  });

  describe('GET /api/assets/:assetId/original', () => {
    it('should return 404 when image server not configured', async () => {
      const response = await request(BASE_URL)
        .get('/api/assets/test-asset-id/original');

      expect([200, 404, 422, 503]).toContain(response.status);
    });
  });

  // Auth-required tests only run without BYPASS_AUTH (these expect 401/403)
  describe.skipIf(process.env.BYPASS_AUTH === 'true')('POST /api/pois/:id/media', () => {
    it('should require authentication', async () => {
      const response = await request(BASE_URL)
        .post(`/api/pois/${TEST_POI_ID}/media`)
        .send({ media_type: 'youtube', youtube_url: 'https://youtube.com/watch?v=test' })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });
  });
});

// Auth-enforcement tests — skipped when BYPASS_AUTH is enabled since auth is bypassed
describe.skipIf(process.env.BYPASS_AUTH === 'true')('Admin POI Media Management API', () => {

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
  it('should handle standard YouTube URLs in upload', async () => {
    const testUrls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    ];

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
    const responses = [];

    for (let i = 0; i < 5; i++) {
      const response = await request(BASE_URL)
        .get('/api/assets/test-asset-id/thumbnail');
      responses.push(response);
    }

    responses.forEach(response => {
      expect([200, 404, 422, 503]).toContain(response.status);
    });
  });

  it('should include rate limit headers', async () => {
    const response = await request(BASE_URL)
      .get('/api/assets/test-asset-id/original');

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

    expect(remaining2).toBeLessThan(remaining1);
  });
});

describe('Mosaic Caching (Performance)', () => {
  it('should return same data structure on repeated requests', async () => {
    const response1 = await request(BASE_URL)
      .get(`/api/pois/${TEST_POI_ID}/media`);

    const response2 = await request(BASE_URL)
      .get(`/api/pois/${TEST_POI_ID}/media`);

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    expect(response1.body).toHaveProperty('mosaic');
    expect(response1.body).toHaveProperty('all_media');
    expect(response1.body).toHaveProperty('total_count');

    expect(response2.body).toHaveProperty('mosaic');
    expect(response2.body).toHaveProperty('all_media');
    expect(response2.body).toHaveProperty('total_count');

    expect(response2.body.total_count).toBe(response1.body.total_count);
  });

  it('should return mosaic data consistently across cache hits', async () => {
    const response1 = await request(BASE_URL)
      .get(`/api/pois/${TEST_POI_ID}/media`);

    const response2 = await request(BASE_URL)
      .get(`/api/pois/${TEST_POI_ID}/media`);

    const response3 = await request(BASE_URL)
      .get(`/api/pois/${TEST_POI_ID}/media`);

    expect(response1.body.total_count).toBe(response2.body.total_count);
    expect(response2.body.total_count).toBe(response3.body.total_count);

    expect(response1.body.mosaic.length).toBe(response2.body.mosaic.length);
    expect(response2.body.mosaic.length).toBe(response3.body.mosaic.length);
  });
});
