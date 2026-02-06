import React, { memo } from 'react';

// Individual POI tile for the Results tab
const ResultsTile = memo(function ResultsTile({ poi, poiKey, isLinear, isVirtual, isSelected, showStatusBadge, status, showStatusInfo, statusData }) {
  // Use thumbnail endpoint for fast, cached small images
  // Include updated_at for cache busting when image changes
  const imageUrl = poi.image_mime_type
    ? `/api/pois/${poi.id}/thumbnail?size=small&v=${poi.updated_at || Date.now()}`
    : null;

  // Get default thumbnail SVG path based on type
  const getDefaultThumbnail = () => {
    if (isVirtual) return '/icons/thumbnails/virtual.svg';
    if (isLinear) {
      if (poi.feature_type === 'river') return '/icons/thumbnails/river.svg';
      if (poi.feature_type === 'boundary') return '/icons/thumbnails/boundary.svg';
      return '/icons/thumbnails/trail.svg';
    }
    return '/icons/thumbnails/destination.svg';
  };

  // Get POI type for styling and labels
  const getPoiType = () => {
    if (isVirtual) return 'virtual';
    if (!isLinear) return 'destination';
    if (poi.feature_type === 'river') return 'river';
    if (poi.feature_type === 'boundary') return 'boundary';
    return 'trail';
  };

  // Get type label
  const getTypeLabel = () => {
    const type = getPoiType();
    if (type === 'virtual') return 'Organization';
    if (type === 'destination') return 'Destination';
    if (type === 'river') return 'River';
    if (type === 'boundary') return 'Boundary';
    return 'Trail';
  };

  const poiType = getPoiType();

  return (
    <div
      className={`results-tile ${isSelected ? 'selected' : ''} poi-type-${poiType}`}
      data-poi-key={poiKey}
      role="button"
      tabIndex={0}
    >
      {/* Thumbnail */}
      <div className={`results-tile-image ${isVirtual ? 'virtual-thumbnail' : ''}`}>
        {imageUrl ? (
          <img src={imageUrl} alt={poi.name} loading="lazy" className={isVirtual ? 'logo-image' : ''} />
        ) : (
          <img src={getDefaultThumbnail()} alt={poi.name} className="default-thumbnail" loading="lazy" />
        )}
      </div>

      {/* Content */}
      <div className="results-tile-content">
        <div className="results-tile-name">{poi.name}</div>

        {/* Badges row */}
        <div className="results-tile-badges">
          <span className={`poi-type-icon ${poiType}`}>
            {poiType === 'virtual' ? 'O' : poiType === 'destination' ? 'D' : poiType === 'trail' ? 'T' : poiType === 'river' ? 'R' : 'B'}
          </span>
          {showStatusBadge && status && (
            <span className={`status-badge status-${status.status}`}>
              {status.status.toUpperCase()}
            </span>
          )}
          {poi.era_name && (
            <span className="results-tile-era">{poi.era_name}</span>
          )}
          {isLinear && poi.difficulty && (
            <span className={`results-tile-difficulty ${poi.difficulty.toLowerCase()}`}>
              {poi.difficulty}
            </span>
          )}
        </div>

        {/* Trail status info (MTB mode) or brief description */}
        {showStatusInfo && statusData ? (
          <div className="results-tile-status-info">
            <div className="status-row">
              <span className={`status-badge status-${statusData.status || 'unknown'}`}>
                {statusData.status ? statusData.status.toUpperCase() : 'UNKNOWN'}
              </span>
            </div>
            {statusData.conditions && (
              <div className="status-conditions">{statusData.conditions}</div>
            )}
            {statusData.last_updated && (
              <div className="status-updated">
                Updated: {new Date(statusData.last_updated).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}
              </div>
            )}
          </div>
        ) : poi.brief_description && (
          <div className="results-tile-description">
            {poi.brief_description}
          </div>
        )}
      </div>
    </div>
  );
});

export default ResultsTile;
