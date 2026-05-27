/**
 * POI Classifier Unit Tests (#418)
 * classifyPoiType mirrors the frontend icon classifier: name keyword first,
 * then primary_activities fallback. Drives news/events collection skip for
 * amenity types (playground, restroom).
 */
import { describe, it, expect } from 'vitest';
import { classifyPoiType } from '../utils/poiClassify.js';

// Amenity types carry the lowest sort_order so their explicit keyword wins over a
// park-name keyword (e.g. 'mill' -> historic) — see migration 066.
// Ordered by sort_order (classification priority), matching production: amenities
// first, then visitor-center ahead of historic (migration 065/066). Amenity types
// have NO activity_fallbacks — a POI "is" a playground/restroom only when named
// so, not because a full park lists it among many offered activities.
const iconConfig = [
  { name: 'playground', title_keywords: 'playground,play area', activity_fallbacks: null },
  { name: 'restroom', title_keywords: 'restroom,restrooms,bathroom,toilet,toilets', activity_fallbacks: null },
  { name: 'visitor-center', title_keywords: 'visitor center,museum', activity_fallbacks: 'Information' },
  { name: 'nature', title_keywords: 'nature,preserve', activity_fallbacks: 'Nature Study,Wildlife Viewing' },
  { name: 'historic', title_keywords: 'historic,history,house,mill,lock', activity_fallbacks: 'Historical Tours' },
];

describe('classifyPoiType', () => {
  it('classifies a restroom by name keyword', () => {
    expect(classifyPoiType('Sand Run Metro Park Restroom', 'Restroom', iconConfig)).toBe('restroom');
  });

  it('classifies a playground by name keyword', () => {
    expect(classifyPoiType('Bedford Reservation Playground', 'Playground', iconConfig)).toBe('playground');
  });

  it('lets the amenity keyword win over a park-name keyword (mill -> historic)', () => {
    // 'restroom' (lower sort_order) is checked before 'historic' matches 'mill'
    expect(classifyPoiType('Mill Stream Run Reservation Restroom', 'Restroom', iconConfig)).toBe('restroom');
  });

  it('does NOT icon a full park as an amenity just because it offers one', () => {
    // Amenity types have no activity_fallbacks, so a Playground in a multi-activity
    // list does not flip the park's icon (collection exclusion handles dedicated
    // amenities separately via an exact single-activity match).
    expect(classifyPoiType('Valley View Woods Park', 'Hiking, Picnicking, Playground', iconConfig)).not.toBe('playground');
  });

  it('classifies a non-amenity POI normally', () => {
    expect(classifyPoiType('Boston Mill Visitor Center', 'Information', iconConfig)).toBe('visitor-center');
  });

  it('returns default with no signal', () => {
    expect(classifyPoiType('Some Field', '', iconConfig)).toBe('default');
  });

  it('returns default when iconConfig is empty', () => {
    expect(classifyPoiType('X Restroom', 'Restroom', [])).toBe('default');
  });

  it('ignores disabled icons', () => {
    const cfg = [{ name: 'restroom', title_keywords: 'restroom', activity_fallbacks: 'Restroom', enabled: false }];
    expect(classifyPoiType('Park Restroom', 'Restroom', cfg)).toBe('default');
  });
});
