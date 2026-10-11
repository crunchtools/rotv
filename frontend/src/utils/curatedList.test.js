import { describe, it, expect } from 'vitest';
import {
  curatedListRows, sortListRows, parseListSort, nextListSort, choiceCandidates, suggestChoice, choiceRow
} from './curatedList';

const towpath = { id: 1062, name: 'Ohio & Erie Canal Towpath Trail', primary_activities: 'Biking, Hiking' };
const quarry = { id: 1081, name: 'Quarry Trail', navigation_latitude: 41.2, navigation_longitude: -81.5 };
const pois = [quarry, { id: 7, name: 'Not on the list' }, towpath];

const list = {
  items: [
    { poi_id: 1062, position: 1, label: 'Towpath Trail from Wilbeth Road', nav_latitude: 41.03, nav_longitude: -81.53 },
    { poi_id: 1081, position: 2, label: 'Quarry Trail', nav_latitude: null, nav_longitude: null },
    { poi_id: 1062, position: 3, label: 'Towpath Trail from Botzum', nav_latitude: 41.16, nav_longitude: -81.57 },
    { poi_id: 9999, position: 4, label: 'A place that was deleted' }
  ]
};

describe('curatedListRows', () => {
  it('keeps the organizer\'s order and leaves out an item whose place is unknown', () => {
    expect(curatedListRows(list, pois).map(row => row._listItem.position)).toEqual([1, 2, 3]);
  });

  it('sends Directions to the item\'s trailhead, or the place\'s own when the item has none', () => {
    const [first, second, third] = curatedListRows(list, pois);
    expect([first.navigation_latitude, first.navigation_longitude]).toEqual([41.03, -81.53]);
    expect([second.navigation_latitude, second.navigation_longitude]).toEqual([41.2, -81.5]);
    expect([third.navigation_latitude, third.navigation_longitude]).toEqual([41.16, -81.57]);
    expect(towpath.navigation_latitude).toBeUndefined();
  });

  it('uses the place\'s own pair when the item has only half a trailhead', () => {
    const half = { items: [{ poi_id: 1081, position: 1, label: 'Quarry Trail', nav_latitude: 41.9, nav_longitude: null }] };
    const [row] = curatedListRows(half, pois);
    expect([row.navigation_latitude, row.navigation_longitude]).toEqual([41.2, -81.5]);
  });

  it('matches two entries for one place by their own labels', () => {
    expect(curatedListRows(list, pois, 'wilbeth').map(row => row._listItem.position)).toEqual([1]);
    expect(curatedListRows(list, pois, 'botzum').map(row => row._listItem.position)).toEqual([3]);
  });

  it('matches the place itself, which every entry for it shares', () => {
    expect(curatedListRows(list, pois, 'canal').map(row => row._listItem.position)).toEqual([1, 3]);
    expect(curatedListRows(list, pois, 'biking').map(row => row._listItem.position)).toEqual([1, 3]);
    expect(curatedListRows(list, pois, 'nothing like this')).toEqual([]);
  });
});

