import React from 'react';
import { useAuth } from '../hooks/useAuth';
import BadgeToggleButton from './BadgeToggleButton';

const CHECK_FILLED = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z';
const CIRCLE_OUTLINE = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z';

export default function VisitedToggle({ poi, className = 'share-badge-btn visited-toggle-btn' }) {
  const { isVisited, toggleVisited } = useAuth();

  const poiId = poi && poi.id ? poi.id : null;
  if (!poiId) return null;

  const visited = isVisited(poiId);

  return (
    <BadgeToggleButton
      active={visited}
      onToggle={() => toggleVisited(poiId)}
      className={className}
      activeClassName="visited"
      title={visited ? 'Remove from your visited list' : 'Mark this place as visited'}
      activeIconPath={CHECK_FILLED}
      inactiveIconPath={CIRCLE_OUTLINE}
      label={visited ? 'Visited' : 'Mark visited'}
    />
  );
}
