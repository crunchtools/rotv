import React, { useEffect, useState, useRef, memo } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';

const PARK_CENTER = [41.26, -81.55];
const DEFAULT_BOUNDS = [[41.1, -81.7], [41.4, -81.4]];

function MapBoundsSync({ bounds }) {
  const map = useMap();
  const prevBoundsRef = useRef(null);

  useEffect(() => {
    const boundsChanged = !prevBoundsRef.current || !bounds ||
      bounds[0][0] !== prevBoundsRef.current[0][0] ||
      bounds[0][1] !== prevBoundsRef.current[0][1] ||
      bounds[1][0] !== prevBoundsRef.current[1][0] ||
      bounds[1][1] !== prevBoundsRef.current[1][1];

    if (!boundsChanged) {
      return;
    }

    prevBoundsRef.current = bounds;

    try {
      if (map && map.getContainer()) {
        map.invalidateSize();

        if (bounds && bounds.length === 2) {
          map.fitBounds(bounds, { animate: false, padding: [0, 0] });
        }
      }
    } catch {
      void 0;
    }
  }, [map, bounds]);

  useEffect(() => {
    if (!map) return;

    const container = map.getContainer();
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setTimeout(() => {
              try {
                if (map && map.getContainer()) {
                  map.invalidateSize();
                }
              } catch {
                void 0;
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

function MapThumbnail({
  bounds = DEFAULT_BOUNDS,
  aspectRatio = 1.5,
  visibleDestinations = [],
  onClick,
  poiCount = 0
}) {
  const [isReady, setIsReady] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const maxWidth = 200;
  const width = maxWidth;
  const height = Math.round(maxWidth / aspectRatio);

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

      <div className="map-thumbnail-poi-count">
        {poiCount} Result{poiCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

function arePropsEqual(prevProps, nextProps) {
  const prevBounds = prevProps.bounds;
  const nextBounds = nextProps.bounds;

  const boundsEqual = prevBounds && nextBounds &&
    prevBounds[0][0] === nextBounds[0][0] &&
    prevBounds[0][1] === nextBounds[0][1] &&
    prevBounds[1][0] === nextBounds[1][0] &&
    prevBounds[1][1] === nextBounds[1][1];

  const aspectRatioEqual = prevProps.aspectRatio === nextProps.aspectRatio;
  const poiCountEqual = prevProps.poiCount === nextProps.poiCount;
  const onClickEqual = prevProps.onClick === nextProps.onClick;

  const destinationsEqual = prevProps.visibleDestinations?.length === nextProps.visibleDestinations?.length;

  const shouldSkipRender = boundsEqual && aspectRatioEqual && poiCountEqual && onClickEqual && destinationsEqual;

  return shouldSkipRender;
}

export default memo(MapThumbnail, arePropsEqual);
