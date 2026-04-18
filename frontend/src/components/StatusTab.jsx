import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import MapThumbnail from './MapThumbnail';
import { StatusBadge } from './StatusBadge';
import { formatRelativeTime } from '../utils/dateUtils';

// StatusTab component showing all MTB trails with status badges
const StatusTab = memo(function StatusTab({
  mapState,
  onMapClick,
  onSelectLinearFeature,
  onSelectDestination,
  linearFeatures,
  destinations,
  onMTBTrailsBoundsChange
}) {
  const [trails, setTrails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    fetchMtbTrails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // fetchMtbTrails intentionally excluded to only run on mount

  const fetchMtbTrails = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/trail-status/mtb-trails');
      if (response.ok) {
        const data = await response.json();
        setTrails(data);

        // Calculate bounds for all MTB trails
        if (data.length > 0 && onMTBTrailsBoundsChange) {
          const bounds = calculateTrailsBounds(data);
          if (bounds) {
            onMTBTrailsBoundsChange(bounds);
          }
        }
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

  // Calculate bounds that encompass all MTB trails
  const calculateTrailsBounds = (trails) => {
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    trails.forEach(trail => {
      if (trail.latitude && trail.longitude) {
        // Point POI
        minLat = Math.min(minLat, trail.latitude);
        maxLat = Math.max(maxLat, trail.latitude);
        minLng = Math.min(minLng, trail.longitude);
        maxLng = Math.max(maxLng, trail.longitude);
      } else if (trail.geometry) {
        // Linear feature - extract coordinates from geometry
        const coords = extractCoordinatesFromGeometry(trail.geometry);
        coords.forEach(([lng, lat]) => {
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        });
      }
    });

    if (minLat === Infinity) return null;

    return [[minLng, minLat], [maxLng, maxLat]];
  };

  // Extract coordinates from GeoJSON geometry
  const extractCoordinatesFromGeometry = (geometry) => {
    if (typeof geometry === 'string') {
      geometry = JSON.parse(geometry);
    }

    const coords = [];
    if (geometry.type === 'LineString') {
      coords.push(...geometry.coordinates);
    } else if (geometry.type === 'MultiLineString') {
      geometry.coordinates.forEach(lineString => {
        coords.push(...lineString);
      });
    } else if (geometry.type === 'Polygon') {
      geometry.coordinates[0].forEach(coord => {
        coords.push(coord);
      });
    } else if (geometry.type === 'MultiPolygon') {
      geometry.coordinates.forEach(polygon => {
        polygon[0].forEach(coord => {
          coords.push(coord);
        });
      });
    }

    return coords;
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
      const status = trail.status || 'unknown';
      if (groups[status]) {
        groups[status].push(trail);
      } else {
        groups.unknown.push(trail);
      }
    });

    return groups;
  }, [filteredTrails]);

  const handleTrailClick = useCallback((trail) => {
    // Find the index of this trail in the trails list for navigation
    const currentIndex = trails.findIndex(t => t.id === trail.id);
    const mtbContext = {
      trailsList: trails,
      currentIndex: currentIndex
    };

    // Handle both point POIs and linear features
    if (trail.poi_roles?.includes('point')) {
      // Find the full destination object
      const fullDestination = destinations?.find(d => d.id === trail.id);
      if (fullDestination) {
        onSelectDestination(fullDestination, mtbContext);
        onMapClick();
      }
    } else {
      // Find the full linear feature object (trail, river, boundary, etc.)
      const fullTrail = linearFeatures?.find(f => f.id === trail.id);
      if (fullTrail) {
        onSelectLinearFeature(fullTrail, mtbContext);
        onMapClick();
      }
    }
  }, [trails, linearFeatures, destinations, onSelectLinearFeature, onSelectDestination, onMapClick]);

  const renderTrailTile = (trail) => {
    const status = trail.status || 'unknown';
    const lastUpdated = trail.last_updated
      ? formatRelativeTime(trail.last_updated)
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
          <StatusBadge status={status} />
        </div>

        {trail.conditions && (
          <div className="trail-conditions">
            {trail.conditions}
          </div>
        )}

        <div className="trail-status-meta">
          {trail.source_name && (
            <span className="trail-meta-item">
              Source: {trail.source_name}
            </span>
          )}
          {lastUpdated && (
            <span className="trail-meta-item trail-updated">
              Updated: {lastUpdated}
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderStatusGroup = (status, label) => {
    const groupTrails = trailsByStatus[status];
    if (groupTrails.length === 0) return null;

    return (
      <div key={status} className="status-group">
        <h3 className="status-group-header">
          <StatusBadge status={status} /> {label} ({groupTrails.length})
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
