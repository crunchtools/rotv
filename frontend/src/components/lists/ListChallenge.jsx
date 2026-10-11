import React, { useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { listProgress, formatListDay } from '../../utils/listProgress';
import ListBadge from './ListBadge';
import ListCheckinControl from './ListCheckinControl';

/**
 * A curated list as a challenge (spec 050): how far along the person is, the
 * badge, the list's rules and rewards, and its free choice.
 *
 * @param {object} props
 * @param {object} props.list The list, from /api/lists
 * @param {object[]} props.trails Every trail POI, for the free choice
 */
export default function ListChallenge({ list, trails }) {
  const { isAuthenticated, listCheckins } = useAuth();
  const [choicePoiId, setChoicePoiId] = useState('');

  const progress = listProgress(list, listCheckins);
  const choice = listCheckins.find(c => c.list_id === list.id && c.item_id == null);
  const sortedTrails = useMemo(
    () => [...trails].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [trails]
  );
  const chosenTrail = choice ? trails.find(t => t.id === choice.poi_id) : null;
  const percent = Math.min(100, Math.round((progress.done / progress.goal) * 100));

  let status;
  if (progress.earned) {
    status = `Badge earned ${formatListDay(progress.earnedOn)}.`;
  } else if (progress.season === 'open') {
    status = `${progress.remaining} to go · ${progress.daysLeft} ${progress.daysLeft === 1 ? 'day' : 'days'} left`;
  } else {
    status = `Ended ${formatListDay(list.ends_on)}. Hikes from the season can still be filled in.`;
  }

  return (
    <div className="list-challenge">
      {list.hero_image && (
        <figure className="list-hero">
          <img
            src={list.hero_image}
            alt={`${list.name}, ${formatListDay(list.starts_on)} to ${formatListDay(list.ends_on)}`}
          />
          {list.hero_credit && (
            <figcaption>
              Image:{' '}
              {list.source_url
                ? <a className="link-button" href={list.source_url} target="_blank" rel="noopener noreferrer">{list.hero_credit}</a>
                : list.hero_credit}
            </figcaption>
          )}
        </figure>
      )}
      <p className="find-list-description">{list.description}</p>

      <div className="list-challenge-progress">
        <ListBadge
          edition={list.edition}
          earned={progress.earned}
          title={progress.earned ? `${list.edition} ${list.name} badge, earned` : `${list.edition} ${list.name} badge, not yet earned`}
        />
        <div className="list-challenge-tally">
          <div className="list-challenge-count">
            <strong>{progress.done} of {progress.goal}</strong> hikes
          </div>
          <div
            className="list-challenge-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.goal}
            aria-valuenow={Math.min(progress.done, progress.goal)}
            aria-label={`${list.name} progress`}
          >
            <div className="list-challenge-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="list-challenge-status" aria-live="polite">{status}</div>
        </div>
      </div>

      {!isAuthenticated && progress.done > 0 && (
        <p className="list-challenge-nudge">
          Your hikes are saved on this device. Sign in to keep them on your account, year after year.
        </p>
      )}

      {list.choice_label && (
        <div className="list-challenge-choice">
          <div className="list-challenge-choice-name">{list.choice_label}</div>
          <div className="list-challenge-choice-about">
            {chosenTrail ? chosenTrail.name : list.choice_description}
          </div>
          <div className="list-challenge-choice-row">
            {!choice && (
              <select
                aria-label={`${list.choice_label}: pick a trail`}
                value={choicePoiId}
                onChange={(e) => setChoicePoiId(e.target.value)}
              >
                <option value="">Pick a trail…</option>
                {sortedTrails.map(trail => <option key={trail.id} value={trail.id}>{trail.name}</option>)}
              </select>
            )}
            <ListCheckinControl list={list} choicePoiId={choicePoiId ? Number(choicePoiId) : null} />
          </div>
        </div>
      )}

      <details className="list-challenge-rules">
        <summary>How it works</summary>
        <ul>
          <li>
            Hike at least {progress.goal} of the {list.items.length} trails below.
          </li>
          {list.choice_label && (
            <li>
              One of the {progress.goal} can be your {list.choice_label}, as on the official form: {list.choice_description}
            </li>
          )}
          <li>Hikes count from {formatListDay(list.starts_on)} through {formatListDay(list.ends_on, { year: true })}.</li>
          <li>Each trail counts once. Mark it hiked, then set the date beside it to the day you hiked it.</li>
          {(list.rewards || '').split('\n').filter(Boolean).map(line => <li key={line}>{line}</li>)}
          {list.rewards_until && <li>Rewards are not available after {formatListDay(list.rewards_until, { year: true })}.</li>}
        </ul>
        <p className="list-challenge-links">
          {list.source_url && (
            <a className="link-button" href={list.source_url} target="_blank" rel="noopener noreferrer">Official details</a>
          )}
          {list.form_url && (
            <a className="link-button" href={list.form_url} target="_blank" rel="noopener noreferrer">Official form</a>
          )}
        </p>
      </details>
    </div>
  );
}
