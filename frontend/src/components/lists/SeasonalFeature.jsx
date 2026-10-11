import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useActiveLists } from '../../hooks/useActiveLists';
import { listProgress, formatListDay } from '../../utils/listProgress';
import { listPath } from '../../utils/tabPaths';

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
 * The seasonal spotlight on the map (spec 050): while a featured list is in
 * season, a pill with its name and the person's tally that opens it. It can
 * be dismissed for the season. Find advertises the list in its FeatureBanner.
 */
export default function SeasonalFeature() {
  const navigate = useNavigate();
  const { listCheckins } = useAuth();
  const lists = useActiveLists();
  const [dismissed, setDismissed] = useState(readDismissed);

  const list = lists.find(l => l.featured);
  if (!list) return null;

  const editionKey = `${list.slug}-${list.edition}`;
  if (dismissed.includes(editionKey)) return null;

  const progress = listProgress(list, listCheckins);
  const tally = progress.earned
    ? 'Badge earned'
    : progress.done > 0 ? `${progress.done} of ${progress.goal} hiked` : `Through ${formatListDay(list.ends_on)}`;
  const open = () => navigate(listPath(list.slug));

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
