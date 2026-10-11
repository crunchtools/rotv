import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { listProgress, formatListDay } from '../../utils/listProgress';
import ListBadge from './ListBadge';

/**
 * A curated list as a challenge (spec 050): how far along the person is, the
 * badge, and the list's rules and rewards. The hikes, and the free choice
 * among them, are the rows under it.
 *
 * @param {object} props
 * @param {object} props.list The list, from /api/lists
 */
export default function ListChallenge({ list }) {
  const { isAuthenticated, listCheckins } = useAuth();
  const progress = listProgress(list, listCheckins);
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

      <details className="list-challenge-rules">
        <summary>How it works</summary>
        <ul>
          <li>
            Hike at least {progress.goal} of the {list.items.length} trails below.
          </li>
          {list.choice_label && (
            <li>
              One of the {progress.goal} can be your {list.choice_label}, as on the official form: {list.choice_description}{' '}
              It is a tile in the list; change the trail on it to the one you hiked.
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
