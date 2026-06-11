import { describe, it, expect } from 'vitest';
import { expandSeries, cadenceLabel, nextOccurrence } from '../services/eventSeriesService.js';

// Cuyahoga Valley Farmers Market (spec 034, #436): the two driving series.
const summer = {
  id: 1, poi_id: 10, venue_poi_id: 20, venue_name: 'Howe Meadow',
  freq: 'WEEKLY', interval: 1, byday: ['SU'],
  season_start: '2026-05-03', season_end: '2026-10-25',
  time_start: '09:00:00', time_end: '12:00:00', active: true
};
// Winter is biweekly Saturdays anchored on 2025-11-01 (itself a Saturday).
const winter = {
  id: 2, poi_id: 10, freq: 'WEEKLY', interval: 2, byday: ['SA'],
  season_start: '2025-11-01', season_end: '2026-04-25',
  time_start: '09:00:00', time_end: '12:00:00', active: true
};

const dow = (ymd) => new Date(`${ymd.slice(0, 10)}T00:00:00Z`).getUTCDay();

describe('expandSeries — weekly cadence', () => {
  it('projects every Sunday within the request window', () => {
    const dates = expandSeries(summer, '2026-06-01', '2026-06-30').map(o => o.start_date);
    expect(dates).toEqual([
      '2026-06-07 09:00:00', '2026-06-14 09:00:00',
      '2026-06-21 09:00:00', '2026-06-28 09:00:00'
    ]);
  });

  it('embeds the time of day so the event card renders a time', () => {
    const occ = expandSeries(summer, '2026-06-07', '2026-06-07')[0];
    expect(occ.start_date).toBe('2026-06-07 09:00:00');
    expect(occ.end_date).toBe('2026-06-07 12:00:00');
    expect(occ.is_recurring).toBe(true);
    expect(occ.occurrence_date).toBe('2026-06-07');
  });

  it('carries the venue (where) distinct from the organizer (poi_id)', () => {
    const occ = expandSeries(summer, '2026-06-07', '2026-06-07')[0];
    expect(occ.poi_id).toBe(10);          // organizer
    expect(occ.venue_poi_id).toBe(20);    // venue
    expect(occ.venue_name).toBe('Howe Meadow');
  });

  it('every projected date falls on the requested weekday', () => {
    const occ = expandSeries(summer, '2026-05-01', '2026-10-31');
    expect(occ.every(o => dow(o.start_date) === 0)).toBe(true); // Sunday
  });
});

describe('expandSeries — biweekly cadence', () => {
  it('projects every other Saturday on the anchor grid', () => {
    const dates = expandSeries(winter, '2026-01-01', '2026-02-15').map(o => o.start_date.slice(0, 10));
    expect(dates).toEqual(['2026-01-10', '2026-01-24', '2026-02-07']);
  });

  it('keeps every projected date on a Saturday', () => {
    const occ = expandSeries(winter, '2025-11-01', '2026-04-25');
    expect(occ.every(o => dow(o.start_date) === 6)).toBe(true);
  });
});

describe('expandSeries — season bounds', () => {
  it('emits nothing before the season starts', () => {
    expect(expandSeries(summer, '2026-04-01', '2026-04-30')).toHaveLength(0);
  });
  it('emits nothing after the season ends', () => {
    expect(expandSeries(summer, '2026-11-01', '2026-11-30')).toHaveLength(0);
  });
  it('clips the request window to the season range', () => {
    // Window spans April–June but only June Sundays are in season.
    const dates = expandSeries(summer, '2026-04-15', '2026-06-14').map(o => o.start_date.slice(0, 10));
    expect(dates).toEqual(['2026-05-03', '2026-05-10', '2026-05-17', '2026-05-24', '2026-05-31', '2026-06-07', '2026-06-14']);
  });
});

describe('expandSeries — exception dates', () => {
  // Real CVFM winter market: weekly Saturdays, closed three holiday Saturdays.
  const winterWeekly = {
    id: 3, poi_id: 10, freq: 'WEEKLY', interval: 1, byday: ['SA'],
    season_start: '2026-11-07', season_end: '2027-04-24',
    exdates: ['2026-11-28', '2026-12-26', '2027-01-02'],
    time_start: '09:00:00', time_end: '12:00:00', active: true
  };
  it('skips the listed closure dates', () => {
    const dates = expandSeries(winterWeekly, '2026-11-01', '2027-01-10').map(o => o.occurrence_date);
    expect(dates).not.toContain('2026-11-28');
    expect(dates).not.toContain('2026-12-26');
    expect(dates).not.toContain('2027-01-02');
    expect(dates).toContain('2026-11-21');
    expect(dates).toContain('2027-01-09');
  });
});

describe('expandSeries — guards', () => {
  it('returns nothing for inactive series', () => {
    expect(expandSeries({ ...summer, active: false }, '2026-06-01', '2026-06-30')).toHaveLength(0);
  });
  it('returns nothing when byday is empty', () => {
    expect(expandSeries({ ...summer, byday: [] }, '2026-06-01', '2026-06-30')).toHaveLength(0);
  });
  it('ignores non-weekly frequency in v1', () => {
    expect(expandSeries({ ...summer, freq: 'MONTHLY' }, '2026-06-01', '2026-06-30')).toHaveLength(0);
  });
});

describe('nextOccurrence', () => {
  it('returns the next Sunday on/after a midweek date', () => {
    expect(nextOccurrence(summer, '2026-06-09').start_date).toBe('2026-06-14 09:00:00');
  });
  it('returns null once the season is over', () => {
    expect(nextOccurrence(summer, '2026-12-01')).toBeNull();
  });
});

describe('cadenceLabel', () => {
  it('labels weekly and biweekly cadences', () => {
    expect(cadenceLabel(summer)).toBe('Weekly: Sundays');
    expect(cadenceLabel(winter)).toBe('Every 2 weeks: Saturdays');
  });
});
