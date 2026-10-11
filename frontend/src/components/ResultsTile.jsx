import React, { memo } from 'react';
import { getIconUrlForPOI } from '../utils/iconUtils';

/**
 * One row in the Find tab's list.
 *
 * @param {object} props
 * @param {object} props.poi The place
 * @param {string} props.poiKey `point-<id>`, `linear-<id>` or `virtual-<id>`; the list reads it back on click
 * @param {boolean} props.isLinear A trail, river or boundary
 * @param {boolean} props.isVirtual An organization with no location
 * @param {boolean} props.isSelected
 * @param {string|null} [props.parkName] The park the place sits in, shown as "in <park>"
 * @param {boolean} [props.showStatusBadge] Show `status` as a badge beside the type icon
 * @param {{status: string}} [props.status]
 * @param {boolean} [props.showStatusInfo] Show the MTB trail status block instead of the description
 * @param {{status?: string, conditions?: string, last_updated?: string}} [props.statusData]
 * @param {object} [props.listItem] The row is an entry on a curated list (spec 050): what the
 *   organizer calls it, how long and hard it is, and where to park
 * @param {object[]} [props.iconConfig] Icon types, for the row's type icon
 * @param {import('react').ReactNode} [props.children] Controls shown under the row's text
 * @returns {JSX.Element}
 */
const ResultsTile = memo(function ResultsTile({ poi, poiKey, isLinear, isVirtual, isSelected, parkName, showStatusBadge, status, showStatusInfo, statusData, listItem, iconConfig, children }) {
  const imageUrl = poi.has_primary_image
    ? `/api/pois/${poi.id}/thumbnail?size=small&v=${poi.updated_at || Date.now()}`
    : null;

  const isMtbTrailhead = !isLinear && !isVirtual && (poi.poi_roles?.includes('mtb_trail') || (poi.status_url && poi.status_url.trim() !== ''));

  const getDefaultThumbnail = () => '/brand/rotv-logo.png';

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
        <div className="results-tile-name">{listItem?.label || poi.name}</div>
        {parkName && <div className="results-tile-park">in {parkName}</div>}

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
          {listItem && (
            <span className="results-tile-list-facts">
              {[listItem.miles != null && `${listItem.miles} mi`, listItem.rating, listItem.trail_class && `Class ${listItem.trail_class}`]
                .filter(Boolean).join(' · ')}
            </span>
          )}
          {isLinear && poi.difficulty && !listItem && (
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
        ) : listItem ? (
          <div className="results-tile-description">
            {listItem.note && <div>{listItem.note}</div>}
            {listItem.trailhead && <div>Park at {listItem.trailhead}</div>}
          </div>
        ) : poi.brief_description && (
          <div className="results-tile-description">
            {poi.brief_description}
          </div>
        )}
        {children}
      </div>
    </div>
  );
});

export default ResultsTile;
