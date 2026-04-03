import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, useMap, ImageOverlay, GeoJSON, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import MapAdmin from './MapAdmin';
import VirtualPoiCreator from './VirtualPoiCreator';
import { getDestinationIconTypeFromConfig } from '../utils/iconUtils';

// Custom icon definitions
const createIcon = (iconUrl) => L.icon({
  iconUrl,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  tooltipAnchor: [0, -14]
});

// Default icon as fallback before database loads
const defaultIcon = createIcon('/icons/default.svg');

// Get icon URL - either static file or API for generated icons
function getIconUrl(icon) {
  if (icon.svg_content) {
    // AI-generated icon stored in database - serve from API
    return `/api/icons/${icon.name}.svg`;
  }
  // Static icon file
  return `/icons/${icon.svg_filename || `${icon.name}.svg`}`;
}

// Create Leaflet icons from database icon config
function createIconsFromConfig(iconConfig) {
  const icons = {};
  iconConfig.forEach(icon => {
    if (icon.enabled !== false) {
      icons[icon.name] = createIcon(getIconUrl(icon));
    }
  });
  // Always ensure default exists
  if (!icons['default']) {
    icons['default'] = createIcon('/icons/default.svg');
  }
  return icons;
}

// Cuyahoga Valley National Park center coordinates
const PARK_CENTER = [41.26, -81.55];
const DEFAULT_ZOOM = 11;

function Legend({
  // Layer toggles
  showNpsMap, onToggleNpsMap,
  showTrails, onToggleTrails,
  showRivers, onToggleRivers,
  // Boundary controls - individual toggles
  visibleBoundaries, onToggleBoundary, onShowAllBoundaries, onHideAllBoundaries,
  boundaries, // Array of boundary objects with id, name, boundary_color
  // POI type toggles
  visibleTypes, onToggleType, onShowAll, onHideAll,
  // Search
  searchQuery, onSearchChange,
  // Popup control
  isExpanded, _onClose,
  // Edit mode flag for mobile spacing
  editMode,
  // Admin/Edit features
  _activeTab, iconConfig, _onOpenAdmin,
  _onFileSelect, _selectedFileName, _importType, _onImportTypeChange,
  _onImportFile, _importingFile, _importMessage, _onDismissMessage
}) {
  // isEditTab removed - activeTab is already used directly in render

  // Convert iconConfig to the format needed for legend display, then merge with layer icons
  const iconTypes = useMemo(() => {
    let poiTypes;
    if (!iconConfig || iconConfig.length === 0) {
      // Fallback to default set if config not loaded yet
      poiTypes = [
        { id: 'visitor-center', label: 'Visitor Center', svg_filename: 'visitor-center.svg', type: 'poi' },
        { id: 'waterfall', label: 'Waterfall', svg_filename: 'waterfall.svg', type: 'poi' },
        { id: 'trail', label: 'Trailheads', svg_filename: 'trail.svg', type: 'poi' },
        { id: 'mtb-trailhead', label: 'MTB Trailheads', svg_filename: 'mtb-trailhead.svg', type: 'poi' },
        { id: 'historic', label: 'Historic Site', svg_filename: 'historic.svg', type: 'poi' },
        { id: 'bridge', label: 'Bridge', svg_filename: 'bridge.svg', type: 'poi' },
        { id: 'train', label: 'Train Station', svg_filename: 'train.svg', type: 'poi' },
        { id: 'nature', label: 'Nature Area', svg_filename: 'nature.svg', type: 'poi' },
        { id: 'skiing', label: 'Skiing', svg_filename: 'skiing.svg', type: 'poi' },
        { id: 'biking', label: 'Biking', svg_filename: 'biking.svg', type: 'poi' },
        { id: 'picnic', label: 'Picnic Area', svg_filename: 'picnic.svg', type: 'poi' },
        { id: 'camping', label: 'Camping', svg_filename: 'camping.svg', type: 'poi' },
        { id: 'music', label: 'Music Venue', svg_filename: 'music.svg', type: 'poi' },
        { id: 'default', label: 'Other', svg_filename: 'default.svg', type: 'poi' }
      ];
    } else {
      poiTypes = iconConfig
        .filter(icon => icon.enabled !== false)
        .map(icon => ({
          id: icon.name,
          label: icon.name === 'trail' ? 'Trailheads' : icon.label,
          svg_filename: icon.svg_filename || `${icon.name}.svg`,
          svg_content: icon.svg_content,
          iconUrl: getIconUrl(icon),
          type: 'poi'
        }));
    }

    // Add layer icons (Trails, Rivers)
    const layerIcons = [
      { id: 'trails', label: 'Trails', type: 'layer', isActive: showTrails, onToggle: () => onToggleTrails(!showTrails) },
      { id: 'rivers', label: 'Rivers', type: 'layer', isActive: showRivers, onToggle: () => onToggleRivers(!showRivers) }
    ];

    // Combine and sort all alphabetically
    return [...poiTypes, ...layerIcons].sort((a, b) => a.label.localeCompare(b.label));
  }, [iconConfig, showTrails, showRivers, onToggleTrails, onToggleRivers]);

  return (
    <div className={`legend ${isExpanded ? 'legend-expanded' : ''} ${editMode ? 'legend-edit-mode' : ''}`}>
      <div className="legend-content">
        {/* Search input */}
        <div className="legend-search">
          <input
            type="text"
            className="search-input"
            placeholder="Search destinations..."
            value={searchQuery || ''}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="legend-divider"></div>

        <div className="legend-header-row">
          <h4>Points of Interest</h4>
          <div className="legend-filter-btns">
            <button onClick={onShowAll} title="Show All POIs">All</button>
            <button onClick={onHideAll} title="Hide All POIs">None</button>
          </div>
        </div>

        {/* Unified icon grid - all POI types and layers sorted alphabetically */}
        <div className="legend-icons">
          {iconTypes.map(type => {
            if (type.type === 'layer') {
              // Layer icon (Trails, Rivers)
              return (
                <div
                  key={type.id}
                  className={`legend-icon-item ${type.isActive ? 'active' : 'inactive'}`}
                  onClick={type.onToggle}
                >
                  <img src={`/icons/layers/${type.id}.svg`} alt={type.label} />
                  <span>{type.label}</span>
                </div>
              );
            } else {
              // POI type icon
              return (
                <div
                  key={type.id}
                  className={`legend-icon-item ${visibleTypes.has(type.id) ? 'active' : 'inactive'}`}
                  onClick={() => onToggleType(type.id)}
                >
                  {type.svg_content ? (
                    <div className="legend-icon-svg" dangerouslySetInnerHTML={{ __html: type.svg_content }} />
                  ) : (
                    <img src={type.iconUrl || `/icons/${type.svg_filename}`} alt={type.label} />
                  )}
                  <span>{type.label}</span>
                </div>
              );
            }
          })}
        </div>

        {/* Boundaries & Overlays section */}
        <div className="legend-divider"></div>
        <div className="boundary-chips-header">
          <h4>Boundaries & Overlays</h4>
          {boundaries && boundaries.length > 0 && (
            <div className="boundary-chips-actions">
              <button onClick={onShowAllBoundaries} title="Show All">All</button>
              <button onClick={onHideAllBoundaries} title="Hide All">None</button>
            </div>
          )}
        </div>
        <div className="boundary-chips">
          {/* NPS Map overlay chip */}
          <button
            className={`boundary-chip nps-map-chip ${showNpsMap ? 'active' : 'inactive'}`}
            onClick={() => onToggleNpsMap(!showNpsMap)}
            title="NPS Park Map Overlay"
          >
            <span className="boundary-chip-icon">🗺️</span>
            <span className="boundary-chip-name">NPS Map</span>
          </button>
          {/* Individual boundary chips */}
          {boundaries && boundaries.map(boundary => (
            <button
              key={boundary.id}
              className={`boundary-chip ${visibleBoundaries.has(boundary.id) ? 'active' : 'inactive'}`}
              onClick={() => onToggleBoundary(boundary.id)}
              title={boundary.name}
            >
              <span
                className="boundary-chip-color"
                style={{ backgroundColor: boundary.boundary_color || '#228B22' }}
              />
              <span className="boundary-chip-name">{boundary.name}</span>
            </button>
          ))}
        </div>

        {/* Edit tab - admin tools moved to General Settings */}
      </div>
    </div>
  );
}

