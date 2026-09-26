import React from 'react';
import { useAuth } from '../hooks/useAuth';
import BadgeToggleButton from './BadgeToggleButton';

const STAR_FILLED = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';
const STAR_OUTLINE = 'M12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4zM12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z';

export default function FavoriteToggle({ poi, className = 'share-badge-btn favorite-toggle-btn' }) {
  const { isFavorited, toggleFavorite } = useAuth();

  const poiId = poi && poi.id ? poi.id : null;
  if (!poiId) return null;

  const favorited = isFavorited(poiId);

  return (
    <BadgeToggleButton
      active={favorited}
      onToggle={() => toggleFavorite(poiId)}
      className={className}
      activeClassName="favorited"
      title={favorited ? 'Remove from favorites' : 'Add to favorites for news & event updates'}
      activeIconPath={STAR_FILLED}
      inactiveIconPath={STAR_OUTLINE}
      label={favorited ? 'Favorited' : 'Favorite'}
    />
  );
}
