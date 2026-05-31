import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Marker, Tooltip, useMap, GeoJSON, useMapEvents, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import VirtualPoiCreator from './VirtualPoiCreator';
import { getDestinationIconTypeFromConfig, poiMatchesActivityForTypes, matchesWholeWord } from '../utils/iconUtils';
import { useTrip } from '../hooks/useTrip';
import { useNavigate } from 'react-router-dom';
import { generateSlug } from './sidebar/helpers';

// Escape user-supplied POI fields before interpolating them into tooltip HTML
// strings passed to Leaflet's bindTooltip (which sets innerHTML). Prevents XSS
// from admin-entered names/descriptions. (PR #415 review)
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// River gauge marker (#92): a labeled pin showing the latest discharge (cfs)
function createGaugeIcon(label, active) {
  return L.divIcon({
    className: `river-gauge-marker${active ? ' active' : ''}`,
    html: `<div class="river-gauge-pin"><span class="river-gauge-dot"></span><span class="river-gauge-label">${label}</span></div>`,
    iconSize: [0, 0],
    iconAnchor: [6, 6]
  });
}

function createBoatIcon(heading) {
  return L.divIcon({
    className: 'boat-marker-icon',
    html: `<div class="boat-marker-inner" style="transform: rotate(${heading || 0}deg)">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="38" height="38">
        <path fill="#F5C518" stroke="#B8860B" stroke-width="30" stroke-linejoin="round"
          d="m595.16 289.09c1.19.14 2.37.2 3.55.2 7.15 0 14.09-2.47 19.85-7.14 7.28-5.89 11.99-14.83 12.93-24.55 1.88-19.32-11.27-36.73-29.31-38.79-8.38-.96-16.68 1.5-23.4 6.93-7.28 5.89-11.99 14.84-12.93 24.55-1.87 19.33 11.28 36.73 29.31 38.79z"/>
        <path fill="#F5C518" stroke="#B8860B" stroke-width="30" stroke-linejoin="round"
          d="m790.01 496.53c-4.48-122.12-63.66-279.98-185.76-357.34-1.35-.86-2.9-1.09-4.35-.81-1.45-.28-3-.04-4.35.81-122.1 77.36-181.28 235.22-185.76 357.34-3.63 98.91.28 193.45 5.7 324.28 1.23 29.74 2.54 61.41 3.86 95.53.05 1.45.64 2.75 1.54 3.75.72 2.27 2.75 4 5.27 4.19 35.48 2.63 69.48 5.12 103.29 6.93 9.51 34.25 9.58 34.3 13.01 35.59.47.18.95.29 1.44.35 20.04 2.89 40.75 4.41 61.36 4.58l.41 23.09c-13.56-5.59-33.36-10.27-48.16-6.43-7.83 2.03-13.65 6.39-16.81 12.62-5.4 10.62-2.76 23.81 6.57 32.82 4.43 4.28 19.85 16.1 46.39 5.69.55 4.82 2.35 9.63 5.26 13.54 4.18 5.63 10.17 8.73 16.69 8.73.77 0 1.55-.04 2.33-.13 6.83-.76 12.27-3.87 15.76-8.99 3.24-4.77 4.22-10.33 4.25-15.21 13.88 5.04 26.36 4.7 35.21-1.17 8.23-5.46 12.39-15.29 11.4-26.93-1.04-12.2-9.06-21.29-22-24.95-13.19-3.73-31.45-1.17-44.91 8.48l-.38-21.21c22.07-.38 43.86-2.32 64.4-5.83 2.38-.41 4.28-2.2 4.83-4.54l6.84-29.14c25.39-1.32 51.66-3.43 79.27-6.55 2.57-.29 4.56-2.17 5.14-4.55.39-.74.65-1.57.7-2.46 9.91-174.88 16.08-298.73 11.55-422.09z"/>
        <path fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round" opacity="0.7"
          d="M600 400 L600 700"/>
      </svg>
    </div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function createTripStopIcon(n) {
  return L.divIcon({
    className: 'trip-stop-icon',
    html: `<div class="trip-stop-marker">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function TripStopMarkers() {
  const { trip } = useTrip();
  if (!trip || !Array.isArray(trip.stops) || trip.stops.length === 0) return null;
  return (
    <>
      {trip.stops.map((stop, i) => (
        <Marker
          key={`trip-stop-${i}`}
          position={[Number(stop.latitude), Number(stop.longitude)]}
          icon={createTripStopIcon(i + 1)}
          interactive={false}
          zIndexOffset={1000}
        />
      ))}
    </>
  );
}

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

// All park boundaries render in CVNP's forest green for a consistent "park" look;
// municipal/county/state keep their own per-row boundary_color. (#396 follow-up)
const PARK_BOUNDARY_COLOR = '#228B22';
const boundaryDisplayColor = (b) =>
  b.boundary_type === 'park' ? PARK_BOUNDARY_COLOR : (b.boundary_color || PARK_BOUNDARY_COLOR);

function LegendSection({ id, title, count, isOpen, onToggle, showActions, onShowAll, onHideAll, children }) {
  const bodyId = `legend-section-${id}`;
  return (
    <div className={`legend-section ${isOpen ? 'open' : ''}`}>
      <div className="legend-section-header">
        <button
          type="button"
          className="legend-section-toggle"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className={`legend-section-chevron ${isOpen ? 'open' : ''}`} aria-hidden="true">&#9654;</span>
          <span className="legend-section-title">{title}</span>
          <span className="legend-section-count">({count})</span>
        </button>
        {showActions && isOpen && (
          <div className="legend-section-actions">
            <button type="button" onClick={onShowAll} title={`Show all ${title}`}>All</button>
            <button type="button" onClick={onHideAll} title={`Hide all ${title}`}>None</button>
          </div>
        )}
      </div>
      <div id={bodyId} className="legend-section-body" hidden={!isOpen}>
        {children}
      </div>
    </div>
  );
}

function Legend({
  showTrails, onToggleTrails,
  showRivers, onToggleRivers,
  showWaterTaxis, onToggleWaterTaxis,
  visibleBoundaries, onToggleBoundary,
  onShowBoundaries, onHideBoundaries,
  parkBoundaries = [], municipalBoundaries = [],
  visibleTypes, onToggleType, onShowAll, onHideAll,
  searchQuery, onSearchChange,
  isExpanded, onClose, innerRef,
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
      { id: 'rivers', label: 'Rivers', type: 'layer', isActive: showRivers, onToggle: () => onToggleRivers(!showRivers) },
      { id: 'water-taxis', label: 'Water Taxis', type: 'layer', isActive: showWaterTaxis, onToggle: () => onToggleWaterTaxis(!showWaterTaxis) }
    ];

    return [...poiTypes, ...layerIcons].sort((a, b) => a.label.localeCompare(b.label));
  }, [iconConfig, showTrails, showRivers, showWaterTaxis, onToggleTrails, onToggleRivers, onToggleWaterTaxis]);

  const [openSection, setOpenSection] = useState('poi');
  const toggleSection = (key) => setOpenSection(prev => (prev === key ? null : key));

  const [touchTooltip, setTouchTooltip] = useState(null);
  const touchTimerRef = useRef(null);

  const showTapTooltip = useCallback((e, text) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    setTouchTooltip({ text, x: rect.left + rect.width / 2, y: rect.top });
    touchTimerRef.current = setTimeout(() => setTouchTooltip(null), 2500);
  }, []);

  const renderBoundaryChip = (boundary) => (
    <button
      key={boundary.id}
      className={`boundary-chip ${visibleBoundaries.has(boundary.id) ? 'active' : 'inactive'}`}
      onClick={(e) => { onToggleBoundary(boundary.id); showTapTooltip(e, boundary.name); }}
      title={boundary.name}
    >
      <span
        className="boundary-chip-color"
        style={{ backgroundColor: boundaryDisplayColor(boundary) }}
      />
      <span className="boundary-chip-name">{boundary.name}</span>
    </button>
  );

  return (
    <div ref={innerRef} className={`legend ${isExpanded ? 'legend-expanded' : ''} ${editMode ? 'legend-edit-mode' : ''}`}>
      {isExpanded && onClose && (
        <button className="legend-close-btn" onClick={onClose} aria-label="Close legend">&times;</button>
      )}
      <div className="legend-content">
        <div className="legend-search">
          <input
            type="text"
            className="search-input"
            placeholder="Search by name or activity..."
            value={searchQuery || ''}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <LegendSection
          id="poi"
          title="Points of Interest"
          count={iconTypes.length}
          isOpen={openSection === 'poi'}
          onToggle={() => toggleSection('poi')}
          showActions
          onShowAll={onShowAll}
          onHideAll={onHideAll}
        >
          <div className="legend-icons" role="group" aria-label="Map layer filters">
            {iconTypes.map(type => {
              if (type.type === 'layer') {
                return (
                  <button
                    key={type.id}
                    className={`legend-icon-item ${type.isActive ? 'active' : 'inactive'}`}
                    onClick={(e) => { type.onToggle(); showTapTooltip(e, type.label); }}
                    aria-pressed={type.isActive}
                    title={type.label}
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
                    onClick={(e) => { onToggleType(type.id); showTapTooltip(e, type.label); }}
                    aria-pressed={isActive}
                    title={type.label}
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
        </LegendSection>

        <LegendSection
          id="parks"
          title="Parks"
          count={parkBoundaries.length}
          isOpen={openSection === 'parks'}
          onToggle={() => toggleSection('parks')}
          showActions={parkBoundaries.length > 0}
          onShowAll={() => onShowBoundaries(parkBoundaries.map(b => b.id))}
          onHideAll={() => onHideBoundaries(parkBoundaries.map(b => b.id))}
        >
          <div className="boundary-chips">
            {parkBoundaries.map(renderBoundaryChip)}
          </div>
        </LegendSection>

        <LegendSection
          id="municipal"
          title="Municipal"
          count={municipalBoundaries.length}
          isOpen={openSection === 'municipal'}
          onToggle={() => toggleSection('municipal')}
          showActions={municipalBoundaries.length > 0}
          onShowAll={() => onShowBoundaries(municipalBoundaries.map(b => b.id))}
          onHideAll={() => onHideBoundaries(municipalBoundaries.map(b => b.id))}
        >
          <div className="boundary-chips">
            {municipalBoundaries.map(renderBoundaryChip)}
          </div>
        </LegendSection>

      </div>
      {touchTooltip && createPortal(
        <div className="touch-tooltip" style={{ top: touchTooltip.y - 40, left: touchTooltip.x }}>
          {touchTooltip.text}
        </div>,
        document.body
      )}
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
        return;
      }
      // Water taxi routes are small and easy to miss; fit the map to the route on select.
      if (selectedLinearFeature.poi_roles?.includes('water_taxi')) {
        const b = getGeometryBounds(selectedLinearFeature.geometry);
        if (b) {
          map.invalidateSize();
          map.flyToBounds([[b.south, b.west], [b.north, b.east]], { padding: [60, 60], maxZoom: 16, duration: 0.6 });
        }
      }
    }
  }, [selectedLinearFeature, map, skipFlyRef]);

  return null;
}

// Pan/zoom the map to the active river gauge as the user steps through the
// River Levels carousel (#92). The flyTo is wrapped in _isProgrammaticMove so
// its moveend does NOT recompute visible POIs (see MapBoundsTracker, ~line 603)
// — that cascade is what made the POI carousel reappear on every gauge switch
// when GaugeFocuser was a bare flyTo.
function GaugeFocuser({ activeGauge }) {
  const map = useMap();
  React.useEffect(() => {
    if (!activeGauge || activeGauge.latitude == null || activeGauge.longitude == null) return;
    const targetZoom = Math.max(map.getZoom(), 13);
    map._isProgrammaticMove = true;
    map.flyTo([activeGauge.latitude, activeGauge.longitude], targetZoom, { animate: true, duration: 0.6 });
    const timer = setTimeout(() => { map._isProgrammaticMove = false; }, 700); // 600ms fly + buffer
    return () => clearTimeout(timer);
  }, [activeGauge, map]);
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

function BoundsFitter({ boundsToFit, fitNonce }) {
  const map = useMap();
  const prevBounds = useRef(null);
  const prevNonce = useRef(fitNonce);

  useEffect(() => {
    if (!boundsToFit) return;

    // Re-fit when an explicit user action bumped the nonce (even if the target
    // bounds are unchanged, e.g. re-enabling the same boundary), or when the
    // bounds themselves changed. (#396 follow-up)
    const nonceChanged = fitNonce !== undefined && fitNonce !== prevNonce.current;
    const boundsChanged = JSON.stringify(boundsToFit) !== JSON.stringify(prevBounds.current);
    if (nonceChanged || boundsChanged) {
      const latRange = boundsToFit[1][0] - boundsToFit[0][0];
      const lngRange = boundsToFit[1][1] - boundsToFit[0][1];
      const geoSize = Math.max(latRange, lngRange);

      // Clamp how far we zoom in for a tight cluster / single point so a one-POI
      // type (or a tiny boundary) doesn't slam to max zoom.
      const padding = geoSize >= 0.3 ? [20, 20] : [50, 50];
      let maxZoom;
      if (geoSize >= 0.3) maxZoom = 12;       // large areas
      else if (geoSize < 0.02) maxZoom = 15;  // very small / single point

      map.fitBounds(boundsToFit, { padding, maxZoom });
      prevBounds.current = boundsToFit;
      prevNonce.current = fitNonce;
    }
  }, [boundsToFit, fitNonce, map]);

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

function MapBoundsTracker({ destinations, visibleTypes, getDestinationIconType, onVisiblePoisChange, onMapStateChange, linearFeatures, showTrails, showRivers, showWaterTaxis, visibleBoundaries, searchQuery, iconConfig }) {
  const map = useMap();
  const search = (searchQuery || '').toLowerCase();

  const updateVisiblePois = useCallback(() => {
    try {
      const bounds = map.getBounds();
      if (!bounds || !bounds.isValid()) return;

      const visibleIds = [];

      if (destinations && destinations.length > 0) {
        destinations.forEach(dest => {
          if (!dest.latitude || !dest.longitude) return;

          // While searching, destinations are already title-filtered upstream — count
          // them regardless of category; otherwise honor the category toggles.
          const iconType = getDestinationIconType(dest);
          if (!search && !visibleTypes.has(iconType) && !poiMatchesActivityForTypes(dest, visibleTypes, iconConfig)) {
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
      const includeLinearFeatures = !!search || !isFilteredMode ||
                                    visibleTypes.has('trail') ||
                                    visibleTypes.has('river') ||
                                    visibleTypes.has('water_taxi') ||
                                    visibleTypes.has('boundary') ||
                                    isFilteredMode;

      if (includeLinearFeatures && linearFeatures && linearFeatures.length > 0) {
        linearFeatures.forEach(feature => {
          let isLayerVisible = false;
          if (search) {
            // Title search matches across all linear types, ignoring layer toggles
            isLayerVisible = feature.name?.toLowerCase().includes(search);
          } else if (feature.poi_roles?.includes('trail')) {
            isLayerVisible = showTrails || poiMatchesActivityForTypes(feature, visibleTypes, iconConfig);
          } else if (feature.poi_roles?.includes('river')) {
            isLayerVisible = showRivers;
          } else if (feature.poi_roles?.includes('water_taxi')) {
            isLayerVisible = showWaterTaxis;
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
  }, [map, destinations, visibleTypes, getDestinationIconType, onVisiblePoisChange, onMapStateChange, linearFeatures, showTrails, showRivers, showWaterTaxis, visibleBoundaries, search, iconConfig]);

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
  }, [destinations, linearFeatures, showTrails, showRivers, showWaterTaxis, visibleBoundaries, updateVisiblePois]);

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

function DestinationMarker({ dest, icon, isSelected, isEditMode, onSelect, onDragEnd, _mapMoveCount }) {
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

  // The selected POI has no on-map tooltip (its info is in the sidebar); every
  // other POI still shows its hover tooltip, even while one is selected. (#409)
  const showTooltip = !isSelected;

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

function Map({ destinations, selectedPoi, selectedIsLinear, onSelectPoi, isAdmin, onDestinationUpdate, editMode, activeTab, _onDestinationCreate, previewCoords, onPreviewCoordsChange, newPOI, onStartNewPOI, linearFeatures, visibleTypes, onVisibleTypesChange, onVisiblePoisChange, onMapStateChange, showTrails, onToggleTrails, showRivers, onToggleRivers, showWaterTaxis, onToggleWaterTaxis, visibleBoundaries, onToggleBoundary, onShowBoundaries, onHideBoundaries, searchQuery, onSearchChange, _onNewsRefresh, skipFlyRef, newOrganization, onStartNewOrganization, isDrawingAssociations, addingAssociationsToOrgId, onAddAssociationsFromDrawing, onCancelDrawingAssociations, boundsToFit, fitNonce, onFitBounds, defaultBounds, visiblePoiCount, iconConfig, activeGauge, isLegendExpanded, setIsLegendExpanded, boatPosition }) {
  // Unified selection: one selectedPoi in, one onSelectPoi out (spec 019).
  // `selectedIsLinear` reflects the selection KIND (path), not geometry — a
  // dual-role organization+boundary may be selected as a destination yet still
  // carry geometry, so kind is the correct discriminator (PR #348).
  const selectedDestination = selectedPoi && !selectedIsLinear ? selectedPoi : null;
  const selectedLinearFeature = selectedPoi && selectedIsLinear ? selectedPoi : null;
  const onSelectDestination = onSelectPoi;
  const onSelectLinearFeature = onSelectPoi;
  const navigate = useNavigate();
  // isLegendExpanded + setIsLegendExpanded come from props (lifted to App)
  const legendRef = useRef(null);
  const legendChipRef = useRef(null);

  useEffect(() => {
    if (!isLegendExpanded) return;
    function handlePointerDown(e) {
      if (legendRef.current?.contains(e.target)) return;
      if (legendChipRef.current?.contains(e.target)) return;
      setIsLegendExpanded(false);
    }
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isLegendExpanded, setIsLegendExpanded]);

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

  // River gauges (#92): fetched once; rendered as labeled markers tied to the Rivers layer
  const [riverGauges, setRiverGauges] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/river-gauges')
      .then(res => (res.ok ? res.json() : []))
      .then(data => { if (!cancelled) setRiverGauges(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setRiverGauges([]); });
    return () => { cancelled = true; };
  }, []);

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


  // Pre-compute each icon type's POI bounds once per data load, so toggling a type
  // doesn't re-scan every POI on each click. Stored as [minLat,minLng,maxLat,maxLng].
  // (PR #401 review)
  const typeBoundsById = useMemo(() => {
    const byType = new globalThis.Map();
    const addToBounds = (type, lat, lng) => {
      const cur = byType.get(type);
      if (!cur) {
        byType.set(type, [lat, lng, lat, lng]);
      } else {
        if (lat < cur[0]) cur[0] = lat;
        if (lng < cur[1]) cur[1] = lng;
        if (lat > cur[2]) cur[2] = lat;
        if (lng > cur[3]) cur[3] = lng;
      }
    };
    for (const dest of destinations) {
      if (!dest.latitude || !dest.longitude) continue;
      const t = getDestinationIconType(dest);
      const lat = parseFloat(dest.latitude);
      const lng = parseFloat(dest.longitude);
      addToBounds(t, lat, lng);
      const poiActs = (dest.primary_activities || '').toLowerCase();
      if (poiActs && iconConfig) {
        for (const icon of iconConfig) {
          if (icon.enabled === false || !icon.activity_fallbacks || icon.name === t) continue;
          const fbs = icon.activity_fallbacks.split(',').map(a => a.trim().toLowerCase());
          if (fbs.some(fb => fb && matchesWholeWord(poiActs, fb))) {
            addToBounds(icon.name, lat, lng);
          }
        }
      }
    }
    return byType;
  }, [destinations, getDestinationIconType, iconConfig]);

  // Fit the map to all POIs of the given icon type(s), from cached per-type bounds.
  const fitToTypes = useCallback((typeIds) => {
    if (!onFitBounds) return;
    const typeSet = typeIds instanceof Set ? typeIds : new Set(typeIds);
    let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
    for (const t of typeSet) {
      const b = typeBoundsById.get(t);
      if (!b) continue;
      if (b[0] < minLat) minLat = b[0];
      if (b[1] < minLng) minLng = b[1];
      if (b[2] > maxLat) maxLat = b[2];
      if (b[3] > maxLng) maxLng = b[3];
    }
    if (minLat === Infinity) {
      if (defaultBounds) onFitBounds(defaultBounds);
      return;
    }
    onFitBounds([[minLat, minLng], [maxLat, maxLng]]);
  }, [typeBoundsById, onFitBounds, defaultBounds]);

  const handleToggleType = (typeId) => {
    if (!onVisibleTypesChange) return;
    const willEnable = !visibleTypes.has(typeId);
    onVisibleTypesChange(prev => {
      const newSet = new Set(prev);
      if (newSet.has(typeId)) newSet.delete(typeId); else newSet.add(typeId);
      return newSet;
    });
    // Enabling a type: zoom to fit all POIs of that type. Disabling the last visible
    // type: zoom back to the default view. (#396 follow-up)
    if (willEnable) {
      fitToTypes([typeId]);
    } else if (visibleTypes.size === 1 && visibleTypes.has(typeId) && onFitBounds && defaultBounds) {
      onFitBounds(defaultBounds);
    }
  };

  // Fit the map to all water taxi routes (their geometry sits in the Flats).
  const fitToWaterTaxis = useCallback(() => {
    if (!onFitBounds || !linearFeatures) return;
    let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
    for (const f of linearFeatures) {
      if (!f.poi_roles?.includes('water_taxi') || !f.geometry) continue;
      const b = getGeometryBounds(f.geometry);
      if (!b) continue;
      if (b.south < minLat) minLat = b.south;
      if (b.west < minLng) minLng = b.west;
      if (b.north > maxLat) maxLat = b.north;
      if (b.east > maxLng) maxLng = b.east;
    }
    if (minLat === Infinity) {
      if (defaultBounds) onFitBounds(defaultBounds);
      return;
    }
    onFitBounds([[minLat, minLng], [maxLat, maxLng]]);
  }, [linearFeatures, onFitBounds, defaultBounds]);

  // Toggling the Water Taxis layer on zooms to its routes, matching POI-type behavior.
  const handleToggleWaterTaxis = (next) => {
    onToggleWaterTaxis(next);
    if (next) fitToWaterTaxis();
  };

  const handleShowAll = () => {
    if (onVisibleTypesChange) onVisibleTypesChange(new Set(allIconTypes));
    onToggleTrails(true);
    onToggleRivers(true);
    onToggleWaterTaxis(true);
    fitToTypes(allIconTypes); // fit to every POI now shown
  };

  const handleHideAll = () => {
    if (onVisibleTypesChange) onVisibleTypesChange(new Set());
    onToggleTrails(false);
    onToggleRivers(false);
    onToggleWaterTaxis(false);
    if (onFitBounds && defaultBounds) onFitBounds(defaultBounds);
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

    if (feature.poi_roles?.includes('river')) {
      return {
        weight: isSelected ? 3 : 2,  // Thinner than base: 2 normal, 3 selected
        opacity: isSelected ? 1 : 0.8,
        color: isSelected ? (editMode ? editSelectedColor : viewSelectedColor) : '#1E90FF'
      };
    } else if (feature.poi_roles?.includes('water_taxi')) {
      return {
        weight: isSelected ? 4 : 3,
        opacity: isSelected ? 1 : 0.85,
        dashArray: '10, 8',
        color: isSelected ? (editMode ? editSelectedColor : viewSelectedColor) : '#0E9E9E'
      };
    } else if (feature.poi_roles?.includes('boundary')) {
      const boundaryColor = boundaryDisplayColor(feature);
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
            attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community | Amenity data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        ) : (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        )}


        {/* River gauge markers (#92) — shown with the Rivers layer, or while the
            River Levels carousel is open so its highlighted gauge is visible */}
        {(showRivers || activeGauge || searchQuery) && riverGauges.map(gauge => {
          if (gauge.latitude == null || gauge.longitude == null) return null;
          // When a title search is active, only show gauges on the matching river
          if (searchQuery && !(gauge.river_name || '').toLowerCase().includes(searchQuery.toLowerCase())) return null;
          const cfs = gauge.latest?.discharge_cfs;
          const ft = gauge.latest?.gage_height_ft;
          const label = cfs != null
            ? `${Number(cfs).toLocaleString(undefined, { maximumFractionDigits: 0 })} cfs`
            : (ft != null ? `${ft} ft` : '—');
          const isActive = activeGauge?.id === gauge.id;
          return (
            <Marker
              key={`gauge-${gauge.id}-${isActive}`}
              position={[gauge.latitude, gauge.longitude]}
              icon={createGaugeIcon(label, isActive)}
              zIndexOffset={isActive ? 1000 : 0}
              eventHandlers={{
                click: () => {
                  const slug = generateSlug(gauge.river_name || '');
                  if (slug) navigate(`/${slug}/river_levels?gauge=${gauge.id}`);
                }
              }}
            >
              {!activeGauge && (
                <Tooltip direction="top" offset={[0, -8]}>
                  <strong>{gauge.name || gauge.usgs_site_id}</strong>
                  <br />{label}{cfs != null && ft != null ? ` • ${ft} ft` : ''}
                </Tooltip>
              )}
            </Marker>
          );
        })}

        {linearFeatures && linearFeatures.map(feature => {
          // A title search matches across all types — show a matching linear feature
          // regardless of its layer toggle, and hide non-matches.
          const isVisible = searchQuery
            ? feature.name?.toLowerCase().includes(searchQuery.toLowerCase())
            : ((feature.poi_roles?.includes('trail') && (showTrails || poiMatchesActivityForTypes(feature, visibleTypes, iconConfig))) ||
               (feature.poi_roles?.includes('river') && showRivers) ||
               (feature.poi_roles?.includes('water_taxi') && showWaterTaxis) ||
               (feature.poi_roles?.includes('boundary') && visibleBoundaries.has(feature.id)));
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
                    weight: 24,
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
                      // Fix: glow the visible edge on hover via a CSS class instead of
                      // shrinking the hit stroke. Shrinking it moved the cursor out of
                      // the stroke (mouseout→mouseover loop) — the #409 flicker. The hit
                      // width now stays constant (and is a touch wider for easier hover).
                      layer.on('mouseover', () => {
                        document.querySelector(`.lf-vis-${feature.id}`)?.classList.add('map-hover');
                      });
                      layer.on('mouseout', () => {
                        document.querySelector(`.lf-vis-${feature.id}`)?.classList.remove('map-hover');
                      });
                    }

                    layer.on('click', (e) => {
                      L.DomEvent.stopPropagation(e);
                      handleLinearFeatureClick(feature);
                    });

                    // The SELECTED feature has no on-map tooltip (its info is in the
                    // sidebar); every other feature still shows its hover tooltip, even
                    // while one is selected, so the user can explore others. (#409)
                    if (!isSelected) {
                      const hasImage = feature.has_primary_image;
                      const imageUrl = hasImage ? `/api/pois/${feature.id}/thumbnail?size=medium` : null;

                      let tooltipHtml = '<div class="tooltip-content">';
                      if (hasImage) {
                        tooltipHtml += `<div class="tooltip-thumbnail"><img src="${imageUrl}" alt="" onerror="this.style.display='none';this.parentElement.style.display='none'" /></div>`;
                      }
                      tooltipHtml += `<strong>${escapeHtml(feature.name)}</strong>`;
                      if (feature.brief_description) {
                        tooltipHtml += `<p>${escapeHtml(feature.brief_description)}</p>`;
                      }
                      tooltipHtml += '</div>';

                      layer.bindTooltip(tooltipHtml, {
                        permanent: false,
                        direction: 'auto',
                        offset: [0, 0],
                        sticky: true,
                        className: 'destination-tooltip'
                      });

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
                        el.classList.add(`lf-vis-${feature.id}`); // hover-glow hook (#409)
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
                  weight: 24,
                  opacity: 1
                })}
                onEachFeature={(geoFeature, layer) => {
                  layer.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    handleLinearFeatureClick(feature);
                  });

                  if (!isSelected) {
                    // Fix: glow the visible line on hover via a CSS class instead of
                    // shrinking the hit stroke. Shrinking it moved the cursor out of
                    // the stroke (mouseout→mouseover loop) — the #409 flicker. The hit
                    // width now stays constant (and is a touch wider for easier hover).
                    layer.on('mouseover', () => {
                      document.querySelector(`.lf-vis-${feature.id}`)?.classList.add('map-hover');
                    });
                    layer.on('mouseout', () => {
                      document.querySelector(`.lf-vis-${feature.id}`)?.classList.remove('map-hover');
                    });
                  }

                  // The SELECTED feature has no on-map tooltip (its info is in the
                  // sidebar); every other feature still shows its hover tooltip, even
                  // while one is selected, so the user can explore others. (#409)
                  if (!isSelected) {
                    const hasImage = feature.has_primary_image;
                    const imageUrl = hasImage ? `/api/pois/${feature.id}/thumbnail?size=medium` : null;

                    let tooltipHtml = '<div class="tooltip-content">';
                    if (hasImage) {
                      tooltipHtml += `<div class="tooltip-thumbnail"><img src="${imageUrl}" alt="" onerror="this.style.display='none';this.parentElement.style.display='none'" /></div>`;
                    }
                    tooltipHtml += `<strong>${escapeHtml(feature.name)}</strong>`;
                    if (feature.brief_description) {
                      tooltipHtml += `<p>${escapeHtml(feature.brief_description)}</p>`;
                    }
                    if (feature.length_miles) {
                      tooltipHtml += `<p class="trail-info">${escapeHtml(feature.length_miles)} miles${feature.difficulty ? ' • ' + escapeHtml(feature.difficulty) : ''}</p>`;
                    }
                    tooltipHtml += '</div>';

                    layer.bindTooltip(tooltipHtml, {
                      permanent: false,
                      direction: 'auto',
                      offset: [0, 0],
                      sticky: true,
                      className: 'destination-tooltip'
                    });

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
                      el.classList.add(`lf-vis-${feature.id}`); // hover-glow hook (#409)
                    }
                  });
                }}
              />
            </React.Fragment>
          );
        })}

        {linearFeatures && linearFeatures.map(feature => {
          if (!feature.poi_roles?.includes('water_taxi') || !Array.isArray(feature.stops)) return null;
          const stopsVisible = searchQuery
            ? feature.name?.toLowerCase().includes(searchQuery.toLowerCase())
            : showWaterTaxis;
          if (!stopsVisible) return null;
          return feature.stops.map((stop, i) => (
            <CircleMarker
              key={`wt-stop-${feature.id}-${i}`}
              center={[stop.lat, stop.lng]}
              radius={5}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#0E9E9E', fillOpacity: 1 }}
            >
              <Tooltip direction="top" offset={[0, -4]}>{stop.name}</Tooltip>
            </CircleMarker>
          ));
        })}

        {showWaterTaxis && boatPosition && (
          <Marker
            position={[boatPosition.latitude, boatPosition.longitude]}
            icon={createBoatIcon(boatPosition.heading, boatPosition.status)}
            zIndexOffset={500}
            keyboard={false}
          >
            <Tooltip direction="top" offset={[0, -14]}>
              {boatPosition.status === 'docked' ? 'Harbor Hopper (Docked)' : 'Harbor Hopper (Live)'}
            </Tooltip>
          </Marker>
        )}

        <MapUpdater selectedDestination={selectedDestination} selectedLinearFeature={selectedLinearFeature} skipFlyRef={skipFlyRef} />
        <GaugeFocuser activeGauge={activeGauge} />
        <MapVisibilityHandler activeTab={activeTab} />
        <BoundsFitter boundsToFit={boundsToFit} fitNonce={fitNonce} />
        <MapBoundsTracker
          destinations={destinations}
          visibleTypes={visibleTypes}
          getDestinationIconType={getDestinationIconType}
          onVisiblePoisChange={handleVisiblePoisChange}
          onMapStateChange={onMapStateChange}
          linearFeatures={linearFeatures}
          showTrails={showTrails}
          showRivers={showRivers}
          showWaterTaxis={showWaterTaxis}
          visibleBoundaries={visibleBoundaries}
          searchQuery={searchQuery}
          iconConfig={iconConfig}
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
          />
        )}

        {iconConfig.length > 0 && destinations.map((dest) => {
          if (!dest.latitude || !dest.longitude) return null;

          // When a title search is active, App has already narrowed destinations to
          // name matches — show them regardless of the category toggles.
          const iconType = getDestinationIconType(dest);
          if (!searchQuery && !visibleTypes.has(iconType) && !poiMatchesActivityForTypes(dest, visibleTypes, iconConfig)) return null;

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
        <TripStopMarkers />
      </MapContainer>

      <button
        ref={legendChipRef}
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

      <Legend
        showTrails={showTrails}
        onToggleTrails={onToggleTrails}
        showRivers={showRivers}
        onToggleRivers={onToggleRivers}
        showWaterTaxis={showWaterTaxis}
        onToggleWaterTaxis={handleToggleWaterTaxis}
        visibleBoundaries={visibleBoundaries}
        onToggleBoundary={onToggleBoundary}
        onShowBoundaries={onShowBoundaries}
        onHideBoundaries={onHideBoundaries}
        parkBoundaries={linearFeatures.filter(f => f.poi_roles?.includes('boundary') && f.boundary_type === 'park')}
        municipalBoundaries={linearFeatures.filter(f => f.poi_roles?.includes('boundary') && ['municipal','city','township','village','county','state'].includes(f.boundary_type))}
        visibleTypes={visibleTypes}
        onToggleType={handleToggleType}
        onShowAll={handleShowAll}
        onHideAll={handleHideAll}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        isExpanded={isLegendExpanded}
        onClose={() => setIsLegendExpanded(false)}
        innerRef={legendRef}
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
