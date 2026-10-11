import { describe, it, expect } from 'vitest';
import {
  todayInValley, checkinsForList, listProgress, checkinDateBounds, earlierEditionsEarned, formatListDay
} from './listProgress';

const spree = (edition, id) => ({
  id, slug: 'fall-hiking-spree', edition, goal_count: 3, choice_label: "Hiker's Choice",
  starts_on: `${edition}-09-01`, ends_on: `${edition}-11-30`,
  items: [1, 2, 3, 4].map(n => ({ id: id * 10 + n, poi_id: 100 + n }))
});
const list = spree(2026, 1);
const hike = (itemId, doneOn, listId = 1) => ({ list_id: listId, item_id: itemId, poi_id: 100, done_on: doneOn });

describe('todayInValley', () => {
  it('is the Eastern date, not the UTC one', () => {
    expect(todayInValley(new Date('2026-09-01T02:30:00Z'))).toBe('2026-08-31');
    expect(todayInValley(new Date('2026-09-01T12:00:00Z'))).toBe('2026-09-01');
  });
});

describe('checkinsForList', () => {
  it('counts one per trail, the free choice once, and nothing from another list', () => {
    const counted = checkinsForList(list, [
      hike(11, '2026-09-05'), hike(11, '2026-09-06'), hike(null, '2026-09-07'), hike(null, '2026-09-08'),
      hike(21, '2026-09-09', 2), hike(99, '2026-09-10')
    ]);
    expect(counted.map(c => [c.item_id, c.done_on])).toEqual([[11, '2026-09-05'], [null, '2026-09-07']]);
  });

  it('ignores a free choice on a list that offers none', () => {
    expect(checkinsForList({ ...list, choice_label: null }, [hike(null, '2026-09-07')])).toEqual([]);
  });
});

describe('listProgress', () => {
  it('counts toward the goal and the days left in the season', () => {
    expect(listProgress(list, [hike(11, '2026-09-05')], '2026-11-28')).toEqual({
      done: 1, goal: 3, remaining: 2, earned: false, earnedOn: null, season: 'open', daysLeft: 3
    });
  });

  it('earns the badge on the day the goal was reached, whatever order hikes were logged in', () => {
    const progress = listProgress(list, [
      hike(13, '2026-10-20'), hike(11, '2026-09-05'), hike(null, '2026-10-01'), hike(12, '2026-11-02')
    ], '2026-11-10');
    expect(progress).toMatchObject({ done: 4, remaining: 0, earned: true, earnedOn: '2026-10-20' });
  });

  it('knows a season that has not opened or has ended', () => {
    expect(listProgress(list, [], '2026-08-31')).toMatchObject({ season: 'upcoming', daysLeft: 0 });
    expect(listProgress(list, [], '2026-11-30')).toMatchObject({ season: 'open', daysLeft: 1 });
    expect(listProgress(list, [], '2026-12-01')).toMatchObject({ season: 'ended', daysLeft: 0 });
  });

  it('falls back to every item when the list sets no goal', () => {
    expect(listProgress({ ...list, goal_count: null }, [], '2026-10-01').goal).toBe(4);
  });
});

describe('checkinDateBounds', () => {
  it('allows the season so far, and the whole season once it has ended', () => {
    expect(checkinDateBounds(list, '2026-08-31')).toBeNull();
    expect(checkinDateBounds(list, '2026-10-11')).toEqual({ min: '2026-09-01', max: '2026-10-11' });
    expect(checkinDateBounds(list, '2027-01-15')).toEqual({ min: '2026-09-01', max: '2026-11-30' });
  });
});

describe('earlierEditionsEarned', () => {
  it('counts finished earlier years of the same series', () => {
    const y2025 = spree(2025, 2);
    const y2027 = spree(2027, 3);
    const other = { ...spree(2025, 4), slug: 'winter-challenge' };
    const checkins = [
      hike(21, '2025-09-05', 2), hike(22, '2025-09-06', 2), hike(23, '2025-09-07', 2),
      hike(41, '2025-09-05', 4), hike(42, '2025-09-06', 4), hike(43, '2025-09-07', 4),
      hike(11, '2026-09-05')
    ];
    const all = [y2025, list, y2027, other];
    expect(earlierEditionsEarned(list, all, checkins)).toBe(1);
    expect(earlierEditionsEarned(y2027, all, checkins)).toBe(1);
    expect(earlierEditionsEarned(y2025, all, checkins)).toBe(0);
  });
});

describe('formatListDay', () => {
  it('names the day without shifting it across a time zone', () => {
    expect(formatListDay('2026-09-01')).toBe('September 1');
    expect(formatListDay('2026-11-30', { year: true })).toBe('November 30, 2026');
    expect(formatListDay('2026-10-04', { short: true })).toBe('Oct 4');
  });
});
