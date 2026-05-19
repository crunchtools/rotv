import React from 'react';
import { useTrip } from '../hooks/useTrip';

export default function AddToTripButton({ poi, stops, className = 'share-badge-btn add-to-trip-btn' }) {
  const { trip, addStop, removeStopByPoi, hasStop, MAX_STOPS } = useTrip();

  if (!Array.isArray(stops) || stops.length === 0) return null;
  const primary = stops[0];
  if (!primary || typeof primary.lat !== 'number' || typeof primary.lng !== 'number') return null;

  const poiId = poi && poi.id ? poi.id : null;
  const inTrip = poiId ? hasStop(poiId) : false;
  const atLimit = trip.stops.length >= MAX_STOPS;

  const handleClick = (e) => {
    e.stopPropagation();
    if (inTrip && poiId) {
      removeStopByPoi(poiId);
      return;
    }
    if (atLimit) return;
    addStop({
      poi_id: poiId,
      label: poi && poi.name ? poi.name : null,
      latitude: primary.lat,
      longitude: primary.lng
    });
  };

  if (!inTrip && atLimit) {
    return (
      <button className={className} disabled title={`Trip is at the ${MAX_STOPS}-stop maximum`}>
        Trip full
      </button>
    );
  }

  return (
    <button
      className={className}
      onClick={handleClick}
      title={inTrip ? 'Remove from trip' : 'Add this stop to your day-trip'}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        {inTrip ? (
          <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        ) : (
          <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />
        )}
      </svg>
      {inTrip ? 'In Trip' : 'Add to Trip'}
    </button>
  );
}
