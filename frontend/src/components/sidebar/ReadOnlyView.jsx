import { formatDateTime } from '../NewsEventsShared';
import NavigateButton from '../NavigateButton';
import AddToTripButton from '../AddToTripButton';
import FavoriteToggle from '../FavoriteToggle';
import CellSignal from './CellSignal';
import { getNavigationStops, getOwnerClass, formatCoordinate } from './helpers';

function ReadOnlyView({ destination, isLinearFeature, isAdmin, editMode, onShare, moreInfoLink, trailStatus = null, onCollectStatus, boatPosition }) {
  // Fix: only honor http(s) tracker URLs so a stored javascript: URL can't run on click (PR #405 review)
  const liveTrackerUrl = /^https?:\/\//i.test(destination.live_tracker_url || '')
    ? destination.live_tracker_url
    : null;
  return (
    <div className="view-container">
      <div className="view-scroll">

        <div className="sidebar-content">
        <div className="badges-row">
          {isLinearFeature ? (
            <span className={`poi-type-badge ${destination.poi_roles?.includes('river') ? 'river' : destination.poi_roles?.includes('water_taxi') ? 'water-taxi' : destination.poi_roles?.includes('boundary') ? 'boundary' : 'trail'}`}>
              {destination.poi_roles?.includes('river') ? 'River' :
               destination.poi_roles?.includes('water_taxi') ? 'Water Taxi' :
               destination.poi_roles?.includes('boundary') ? 'Boundary' : 'Trail'}
            </span>
          ) : destination.poi_roles?.includes('organization') ? (
            <span className="poi-type-badge virtual">
              Organization
            </span>
          ) : destination.poi_roles?.includes('point') && destination.status_url ? (
            <span className="poi-type-badge mtb">
              MTB Trailhead
            </span>
          ) : (
            <span className="poi-type-badge destination">
              Destination
            </span>
          )}
          {isLinearFeature && destination.difficulty && (
            <span className={`difficulty-badge ${destination.difficulty.toLowerCase()}`}>
              {destination.difficulty}
            </span>
          )}
          {destination.is_seasonal && (
            <span className="service-badge seasonal" title="Seasonal service — does not run in winter">
              Seasonal
            </span>
          )}
          {destination.is_ada_accessible && (
            <span className="service-badge ada" title="ADA accessible">
              ADA
            </span>
          )}
          {destination.is_bike_friendly && (
            <span className="service-badge bike" title="Bike-friendly">
              Bike-friendly
            </span>
          )}
          {destination.era_name && !destination.poi_roles?.includes('organization') && (
            <span className="era-badge-large">{destination.era_name}</span>
          )}
          {(destination.owner_name || destination.property_owner) && !destination.poi_roles?.includes('organization') && (
            <span className={`owner-badge ${getOwnerClass(destination.owner_name || destination.property_owner)}`}>
              {destination.owner_name || destination.property_owner}
            </span>
          )}
          {destination.status_url && trailStatus && trailStatus.status !== 'unknown' && (
            <span className={`trail-status-badge status-${trailStatus.status}`}>
              {trailStatus.status === 'open' ? 'Open' :
               trailStatus.status === 'closed' ? 'Closed' :
               trailStatus.status === 'limited' ? 'Limited' :
               trailStatus.status === 'maintenance' ? 'Maintenance' : 'Unknown'}
            </span>
          )}
          {destination.status_url && trailStatus && trailStatus.source_url && (
            <a href={trailStatus.source_url} target="_blank" rel="noopener noreferrer" className="trail-status-badge source">
              Source
            </a>
          )}
          {onShare && (
            <button className="share-badge-btn" onClick={onShare} title="Share this location">
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
              </svg>
              Share
            </button>
          )}
          <NavigateButton stops={getNavigationStops(destination, isLinearFeature)} />
          <AddToTripButton poi={destination} stops={getNavigationStops(destination, isLinearFeature)} />
          <FavoriteToggle poi={destination} />
        </div>

        {destination.status_url && trailStatus && trailStatus.status !== 'unknown' && (trailStatus.conditions || trailStatus.weather_impact || trailStatus.seasonal_closure || trailStatus.last_updated) && (
          <div className="section">
            <h3>Trail Status {isAdmin && editMode && onCollectStatus && (
              <button className="collect-status-inline-btn" onClick={onCollectStatus} title="Refresh trail status">
                Refresh
              </button>
            )}</h3>
            {trailStatus.conditions && (
              <p className="trail-status-detail">{trailStatus.conditions}</p>
            )}
            {trailStatus.weather_impact && (
              <p className="trail-status-detail">{trailStatus.weather_impact}</p>
            )}
            {trailStatus.seasonal_closure && (
              <p className="trail-status-detail trail-status-seasonal">Seasonal Closure in Effect</p>
            )}
            {trailStatus.last_updated && (
              <p className="trail-status-updated">Updated: {formatDateTime(trailStatus.last_updated)}</p>
            )}
          </div>
        )}

        {destination.brief_description && (
          <div className="section">
            <h3>Overview</h3>
            <p>{destination.brief_description}</p>
          </div>
        )}

        <div className="section">
          <h3>Visitor Information</h3>
          <div className="details-grid">
            {isLinearFeature && destination.length_miles && (
              <div className="detail-item">
                <label>Length</label>
                <span>{destination.length_miles} miles</span>
              </div>
            )}
            {destination.primary_activities && (
              <div className="detail-item">
                <label>Activities</label>
                <span>{destination.primary_activities}</span>
              </div>
            )}
            {destination.surface && (
              <div className="detail-item">
                <label>Surface</label>
                <span>{destination.surface}</span>
              </div>
            )}
            {destination.pets && (
              <div className="detail-item">
                <label>Pets Allowed</label>
                <span>{destination.pets}</span>
              </div>
            )}
            {destination.cell_signal !== null && destination.cell_signal !== undefined && (
              <div className="detail-item">
                <label>Cell Signal</label>
                <CellSignal level={destination.cell_signal} />
              </div>
            )}
          </div>
        </div>

        {!isLinearFeature && destination.latitude && destination.longitude && (
          <div className="section">
            <h3>Location</h3>
            <p>{formatCoordinate(destination.latitude, 'lat')}, {formatCoordinate(destination.longitude, 'lng')}</p>
          </div>
        )}
        </div>

        {liveTrackerUrl && (
          <div className="more-info-section">
            <a
              href={liveTrackerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="more-info-link live-tracker-link"
            >
              Live Tracker
              <svg viewBox="0 0 24 24" width="16" height="16" style={{ marginLeft: '8px' }}>
                <path fill="currentColor" d="M12,8A4,4 0 0,0 8,12A4,4 0 0,0 12,16A4,4 0 0,0 16,12A4,4 0 0,0 12,8M12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z" />
              </svg>
            </a>
            <span className={`boat-status-badge ${boatPosition?.status === 'active' ? 'live' : boatPosition?.status === 'docked' ? 'docked' : 'offline'}`}>
              {boatPosition?.status === 'active' ? 'Live' : boatPosition?.status === 'docked' ? 'Docked' : 'Offline'}
            </span>
          </div>
        )}

        {moreInfoLink && (
          <div className="more-info-section">
            <a
              href={moreInfoLink}
              target="_blank"
              rel="noopener noreferrer"
              className="more-info-link"
            >
              More Information
              <svg viewBox="0 0 24 24" width="16" height="16" style={{ marginLeft: '8px' }}>
                <path fill="currentColor" d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
              </svg>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default ReadOnlyView;
