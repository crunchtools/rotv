import { describe, it, expect } from 'vitest';
import { curatedListRows } from './curatedList';

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
