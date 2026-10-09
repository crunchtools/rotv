import { describe, it, expect } from 'vitest';
import { isCollectiblePoi } from '../utils/poiRoles.js';

describe('isCollectiblePoi', () => {
  it('treats a park boundary as a place we collect for', () => {
    expect(isCollectiblePoi({ poi_roles: ['boundary'], boundary_type: 'park' })).toBe(true);
  });

  it('leaves municipal boundaries and trails out', () => {
    expect(isCollectiblePoi({ poi_roles: ['boundary'], boundary_type: 'municipal' })).toBe(false);
    expect(isCollectiblePoi({ poi_roles: ['trail'] })).toBe(false);
    expect(isCollectiblePoi({})).toBe(false);
    expect(isCollectiblePoi(null)).toBe(false);
  });

  it('still accepts points, organizations and rivers', () => {
    for (const role of ['point', 'organization', 'river']) {
      expect(isCollectiblePoi({ poi_roles: [role] })).toBe(true);
    }
  });
});
