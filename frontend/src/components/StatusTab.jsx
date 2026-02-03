import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import MapThumbnail from './MapThumbnail';

// StatusTab component showing all MTB trails with status badges
const StatusTab = memo(function StatusTab({
  mapState,
  onMapClick,
  onSelectLinearFeature,
  onSelectDestination,
  linearFeatures,
  destinations
}) {
  const [trails, setTrails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    fetchMtbTrails();
  }, []);

  const fetchMtbTrails = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/trails/mtb?includeStatus=true');
      if (response.ok) {
        const data = await response.json();
        setTrails(data);
      } else {
        setError('Failed to load MTB trails');
      }
    } catch (err) {
      setError('Failed to load MTB trails');
      console.error('Error fetching MTB trails:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filter trails by search text
  const filteredTrails = useMemo(() => {
    let filtered = trails;

    if (searchText.trim()) {
      const search = searchText.toLowerCase();
      filtered = filtered.filter(trail =>
        (trail.name || '').toLowerCase().includes(search) ||
        (trail.brief_description || '').toLowerCase().includes(search)
      );
    }

    return filtered;
  }, [trails, searchText]);

  // Group trails by status
  const trailsByStatus = useMemo(() => {
    const groups = {
      open: [],
      limited: [],
      maintenance: [],
      closed: [],
      unknown: []
    };

    filteredTrails.forEach(trail => {
      const status = trail.status?.status || 'unknown';
      if (groups[status]) {
        groups[status].push(trail);
      } else {
        groups.unknown.push(trail);
      }
    });

    return groups;
  }, [filteredTrails]);

  const handleTrailClick = useCallback((trail) => {
    // Handle both point POIs and linear features
    if (trail.poi_type === 'point') {
      // Find the full destination object
      const fullDestination = destinations?.find(d => d.id === trail.id);
      if (fullDestination) {
        onSelectDestination(fullDestination);
        onMapClick();
      }
    } else {
      // Find the full linear feature object (trail, river, boundary, etc.)
      const fullTrail = linearFeatures?.find(f => f.id === trail.id);
      if (fullTrail) {
        onSelectLinearFeature(fullTrail);
        onMapClick();
      }
    }
  }, [linearFeatures, destinations, onSelectLinearFeature, onSelectDestination, onMapClick]);

  const getStatusBadge = (status) => {
    const statusMap = {
      open: { label: 'OPEN', className: 'status-open' },
      closed: { label: 'CLOSED', className: 'status-closed' },
      limited: { label: 'LIMITED', className: 'status-limited' },
      maintenance: { label: 'MAINTENANCE', className: 'status-maintenance' },
      unknown: { label: 'UNKNOWN', className: 'status-unknown' }
    };

    const statusInfo = statusMap[status] || statusMap.unknown;
    return (
      <span className={`status-badge ${statusInfo.className}`}>
        {statusInfo.label}
      </span>
    );
  };

  const renderTrailTile = (trail) => {
    const status = trail.status?.status || 'unknown';
    const lastUpdated = trail.status?.last_updated
      ? new Date(trail.status.last_updated).toLocaleDateString()
      : null;

    return (
      <div
        key={trail.id}
        className="results-tile trail-status-tile"
        onClick={() => handleTrailClick(trail)}
        style={{ cursor: 'pointer' }}
      >
        <div className="results-tile-header">
          <h3 className="results-tile-title">{trail.name}</h3>
          {getStatusBadge(status)}
        </div>

        {trail.brief_description && (
          <p className="results-tile-description">{trail.brief_description}</p>
        )}

        {trail.status?.conditions && (
          <div className="trail-conditions">
            <strong>Conditions:</strong> {trail.status.conditions}
          </div>
        )}

        {trail.status?.weather_impact && (
          <div className="trail-weather">
            <strong>Weather:</strong> {trail.status.weather_impact}
          </div>
        )}

        <div className="trail-status-meta">
          {trail.length_miles && (
            <span className="trail-meta-item">
              📏 {trail.length_miles} miles
            </span>
          )}
          {trail.difficulty && (
            <span className="trail-meta-item">
              ⚡ {trail.difficulty}
            </span>
          )}
          {lastUpdated && (
            <span className="trail-meta-item trail-updated">
              Updated: {lastUpdated}
            </span>
          )}
        </div>

        {trail.status?.seasonal_closure && (
          <div className="trail-seasonal-notice">
            ⚠️ Seasonal Closure in Effect
          </div>
        )}
      </div>
    );
  };

  const renderStatusGroup = (status, label) => {
    const groupTrails = trailsByStatus[status];
    if (groupTrails.length === 0) return null;

    return (
      <div key={status} className="status-group">
        <h3 className="status-group-header">
          {getStatusBadge(status)} {label} ({groupTrails.length})
        </h3>
        <div className="results-list">
          {groupTrails.map(trail => renderTrailTile(trail))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="results-tab-wrapper">
        <div className="news-events-header">
          <h2>Trail Status</h2>
          <p className="tab-subtitle">Mountain bike trail conditions and status</p>
        </div>
        <div className="news-events-layout">
          <div className="news-events-content">
            <div className="results-tab-loading">Loading trail status...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="results-tab-wrapper">
        <div className="news-events-header">
          <h2>Trail Status</h2>
          <p className="tab-subtitle">Mountain bike trail conditions and status</p>
        </div>
        <div className="news-events-layout">
          <div className="news-events-content">
            <div className="results-tab-error">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (trails.length === 0) {
    return (
      <div className="results-tab-wrapper">
        <div className="news-events-header">
          <h2>Trail Status</h2>
          <p className="tab-subtitle">Mountain bike trail conditions and status</p>
        </div>
        <div className="news-events-layout">
          <div className="news-events-content">
            <div className="results-tab-empty">
              <div className="results-tab-empty-icon">🚵</div>
              <div className="results-tab-empty-text">
                No MTB trails found.
              </div>
              <div className="results-tab-empty-hint">
                Check back later or contact an administrator.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="results-tab-wrapper">
      <div className="news-events-header">
        <h2>Trail Status</h2>
        <p className="tab-subtitle">Mountain bike trail conditions and status</p>
      </div>

      <div className="results-filters">
        <input
          type="text"
          className="results-search-input"
          placeholder="Search trails by name or description..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>

      <div className="news-events-layout">
        <div className="news-events-content">
          <div className="status-tab-content">
            <div className="status-section">
              <h2 className="status-section-title">MTB Trails</h2>

              {filteredTrails.length === 0 ? (
                <div className="results-tab-empty-inline">
                  No trails match your search.
                </div>
              ) : (
                <>
                  {renderStatusGroup('open', 'Open')}
                  {renderStatusGroup('limited', 'Limited')}
                  {renderStatusGroup('maintenance', 'Maintenance')}
                  {renderStatusGroup('closed', 'Closed')}
                  {renderStatusGroup('unknown', 'Status Unknown')}
                </>
              )}
            </div>
          </div>
        </div>

        {mapState && (
          <div className="map-thumbnail-sidebar">
            <MapThumbnail
              bounds={mapState.bounds}
              aspectRatio={mapState.aspectRatio || 1.5}
              visibleDestinations={[]}
              onClick={onMapClick}
              poiCount={trails.length}
            />
          </div>
        )}
      </div>
    </div>
  );
});

export default StatusTab;