// Component to handle map clicks - right-click for POI creation, left-click to deselect
function MapClickHandler({ isAdmin, editMode, onRightClick, onMapClick }) {
  useMapEvents({
    click: () => {
      // Left click on map (not on a marker) deselects current selection
      if (onMapClick) {
        onMapClick();
      }
    },
    contextmenu: (e) => {
      if (isAdmin && editMode && onRightClick) {
        e.originalEvent.preventDefault();
        onRightClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    }
  });
  return null;
}

// Component to handle map view updates when selection changes
// Sets a flag on the map to indicate programmatic movement (vs user interaction)
function MapUpdater({ selectedDestination, selectedLinearFeature, skipFlyRef }) {
  const map = useMap();

  React.useEffect(() => {
    if (selectedDestination && selectedDestination.latitude && selectedDestination.longitude) {
      // Check if we should skip the fly animation (e.g., selection from Results tab)
      if (skipFlyRef && skipFlyRef.current) {
        skipFlyRef.current = false; // Reset the flag
        return; // Skip the fly animation
      }

      // Ensure map size is correct before flying (critical when switching from Results tab)
      map.invalidateSize();

      // Mark this as a programmatic move so MapBoundsTracker doesn't update News/Events filter
      map._isProgrammaticMove = true;

      // Track if this is the initial load (for forcing Results update)
      const isInitialLoad = !map._hasCompletedInitialLoad;

      // Fly to the selected destination with appropriate zoom
      const currentZoom = map.getZoom();
      // On initial load (when map is at default zoom), zoom in more to show detailed view
      // Otherwise, zoom to at least 15 but don't zoom out if already closer
      const targetZoom = isInitialLoad ? 16 : Math.max(currentZoom, 15);

      map.flyTo([selectedDestination.latitude, selectedDestination.longitude], targetZoom, {
        animate: true,
        duration: isInitialLoad ? 0.8 : 0.5 // Slightly longer animation on initial load
      });

      // Clear the flag after animation completes
      const animationDuration = isInitialLoad ? 800 : 500;
      setTimeout(() => {
        map._isProgrammaticMove = false;
        // On initial load only, force a Results update by firing moveend
        if (isInitialLoad) {
          map._hasCompletedInitialLoad = true;
          map._forceNextUpdate = true; // Signal to bypass threshold check
          map.fire('moveend');
        }
      }, animationDuration + 100); // Add 100ms buffer
    }
  }, [selectedDestination, map, skipFlyRef]);

  // Handle linear feature selection - no zoom change, just select
  React.useEffect(() => {
    if (selectedLinearFeature && selectedLinearFeature.geometry) {
      // Reset skip flag if set (from Results tab selection)
      if (skipFlyRef && skipFlyRef.current) {
        skipFlyRef.current = false;
      }
      // No zoom/pan - just let the selection happen without moving the map
    }
  }, [selectedLinearFeature, map, skipFlyRef]);

  return null;
}

// Component to handle map resize when container visibility changes
function MapVisibilityHandler({ activeTab }) {
  const map = useMap();
  const prevTab = useRef(activeTab);

  useEffect(() => {
    // When switching back to view/edit tab, invalidate size to fix rendering
    if ((activeTab === 'view' || activeTab === 'edit') &&
        prevTab.current !== 'view' && prevTab.current !== 'edit') {
      // Call invalidateSize immediately so MapUpdater can flyTo with correct dimensions
      // Use requestAnimationFrame to ensure DOM has painted
      requestAnimationFrame(() => {
        map.invalidateSize();
      });
    }
    prevTab.current = activeTab;
  }, [activeTab, map]);

  return null;
}

// Component to fit map to specific bounds when provided
function BoundsFitter({ boundsToFit }) {
  const map = useMap();
  const prevBounds = useRef(null);

  useEffect(() => {
    if (boundsToFit && JSON.stringify(boundsToFit) !== JSON.stringify(prevBounds.current)) {

      // Calculate geographic size to determine if we need extra zoom out
      const latRange = boundsToFit[1][0] - boundsToFit[0][0];
      const lngRange = boundsToFit[1][1] - boundsToFit[0][1];
      const geoSize = Math.max(latRange, lngRange);

      // If bounds cover a large area (all POIs), zoom out more to show more in viewport
      // Small bounds (< 0.3 degrees) = zooming to small set of POIs, use normal padding
      // Large bounds (>= 0.3 degrees) = zooming to all POIs, use extra zoom out
      const padding = geoSize >= 0.3 ? [20, 20] : [50, 50];
      const maxZoom = geoSize >= 0.3 ? 12 : undefined; // Limit zoom for large areas


      // boundsToFit is already in Leaflet format: [[lat, lng], [lat, lng]]
      map.fitBounds(boundsToFit, { padding, maxZoom });
      prevBounds.current = boundsToFit;
    }
  }, [boundsToFit, map]);

  return null;
}

// Helper to get bounding box from GeoJSON geometry
function getGeometryBounds(geometry) {
  if (!geometry) return null;

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  // Recursively extract all coordinates from the geometry
  const processCoords = (coords) => {
    if (!Array.isArray(coords)) return;

    // If this is a coordinate pair [lng, lat]
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lng = coords[0];
      const lat = coords[1];
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    } else {
      // Nested array - recurse
      coords.forEach(c => processCoords(c));
    }
  };

  if (geometry.coordinates) {
    processCoords(geometry.coordinates);
  }

  if (minLat === Infinity) return null;

  return {
    south: minLat,
    north: maxLat,
    west: minLng,
    east: maxLng
  };
}

