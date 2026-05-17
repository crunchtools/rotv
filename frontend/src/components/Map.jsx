import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, useMap, GeoJSON, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import VirtualPoiCreator from './VirtualPoiCreator';
import { getDestinationIconTypeFromConfig } from '../utils/iconUtils';

const createIcon = (iconUrl) => L.icon({
  iconUrl,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  tooltipAnchor: [0, -14]
});

const defaultIcon = createIcon('/icons/default.svg');

function getIconUrl(icon) {
  if (icon.svg_content) {
    return `/api/icons/${icon.name}.svg`;
  }
  return `/icons/${icon.svg_filename || `${icon.name}.svg`}`;
}

function createIconsFromConfig(iconConfig) {
  const icons = {};
  iconConfig.forEach(icon => {
    if (icon.enabled !== false) {
      icons[icon.name] = createIcon(getIconUrl(icon));
    }
  });
  if (!icons['default']) {
    icons['default'] = createIcon('/icons/default.svg');
  }
  return icons;
}

const PARK_CENTER = [41.26, -81.55];
const DEFAULT_ZOOM = 11;

const TOOLTIP_HOVER_DELAY = 250; // ms

function Legend({
  showTrails, onToggleTrails,
  showRivers, onToggleRivers,
  visibleBoundaries, onToggleBoundary, onShowAllBoundaries, onHideAllBoundaries,
  boundaries, // Array of boundary objects with id, name, boundary_color
  visibleTypes, onToggleType, onShowAll, onHideAll,
  searchQuery, onSearchChange,
  isExpanded, _onClose,
  editMode,
  _activeTab, iconConfig, _onOpenAdmin,
  _onFileSelect, _selectedFileName, _importType, _onImportTypeChange,
  _onImportFile, _importingFile, _importMessage, _onDismissMessage
}) {

  const iconTypes = useMemo(() => {
    let poiTypes;
    if (!iconConfig || iconConfig.length === 0) {
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

    const layerIcons = [
      { id: 'trails', label: 'Trails', type: 'layer', isActive: showTrails, onToggle: () => onToggleTrails(!showTrails) },
      { id: 'rivers', label: 'Rivers', type: 'layer', isActive: showRivers, onToggle: () => onToggleRivers(!showRivers) }
    ];

    return [...poiTypes, ...layerIcons].sort((a, b) => a.label.localeCompare(b.label));
  }, [iconConfig, showTrails, showRivers, onToggleTrails, onToggleRivers]);

  return (
    <div className={`legend ${isExpanded ? 'legend-expanded' : ''} ${editMode ? 'legend-edit-mode' : ''}`}>
      <div className="legend-content">
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

        <div className="legend-icons" role="group" aria-label="Map layer filters">
          {iconTypes.map(type => {
            if (type.type === 'layer') {
              return (
                <button
                  key={type.id}
                  className={`legend-icon-item ${type.isActive ? 'active' : 'inactive'}`}
                  onClick={type.onToggle}
                  aria-pressed={type.isActive}
                  type="button"
                >
                  <img src={`/icons/layers/${type.id}.svg`} alt="" aria-hidden="true" />
                  <span>{type.label}</span>
                </button>
              );
            } else {
              const isActive = visibleTypes.has(type.id);
              return (
                <button
                  key={type.id}
                  className={`legend-icon-item ${isActive ? 'active' : 'inactive'}`}
                  onClick={() => onToggleType(type.id)}
                  aria-pressed={isActive}
                  type="button"
                >
                  {type.svg_content ? (
                    <div className="legend-icon-svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: type.svg_content }} />
                  ) : (
                    <img src={type.iconUrl || `/icons/${type.svg_filename}`} alt="" aria-hidden="true" />
                  )}
                  <span>{type.label}</span>
                </button>
              );
            }
          })}
        </div>

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

      </div>
    </div>
  );
}

function MapClickHandler({ isAdmin, editMode, onRightClick, onMapClick }) {
  useMapEvents({
    click: () => {
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

function MapUpdater({ selectedDestination, selectedLinearFeature, skipFlyRef }) {
  const map = useMap();

  React.useEffect(() => {
    if (selectedDestination && selectedDestination.latitude && selectedDestination.longitude) {
      if (skipFlyRef && skipFlyRef.current) {
        skipFlyRef.current = false; // Reset the flag
        return; // Skip the fly animation
      }

      map.invalidateSize();

      map._isProgrammaticMove = true;

      const isInitialLoad = !map._hasCompletedInitialLoad;

      const currentZoom = map.getZoom();
      const targetZoom = isInitialLoad ? 16 : Math.max(currentZoom, 15);

      map.flyTo([selectedDestination.latitude, selectedDestination.longitude], targetZoom, {
        animate: true,
        duration: isInitialLoad ? 0.8 : 0.5 // Slightly longer animation on initial load
      });

      const animationDuration = isInitialLoad ? 800 : 500;
      setTimeout(() => {
        map._isProgrammaticMove = false;
        if (isInitialLoad) {
          map._hasCompletedInitialLoad = true;
          map._forceNextUpdate = true; // Signal to bypass threshold check
          map.fire('moveend');
        }
      }, animationDuration + 100); // Add 100ms buffer
    }
  }, [selectedDestination, map, skipFlyRef]);

  React.useEffect(() => {
    if (selectedLinearFeature && selectedLinearFeature.geometry) {
      if (skipFlyRef && skipFlyRef.current) {
        skipFlyRef.current = false;
      }
    }
  }, [selectedLinearFeature, map, skipFlyRef]);

  return null;
}

function MapVisibilityHandler({ activeTab }) {
  const map = useMap();
  const prevTab = useRef(activeTab);

  useEffect(() => {
    if (activeTab === 'view' && prevTab.current !== 'view') {
      requestAnimationFrame(() => {
        map.invalidateSize();
      });
    }
    prevTab.current = activeTab;
  }, [activeTab, map]);

  return null;
}

function BoundsFitter({ boundsToFit }) {
  const map = useMap();
  const prevBounds = useRef(null);

  useEffect(() => {
    if (boundsToFit && JSON.stringify(boundsToFit) !== JSON.stringify(prevBounds.current)) {

      const latRange = boundsToFit[1][0] - boundsToFit[0][0];
      const lngRange = boundsToFit[1][1] - boundsToFit[0][1];
      const geoSize = Math.max(latRange, lngRange);

      const padding = geoSize >= 0.3 ? [20, 20] : [50, 50];
      const maxZoom = geoSize >= 0.3 ? 12 : undefined; // Limit zoom for large areas


      map.fitBounds(boundsToFit, { padding, maxZoom });
      prevBounds.current = boundsToFit;
    }
  }, [boundsToFit, map]);

  return null;
}

function getGeometryBounds(geometry) {
  if (!geometry) return null;

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  const processCoords = (coords) => {
    if (!Array.isArray(coords)) return;

    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lng = coords[0];
      const lat = coords[1];
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    } else {
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

function boundsIntersect(mapBounds, geoBounds) {
  if (!geoBounds) return false;

  const mapSouth = mapBounds.getSouth();
  const mapNorth = mapBounds.getNorth();
  const mapWest = mapBounds.getWest();
  const mapEast = mapBounds.getEast();

  if (geoBounds.north < mapSouth || geoBounds.south > mapNorth) return false;
  if (geoBounds.east < mapWest || geoBounds.west > mapEast) return false;

  return true;
}

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

function ZoomTooltipHider() {
  const map = useMap();
  const hiddenPermanentRef = useRef([]);

  useEffect(() => {
    if (!map) return;

    const hideTooltips = () => {
      hiddenPermanentRef.current = [];
      map.eachLayer((layer) => {
        if (layer.getTooltip && layer.getTooltip() && layer.isTooltipOpen()) {
          const tooltip = layer.getTooltip();
          if (tooltip.options.permanent) {
            const el = tooltip.getElement();
            if (el) el.style.opacity = '0';
            hiddenPermanentRef.current.push(tooltip);
          } else {
            layer.closeTooltip();
          }
        }
      });
    };

    const restorePermanent = () => {
      hiddenPermanentRef.current.forEach((tooltip) => {
        const el = tooltip.getElement();
        if (el) el.style.opacity = '0.95';
      });
      hiddenPermanentRef.current = [];
    };

    map.on('zoomstart', hideTooltips);
    map.on('zoomend', restorePermanent);
    return () => {
      map.off('zoomstart', hideTooltips);
      map.off('zoomend', restorePermanent);
    };
  }, [map]);

  return null;
}

function MapBoundsTracker({ destinations, visibleTypes, getDestinationIconType, onVisiblePoisChange, onMapStateChange, linearFeatures, showTrails, showRivers, visibleBoundaries }) {
  const map = useMap();

  const updateVisiblePois = useCallback(() => {
    try {
      const bounds = map.getBounds();
      if (!bounds || !bounds.isValid()) return;

      const visibleIds = [];

      if (destinations && destinations.length > 0) {
        destinations.forEach(dest => {
          if (!dest.latitude || !dest.longitude) return;

          const iconType = getDestinationIconType(dest);
          if (!visibleTypes.has(iconType)) {
            return;
          }

          const lat = parseFloat(dest.latitude);
          const lng = parseFloat(dest.longitude);
          if (bounds.contains([lat, lng])) {
            visibleIds.push(dest.id);
          }
        });
      }

      const isFilteredMode = visibleTypes.size < 10; // Small specific set means filtered mode
      const includeLinearFeatures = !isFilteredMode ||
                                    visibleTypes.has('trail') ||
                                    visibleTypes.has('river') ||
                                    visibleTypes.has('boundary');

      if (includeLinearFeatures && linearFeatures && linearFeatures.length > 0) {
        linearFeatures.forEach(feature => {
          let isLayerVisible = false;
          if (feature.feature_type === 'trail') {
            isLayerVisible = showTrails;
          } else if (feature.feature_type === 'river') {
            isLayerVisible = showRivers;
          } else if (feature.poi_roles?.includes('boundary')) {
            isLayerVisible = visibleBoundaries.has(feature.id);
          }

          if (!isLayerVisible) return;

          if (feature.geometry) {
            const geoBounds = getGeometryBounds(feature.geometry);
            if (boundsIntersect(bounds, geoBounds)) {
              visibleIds.push(feature.id);
            }
          }
        });
      }

      if (onVisiblePoisChange && !map._isProgrammaticMove) {
        onVisiblePoisChange(visibleIds);
      }

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
    }
  }, [map, destinations, visibleTypes, getDestinationIconType, onVisiblePoisChange, onMapStateChange, linearFeatures, showTrails, showRivers, visibleBoundaries]);

  useMapEvents({
    moveend: updateVisiblePois,
    zoomend: updateVisiblePois,
    load: updateVisiblePois
  });

  useEffect(() => {
    updateVisiblePois();

    const timer = setTimeout(updateVisiblePois, 100);
    return () => clearTimeout(timer);
  }, [updateVisiblePois]);

  useEffect(() => {
    updateVisiblePois();
  }, [destinations, linearFeatures, showTrails, showRivers, visibleBoundaries, updateVisiblePois]);

  return null;
}

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

        map.flyTo(latlng, 16, { duration: 1 });

        if (userMarkerRef.current) {
          userMarkerRef.current.remove();
        }
        if (userCircleRef.current) {
          userCircleRef.current.remove();
        }

        userCircleRef.current = L.circle(latlng, {
          radius: accuracy,
          color: '#4285f4',
          fillColor: '#4285f4',
          fillOpacity: 0.15,
          weight: 2
        }).addTo(map);

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

  useEffect(() => {
    const ZoomLocateControlClass = L.Control.extend({
      onAdd: function(map) {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control zoom-locate-control');

        const zoomIn = L.DomUtil.create('a', 'zoom-locate-btn zoom-in-btn', container);
        zoomIn.href = '#';
        zoomIn.title = 'Zoom in';
        zoomIn.setAttribute('role', 'button');
        zoomIn.setAttribute('aria-label', 'Zoom in');
        zoomIn.innerHTML = '<span aria-hidden="true">+</span>';

        const zoomOut = L.DomUtil.create('a', 'zoom-locate-btn zoom-out-btn', container);
        zoomOut.href = '#';
        zoomOut.title = 'Zoom out';
        zoomOut.setAttribute('role', 'button');
        zoomOut.setAttribute('aria-label', 'Zoom out');
        zoomOut.innerHTML = '<span aria-hidden="true">−</span>';

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

function createEditSelectedIcon(iconUrl) {
  return L.divIcon({
    className: 'selected-marker-icon edit-mode',
    html: `<div class="marker-highlight edit-highlight"><img src="${iconUrl}" alt="" /></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    tooltipAnchor: [0, -18]
  });
}

function createViewSelectedIcon(iconUrl) {
  return L.divIcon({
    className: 'selected-marker-icon view-mode',
    html: `<div class="marker-highlight view-highlight"><img src="${iconUrl}" alt="" /></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    tooltipAnchor: [0, -18]
  });
}

function DestinationMarker({ dest, icon, isSelected, isEditMode, onSelect, onDragEnd, _mapMoveCount, hasSelection }) {
  const markerRef = useRef(null);
  const map = useMap();
  const hoverTimerRef = useRef(null);

  const getTooltipDirection = () => {
    if (!map) return 'top';

    const point = map.latLngToContainerPoint([dest.latitude, dest.longitude]);
    const mapSize = map.getSize();

    const tooltipWidth = 220;
    const tooltipHeight = 220; // Account for image thumbnail (~120px) + text
    const margin = 20;

    const nearTop = point.y < tooltipHeight + margin;
    const nearBottom = (mapSize.y - point.y) < tooltipHeight + margin;
    const nearRight = (mapSize.x - point.x) < tooltipWidth + margin;
    const nearLeft = point.x < tooltipWidth + margin;

    if (nearTop && !nearBottom) {
      return 'bottom';
    }
    if (nearRight && !nearLeft && !nearTop) {
      return 'left';
    }
    if (nearLeft && !nearRight && !nearTop) {
      return 'right';
    }
    return 'top';
  };

  const tooltipDirection = isSelected ? 'top' : getTooltipDirection();

  const eventHandlers = {
    click: () => onSelect(dest),
    dragend: () => {
      const marker = markerRef.current;
      if (marker) {
        const { lat, lng } = marker.getLatLng();
        onDragEnd(dest, lat, lng);
      }
    },
    tooltipopen: (e) => {
      if (!isSelected) {
        const el = e.tooltip.getElement();
        if (el) el.style.opacity = '0';
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = setTimeout(() => {
          e.tooltip.update();
          const el2 = e.tooltip.getElement();
          if (el2) el2.style.opacity = '0.95';
          hoverTimerRef.current = null;
        }, TOOLTIP_HOVER_DELAY);
      }
    },
    tooltipclose: () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    }
  };

  const getDisplayIcon = () => {
    if (!isSelected) return icon;
    if (isEditMode) return createEditSelectedIcon(icon.options.iconUrl);
    return createViewSelectedIcon(icon.options.iconUrl);
  };
  const displayIcon = getDisplayIcon();

  const markerKey = `${dest.id}-${isEditMode ? 'edit' : 'view'}`;

  const getOffset = () => {
    switch (tooltipDirection) {
      case 'bottom': return [0, 28]; // Move below the icon (icon is 28px tall)
      case 'left': return [-14, 14]; // Move left and adjust vertical
      case 'right': return [14, 14]; // Move right and adjust vertical
      default: return [0, 0]; // Icon's tooltipAnchor handles "top"
    }
  };

  const showTooltip = isSelected || !hasSelection;

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
                <img
                  src={`/api/pois/${dest.id}/thumbnail?size=medium&v=${dest.updated_at || ''}`}
                  alt=""
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentElement.style.display = 'none';
                  }}
                />
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

const DEFAULT_ICON_TYPES = new Set(['visitor-center', 'waterfall', 'trail', 'historic', 'bridge', 'train', 'nature', 'skiing', 'biking', 'picnic', 'camping', 'music', 'default']);

function Map({ destinations, selectedDestination, onSelectDestination, isAdmin, onDestinationUpdate, editMode, activeTab, _onDestinationCreate, previewCoords, onPreviewCoordsChange, newPOI, onStartNewPOI, linearFeatures, selectedLinearFeature, onSelectLinearFeature, visibleTypes, onVisibleTypesChange, onVisiblePoisChange, onMapStateChange, showTrails, onToggleTrails, showRivers, onToggleRivers, visibleBoundaries, onToggleBoundary, onShowAllBoundaries, onHideAllBoundaries, searchQuery, onSearchChange, _onNewsRefresh, skipFlyRef, newOrganization, onStartNewOrganization, isDrawingAssociations, addingAssociationsToOrgId, onAddAssociationsFromDrawing, onCancelDrawingAssociations, boundsToFit, visiblePoiCount, iconConfig }) {
  const [isLegendExpanded, setIsLegendExpanded] = useState(false);
  const [useSatellite, setUseSatellite] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState(null); // Just for UI display
  const [importType, setImportType] = useState('trail');
  const [importingFile, setImportingFile] = useState(false);
  const [importMessage, setImportMessage] = useState(null);
  const [isCreatingVirtualPoi, setIsCreatingVirtualPoi] = useState(false);
  const [visiblePoiIds, setVisiblePoiIds] = useState([]);
  const [refreshResult, setRefreshResult] = useState(null);
  const fileRef = useRef(null); // Store File object in ref to avoid React re-renders

  const [mapMoveCount, setMapMoveCount] = useState(0);


  const handleVisiblePoisChange = useCallback((visibleIds) => {
    setVisiblePoiIds(visibleIds);
    if (onVisiblePoisChange) {
      onVisiblePoisChange(visibleIds);
    }
  }, [onVisiblePoisChange]);


  const icons = useMemo(() => createIconsFromConfig(iconConfig), [iconConfig]);

  const allIconTypes = useMemo(() => {
    if (iconConfig.length === 0) return DEFAULT_ICON_TYPES;
    const types = new Set(iconConfig.filter(i => i.enabled !== false).map(i => i.name));
    if (!types.has('default')) types.add('default');
    return types;
  }, [iconConfig]);

  const getDestinationIconType = useCallback((dest) => {
    if (iconConfig.length === 0) return 'default';
    return getDestinationIconTypeFromConfig(dest, iconConfig);
  }, [iconConfig]);

  const getDestinationIcon = useCallback((dest) => {
    const iconType = getDestinationIconType(dest);
    return icons[iconType] || icons['default'] || defaultIcon;
  }, [icons, getDestinationIconType]);

  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [saving, setSaving] = useState(false);


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
    if (onVisibleTypesChange) onVisibleTypesChange(new Set(allIconTypes));
    onToggleTrails(true);
    onToggleRivers(true);
  };

  const handleHideAll = () => {
    if (onVisibleTypesChange) onVisibleTypesChange(new Set());
    onToggleTrails(false);
    onToggleRivers(false);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileRef.current = file; // Store in ref - no re-render
    setSelectedFileName(file.name); // Update UI
  };

  const handleImportFile = async () => {
    const file = fileRef.current;
    if (!file) return;

    setImportingFile(true);
    setImportMessage(null);

    try {
      const content = await file.text();

      let geojson;
      try {
        geojson = JSON.parse(content);
      } catch {
        setImportMessage({ type: 'error', text: 'Invalid JSON file' });
        setImportingFile(false);
        return;
      }

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

  const handleDismissMessage = () => {
    setImportMessage(null);
  };

  const handleMarkerDragEnd = (dest, newLat, newLng) => {
    setPendingUpdate({
      destination: dest,
      newLat,
      newLng
    });
  };

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

  const handleCancelUpdate = () => {
    setPendingUpdate(null);
  };


  const handleLinearFeatureClick = (feature) => {
    if (onSelectLinearFeature) {
      onSelectLinearFeature(feature);
    }
  };

  const getLinearFeatureStyle = useCallback((feature, isSelected) => {
    const editSelectedColor = '#FF8C00';
    const viewSelectedColor = '#0066CC';

    if (feature.feature_type === 'river') {
      return {
        weight: isSelected ? 3 : 2,  // Thinner than base: 2 normal, 3 selected
        opacity: isSelected ? 1 : 0.8,
        color: isSelected ? (editMode ? editSelectedColor : viewSelectedColor) : '#1E90FF'
      };
    } else if (feature.poi_roles?.includes('boundary')) {
      const boundaryColor = feature.boundary_color || '#228B22';
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
      return {
        weight: isSelected ? 3 : 2,  // Thinner than base: 2 normal, 3 selected
        opacity: isSelected ? 1 : 0.8,
        dashArray: '5, 5',  // Dashed line pattern
        color: isSelected ? (editMode ? editSelectedColor : viewSelectedColor) : '#8B4513'
      };
    }
  }, [editMode]);

  const hasAnySelection = !!((selectedDestination && (selectedDestination.geometry || selectedDestination.latitude)) || selectedLinearFeature);

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


        {linearFeatures && linearFeatures.map(feature => {
          const isVisible = (feature.feature_type === 'trail' && showTrails) ||
                           (feature.feature_type === 'river' && showRivers) ||
                           (feature.poi_roles?.includes('boundary') && visibleBoundaries.has(feature.id));
          if (!isVisible) return null;

          const isSelected = selectedLinearFeature?.id === feature.id;
          const geojsonData = {
            type: 'Feature',
            properties: { id: feature.id, name: feature.name },
            geometry: feature.geometry
          };

          if (feature.poi_roles?.includes('boundary')) {
            return (
              <React.Fragment key={`boundary-${feature.id}-${isSelected}-${editMode}-${hasAnySelection}-${feature.updated_at}`}>
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
                    layer.on('add', () => {
                      const el = layer.getElement();
                      if (el) {
                        el.style.pointerEvents = 'stroke';
                      }
                    });

                    if (!isSelected) {
                      layer.on('mouseover', () => {
                        layer.setStyle({ color: 'rgba(0, 102, 204, 0.35)', weight: 8 });
                      });
                      layer.on('mouseout', () => {
                        layer.setStyle({ color: 'transparent', weight: 20 });
                      });
                    }

                    layer.on('click', (e) => {
                      L.DomEvent.stopPropagation(e);
                      handleLinearFeatureClick(feature);
                    });

                    const hasAnySelection = (selectedDestination && (selectedDestination.geometry || selectedDestination.latitude)) || selectedLinearFeature;
                    if (isSelected || !hasAnySelection) {
                      const hasImage = feature.has_primary_image;
                      const imageUrl = hasImage ? `/api/pois/${feature.id}/thumbnail?size=medium` : null;

                      let tooltipHtml = '<div class="tooltip-content">';
                      if (hasImage) {
                        tooltipHtml += `<div class="tooltip-thumbnail"><img src="${imageUrl}" alt="" onerror="this.style.display='none';this.parentElement.style.display='none'" /></div>`;
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

                      if (!isSelected) {
                        let hoverTimer = null;
                        layer.on('tooltipopen', (e) => {
                          const el = e.tooltip.getElement();
                          if (el) el.style.opacity = '0';
                          if (hoverTimer) clearTimeout(hoverTimer);
                          hoverTimer = setTimeout(() => {
                            e.tooltip.update();
                            const el2 = e.tooltip.getElement();
                            if (el2) el2.style.opacity = '0.95';
                            hoverTimer = null;
                          }, TOOLTIP_HOVER_DELAY);
                        });
                        layer.on('tooltipclose', () => {
                          if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
                        });
                      }
                    }
                  }}
                />
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

          return (
            <React.Fragment key={`linear-${feature.id}-${isSelected}-${editMode}-${hasAnySelection}-${feature.updated_at}`}>
              <GeoJSON
                key={`linear-hit-${feature.id}-${isSelected}-${editMode}-${hasAnySelection}`}
                data={geojsonData}
                style={() => ({
                  color: 'transparent',
                  weight: 20,
                  opacity: 1
                })}
                onEachFeature={(geoFeature, layer) => {
                  layer.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    handleLinearFeatureClick(feature);
                  });

                  if (!isSelected) {
                    layer.on('mouseover', () => {
                      layer.setStyle({ color: 'rgba(0, 102, 204, 0.35)', weight: 8 });
                    });
                    layer.on('mouseout', () => {
                      layer.setStyle({ color: 'transparent', weight: 20 });
                    });
                  }

                  const hasAnySelection = selectedDestination || selectedLinearFeature;
                  if (isSelected || !hasAnySelection) {
                    const hasImage = feature.has_primary_image;
                    const imageUrl = hasImage ? `/api/pois/${feature.id}/thumbnail?size=medium` : null;

                    let tooltipHtml = '<div class="tooltip-content">';
                    if (hasImage) {
                      tooltipHtml += `<div class="tooltip-thumbnail"><img src="${imageUrl}" alt="" onerror="this.style.display='none';this.parentElement.style.display='none'" /></div>`;
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

                    if (!isSelected) {
                      let hoverTimer = null;
                      layer.on('tooltipopen', (e) => {
                        const el = e.tooltip.getElement();
                        if (el) el.style.opacity = '0';
                        if (hoverTimer) clearTimeout(hoverTimer);
                        hoverTimer = setTimeout(() => {
                          const el2 = e.tooltip.getElement();
                          if (el2) el2.style.opacity = '0.95';
                          hoverTimer = null;
                        }, TOOLTIP_HOVER_DELAY);
                      });
                      layer.on('tooltipclose', () => {
                        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
                      });
                    }
                  }
                }}
              />
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
        <ZoomTooltipHider />
        <MapClickHandler
          isAdmin={isAdmin}
          editMode={editMode}
          onRightClick={onStartNewPOI}
          onMapClick={() => {
            if (onSelectDestination) onSelectDestination(null);
            if (onSelectLinearFeature) onSelectLinearFeature(null);
          }}
        />

        <ZoomLocateControl
          useSatellite={useSatellite}
          onSatelliteToggle={() => setUseSatellite(prev => !prev)}
        />

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

        {iconConfig.length > 0 && destinations.map((dest) => {
          if (!dest.latitude || !dest.longitude) return null;

          const iconType = getDestinationIconType(dest);
          if (!visibleTypes.has(iconType)) return null;

          const isSelected = selectedDestination?.id === dest.id;
          const icon = getDestinationIcon(dest);

          const markerLat = isSelected && previewCoords ? previewCoords.lat : parseFloat(dest.latitude);
          const markerLng = isSelected && previewCoords ? previewCoords.lng : parseFloat(dest.longitude);

          const isInEditMode = editMode && isAdmin;
          const isDraggable = isInEditMode && isSelected;

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
              hasSelection={!!((selectedDestination && (selectedDestination.geometry || selectedDestination.latitude)) || selectedLinearFeature)}
            />
          );
        })}

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
                setIsCreatingVirtualPoi(false);
                if (onStartNewOrganization) {
                  onStartNewOrganization(pois);
                }
              } else if (isDrawingAssociations && addingAssociationsToOrgId) {
                if (onAddAssociationsFromDrawing) {
                  onAddAssociationsFromDrawing(addingAssociationsToOrgId, pois);
                }
              }
            }}
          />
        )}
      </MapContainer>

      <button
        className={`map-poi-count ${(selectedDestination || selectedLinearFeature || newPOI || newOrganization) ? 'sidebar-open' : ''}`}
        onClick={() => setIsLegendExpanded(!isLegendExpanded)}
      >
        {visiblePoiCount} Result{visiblePoiCount !== 1 ? 's' : ''}
      </button>


      {refreshResult && (
        <div className={`map-refresh-result ${refreshResult.type}`}>
          {refreshResult.message}
          <button className="dismiss-btn" onClick={() => setRefreshResult(null)}>×</button>
        </div>
      )}

      <div
        className={`legend-backdrop ${isLegendExpanded ? 'visible' : ''}`}
        onClick={() => setIsLegendExpanded(false)}
      />

      <Legend
        showTrails={showTrails}
        onToggleTrails={onToggleTrails}
        showRivers={showRivers}
        onToggleRivers={onToggleRivers}
        visibleBoundaries={visibleBoundaries}
        onToggleBoundary={onToggleBoundary}
        onShowAllBoundaries={onShowAllBoundaries}
        onHideAllBoundaries={onHideAllBoundaries}
        boundaries={linearFeatures.filter(f => f.poi_roles?.includes('boundary') && !['county', 'state'].includes(f.boundary_type))}
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
        onOpenAdmin={() => {}}
        onFileSelect={handleFileSelect}
        selectedFileName={selectedFileName}
        importType={importType}
        onImportTypeChange={setImportType}
        onImportFile={handleImportFile}
        importingFile={importingFile}
        importMessage={importMessage}
        onDismissMessage={handleDismissMessage}
      />
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
