import React, { useState, useEffect } from 'react';
import { useTrip } from '../hooks/useTrip';
import { useAuth } from '../hooks/useAuth';
import { buildGoogleMapsUrl } from './NavigateButton';
import './TripBuilder.css';

const CHEVRON_UP = 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z';
const CHEVRON_DOWN = 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z';
const TRASH = 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';
const DIRECTIONS = 'M21.71 11.29l-9-9a1 1 0 0 0-1.41 0l-9 9a1 1 0 0 0 0 1.41l9 9a1 1 0 0 0 1.41 0l9-9a1 1 0 0 0 0-1.41zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5L17.5 11 14 14.5z';

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

  // A saved trip closes at once; an unsaved one is lost, so it takes a second tap
  const handleDiscard = () => {
    if (!trip.id && !confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    clear();
    setConfirmClear(false);
  };

  const summary = `${trip.name || 'Untitled Trip'} · ${trip.stops.length} stop${trip.stops.length === 1 ? '' : 's'}`;

  return (
    <div className={`trip-builder${expanded ? ' open' : ''}`} role="region" aria-label="Trip Builder">
      <div className="trip-builder-handle">
        <button
          type="button"
          className="trip-builder-toggle"
          onClick={() => setShowBuilder(!expanded)}
          aria-expanded={expanded}
          title={expanded ? 'Hide trip' : 'Show trip'}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d={expanded ? CHEVRON_DOWN : CHEVRON_UP} />
          </svg>
          <span className="trip-builder-handle-summary">{summary}</span>
        </button>
        {!expanded && googleMapsUrl && (
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="poi-action poi-action--primary"
            title="Open the trip in Google Maps"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d={DIRECTIONS} />
            </svg>
            Navigate
          </a>
        )}
      </div>

      {expanded && (
        <div className="trip-builder-body">
          <input
            type="text"
            className="trip-name-input"
            placeholder="Untitled Trip"
            aria-label="Trip name"
            value={trip.name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />

          <ol className="trip-stops-list">
            {trip.stops.map((stop, i) => (
              <li key={`${i}:${stop.poi_id || stop.latitude}`} className="trip-stop-row">
                <span className="trip-stop-position">{i + 1}</span>
                <span className="trip-stop-label">{stop.label || stop.poi_name || `Stop ${i + 1}`}</span>
                <div className="trip-stop-actions">
                  <button
                    type="button"
                    className="trip-stop-action-btn"
                    onClick={() => moveStop(i, i - 1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    title="Move up"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                      <path fill="currentColor" d={CHEVRON_UP} />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="trip-stop-action-btn"
                    onClick={() => moveStop(i, i + 1)}
                    disabled={i === trip.stops.length - 1}
                    aria-label="Move down"
                    title="Move down"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                      <path fill="currentColor" d={CHEVRON_DOWN} />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="trip-stop-action-btn trip-stop-remove-btn"
                    onClick={() => removeStop(i)}
                    aria-label="Remove stop"
                    title="Remove stop"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path fill="currentColor" d={TRASH} />
                    </svg>
                  </button>
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
              className={`poi-action poi-action--primary${googleMapsUrl ? '' : ' disabled'}`}
              onClick={(e) => { if (!googleMapsUrl) e.preventDefault(); }}
              aria-disabled={!googleMapsUrl}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d={DIRECTIONS} />
              </svg>
              Navigate
            </a>
            <button
              type="button"
              className="poi-action"
              onClick={handleSave}
              disabled={saving}
              title={isAuthenticated ? '' : 'Saved to this browser until you sign in'}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="poi-action"
              onClick={onOpenMyTrips}
            >
              My trips
            </button>
          </div>

          <div className="trip-builder-footer">
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
            <button
              type="button"
              className={`link-button trip-builder-discard${confirmClear ? ' confirming' : ''}`}
              onClick={handleDiscard}
            >
              {trip.id ? 'Close trip' : confirmClear ? 'Tap again to discard' : 'Discard trip'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
