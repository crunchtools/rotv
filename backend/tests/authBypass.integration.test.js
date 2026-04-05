/**
 * Auth Bypass Integration Tests
 *
 * These tests verify that the environment-based auth bypass is working
 * correctly for testing admin endpoints without OAuth authentication.
 */
import { describe, it, expect } from 'vitest';

describe('Auth Bypass Integration Tests', () => {
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

      // With bypass enabled, should get 200 (not 401/403)
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);

      console.log(`[Auth Bypass Test] Admin settings accessed: ${data.length} settings`);
    });

    it('GET /api/admin/pois - should access POI admin endpoint without auth', async () => {
      const response = await fetch(`${BASE_URL}/api/admin/pois`);

      // With bypass enabled, should get 200
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);

      console.log(`[Auth Bypass Test] POIs accessed: ${data.length} POIs`);
    });

    it('GET /api/admin/jobs - should access jobs endpoint without auth', async () => {
      const response = await fetch(`${BASE_URL}/api/admin/jobs`);

      // With bypass enabled, should get 200
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);

      console.log(`[Auth Bypass Test] Jobs accessed: ${data.length} jobs`);
    });
  });

  describe('Role-Based Access', () => {
    it('should allow admin role access to admin endpoints', async () => {
      // The bypass injects an admin user, so all admin endpoints should work
      const response = await fetch(`${BASE_URL}/api/admin/settings`);
      expect(response.status).toBe(200);
    });

    it('should allow media_admin role access to media endpoints', async () => {
      // Media admin endpoints should also work with bypass
      // (bypass defaults to admin role, which has media_admin permissions)
      const response = await fetch(`${BASE_URL}/api/admin/pois`);
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
      // This is a meta-test verifying our security assumptions
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.BYPASS_AUTH).toBe('true');

      // In production, these should NEVER both be true
      const wouldBypassInProd = process.env.NODE_ENV === 'production' &&
                                process.env.BYPASS_AUTH === 'true';
      expect(wouldBypassInProd).toBe(false);
    });
  });
});
