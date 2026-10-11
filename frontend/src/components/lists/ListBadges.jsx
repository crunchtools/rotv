import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useActiveLists } from '../../hooks/useActiveLists';
import { listProgress, checkinsForList, earlierEditionsEarned, formatListDay } from '../../utils/listProgress';
import ListBadge from './ListBadge';

/**
 * My Valley's Badges tab (spec 050): every curated list the person has hiked
 * on, this year's and earlier years', with the badge and the dated hikes.
 *
 * @param {object} props
 * @param {(slug: string) => void} props.onOpenList Open a list that is in season
 * @param {(count: number) => void} [props.onCount] Told how many badges are earned
 */
export default function ListBadges({ onOpenList, onCount }) {
  const { listCheckins } = useAuth();
  const activeLists = useActiveLists();
  const [pastLists, setPastLists] = useState([]);

  const activeIds = useMemo(() => new Set(activeLists.map(l => l.id)), [activeLists]);
  const pastIds = useMemo(
    () => [...new Set(listCheckins.map(c => c.list_id))].filter(id => !activeIds.has(id)).sort((a, b) => a - b),
    [listCheckins, activeIds]
  );
  const pastKey = pastIds.join(',');

  useEffect(() => {
    if (!pastKey) {
      setPastLists([]);
      return;
    }
    let current = true;
    fetch(`/api/lists?ids=${pastKey}`)
      .then(res => (res.ok ? res.json() : []))
      .then(loaded => { if (current) setPastLists(loaded); })
      .catch(err => console.error('Failed to fetch earlier lists:', err));
    return () => { current = false; };
  }, [pastKey]);

  const lists = useMemo(
    () => [...activeLists, ...pastLists].sort((a, b) => b.edition - a.edition || a.name.localeCompare(b.name)),
    [activeLists, pastLists]
  );
  const earnedCount = lists.filter(list => listProgress(list, listCheckins).earned).length;

  useEffect(() => {
    if (onCount) onCount(earnedCount);
  }, [onCount, earnedCount]);

  if (lists.length === 0) {
    return (
      <div className="my-valley-empty">
        <strong>No badges yet</strong>
        <p>When a seasonal challenge such as the Fall Hiking Spree is on, your hikes and badges show here.</p>
      </div>
    );
  }

  return (
    <ul className="list-badges">
      {lists.map(list => {
        const progress = listProgress(list, listCheckins);
        const hikes = checkinsForList(list, listCheckins).sort((a, b) => a.done_on.localeCompare(b.done_on));
        const earlier = earlierEditionsEarned(list, lists, listCheckins);
        return (
          <li key={list.id} className="list-badges-row">
            <ListBadge
              edition={list.edition}
              earned={progress.earned}
              size={48}
              title={`${list.edition} ${list.name} badge, ${progress.earned ? 'earned' : 'not yet earned'}`}
            />
            <div className="list-badges-body">
              <div className="list-badges-name">{list.name} {list.edition}</div>
              <div className="list-badges-status">
                {progress.earned
                  ? `Earned ${formatListDay(progress.earnedOn, { year: true })} · ${progress.done} hikes`
                  : `${progress.done} of ${progress.goal} hikes`}
                {earlier > 0 && ` · year ${earlier + 1}`}
              </div>
              {hikes.length > 0 && (
                <ul className="list-badges-hikes">
                  {hikes.map(hike => {
                    const item = list.items.find(i => i.id === hike.item_id);
                    return (
                      <li key={hike.item_id ?? 'choice'}>
                        {item ? item.label : list.choice_label} · {formatListDay(hike.done_on, { short: true })}
                      </li>
                    );
                  })}
                </ul>
              )}
              {activeIds.has(list.id) && (
                <button type="button" className="link-button" onClick={() => onOpenList(list.slug)}>
                  {progress.earned ? 'See the trails' : 'Keep going'}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