// Check if two bounding boxes intersect
function boundsIntersect(mapBounds, geoBounds) {
  if (!geoBounds) return false;

  const mapSouth = mapBounds.getSouth();
  const mapNorth = mapBounds.getNorth();
  const mapWest = mapBounds.getWest();
  const mapEast = mapBounds.getEast();

  // Check for no overlap
  if (geoBounds.north < mapSouth || geoBounds.south > mapNorth) return false;
  if (geoBounds.east < mapWest || geoBounds.west > mapEast) return false;

  return true;
}

// Component to track map moves for tooltip repositioning
function MapMoveTracker({ onMapMove }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const handleMove = () => {
      onMapMove();
    };

    map.on('moveend', handleMove);
    map.on('zoomend', handleMove);

    return () => {
      map.off('moveend', handleMove);
      map.off('zoomend', handleMove);
    };
  }, [map, onMapMove]);

  return null;
}

// Component to track which POIs are visible in the current map viewport
function MapBoundsTracker({ destinations, visibleTypes, getDestinationIconType, onVisiblePoisChange, onMapStateChange, linearFeatures, showTrails, showRivers, visibleBoundaries }) {
  const map = useMap();

  // Calculate which POIs are visible in current bounds and emit map state
  const updateVisiblePois = useCallback(() => {
    // Check if map has valid bounds (may not be ready yet)
    try {
      const bounds = map.getBounds();
      if (!bounds || !bounds.isValid()) return;

      const visibleIds = [];

      // Add visible point destinations
      if (destinations && destinations.length > 0) {
        destinations.forEach(dest => {
          if (!dest.latitude || !dest.longitude) return;

          // Check if POI type is visible in legend
          const iconType = getDestinationIconType(dest);
          if (!visibleTypes.has(iconType)) {
            return;
          }

          // Check if POI is within map bounds
          const lat = parseFloat(dest.latitude);
          const lng = parseFloat(dest.longitude);
          if (bounds.contains([lat, lng])) {
            visibleIds.push(dest.id);
          }
        });
      }

      // Add linear features in viewport to Results
      // When filtering by specific POI types (e.g., mtb-trailheads), skip linear features
      // Linear features are only included when showing all types or no filter is active
      const isFilteredMode = visibleTypes.size < 10; // Small specific set means filtered mode
      const includeLinearFeatures = !isFilteredMode ||
                                    visibleTypes.has('trail') ||
                                    visibleTypes.has('river') ||
                                    visibleTypes.has('boundary');

      if (includeLinearFeatures && linearFeatures && linearFeatures.length > 0) {
        linearFeatures.forEach(feature => {
          // Check if the feature's layer is visible
          let isLayerVisible = false;
          if (feature.feature_type === 'trail') {
            isLayerVisible = showTrails;
          } else if (feature.feature_type === 'river') {
            isLayerVisible = showRivers;
          } else if (feature.feature_type === 'boundary') {
            isLayerVisible = visibleBoundaries.has(feature.id);
          }

          if (!isLayerVisible) return;

          // Check if any part of the feature intersects with map bounds
          // Use bounding box intersection which works for all geometry types
          if (feature.geometry) {
            const geoBounds = getGeometryBounds(feature.geometry);
            if (boundsIntersect(bounds, geoBounds)) {
              visibleIds.push(feature.id);
            }
          }
        });
      }

      // Emit visible IDs (destinations + linear features)
      // Skip if this is a programmatic move (e.g., selection zoom) to preserve current selection
      if (onVisiblePoisChange && !map._isProgrammaticMove) {
        onVisiblePoisChange(visibleIds);
      }

      // Emit map state for thumbnail
      if (onMapStateChange) {
        const center = map.getCenter();
        const zoom = map.getZoom();
        const container = map.getContainer();
        const width = container.clientWidth;
        const height = container.clientHeight;
        onMapStateChange({
          center: [center.lat, center.lng],
          zoom: zoom,
          bounds: [[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]],
          aspectRatio: width / height
        });
      }
    } catch {
      // Map not ready yet, will try again on next event
    }
  }, [map, destinations, visibleTypes, getDestinationIconType, onVisiblePoisChange, onMapStateChange, linearFeatures, showTrails, showRivers, visibleBoundaries]);

  // Track map movements and load
  useMapEvents({
    moveend: updateVisiblePois,
    zoomend: updateVisiblePois,
    load: updateVisiblePois
  });

  // Initial calculation with a small delay to ensure map is ready
  useEffect(() => {
    // Immediate attempt
    updateVisiblePois();

    // Also try after a short delay in case map wasn't ready
    const timer = setTimeout(updateVisiblePois, 100);
    return () => clearTimeout(timer);
  }, [updateVisiblePois]);

  // Re-calculate when destinations or linear features change
  useEffect(() => {
    updateVisiblePois();
  }, [destinations, linearFeatures, showTrails, showRivers, visibleBoundaries, updateVisiblePois]);

  return null;
}

