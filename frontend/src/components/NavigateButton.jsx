import React from 'react';

function isValidStop(s) {
  if (!s || typeof s !== 'object') return false;
  const { lat, lng } = s;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  return true;
}

export function buildGoogleMapsUrl(stops) {
  if (!Array.isArray(stops)) return null;
  const valid = stops.filter(isValidStop);
  if (valid.length === 0) return null;

  const fmt = ({ lat, lng }) => `${lat},${lng}`;
  const base = 'https://www.google.com/maps/dir/?api=1';

  // Omit &origin= so Google Maps starts from the user's current location.
  // The last stop is the destination; everything before it is a waypoint.
  // Google Maps URL spec supports up to 9 waypoints.
  const destination = valid[valid.length - 1];
  const waypoints = valid.slice(0, -1);

  let url = `${base}&destination=${encodeURIComponent(fmt(destination))}`;
  if (waypoints.length > 0) {
    url += `&waypoints=${encodeURIComponent(waypoints.map(fmt).join('|'))}`;
  }
  return url;
}

export default function NavigateButton({ stops, label = 'Navigate', className = 'share-badge-btn', title = 'Open in Google Maps' }) {
  const url = buildGoogleMapsUrl(stops);
  if (!url) return null;

  const handleClick = (e) => {
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <button className={className} onClick={handleClick} title={title}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M21.71 11.29l-9-9a1 1 0 0 0-1.41 0l-9 9a1 1 0 0 0 0 1.41l9 9a1 1 0 0 0 1.41 0l9-9a1 1 0 0 0 0-1.41zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5L17.5 11 14 14.5z"
        />
      </svg>
      {label}
    </button>
  );
}
