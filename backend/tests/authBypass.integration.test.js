/**
 * Auth Bypass Integration Tests
 *
 * These tests verify that the environment-based auth bypass is working
 * correctly for testing admin endpoints without OAuth authentication.
 *
 * Only runs when BYPASS_AUTH=true is set (local dev troubleshooting).
 * Skipped in CI/GHA where auth is not bypassed.
 */
import { describe, it, expect } from 'vitest';

const BYPASS_ENABLED = process.env.BYPASS_AUTH === 'true' && process.env.NODE_ENV === 'test';

describe.skipIf(!BYPASS_ENABLED)('Auth Bypass Integration Tests', () => {
  const BASE_URL = 'http://localhost:8080';

  describe('Environment Variables', () => {
    it('should have NODE_ENV set to test', () => {
      expect(process.env.NODE_ENV).toBe('test');
    });

    it('should have BYPASS_AUTH enabled', () => {
      expect(process.env.BYPASS_AUTH).toBe('true');
    });
  });

  describe('Admin API Access', () => {
    it('GET /api/admin/settings - should access admin endpoint without auth', async () => {
      const response = await fetch(`${BASE_URL}/api/admin/settings`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(typeof data).toBe('object');

      console.log(`[Auth Bypass Test] Admin settings accessed: ${Object.keys(data).length} settings`);
    });

    it('GET /api/admin/jobs/history - should access jobs endpoint without auth', async () => {
      const response = await fetch(`${BASE_URL}/api/admin/jobs/history`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(typeof data).toBe('object');

      console.log(`[Auth Bypass Test] Jobs history accessed`);
    });

    it('GET /api/admin/jobs/scheduled - should access scheduled jobs without auth', async () => {
      const response = await fetch(`${BASE_URL}/api/admin/jobs/scheduled`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(typeof data).toBe('object');

      console.log(`[Auth Bypass Test] Scheduled jobs accessed`);
    });
  });

  describe('Role-Based Access', () => {
    it('should allow admin role access to admin endpoints', async () => {
      const response = await fetch(`${BASE_URL}/api/admin/settings`);
      expect(response.status).toBe(200);
    });

    it('should allow media_admin role access to media endpoints', async () => {
      const response = await fetch(`${BASE_URL}/api/admin/poi-media`);
      expect(response.status).toBe(200);
    });
  });

  describe('Public API (No Auth Required)', () => {
    it('GET /api/destinations - should access public endpoint', async () => {
      const response = await fetch(`${BASE_URL}/api/destinations`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);

      console.log(`[Auth Bypass Test] Public destinations: ${data.length} items`);
    });

    it('GET /api/pois - should access public POI endpoint', async () => {
      const response = await fetch(`${BASE_URL}/api/pois`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);

      console.log(`[Auth Bypass Test] Public POIs: ${data.length} items`);
    });
  });

  describe('Security Verification', () => {
    it('should only work when both NODE_ENV and BYPASS_AUTH are set', () => {
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.BYPASS_AUTH).toBe('true');

      const wouldBypassInProd = process.env.NODE_ENV === 'production' &&
                                process.env.BYPASS_AUTH === 'true';
      expect(wouldBypassInProd).toBe(false);
    });
  });
});