// Combined Zoom and GPS Locate Control
function ZoomLocateControl({ onLocationFound, onLocationError, useSatellite, onSatelliteToggle }) {
  const map = useMap();
  const [locating, setLocating] = useState(false);
  const userMarkerRef = useRef(null);
  const userCircleRef = useRef(null);

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) {
      if (onLocationError) {
        onLocationError('Geolocation is not supported by your browser');
      }
      return;
    }

    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const latlng = [latitude, longitude];

        setLocating(false);

        // Zoom to user location - zoom 16 shows a few blocks
        map.flyTo(latlng, 16, { duration: 1 });

        // Remove old markers if they exist
        if (userMarkerRef.current) {
          userMarkerRef.current.remove();
        }
        if (userCircleRef.current) {
          userCircleRef.current.remove();
        }

        // Add accuracy circle
        userCircleRef.current = L.circle(latlng, {
          radius: accuracy,
          color: '#4285f4',
          fillColor: '#4285f4',
          fillOpacity: 0.15,
          weight: 2
        }).addTo(map);

        // Add user location marker (blue dot)
        userMarkerRef.current = L.circleMarker(latlng, {
          radius: 8,
          color: '#ffffff',
          fillColor: '#4285f4',
          fillOpacity: 1,
          weight: 3
        }).addTo(map);

        if (onLocationFound) {
          onLocationFound({ latlng, accuracy });
        }
      },
      (error) => {
        setLocating(false);
        let message = 'Unable to get your location';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = 'Location permission denied';
            break;
          case error.POSITION_UNAVAILABLE:
            message = 'Location information unavailable';
            break;
          case error.TIMEOUT:
            message = 'Location request timed out';
            break;
        }
        if (onLocationError) {
          onLocationError(message);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  }, [map, onLocationFound, onLocationError]);

  // Add the combined control to the map
  useEffect(() => {
    const ZoomLocateControlClass = L.Control.extend({
      onAdd: function(map) {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control zoom-locate-control');

        // Zoom In button
        const zoomIn = L.DomUtil.create('a', 'zoom-locate-btn zoom-in-btn', container);
        zoomIn.href = '#';
        zoomIn.title = 'Zoom in';
        zoomIn.setAttribute('role', 'button');
        zoomIn.setAttribute('aria-label', 'Zoom in');
        zoomIn.innerHTML = '<span aria-hidden="true">+</span>';

        // Zoom Out button
        const zoomOut = L.DomUtil.create('a', 'zoom-locate-btn zoom-out-btn', container);
        zoomOut.href = '#';
        zoomOut.title = 'Zoom out';
        zoomOut.setAttribute('role', 'button');
        zoomOut.setAttribute('aria-label', 'Zoom out');
        zoomOut.innerHTML = '<span aria-hidden="true">−</span>';

        // GPS Locate button
        const locate = L.DomUtil.create('a', 'zoom-locate-btn locate-button', container);
        locate.href = '#';
        locate.title = 'Find my location';
        locate.setAttribute('role', 'button');
        locate.setAttribute('aria-label', 'Find my location');
        locate.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
          </svg>
        `;

        // Satellite Toggle button
        const satelliteToggle = L.DomUtil.create('a', 'zoom-locate-btn satellite-toggle-button', container);
        satelliteToggle.href = '#';
        satelliteToggle.title = useSatellite ? 'Switch to map view' : 'Switch to satellite view';
        satelliteToggle.setAttribute('role', 'button');
        satelliteToggle.setAttribute('aria-label', useSatellite ? 'Switch to map view' : 'Switch to satellite view');
        satelliteToggle.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
        `;
        if (useSatellite) {
          satelliteToggle.classList.add('active');
        }

        L.DomEvent.disableClickPropagation(container);

        L.DomEvent.on(zoomIn, 'click', function(e) {
          L.DomEvent.preventDefault(e);
          map.zoomIn();
        });

        L.DomEvent.on(zoomOut, 'click', function(e) {
          L.DomEvent.preventDefault(e);
          map.zoomOut();
        });

        L.DomEvent.on(locate, 'click', function(e) {
          L.DomEvent.preventDefault(e);
          handleLocate();
        });

        L.DomEvent.on(satelliteToggle, 'click', function(e) {
          L.DomEvent.preventDefault(e);
          if (onSatelliteToggle) {
            onSatelliteToggle();
          }
        });

        return container;
      }
    });

    const control = new ZoomLocateControlClass({ position: 'topleft' });
    map.addControl(control);

    return () => {
      map.removeControl(control);
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
      }
      if (userCircleRef.current) {
        userCircleRef.current.remove();
      }
    };
  }, [map, handleLocate, useSatellite, onSatelliteToggle]);

  // Update button state when locating
  useEffect(() => {
    const button = document.querySelector('.locate-button');
    if (button) {
      if (locating) {
        button.classList.add('locating');
      } else {
        button.classList.remove('locating');
      }
    }
  }, [locating]);

  // Update satellite button state when satellite mode changes
  useEffect(() => {
    const button = document.querySelector('.satellite-toggle-button');
    if (button) {
      if (useSatellite) {
        button.classList.add('active');
        button.title = 'Switch to map view';
        button.setAttribute('aria-label', 'Switch to map view');
      } else {
        button.classList.remove('active');
        button.title = 'Switch to satellite view';
        button.setAttribute('aria-label', 'Switch to satellite view');
      }
    }
  }, [useSatellite]);

  return null;
}

// Create a highlighted version of an icon for Edit mode (green highlight)
function createEditSelectedIcon(iconUrl) {
  return L.divIcon({
    className: 'selected-marker-icon edit-mode',
    html: `<div class="marker-highlight edit-highlight"><img src="${iconUrl}" alt="" /></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    tooltipAnchor: [0, -18]
  });
}

// Create a highlighted version of an icon for View mode (blue highlight)
function createViewSelectedIcon(iconUrl) {
  return L.divIcon({
    className: 'selected-marker-icon view-mode',
    html: `<div class="marker-highlight view-highlight"><img src="${iconUrl}" alt="" /></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    tooltipAnchor: [0, -18]
  });
}

// Simple marker component - draggable state controlled by key prop
// hasSelection indicates if ANY marker is currently selected (used to suppress hover tooltips)
function DestinationMarker({ dest, icon, isSelected, isEditMode, onSelect, onDragEnd, _mapMoveCount, hasSelection }) {
  const markerRef = useRef(null);
  const map = useMap();

  // Calculate best tooltip direction based on marker position relative to map bounds
  // For selected markers, use a stable direction to prevent flickering
  const getTooltipDirection = () => {
    if (!map) return 'top';

    const point = map.latLngToContainerPoint([dest.latitude, dest.longitude]);
    const mapSize = map.getSize();

    // Tooltip dimensions - with image it's taller
    const tooltipWidth = 220;
    const tooltipHeight = 220; // Account for image thumbnail (~120px) + text
    const margin = 20;

    // Check which edges the marker is near
    const nearTop = point.y < tooltipHeight + margin;
    const nearBottom = (mapSize.y - point.y) < tooltipHeight + margin;
    const nearRight = (mapSize.x - point.x) < tooltipWidth + margin;
    const nearLeft = point.x < tooltipWidth + margin;

    // If near top edge, prefer bottom
    if (nearTop && !nearBottom) {
      return 'bottom';
    }
    // If near right edge (and not near top), show on left
    if (nearRight && !nearLeft && !nearTop) {
      return 'left';
    }
    // If near left edge (and not near top), show on right
    if (nearLeft && !nearRight && !nearTop) {
      return 'right';
    }
    // Default to top
    return 'top';
  };

  // For selected markers, don't recalculate direction on every render to prevent flickering
  // Only recalculate for non-selected markers (hover tooltips)
  const tooltipDirection = isSelected ? 'top' : getTooltipDirection();

  const eventHandlers = {
    click: () => onSelect(dest),
    dragend: () => {
      const marker = markerRef.current;
      if (marker) {
        const { lat, lng } = marker.getLatLng();
        onDragEnd(dest, lat, lng);
      }
    }
  };

  // Highlight selected marker - different colors for Edit vs View mode
  const getDisplayIcon = () => {
    if (!isSelected) return icon;
    if (isEditMode) return createEditSelectedIcon(icon.options.iconUrl);
    return createViewSelectedIcon(icon.options.iconUrl);
  };
  const displayIcon = getDisplayIcon();

  // Use stable key to prevent marker recreation on selection change
  // Only change key when edit mode changes (which requires different draggable behavior)
  const markerKey = `${dest.id}-${isEditMode ? 'edit' : 'view'}`;

  // Calculate offset based on direction
  // Note: Icon already has tooltipAnchor: [0, -14] which positions for "top"
  const getOffset = () => {
    switch (tooltipDirection) {
      case 'bottom': return [0, 28]; // Move below the icon (icon is 28px tall)
      case 'left': return [-14, 14]; // Move left and adjust vertical
      case 'right': return [14, 14]; // Move right and adjust vertical
      default: return [0, 0]; // Icon's tooltipAnchor handles "top"
    }
  };

  // Only show tooltip if: this marker is selected, OR nothing is selected (allow hover)
  const showTooltip = isSelected || !hasSelection;

  // Update marker icon when selection changes (Leaflet doesn't always pick up icon prop changes)
  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.setIcon(displayIcon);
    }
  }, [displayIcon, isSelected]);

  return (
    <Marker
      key={markerKey}
      ref={markerRef}
      position={[dest.latitude, dest.longitude]}
      icon={displayIcon}
      opacity={isSelected ? 1 : 0.85}
      draggable={isEditMode}
      eventHandlers={eventHandlers}
    >
      {showTooltip && (
        <Tooltip
          direction={tooltipDirection}
          offset={getOffset()}
          opacity={0.95}
          className={`destination-tooltip ${isSelected ? 'selected-tooltip' : ''}`}
          permanent={isSelected}
        >
          <div className="tooltip-content">
            {dest.has_primary_image && (
              <div className="tooltip-thumbnail">
                <img src={`/api/pois/${dest.id}/thumbnail?size=medium`} alt="" />
              </div>
            )}
            <strong>{dest.name}</strong>
            {dest.brief_description && (
              <p>{dest.brief_description}</p>
            )}
          </div>
        </Tooltip>
      )}
    </Marker>
  );
}

