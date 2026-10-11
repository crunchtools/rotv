/**
 * Where a person stands on a curated list (spec 050): how many of its hikes
 * they have logged, whether that earns the badge, and which dates the list's
 * rules let them log. The server applies the same rules (poiListService.js).
 */

const LIST_TIMEZONE = 'America/New_York';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's date in the valley, as YYYY-MM-DD: the season's dates are the organizer's. */
export function todayInValley(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LIST_TIMEZONE }).format(now);
}

const daysBetween = (fromIso, toIso) =>
  Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / DAY_MS);

/** "October 4" for an ISO date; with `year`, "October 4, 2026". */
export function formatListDay(isoDate, { year = false, short = false } = {}) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-US', {
    month: short ? 'short' : 'long', day: 'numeric', ...(year ? { year: 'numeric' } : {})
  });
}

/**
 * The check-ins that count toward a list: one per item still on it, plus the
 * free choice when the list offers one.
 */
export function checkinsForList(list, checkins) {
  const itemIds = new Set(list.items.map(item => item.id));
  const seen = new Set();
  return checkins.filter(checkin => {
    if (checkin.list_id !== list.id) return false;
    const key = checkin.item_id == null ? 'choice' : checkin.item_id;
    if (seen.has(key)) return false;
    if (checkin.item_id == null ? !list.choice_label : !itemIds.has(checkin.item_id)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {object} list A list from /api/lists
 * @param {object[]} checkins Every check-in the person has, on any list
 * @param {string} [today]
 * @returns {{done: number, goal: number, remaining: number, earned: boolean, earnedOn: string|null,
 *   season: 'upcoming'|'open'|'ended', daysLeft: number}} `earnedOn` is the day the goal was reached;
 *   `daysLeft` counts today, and is 0 outside the season
 */
export function listProgress(list, checkins, today = todayInValley()) {
  const mine = checkinsForList(list, checkins);
  const goal = list.goal_count || list.items.length;
  const done = mine.length;
  const earned = goal > 0 && done >= goal;
  const dates = mine.map(checkin => checkin.done_on).sort();
  const season = today < list.starts_on ? 'upcoming' : today > list.ends_on ? 'ended' : 'open';
  return {
    done,
    goal,
    remaining: Math.max(goal - done, 0),
    earned,
    earnedOn: earned ? dates[goal - 1] : null,
    season,
    daysLeft: season === 'open' ? daysBetween(today, list.ends_on) + 1 : 0
  };
}

/**
 * The dates a hike on this list may carry: inside the season and not in the
 * future. Null before the season opens. After it ends a hike can still be
 * filled in, dated inside the season.
 *
 * @returns {{min: string, max: string}|null}
 */
export function checkinDateBounds(list, today = todayInValley()) {
  if (today < list.starts_on) return null;
  return { min: list.starts_on, max: today > list.ends_on ? list.ends_on : today };
}

/**
 * How many earlier editions of the same series the person finished: a spree
 * hiker in their second year is a returning hiker.
 */
export function earlierEditionsEarned(list, allLists, checkins) {
  return allLists.filter(other =>
    other.slug === list.slug && other.edition < list.edition && listProgress(other, checkins, other.ends_on).earned
  ).length;
}
