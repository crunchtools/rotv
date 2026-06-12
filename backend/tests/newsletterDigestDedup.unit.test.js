/**
 * Digest-time dedup for the weekly newsletter (issue #15 regressions).
 * Event case: "Steam in the Valley!" appeared twice — once with a bare date
 * (noon fallback) and once at 10:00 AM, with slightly different URLs.
 * News case: the Summit Metro Parks fishing-derby story ran twice, collected
 * from the parks' own site and from Spectrum News.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/buttondownClient.js', () => ({
  sendEmail: vi.fn(),
  sendDraftToRecipients: vi.fn()
}));

const { dedupeDigestEvents, dedupeDigestNews } = await import('../services/newsletterDigestService.js');

const TZ = 'America/New_York';

describe('dedupeDigestEvents', () => {
  const steamTimed = {
    id: 1, poi_id: 42, poi_name: 'Cuyahoga Valley Scenic Railroad',
    title: 'Steam in the Valley!',
    start_date: '2026-06-05T14:00:00Z', // 10:00 AM Eastern
    source_url: 'https://www.cvsr.org/excursions/steam-in-the-valley/steam-in-the-valley'
  };
  const steamNoonFallback = {
    id: 2, poi_id: 42, poi_name: 'Cuyahoga Valley Scenic Railroad',
    title: 'Steam in the Valley!',
    start_date: '2026-06-05T16:00:00Z', // noon Eastern date-only fallback
    source_url: 'https://www.cvsr.org/excursions/steam-in-the-valley'
  };

  it('collapses the same title at the same POI on the same day', () => {
    const result = dedupeDigestEvents([steamTimed, steamNoonFallback], TZ);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1); // earliest start (the timed variant) wins
  });

  it('treats "The" prefix and case as the same title', () => {
    const result = dedupeDigestEvents([
      steamTimed,
      { ...steamNoonFallback, title: 'The STEAM IN THE VALLEY!' }
    ], TZ);
    expect(result).toHaveLength(1);
  });

  it('keeps the same event on different days (recurring series)', () => {
    const saturdayRun = { ...steamNoonFallback, id: 3, start_date: '2026-06-06T16:00:00Z' };
    expect(dedupeDigestEvents([steamTimed, saturdayRun], TZ)).toHaveLength(2);
  });

  it('keeps identical titles at different POIs', () => {
    const otherPoi = { ...steamNoonFallback, id: 4, poi_id: 99 };
    expect(dedupeDigestEvents([steamTimed, otherPoi], TZ)).toHaveLength(2);
  });

  it('compares days in the digest timezone, not UTC', () => {
    // 11 PM Friday Eastern is 3 AM Saturday UTC — still the same Friday event
    const lateNight = { ...steamTimed, id: 5, start_date: '2026-06-06T03:00:00Z' };
    const lateNightDup = { ...steamTimed, id: 6, start_date: '2026-06-06T03:00:00Z' };
    expect(dedupeDigestEvents([lateNight, lateNightDup], TZ)).toHaveLength(1);
  });
});

describe('dedupeDigestNews', () => {
  const derbyFromParks = {
    id: 10, poi_id: 7, poi_name: 'Summit Metro Parks',
    title: 'Summit Metro Parks Promotes Native Fish Conservation and Fishing Programs',
    summary: 'Summit Metro Parks is promoting its free fishing programs, including Kids\' and Special Needs Fishing Derbies, which will take place in June. The park district has prioritized stocking native fish in its inland lakes and ponds since 2025, aiming to conserve biodiversity and improve aquatic ecosystems.'
  };
  const derbyFromSpectrum = {
    id: 11, poi_id: 7, poi_name: 'Summit Metro Parks',
    title: 'Summit Metro Parks to host annual fishing derbies',
    summary: 'Summit Metro Parks will hold its annual Kids\' Fishing Derby on June 20 and a Special Needs Fishing Derby on June 23 at Little Turtle Pond in Firestone Metro Park. The parks are also enhancing their fish stocking with native species, aiming for larger catches in the derbies.'
  };
  const corpseFlower = {
    id: 12, poi_id: 8, poi_name: 'Cleveland Metroparks',
    title: '32-year-old corpse flower expected to bloom soon at Cleveland Metroparks Zoo',
    summary: 'It could soon be time to visit the Cleveland Metroparks Zoo for a rare blooming -- or stay far, far away, depending on your preference.'
  };
  const mothNight = {
    id: 13, poi_id: 7, poi_name: 'Summit Metro Parks',
    title: 'Moth Night returns to Summit Metro Parks',
    summary: 'Join a naturalist to explore the nighttime world of moths, observing various species that come in different shapes, colors, and sizes at the Nature Realm.'
  };

  it('collapses the same story collected from two outlets', () => {
    const result = dedupeDigestNews([derbyFromParks, derbyFromSpectrum]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(10); // first in sort order (most recent) wins
  });

  it('keeps unrelated stories from the same POI', () => {
    expect(dedupeDigestNews([derbyFromParks, mothNight])).toHaveLength(2);
  });

  it('keeps similar-vocabulary stories from different POIs', () => {
    const otherPoiCopy = { ...derbyFromSpectrum, id: 14, poi_id: 8, poi_name: 'Cleveland Metroparks' };
    expect(dedupeDigestNews([derbyFromParks, otherPoiCopy])).toHaveLength(2);
  });

  it('passes through a mixed digest untouched except for the dup', () => {
    const result = dedupeDigestNews([corpseFlower, derbyFromParks, derbyFromSpectrum, mothNight]);
    expect(result.map(n => n.id)).toEqual([12, 10, 13]);
  });

  it('handles items with no summary', () => {
    const bare = { id: 15, poi_id: 7, poi_name: 'Summit Metro Parks', title: 'Trail closure announced', summary: null };
    expect(dedupeDigestNews([derbyFromParks, bare])).toHaveLength(2);
  });
});
