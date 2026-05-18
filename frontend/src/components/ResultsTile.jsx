import React, { memo } from 'react';
import { getIconUrlForPOI } from '../utils/iconUtils';

const ResultsTile = memo(function ResultsTile({ poi, poiKey, isLinear, isVirtual, isSelected, showStatusBadge, status, showStatusInfo, statusData, iconConfig }) {
  const imageUrl = poi.has_primary_image
    ? `/api/pois/${poi.id}/thumbnail?size=small&v=${poi.updated_at || Date.now()}`
    : null;

  const isMtbTrailhead = !isLinear && !isVirtual && (poi.poi_roles?.includes('mtb_trail') || (poi.status_url && poi.status_url.trim() !== ''));

  const getDefaultThumbnail = () => {
    if (isVirtual) return '/icons/thumbnails/virtual.svg';
    if (isLinear) {
      if (poi.feature_type === 'river') return '/icons/thumbnails/river.svg';
      if (poi.feature_type === 'boundary') return '/icons/thumbnails/boundary.svg';
      return '/icons/thumbnails/trail.svg';
    }
    if (isMtbTrailhead) return '/icons/thumbnails/mtb.svg';
    return '/icons/thumbnails/destination.svg';
  };

  const getPoiType = () => {
    if (isVirtual) return 'virtual';
    if (!isLinear) {
      if (isMtbTrailhead) return 'mtb';
      return 'destination';
    }
    if (poi.feature_type === 'river') return 'river';
    if (poi.feature_type === 'boundary') return 'boundary';
    return 'trail';
  };

  const poiType = getPoiType();

  return (
    <div
      className={`results-tile ${isSelected ? 'selected' : ''} poi-type-${poiType}`}
      data-poi-key={poiKey}
      role="button"
      tabIndex={0}
    >
      <div className={`results-tile-image ${isVirtual ? 'virtual-thumbnail' : ''}`}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={poi.name}
            loading="lazy"
            className={isVirtual ? 'logo-image' : ''}
            onError={(e) => {
              e.target.src = getDefaultThumbnail();
              e.target.className = 'default-thumbnail';
            }}
          />
        ) : (
          <img src={getDefaultThumbnail()} alt={poi.name} className="default-thumbnail" loading="lazy" />
        )}
      </div>

      <div className="results-tile-content">
        <div className="results-tile-name">{poi.name}</div>

        <div className="results-tile-badges">
          <img
            src={getIconUrlForPOI(poi, iconConfig, poiType)}
            alt={poiType}
            className="poi-type-icon"
            width="20"
            height="20"
          />
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
