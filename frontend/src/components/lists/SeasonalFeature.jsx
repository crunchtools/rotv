import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useActiveLists } from '../../hooks/useActiveLists';
import { listProgress, formatListDay } from '../../utils/listProgress';

const KEY_DISMISSED = 'rotv-feature-dismissed';

function readDismissed() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY_DISMISSED) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Could not read which seasonal features were hidden:', err);
    return [];
  }
}

/**
 * The seasonal spotlight (spec 050): while a featured list is in season, a
 * way into it from the map and from Find, showing the person's tally.
 *
 * @param {object} props
 * @param {'map'|'card'} props.variant `map` is a pill over the map that can be
 *   dismissed for the season; `card` is a row at the top of Find
 */
export default function SeasonalFeature({ variant }) {
  const navigate = useNavigate();
  const { listCheckins } = useAuth();
  const lists = useActiveLists();
  const [dismissed, setDismissed] = useState(readDismissed);

  const list = lists.find(l => l.featured);
  if (!list) return null;

  const editionKey = `${list.slug}-${list.edition}`;
  if (variant === 'map' && dismissed.includes(editionKey)) return null;

  const progress = listProgress(list, listCheckins);
  const tally = progress.earned
    ? 'Badge earned'
    : progress.done > 0 ? `${progress.done} of ${progress.goal} hiked` : `Through ${formatListDay(list.ends_on)}`;
  const open = () => navigate(`/find/${list.slug}`);

  if (variant === 'card') {
    return (
      <button type="button" className="seasonal-feature-card" onClick={open}>
        <span className="seasonal-feature-mark" aria-hidden="true">🍂</span>
        <span className="seasonal-feature-text">
          <strong>{list.name}</strong>
          <span>{tally} · {list.items.length} trails</span>
        </span>
        <span className="seasonal-feature-go" aria-hidden="true">›</span>
      </button>
    );
  }

  const dismiss = () => {
    const next = [...dismissed, editionKey];
    setDismissed(next);
    try {
      localStorage.setItem(KEY_DISMISSED, JSON.stringify(next));
    } catch {
      return;
    }
  };

  return (
    <div className="seasonal-feature-pill">
      <button type="button" className="seasonal-feature-open" onClick={open}>
        <span aria-hidden="true">🍂</span> {list.name} <span className="seasonal-feature-tally">· {tally}</span>
      </button>
      <button type="button" className="seasonal-feature-dismiss" onClick={dismiss} aria-label={`Hide ${list.name}`}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.410 10.59 12 5 17.590 6.41 19 12 13.410 17.590 19 19 17.590 13.410 12z" />
        </svg>
      </button>
    </div>
  );
}
