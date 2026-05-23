import { describe, it, expect } from 'vitest';
import { parseUsgsResponse } from '../services/riverLevelsService.js';

// Minimal fixture mirroring the USGS Instantaneous Values JSON shape:
// two parameters (00065 gage height, 00060 discharge) sharing timestamps,
// plus a no-data sentinel (-999999) that must be dropped.
const fixture = {
  value: {
    timeSeries: [
      {
        sourceInfo: {
          siteName: 'Cuyahoga River at Old Portage OH',
          geoLocation: { geogLocation: { latitude: 41.1356112, longitude: -81.5470622 } }
        },
        variable: { variableCode: [{ value: '00065' }], unit: { unitCode: 'ft' } },
        values: [{ value: [
          { value: '3.10', dateTime: '2026-05-23T07:00:00.000-04:00' },
          { value: '3.20', dateTime: '2026-05-23T07:30:00.000-04:00' },
          { value: '-999999', dateTime: '2026-05-23T08:00:00.000-04:00' }
        ] }]
      },
      {
        sourceInfo: { siteName: 'Cuyahoga River at Old Portage OH' },
        variable: { variableCode: [{ value: '00060' }], unit: { unitCode: 'ft3/s' } },
        values: [{ value: [
          { value: '400', dateTime: '2026-05-23T07:00:00.000-04:00' },
          { value: '412', dateTime: '2026-05-23T07:30:00.000-04:00' }
        ] }]
      }
    ]
  }
};

describe('parseUsgsResponse', () => {
  it('extracts site metadata and coordinates', () => {
    const { name, latitude, longitude } = parseUsgsResponse(fixture);
    expect(name).toBe('Cuyahoga River at Old Portage OH');
    expect(latitude).toBeCloseTo(41.1356, 3);
    expect(longitude).toBeCloseTo(-81.5471, 3);
  });

  it('merges gage height and discharge that share a timestamp', () => {
    const { readings } = parseUsgsResponse(fixture);
    const first = readings.find(r => r.reading_time === '2026-05-23T07:00:00.000-04:00');
    expect(first).toEqual({
      reading_time: '2026-05-23T07:00:00.000-04:00',
      gage_height_ft: 3.10,
      discharge_cfs: 400
    });
  });

  it('drops the -999999 no-data sentinel', () => {
    const { readings } = parseUsgsResponse(fixture);
    const eight = readings.find(r => r.reading_time === '2026-05-23T08:00:00.000-04:00');
    // The 08:00 gage-height value was the sentinel and had no discharge → no reading at all
    expect(eight).toBeUndefined();
  });

  it('returns readings sorted ascending by time', () => {
    const { readings } = parseUsgsResponse(fixture);
    expect(readings.map(r => r.reading_time)).toEqual([
      '2026-05-23T07:00:00.000-04:00',
      '2026-05-23T07:30:00.000-04:00'
    ]);
  });

  it('handles an empty/blank response without throwing', () => {
    expect(parseUsgsResponse({}).readings).toEqual([]);
    expect(parseUsgsResponse({ value: { timeSeries: [] } }).name).toBeNull();
  });
});
