import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function VisitedToggle({ poi, className = 'share-badge-btn visited-toggle-btn' }) {
  const { isVisited, toggleVisited } = useAuth();
  const [busy, setBusy] = useState(false);

  const poiId = poi && poi.id ? poi.id : null;
  if (!poiId) return null;

  const visited = isVisited(poiId);

  const handleClick = async (e) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await toggleVisited(poiId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className={`${className} ${visited ? 'visited' : ''}`}
      onClick={handleClick}
      disabled={busy}
      title={visited ? 'Remove from your visited list' : 'Mark this place as visited'}
      aria-pressed={visited}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        {visited ? (
          <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z" />
        ) : (
          <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
        )}
      </svg>
      {visited ? 'Visited' : 'Mark visited'}
    </button>
  );
}