describe('sortListRows', () => {
  const row = (position, label, park, rating, miles) => ({ name: label, _park: park, _listItem: { position, label, rating, miles } });
  const rows = [
    row(1, 'Towpath Trail from Wilbeth Road', 'Wilbeth Road Trailhead', 'Easy', 2.2),
    row(2, 'Rock Creek Trail', 'Furnace Run Metro Park', 'Easy', 1.3),
    row(3, 'Adam Run Trail', 'Hampton Hills Metro Park', 'Strenuous', 3.2),
    row(4, 'Old Mill Trail', 'Furnace Run Metro Park', 'Moderate', 1.0),
    row(5, 'Ledges Trail', 'Liberty Park', 'Difficult', 1.8),
    row(6, 'Mystery Trail', 'Liberty Park', null, 0.5)
  ];
  const positions = (sorted) => sorted.map(r => r._listItem.position);

  it('orders by trail name, up and down', () => {
    expect(positions(sortListRows(rows, 'trail'))).toEqual([3, 5, 6, 4, 2, 1]);
    expect(positions(sortListRows(rows, 'trail-desc'))).toEqual([1, 2, 4, 6, 5, 3]);
  });

  it('orders by park, then by trail within a park', () => {
    expect(positions(sortListRows(rows, 'park'))).toEqual([4, 2, 3, 5, 6, 1]);
    expect(positions(sortListRows(rows, 'park-desc'))).toEqual([1, 6, 5, 3, 2, 4]);
  });

  it('orders by difficulty: rating, then the shorter hike, an unrated hike last', () => {
    expect(positions(sortListRows(rows, 'difficulty'))).toEqual([2, 1, 4, 5, 3, 6]);
    expect(positions(sortListRows(rows, 'difficulty-desc'))).toEqual([6, 3, 5, 4, 1, 2]);
  });

  it('falls back to trail order for a sort it does not know, and leaves its input alone', () => {
    expect(positions(sortListRows(rows, 'official'))).toEqual([3, 5, 6, 4, 2, 1]);
    expect(positions(rows)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('parseListSort and nextListSort', () => {
  it('reads the key and the direction', () => {
    expect(parseListSort('park')).toEqual({ key: 'park', descending: false });
    expect(parseListSort('park-desc')).toEqual({ key: 'park', descending: true });
    expect(parseListSort('nonsense-desc')).toEqual({ key: 'trail', descending: false });
    expect(parseListSort(null)).toEqual({ key: 'trail', descending: false });
  });

  it('turns the active sort around and starts another one ascending', () => {
    expect(nextListSort('trail', 'trail')).toBe('trail-desc');
    expect(nextListSort('trail-desc', 'trail')).toBe('trail');
    expect(nextListSort('trail-desc', 'difficulty')).toBe('difficulty');
  });
});

describe('the free choice', () => {
  const SMP = 5672;
  const parks = {
    sandRun: { id: 1, owner_id: SMP },
    gorge: { id: 2, owner_id: SMP },
    hinckley: { id: 3, owner_id: 9 },
    oneil: { id: 4, owner_id: null }
  };
  const trail = (id, name, park, extra = {}) => ({ id, name, _in: park, ...extra });
  const parkOf = (poi) => poi._in || null;
  const nuthatch = trail(10, 'Nuthatch Trail', parks.oneil);
  const deerRun = trail(11, 'Deer Run Trail', parks.oneil);
  const glens = trail(12, 'Glens Trail', parks.gorge);
  const whipps = trail(13, "Whipp's Ledges Trail", parks.hinckley);
  const orphan = trail(14, 'An Unowned Connector', null);
  const owned = trail(15, 'Bike & Hike Trail', null, { owner_id: SMP });
  const spree = { organizer_poi_id: SMP, choice_label: "Hiker's Choice", choice_description: 'Any one trail.', items: [{ poi_id: 10 }] };
  const all = [whipps, nuthatch, glens, orphan, deerRun, owned];

  it('offers trails in the list\'s parks or the organizer\'s, and none already on the list', () => {
    expect(choiceCandidates(spree, all, parkOf, [nuthatch]).map(t => t.name))
      .toEqual(['Bike & Hike Trail', 'Deer Run Trail', 'Glens Trail']);
  });

  it('offers every other trail when none qualifies', () => {
    const nobody = { ...spree, organizer_poi_id: null };
    expect(choiceCandidates(nobody, [whipps, orphan, nuthatch], parkOf, []).map(t => t.id)).toEqual([14, 13]);
  });

  it('suggests a favorited trail first, else the same trail all day', () => {
    const candidates = [deerRun, glens, owned];
    expect(suggestChoice(candidates, [99, 12], '2026-10-11')).toBe(glens);
    const drawn = suggestChoice(candidates, [], '2026-10-11');
    expect(candidates).toContain(drawn);
    expect(suggestChoice(candidates, [], '2026-10-11')).toBe(drawn);
    expect(suggestChoice([], [12], '2026-10-11')).toBeNull();
  });

  it('draws different trails on different days', () => {
    const candidates = Array.from({ length: 40 }, (_, i) => trail(100 + i, `Trail ${i}`, parks.gorge));
    const drawn = new Set(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'].map(day => suggestChoice(candidates, [], day).id));
    expect(drawn.size).toBeGreaterThan(1);
  });

  it('makes the choice a row with the chosen trail\'s own facts', () => {
    const row = choiceRow(spree, { id: 12, name: 'Glens Trail', length_miles: '1.80', difficulty: 'Difficult' });
    expect(row).toMatchObject({ id: 12, name: 'Glens Trail' });
    expect(row._listItem).toMatchObject({
      id: null, choice: true, poi_id: 12, label: 'Glens Trail', tag: "Hiker's Choice", miles: 1.8, rating: 'Difficult'
    });
    expect(choiceRow(spree, { id: 13, name: 'Bare Trail' })._listItem).toMatchObject({ miles: null, rating: null });
  });
});
