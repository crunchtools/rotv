import { describe, it, expect } from 'vitest';
import { curatedListRows, sortListRows } from './curatedList';

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
  const row = (position, label, park) => ({ name: label, _park: park, _listItem: { position, label } });
  const rows = [
    row(1, 'Towpath Trail from Wilbeth Road', 'Wilbeth Road Trailhead'),
    row(2, 'Rock Creek Trail', 'Furnace Run Metro Park'),
    row(3, 'Adam Run Trail', 'Hampton Hills Metro Park'),
    row(4, 'Old Mill Trail', 'Furnace Run Metro Park')
  ];
  const positions = (sorted) => sorted.map(r => r._listItem.position);

  it('keeps the organizer\'s order by default, and for a sort it does not know', () => {
    expect(positions(sortListRows(rows, 'official'))).toEqual([1, 2, 3, 4]);
    expect(positions(sortListRows(rows, 'nonsense'))).toEqual([1, 2, 3, 4]);
  });

  it('orders by trail name', () => {
    expect(positions(sortListRows(rows, 'trail'))).toEqual([3, 4, 2, 1]);
  });

  it('orders by park, then by trail within a park', () => {
    expect(positions(sortListRows(rows, 'park'))).toEqual([4, 2, 3, 1]);
  });

  it('does not reorder the rows it was given', () => {
    sortListRows(rows, 'trail');
    expect(positions(rows)).toEqual([1, 2, 3, 4]);
  });
});

