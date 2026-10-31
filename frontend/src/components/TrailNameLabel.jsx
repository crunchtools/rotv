import React, { useMemo } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { trailLabelPosition } from '../utils/trailLabel';

export const TRAIL_LABEL_MIN_ZOOM = 16; // close enough that trail names don't crowd each other

// Memoized: the map re-renders on every tracker animation frame, and a new
// divIcon on each render would rebuild the label's DOM.
const TrailNameLabel = React.memo(function TrailNameLabel({ feature, zoom }) {
  const { name, geometry, poi_roles: roles } = feature;
  const position = useMemo(() => trailLabelPosition(geometry), [geometry]);
  const icon = useMemo(() => {
    const html = document.createElement('span');
    html.textContent = name;
    return L.divIcon({ className: 'trail-name-label', html, iconSize: null });
  }, [name]);
  if (!position || !roles?.includes('trail') || zoom < TRAIL_LABEL_MIN_ZOOM) return null;
  return <Marker position={position} icon={icon} interactive={false} keyboard={false} zIndexOffset={-1000} />;
});

export default TrailNameLabel;
