import React, { useEffect, useState, useRef, memo } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';

// Park center for default view
const PARK_CENTER = [41.26, -81.55];
const DEFAULT_BOUNDS = [[41.1, -81.7], [41.4, -81.4]];

// Component to fix map size and sync bounds
function MapBoundsSync({ bounds }) {
  const map = useMap();
  const prevBoundsRef = useRef(null);

  useEffect(() => {
    // Check if bounds coordinates actually changed
    const boundsChanged = !prevBoundsRef.current || !bounds ||
      bounds[0][0] !== prevBoundsRef.current[0][0] ||
      bounds[0][1] !== prevBoundsRef.current[0][1] ||
      bounds[1][0] !== prevBoundsRef.current[1][0] ||
      bounds[1][1] !== prevBoundsRef.current[1][1];

    if (!boundsChanged) {
      console.log('[MapThumbnail MapBoundsSync] Bounds unchanged - skipping fitBounds');
      return;
    }

    console.log('[MapThumbnail MapBoundsSync] Bounds changed! Fitting to bounds SW:', bounds?.[0], 'NE:', bounds?.[1]);
    prevBoundsRef.current = bounds;

    try {
      // Force size recalculation
      if (map && map.getContainer()) {
        map.invalidateSize();

        // Fit to bounds if provided
        if (bounds && bounds.length === 2) {
          map.fitBounds(bounds, { animate: false, padding: [0, 0] });
        }
      }
    } catch (e) {
      // Map not ready, will retry on next update
      console.log('[MapThumbnail MapBoundsSync] Error:', e);
    }
  }, [map, bounds]);

  // Use IntersectionObserver to detect when map becomes visible
  useEffect(() => {
    console.log('[MapThumbnail IntersectionObserver] Setting up observer');
    if (!map) return;

    const container = map.getContainer();
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          console.log('[MapThumbnail IntersectionObserver] Entry:', entry.isIntersecting);
          if (entry.isIntersecting) {
            setTimeout(() => {
              try {
                if (map && map.getContainer()) {
                  console.log('[MapThumbnail IntersectionObserver] Invalidating size only (MapBoundsSync handles fitBounds)');
                  map.invalidateSize();
                  // Don't call fitBounds here - MapBoundsSync effect already handles it
                  // This was causing double-drawing (MapBoundsSync + IntersectionObserver 50ms later)
                }
              } catch (e) {
                // Map not ready, ignore
                console.log('[MapThumbnail IntersectionObserver] Error:', e);
              }
            }, 50);
          }
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [map, bounds]);

  return null;
}

/**
 * MapThumbnail - A small, non-interactive map preview showing the current viewport
 * Used in News and Events tabs to show which area is being filtered
 */
function MapThumbnail({
  bounds = DEFAULT_BOUNDS,
  aspectRatio = 1.5,
  visibleDestinations = [],
  onClick,
  poiCount = 0
}) {
  const [isReady, setIsReady] = useState(false);
  const containerRef = useRef(null);

  // Delay map render until container is mounted
  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Calculate thumbnail dimensions based on aspect ratio
  // Max width of 200px, height adjusts to match aspect ratio
  const maxWidth = 200;
  const width = maxWidth;
  const height = Math.round(maxWidth / aspectRatio);

  // Calculate center from bounds for initial render
  const center = bounds && bounds.length === 2
    ? [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2]
    : PARK_CENTER;

  return (
    <div
      className="map-thumbnail-container"
      onClick={onClick}
      ref={containerRef}
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {isReady && (
        <MapContainer
          center={center}
          zoom={11}
          scrollWheelZoom={false}
          dragging={false}
          zoomControl={false}
          doubleClickZoom={false}
          touchZoom={false}
          keyboard={false}
          boxZoom={false}
          attributionControl={false}
          style={{ height: '100%', width: '100%' }}
        >
          <MapBoundsSync bounds={bounds} />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Small dots for visible POIs */}
          {visibleDestinations.map(dest => {
            if (!dest.latitude || !dest.longitude) return null;
            return (
              <CircleMarker
                key={`poi-${dest.id}`}
                center={[parseFloat(dest.latitude), parseFloat(dest.longitude)]}
                radius={3}
                pathOptions={{
                  color: '#2d5016',
                  fillColor: '#4a7c23',
                  fillOpacity: 0.8,
                  weight: 1
                }}
              />
            );
          })}
        </MapContainer>
      )}

      {/* Results count chip - same style as main map */}
      <div className="map-thumbnail-poi-count">
        {poiCount} Result{poiCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

// Custom comparison function - only re-render if bounds coordinates actually changed
function arePropsEqual(prevProps, nextProps) {
  // Check if bounds coordinates are the same
  const prevBounds = prevProps.bounds;
  const nextBounds = nextProps.bounds;

  const boundsEqual = prevBounds && nextBounds &&
    prevBounds[0][0] === nextBounds[0][0] &&
    prevBounds[0][1] === nextBounds[0][1] &&
    prevBounds[1][0] === nextBounds[1][0] &&
    prevBounds[1][1] === nextBounds[1][1];

  // Check other props
  const aspectRatioEqual = prevProps.aspectRatio === nextProps.aspectRatio;
  const poiCountEqual = prevProps.poiCount === nextProps.poiCount;
  const onClickEqual = prevProps.onClick === nextProps.onClick;

  // Check visibleDestinations length (good enough for most cases)
  const destinationsEqual = prevProps.visibleDestinations?.length === nextProps.visibleDestinations?.length;

  const shouldSkipRender = boundsEqual && aspectRatioEqual && poiCountEqual && onClickEqual && destinationsEqual;

  if (!shouldSkipRender) {
    console.log('[MapThumbnail memo] Re-rendering - boundsEqual:', boundsEqual, 'aspectRatioEqual:', aspectRatioEqual, 'poiCountEqual:', poiCountEqual, 'destinationsEqual:', destinationsEqual);
  } else {
    console.log('[MapThumbnail memo] Skipping re-render - all props equal');
  }

  return shouldSkipRender;
}

export default memo(MapThumbnail, arePropsEqual);
