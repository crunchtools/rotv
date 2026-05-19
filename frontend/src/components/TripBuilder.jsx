import React, { useState, useEffect } from 'react';
import { useTrip } from '../hooks/useTrip';
import { useAuth } from '../hooks/useAuth';
import { buildGoogleMapsUrl } from './NavigateButton';
import './TripBuilder.css';

function stopDisplayName(stop, index) {
  return stop.label || stop.poi_name || `Stop ${index + 1}`;
}

export default function TripBuilder({ onOpenMyTrips }) {
  const {
    trip, showBuilder, setShowBuilder,
    removeStop, moveStop, clear,
    setName, setIsPublic, setIsFeatured, saveTrip,
    MAX_STOPS
  } = useTrip();
  const { isAuthenticated, isAdmin } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (trip.stops.length === 0) setConfirmClear(false);
  }, [trip.stops.length]);

  if (trip.stops.length === 0) return null;

  const expanded = !!showBuilder;
  const googleMapsUrl = buildGoogleMapsUrl(
    trip.stops.map(s => ({ lat: Number(s.latitude), lng: Number(s.longitude) }))
  );
  const atLimit = trip.stops.length >= MAX_STOPS;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveTrip();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    clear();
    setConfirmClear(false);
  };

  const handleClose = () => {
    if (trip.id) {
      clear();
      return;
    }
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    clear();
    setConfirmClear(false);
  };

  return (
    <div className="trip-builder" role="region" aria-label="Trip Builder">
      <div className="trip-builder-handle">
        <button
          type="button"
          className="trip-builder-toggle"
          onClick={() => setShowBuilder(!expanded)}
          aria-label={expanded ? 'Collapse trip builder' : 'Expand trip builder'}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▴'}
        </button>
        <span
          className="trip-builder-handle-summary"
          onClick={() => setShowBuilder(!expanded)}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowBuilder(!expanded);
            }
          }}
        >
          {trip.name || 'Untitled Trip'} · {trip.stops.length} stop{trip.stops.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className={`trip-builder-close${confirmClear ? ' confirming' : ''}`}
          onClick={handleClose}
          aria-label={confirmClear ? 'Tap again to discard trip' : 'Close trip'}
          title={confirmClear ? 'Tap again to discard' : (trip.id ? 'Close' : 'Discard trip')}
        >
          {confirmClear ? 'Discard?' : '×'}
        </button>
      </div>

      {expanded && (
        <div className="trip-builder-body">
          <input
            type="text"
            className="trip-name-input"
            placeholder="Untitled Trip"
            value={trip.name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />

          <ol className="trip-stops-list">
            {trip.stops.map((stop, i) => (
              <li key={`${i}:${stop.poi_id || stop.latitude}`} className="trip-stop-row">
                <span className="trip-stop-position">{i + 1}</span>
                <span className="trip-stop-label">{stopDisplayName(stop, i)}</span>
                <div className="trip-stop-actions">
                  <button
                    type="button"
                    className="trip-stop-action-btn"
                    onClick={() => moveStop(i, i - 1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    title="Move up"
                  >▲</button>
                  <button
                    type="button"
                    className="trip-stop-action-btn"
                    onClick={() => moveStop(i, i + 1)}
                    disabled={i === trip.stops.length - 1}
                    aria-label="Move down"
                    title="Move down"
                  >▼</button>
                  <button
                    type="button"
                    className="trip-stop-remove-btn"
                    onClick={() => removeStop(i)}
                    aria-label="Remove stop"
                    title="Remove stop"
                  >×</button>
                </div>
              </li>
            ))}
          </ol>

          <p className="trip-builder-limit-hint">
            {trip.stops.length} of {MAX_STOPS} stops · Starts from your current location in Google Maps.
            {atLimit && ' Trip is full.'}
          </p>

          {saveError && (
            <div className="trip-builder-warning" role="alert">{saveError}</div>
          )}

          <div className="trip-builder-actions-primary">
            <a
              href={googleMapsUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className={`primary${googleMapsUrl ? '' : ' disabled'}`}
              onClick={(e) => { if (!googleMapsUrl) e.preventDefault(); }}
              aria-disabled={!googleMapsUrl}
            >
              Navigate
            </a>
            <button
              type="button"
              className="primary"
              onClick={handleSave}
              disabled={!isAuthenticated || saving}
              title={isAuthenticated ? '' : 'Sign in to save this trip'}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="primary"
              onClick={onOpenMyTrips}
            >
              My Trips
            </button>
          </div>

          {(isAuthenticated || isAdmin) && (
            <div className="trip-builder-toggles">
              {isAuthenticated && (
                <label className="trip-builder-checkbox">
                  <input
                    type="checkbox"
                    checked={trip.is_public}
                    onChange={(e) => setIsPublic(e.target.checked)}
                  />
                  Public
                </label>
              )}
              {isAdmin && (
                <label className="trip-builder-checkbox">
                  <input
                    type="checkbox"
                    checked={trip.is_featured}
                    onChange={(e) => setIsFeatured(e.target.checked)}
                  />
                  Featured
                </label>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
