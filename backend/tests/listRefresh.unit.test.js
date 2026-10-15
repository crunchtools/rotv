/**
 * Reading the district's spree entries (spec 052): the entry text it publishes
 * per trail, and which of our trails each one is.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseProgramEntry, matchTrail, nextDescription, fetchSpreeEntries } from '../services/listRefreshService.js';

describe('parseProgramEntry', () => {
  it('reads a trail, its park, length and difficulty in the form\'s words', () => {
    expect(parseProgramEntry('Nuthatch Trail (Sand Run Metro Park, 3.3 miles, difficult)')).toEqual({
      label: 'Nuthatch Trail', section: null, park: 'Sand Run Metro Park', miles: 3.3, rating: 'Strenuous'
    });
    expect(parseProgramEntry('Chippewa Trail (Silver Creek Metro Park, 2 miles, moderate)')).toMatchObject({ miles: 2, rating: 'Moderate' });
    expect(parseProgramEntry('Black Bear Trail (Liberty Park, 2.1 miles, moderate)')).toMatchObject({ park: 'Liberty Park' });
  });

  it('reads a hike on part of a trail, which names no park', () => {
    expect(parseProgramEntry('Towpath Trail - Between Wilbeth Road Trailhead & Summit Lake Nature Center (2.2 miles, easy)')).toEqual({
      label: 'Towpath Trail', section: 'Between Wilbeth Road Trailhead & Summit Lake Nature Center', park: null, miles: 2.2, rating: 'Easy'
    });
  });

  it('gives up on text in another shape', () => {
    expect(parseProgramEntry('Hike any trail you like')).toBeNull();
    expect(parseProgramEntry('')).toBeNull();
  });
});

describe('matchTrail', () => {
  const trails = [
    { id: 1, name: 'Parcours Trail' }, { id: 2, name: 'Parcours Trail (Sand Run)' },
    { id: 3, name: 'Seneca Trail' }, { id: 4, name: 'Ohio & Erie Canal Towpath Trail' }
  ];

  it('takes the trail of the same name', () => {
    expect(matchTrail(trails, { districtName: 'Seneca Trail', label: 'Seneca Trail' }).poi.id).toBe(3);
    expect(matchTrail(trails, { districtName: 'Parcours Trail (Sand Run)', label: 'Parcours Trail' }).poi.id).toBe(2);
  });

  it('picks last year\'s trail between two of one name, and leaves it to an admin otherwise', () => {
    const entry = { districtName: 'Parcours Trail (Goodyear Heights)', label: 'Parcours Trail' };
    expect(matchTrail(trails, entry, [{ poi_id: 1, label: 'Parcours Trail' }]).poi.id).toBe(1);
    const { poi, candidates } = matchTrail(trails, { ...entry, label: 'Parcours' });
    expect(poi).toBeNull();
    expect(candidates.map(c => c.id)).toEqual([1, 2]);
  });

  it('finds a trail the district names differently by last year\'s item for it', () => {
    const entry = { districtName: 'Towpath Trail', label: 'Towpath Trail' };
    expect(matchTrail(trails, entry).poi).toBeNull();
    expect(matchTrail(trails, entry, [{ poi_id: 4, label: 'Towpath Trail from Wilbeth Road' }]).poi.id).toBe(4);
  });
});

describe('nextDescription', () => {
  it('counts the program on a year', () => {
    expect(nextDescription("Summit Metro Parks' 63rd annual Fall Hiking Spree.", 1)).toBe("Summit Metro Parks' 64th annual Fall Hiking Spree.");
    expect(nextDescription('The 70th annual spree', 1)).toBe('The 71st annual spree');
    expect(nextDescription('The 111th annual spree', 1)).toBe('The 112th annual spree');
  });
});

describe('fetchSpreeEntries', () => {
  it('waits for the year\'s column, then reads its entries', async () => {
    const answer = (body) => ({ ok: true, json: async () => body });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(answer({ fields: [{ name: 'FHS_2026' }] }));
    expect(await fetchSpreeEntries(2027, fetchImpl)).toBeNull();

    fetchImpl
      .mockResolvedValueOnce(answer({ fields: [{ name: 'FHS_2027' }] }))
      .mockResolvedValueOnce(answer({ features: [
        { attributes: { NAME: 'Seneca Trail ', FHS_2027: 'Seneca Trail (F.A. Seiberling Nature Realm, 1.4 miles, moderate)' } },
        { attributes: { NAME: 'Jogging Trail', FHS_2027: ' ' } }
      ] }));
    expect(await fetchSpreeEntries(2027, fetchImpl)).toEqual([
      { districtName: 'Seneca Trail', entry: 'Seneca Trail (F.A. Seiberling Nature Realm, 1.4 miles, moderate)' }
    ]);
    expect(new URL(fetchImpl.mock.calls[2][0]).searchParams.get('where')).toBe('FHS_2027 IS NOT NULL');
  });
});
