import React, { useMemo } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { trailLabelPosition } from '../utils/trailLabel';

// A trail's `name` printed on the map at the midpoint of its GeoJSON `geometry`.
// The caller decides whether to show it (see showsTrailLabel).
// Memoized: the map re-renders on every tracker animation frame, and a new
// divIcon on each render would rebuild the label's DOM.
const TrailNameLabel = React.memo(function TrailNameLabel({ name, geometry }) {
  const position = useMemo(() => trailLabelPosition(geometry), [geometry]);
  const icon = useMemo(() => {
    const html = document.createElement('span');
    html.textContent = name;
    return L.divIcon({ className: 'trail-name-label', html, iconSize: null });
  }, [name]);
  if (!position) return null;
  return <Marker position={position} icon={icon} interactive={false} keyboard={false} zIndexOffset={-1000} />;
});

export default TrailNameLabel;