// Coordinate confirmation dialog
function CoordinateConfirmDialog({ destination, newLat, newLng, onConfirm, onCancel, saving }) {
  const oldLat = destination.latitude;
  const oldLng = destination.longitude;

  return (
    <div className="coord-confirm-overlay">
      <div className="coord-confirm-dialog">
        <h3>Update Coordinates</h3>
        <p className="dest-name">{destination.name}</p>
        <div className="coord-comparison">
          <div className="coord-old">
            <span className="coord-label">Current:</span>
            <span className="coord-value">{oldLat.toFixed(6)}, {oldLng.toFixed(6)}</span>
          </div>
          <div className="coord-arrow">→</div>
          <div className="coord-new">
            <span className="coord-label">New:</span>
            <span className="coord-value">{newLat.toFixed(6)}, {newLng.toFixed(6)}</span>
          </div>
        </div>
        <div className="coord-diff">
          <span>Change: {((newLat - oldLat) * 111320).toFixed(1)}m N/S, {((newLng - oldLng) * 111320 * Math.cos(oldLat * Math.PI / 180)).toFixed(1)}m E/W</span>
        </div>
        <div className="coord-confirm-buttons">
          <button className="cancel-btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="confirm-btn" onClick={onConfirm} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// NPS Park Map overlay default bounds for cropped image (legend removed)
// Manually calibrated to align Boston Mill Visitor Center and Route 8
// These coordinates define the corners of the map image: [[south, west], [north, east]]
const DEFAULT_NPS_MAP_BOUNDS = [
  [41.1390, -81.6654],  // Southwest corner
  [41.4226, -81.4706]   // Northeast corner
];

// Default icon type IDs for initializing the filter (before config loads)
const DEFAULT_ICON_TYPES = new Set(['visitor-center', 'waterfall', 'trail', 'historic', 'bridge', 'train', 'nature', 'skiing', 'biking', 'picnic', 'camping', 'music', 'default']);

function Map({ destinations, selectedDestination, onSelectDestination, isAdmin, onDestinationUpdate, editMode, activeTab, _onDestinationCreate, previewCoords, onPreviewCoordsChange, newPOI, onStartNewPOI, linearFeatures, selectedLinearFeature, onSelectLinearFeature, visibleTypes, onVisibleTypesChange, onVisiblePoisChange, onMapStateChange, showNpsMap, onToggleNpsMap, showTrails, onToggleTrails, showRivers, onToggleRivers, visibleBoundaries, onToggleBoundary, onShowAllBoundaries, onHideAllBoundaries, searchQuery, onSearchChange, _onNewsRefresh, skipFlyRef, newOrganization, onStartNewOrganization, isDrawingAssociations, addingAssociationsToOrgId, onAddAssociationsFromDrawing, onCancelDrawingAssociations, boundsToFit, visiblePoiCount, iconConfig }) {
  const [showAdmin, setShowAdmin] = useState(false);
  const [isLegendExpanded, setIsLegendExpanded] = useState(false);
  const [mapBounds, setMapBounds] = useState(DEFAULT_NPS_MAP_BOUNDS);
  const [overlayOpacity, setOverlayOpacity] = useState(1.0);
  const [useSatellite, setUseSatellite] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState(null); // Just for UI display
  const [importType, setImportType] = useState('trail');
  const [importingFile, setImportingFile] = useState(false);
  const [importMessage, setImportMessage] = useState(null);
  const [isCreatingVirtualPoi, setIsCreatingVirtualPoi] = useState(false);
  const [visiblePoiIds, setVisiblePoiIds] = useState([]);
  const [refreshResult, setRefreshResult] = useState(null);
  const fileRef = useRef(null); // Store File object in ref to avoid React re-renders

  // Track map moves to trigger tooltip direction recalculation
  const [mapMoveCount, setMapMoveCount] = useState(0);

  // Icon configuration is passed as prop from App.jsx (fetched on mount)

  // Store visible IDs locally for admin news refresh
  const handleVisiblePoisChange = useCallback((visibleIds) => {
    setVisiblePoiIds(visibleIds);
    if (onVisiblePoisChange) {
      onVisiblePoisChange(visibleIds);
    }
  }, [onVisiblePoisChange]);

  // Icon config is fetched in App.jsx on mount and passed as prop
  // We receive iconConfig but don't fetch or modify visibleTypes here

  // Memoize Leaflet icons created from config
  const icons = useMemo(() => createIconsFromConfig(iconConfig), [iconConfig]);

  // Memoize the set of all icon type IDs for filter reset
  const allIconTypes = useMemo(() => {
    if (iconConfig.length === 0) return DEFAULT_ICON_TYPES;
    const types = new Set(iconConfig.filter(i => i.enabled !== false).map(i => i.name));
    if (!types.has('default')) types.add('default');
    return types;
  }, [iconConfig]);

  // Helper to get icon type for a destination
  const getDestinationIconType = useCallback((dest) => {
    if (iconConfig.length === 0) return 'default';
    return getDestinationIconTypeFromConfig(dest, iconConfig);
  }, [iconConfig]);

  // Helper to get Leaflet icon for a destination
  const getDestinationIcon = useCallback((dest) => {
    const iconType = getDestinationIconType(dest);
    return icons[iconType] || icons['default'] || defaultIcon;
  }, [icons, getDestinationIconType]);

  // Admin edit mode state - editMode is passed from parent
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [saving, setSaving] = useState(false);

  // Note: Boundaries now come from linearFeatures prop along with trails/rivers

  // Filter handlers
  const handleToggleType = (typeId) => {
    if (onVisibleTypesChange) {
      onVisibleTypesChange(prev => {
        const newSet = new Set(prev);
        if (newSet.has(typeId)) {
          newSet.delete(typeId);
        } else {
          newSet.add(typeId);
        }
        return newSet;
      });
    }
  };

  const handleShowAll = () => {
    // Show all POI types
    if (onVisibleTypesChange) onVisibleTypesChange(new Set(allIconTypes));
    // Show all layers (Trails and Rivers only - boundaries are controlled separately)
    onToggleTrails(true);
    onToggleRivers(true);
  };

  const handleHideAll = () => {
    // Hide all POI types
    if (onVisibleTypesChange) onVisibleTypesChange(new Set());
    // Hide all layers (Trails and Rivers only - boundaries are controlled separately)
    onToggleTrails(false);
    onToggleRivers(false);
  };

  // Handle file selection - store in ref (no re-render), update name for UI
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileRef.current = file; // Store in ref - no re-render
    setSelectedFileName(file.name); // Update UI
  };

  // Handle file import - read File from ref and send as JSON
  const handleImportFile = async () => {
    const file = fileRef.current;
    if (!file) return;

    setImportingFile(true);
    setImportMessage(null);

    try {
      // Read file content
      const content = await file.text();

      // Parse to validate it's valid JSON
      let geojson;
      try {
        geojson = JSON.parse(content);
      } catch {
        setImportMessage({ type: 'error', text: 'Invalid JSON file' });
        setImportingFile(false);
        return;
      }

      // Send as JSON
      const response = await fetch('/api/admin/spatial/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_type: importType,
          geojson: geojson,
          filename: file.name
        })
      });

      const result = await response.json();
      if (response.ok) {
        setImportMessage({
          type: 'success',
          text: `Imported ${result.imported} ${importType}${result.imported !== 1 ? 's' : ''}. Refreshing...`
        });
        fileRef.current = null;
        setSelectedFileName(null);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setImportMessage({ type: 'error', text: result.error || 'Import failed' });
      }
    } catch (err) {
      setImportMessage({ type: 'error', text: err.message || 'Import failed' });
    } finally {
      setImportingFile(false);
    }
  };

  // Clear import message
  const handleDismissMessage = () => {
    setImportMessage(null);
  };

  // Handle marker drag end
  const handleMarkerDragEnd = (dest, newLat, newLng) => {
    setPendingUpdate({
      destination: dest,
      newLat,
      newLng
    });
  };

  // Confirm coordinate update
  const handleConfirmUpdate = async () => {
    if (!pendingUpdate) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/destinations/${pendingUpdate.destination.id}/coordinates`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          latitude: pendingUpdate.newLat,
          longitude: pendingUpdate.newLng
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update coordinates');
      }

      const updatedDest = await response.json();
      if (onDestinationUpdate) {
        onDestinationUpdate(updatedDest);
      }
      setPendingUpdate(null);
    } catch (error) {
      console.error('Error updating coordinates:', error);
      alert(`Failed to update coordinates: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Cancel coordinate update
  const handleCancelUpdate = () => {
    setPendingUpdate(null);
  };

  // Note: All linear features (trails, rivers, boundaries) now come from database via linearFeatures prop

  // Handle linear feature click (trail or river)
  const handleLinearFeatureClick = (feature) => {
    if (onSelectLinearFeature) {
      onSelectLinearFeature(feature);
    }
  };

  // Style functions for linear features (trails and rivers)
  // Uses editMode from closure to differentiate Edit (orange) vs View (blue) selected colors
  const getLinearFeatureStyle = useCallback((feature, isSelected) => {
    // Selected colors: Edit mode = orange (#FF8C00), View mode = blue (#0066CC)
    const editSelectedColor = '#FF8C00';
    const viewSelectedColor = '#0066CC';

    if (feature.feature_type === 'river') {
      // river - thinner solid line for less obtrusive appearance
      return {
        weight: isSelected ? 3 : 2,  // Thinner than base: 2 normal, 3 selected
        opacity: isSelected ? 1 : 0.8,
        color: isSelected ? (editMode ? editSelectedColor : viewSelectedColor) : '#1E90FF'
      };
    } else if (feature.feature_type === 'boundary') {
      // Park boundaries - use per-boundary color from database
      // Note: invisible hit area layer handles click detection, so stroke can be thin
      const boundaryColor = feature.boundary_color || '#228B22';
      // Selected color depends on mode: green for edit, blue for view
      const selectedStrokeColor = editMode ? editSelectedColor : viewSelectedColor;

      return {
        color: isSelected ? selectedStrokeColor : boundaryColor,
        weight: isSelected ? 3 : 2,
        fillColor: isSelected ? selectedStrokeColor : boundaryColor,
        fillOpacity: isSelected ? 0.30 : 0.15,
        dashArray: '5, 5',
        opacity: 1
      };
    } else {
      // trail - thinner and dashed for less obtrusive appearance
      return {
        weight: isSelected ? 3 : 2,  // Thinner than base: 2 normal, 3 selected
        opacity: isSelected ? 1 : 0.8,
        dashArray: '5, 5',  // Dashed line pattern
        color: isSelected ? (editMode ? editSelectedColor : viewSelectedColor) : '#8B4513'
      };
    }
  }, [editMode]);

  // Track if anything is selected (used to suppress hover tooltips on other features)
  // Virtual POIs (organizations) don't count since they don't appear on the map
  const hasAnySelection = !!((selectedDestination && selectedDestination.poi_type !== 'virtual') || selectedLinearFeature);

  return (
    <div className={`map-container ${editMode ? 'edit-mode-active' : ''}`}>
      {editMode && !isCreatingVirtualPoi && (
        <div className="edit-mode-banner">
          Edit Mode: Click marker or trail to select and edit in sidebar.
        </div>
      )}
      <MapContainer
        center={PARK_CENTER}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom={true}
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        {/* Base map layer - switch between regular and satellite */}
        {useSatellite ? (
          <TileLayer
            attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        ) : (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        )}

        {/* NPS Park Map overlay - rendered first so markers appear on top */}
        {showNpsMap && (
          <ImageOverlay
            url="/data/cvnp-map-cropped.jpg"
            bounds={mapBounds}
            opacity={overlayOpacity}
            zIndex={100}
          />
        )}

        {/* Clickable linear features - split by type for independent toggle control */}
        {linearFeatures && linearFeatures.map(feature => {
          // Check visibility based on feature type
          const isVisible = (feature.feature_type === 'trail' && showTrails) ||
                           (feature.feature_type === 'river' && showRivers) ||
                           (feature.feature_type === 'boundary' && visibleBoundaries.has(feature.id));
          if (!isVisible) return null;

          const isSelected = selectedLinearFeature?.id === feature.id;
          const geojsonData = {
            type: 'Feature',
            properties: { id: feature.id, name: feature.name },
            geometry: feature.geometry
          };

          // For boundaries, render TWO layers: invisible hit area + visible styled line
          if (feature.feature_type === 'boundary') {
            return (
              <React.Fragment key={`boundary-${feature.id}-${isSelected}-${editMode}-${hasAnySelection}-${feature.updated_at}`}>
                {/* Invisible wide hit area for click/hover detection - stroke only */}
                <GeoJSON
                  key={`boundary-hit-${feature.id}-${isSelected}-${editMode}-${hasAnySelection}`}
                  data={geojsonData}
                  style={() => ({
                    color: 'transparent',
                    weight: 20,
                    fill: false,
                    opacity: 1
                  })}
                  onEachFeature={(_geoFeature, layer) => {
                    // Set pointer-events to stroke only (no fill interaction)
                    layer.on('add', () => {
                      const el = layer.getElement();
                      if (el) {
                        el.style.pointerEvents = 'stroke';
                      }
                    });

                    layer.on('click', (e) => {
                      // Stop propagation to prevent MapClickHandler from clearing selection
                      L.DomEvent.stopPropagation(e);
                      handleLinearFeatureClick(feature);
                    });

                    // Only show tooltip if this feature is selected OR nothing is selected
                    // Virtual POIs (organizations) don't count since they don't appear on the map
                    const hasAnySelection = (selectedDestination && selectedDestination.poi_type !== 'virtual') || selectedLinearFeature;
                    if (isSelected || !hasAnySelection) {
                      const hasImage = feature.has_primary_image;
                      const imageUrl = hasImage ? `/api/pois/${feature.id}/thumbnail?size=medium` : null;

                      let tooltipHtml = '<div class="tooltip-content">';
                      if (hasImage) {
                        tooltipHtml += `<div class="tooltip-thumbnail"><img src="${imageUrl}" alt="" /></div>`;
                      }
                      tooltipHtml += `<strong>${feature.name}</strong>`;
                      if (feature.brief_description) {
                        tooltipHtml += `<p>${feature.brief_description}</p>`;
                      }
                      tooltipHtml += '</div>';

                      layer.bindTooltip(tooltipHtml, {
                        permanent: isSelected,
                        direction: 'auto',
                        offset: [0, 0],
                        sticky: !isSelected,
                        className: `destination-tooltip ${isSelected ? 'selected-tooltip' : ''}`
                      });
                    }
                  }}
                />
                {/* Visible styled boundary line (no pointer events) */}
                <GeoJSON
                  key={`boundary-visible-${feature.id}-${isSelected}-${editMode}-${hasAnySelection}`}
                  data={geojsonData}
                  style={() => getLinearFeatureStyle(feature, isSelected)}
                  onEachFeature={(_geoFeature, layer) => {
                    layer.on('add', () => {
                      const el = layer.getElement();
                      if (el) {
                        el.style.pointerEvents = 'none';
                      }
                    });
                  }}
                />
              </React.Fragment>
            );
          }

          // Non-boundary features (trails, rivers) - two layers like boundaries for better click detection
          return (
            <React.Fragment key={`linear-${feature.id}-${isSelected}-${editMode}-${hasAnySelection}-${feature.updated_at}`}>
              {/* Invisible wide hit area for click/hover detection */}
              <GeoJSON
                key={`linear-hit-${feature.id}-${isSelected}-${editMode}-${hasAnySelection}`}
                data={geojsonData}
                style={() => ({
                  color: 'transparent',
                  weight: 20,
                  opacity: 1
                })}
                onEachFeature={(geoFeature, layer) => {
                  // Add click handler - stop propagation to prevent MapClickHandler from clearing selection
                  layer.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    handleLinearFeatureClick(feature);
                  });

                  // Only show tooltip if this feature is selected OR nothing is selected
                  const hasAnySelection = selectedDestination || selectedLinearFeature;
                  if (isSelected || !hasAnySelection) {
                    // Build rich tooltip content (similar to destination tooltips)
                    const hasImage = feature.has_primary_image;
                    const imageUrl = hasImage ? `/api/pois/${feature.id}/thumbnail?size=medium` : null;

                    let tooltipHtml = '<div class="tooltip-content">';
                    if (hasImage) {
                      tooltipHtml += `<div class="tooltip-thumbnail"><img src="${imageUrl}" alt="" /></div>`;
                    }
                    tooltipHtml += `<strong>${feature.name}</strong>`;
                    if (feature.brief_description) {
                      tooltipHtml += `<p>${feature.brief_description}</p>`;
                    }
                    if (feature.length_miles) {
                      tooltipHtml += `<p class="trail-info">${feature.length_miles} miles${feature.difficulty ? ' • ' + feature.difficulty : ''}</p>`;
                    }
                    tooltipHtml += '</div>';

                    layer.bindTooltip(tooltipHtml, {
                      permanent: isSelected,
                      direction: 'auto',
                      offset: [0, 0],
                      sticky: !isSelected,
                      className: `destination-tooltip ${isSelected ? 'selected-tooltip' : ''}`
                    });
                  }
                }}
              />
              {/* Visible styled line (no pointer events) */}
              <GeoJSON
                key={`linear-visible-${feature.id}-${isSelected}-${editMode}-${hasAnySelection}`}
                data={geojsonData}
                style={() => getLinearFeatureStyle(feature, isSelected)}
                onEachFeature={(geoFeature, layer) => {
                  layer.on('add', () => {
                    const el = layer.getElement();
                    if (el) {
                      el.style.pointerEvents = 'none';
                    }
                  });
                }}
              />
            </React.Fragment>
          );
        })}

        <MapUpdater selectedDestination={selectedDestination} selectedLinearFeature={selectedLinearFeature} skipFlyRef={skipFlyRef} />
        <MapVisibilityHandler activeTab={activeTab} />
        <BoundsFitter boundsToFit={boundsToFit} />
        <MapBoundsTracker
          destinations={destinations}
          visibleTypes={visibleTypes}
          getDestinationIconType={getDestinationIconType}
          onVisiblePoisChange={handleVisiblePoisChange}
          onMapStateChange={onMapStateChange}
          linearFeatures={linearFeatures}
          showTrails={showTrails}
          showRivers={showRivers}
          visibleBoundaries={visibleBoundaries}
        />
        <MapMoveTracker onMapMove={() => setMapMoveCount(c => c + 1)} />
        <MapClickHandler
          isAdmin={isAdmin}
          editMode={editMode}
          onRightClick={onStartNewPOI}
          onMapClick={() => {
            // Clear selection when clicking on empty map area
            if (onSelectDestination) onSelectDestination(null);
            if (onSelectLinearFeature) onSelectLinearFeature(null);
          }}
        />

        {/* Combined Zoom and GPS Locate Control */}
        <ZoomLocateControl
          useSatellite={useSatellite}
          onSatelliteToggle={() => setUseSatellite(prev => !prev)}
        />

        {/* Temporary marker for new POI being created */}
        {newPOI && previewCoords && (
          <DestinationMarker
            key="new-poi-marker"
            dest={{
              ...newPOI,
              latitude: previewCoords.lat,
              longitude: previewCoords.lng
            }}
            icon={getDestinationIcon(newPOI)}
            isSelected={true}
            isEditMode={true}
            onSelect={() => {}}
            mapMoveCount={mapMoveCount}
            onDragEnd={(d, lat, lng) => onPreviewCoordsChange({ lat, lng })}
            hasSelection={true}
          />
        )}

        {/* Only render markers after icon config is loaded to prevent flash */}
        {iconConfig.length > 0 && destinations.map((dest) => {
          if (!dest.latitude || !dest.longitude) return null;

          const iconType = getDestinationIconType(dest);
          if (!visibleTypes.has(iconType)) return null;

          const isSelected = selectedDestination?.id === dest.id;
          const icon = getDestinationIcon(dest);

          // In edit mode, use preview coords for selected marker (live updates from sidebar or drag)
          const markerLat = isSelected && previewCoords ? previewCoords.lat : parseFloat(dest.latitude);
          const markerLng = isSelected && previewCoords ? previewCoords.lng : parseFloat(dest.longitude);

          // Only selected markers are draggable in edit mode (when admin)
          const isInEditMode = editMode && isAdmin;
          const isDraggable = isInEditMode && isSelected;

          // Handle drag end - update preview coords only (save happens on Save button click)
          const handleDrag = (d, lat, lng) => {
            onPreviewCoordsChange({ lat, lng });
          };

          return (
            <DestinationMarker
              key={`marker-${dest.id}-${isSelected}`}
              dest={{ ...dest, latitude: markerLat, longitude: markerLng }}
              icon={icon}
              isSelected={isSelected}
              isEditMode={isDraggable}
              onSelect={onSelectDestination}
              onDragEnd={isDraggable ? handleDrag : handleMarkerDragEnd}
              mapMoveCount={mapMoveCount}
              hasSelection={!!((selectedDestination && selectedDestination.poi_type !== 'virtual') || selectedLinearFeature)}
            />
          );
        })}

        {/* Virtual POI Creator - for creating new organizations or adding associations */}
        {isAdmin && editMode && (
          <VirtualPoiCreator
            isActive={isCreatingVirtualPoi || isDrawingAssociations}
            mode={isDrawingAssociations ? 'add' : 'create'}
            onCancel={() => {
              if (isCreatingVirtualPoi) {
                setIsCreatingVirtualPoi(false);
              }
              if (isDrawingAssociations && onCancelDrawingAssociations) {
                onCancelDrawingAssociations();
              }
            }}
            destinations={destinations}
            linearFeatures={linearFeatures}
            visibleTypes={visibleTypes}
            showTrails={showTrails}
            showRivers={showRivers}
            visibleBoundaries={visibleBoundaries}
            getDestinationIconType={getDestinationIconType}
            onPoisSelected={(pois) => {
              if (isCreatingVirtualPoi) {
                // Creating new organization
                setIsCreatingVirtualPoi(false);
                if (onStartNewOrganization) {
                  onStartNewOrganization(pois);
                }
              } else if (isDrawingAssociations && addingAssociationsToOrgId) {
                // Adding associations to existing organization
                if (onAddAssociationsFromDrawing) {
                  onAddAssociationsFromDrawing(addingAssociationsToOrgId, pois);
                }
              }
            }}
          />
        )}
      </MapContainer>

      {/* Results count overlay - clickable to toggle filter popup */}
      <button
        className={`map-poi-count ${(selectedDestination || selectedLinearFeature || newPOI || newOrganization) ? 'sidebar-open' : ''}`}
        onClick={() => setIsLegendExpanded(!isLegendExpanded)}
      >
        {visiblePoiCount} Result{visiblePoiCount !== 1 ? 's' : ''}
      </button>

      {/* Admin controls moved to General Settings for cleaner map interface */}

      {/* Refresh result message */}
      {refreshResult && (
        <div className={`map-refresh-result ${refreshResult.type}`}>
          {refreshResult.message}
          <button className="dismiss-btn" onClick={() => setRefreshResult(null)}>×</button>
        </div>
      )}

      {/* Backdrop for popup mode */}
      <div
        className={`legend-backdrop ${isLegendExpanded ? 'visible' : ''}`}
        onClick={() => setIsLegendExpanded(false)}
      />

      <Legend
        showNpsMap={showNpsMap}
        onToggleNpsMap={onToggleNpsMap}
        showTrails={showTrails}
        onToggleTrails={onToggleTrails}
        showRivers={showRivers}
        onToggleRivers={onToggleRivers}
        visibleBoundaries={visibleBoundaries}
        onToggleBoundary={onToggleBoundary}
        onShowAllBoundaries={onShowAllBoundaries}
        onHideAllBoundaries={onHideAllBoundaries}
        boundaries={linearFeatures.filter(f => f.feature_type === 'boundary')}
        visibleTypes={visibleTypes}
        onToggleType={handleToggleType}
        onShowAll={handleShowAll}
        onHideAll={handleHideAll}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        isExpanded={isLegendExpanded}
        onClose={() => setIsLegendExpanded(false)}
        editMode={editMode}
        activeTab={activeTab}
        iconConfig={iconConfig}
        onOpenAdmin={() => setShowAdmin(true)}
        onFileSelect={handleFileSelect}
        selectedFileName={selectedFileName}
        importType={importType}
        onImportTypeChange={setImportType}
        onImportFile={handleImportFile}
        importingFile={importingFile}
        importMessage={importMessage}
        onDismissMessage={handleDismissMessage}
      />
      {showAdmin && (
        <MapAdmin
          bounds={{
            south: mapBounds[0][0],
            west: mapBounds[0][1],
            north: mapBounds[1][0],
            east: mapBounds[1][1]
          }}
          onBoundsChange={setMapBounds}
          onClose={() => setShowAdmin(false)}
          opacity={overlayOpacity}
          onOpacityChange={setOverlayOpacity}
        />
      )}
      {pendingUpdate && (
        <CoordinateConfirmDialog
          destination={pendingUpdate.destination}
          newLat={pendingUpdate.newLat}
          newLng={pendingUpdate.newLng}
          onConfirm={handleConfirmUpdate}
          onCancel={handleCancelUpdate}
          saving={saving}
        />
      )}
    </div>
  );
}

export default Map;
