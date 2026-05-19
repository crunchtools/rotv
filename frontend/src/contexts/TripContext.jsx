import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';

export const TripContext = createContext(null);

const STORAGE_KEY = 'rotv.tripInProgress.v1';
export const MAX_STOPS = 9;

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyTrip();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.stops)) return emptyTrip();
    return {
      id: parsed.id || null,
      slug: parsed.slug || null,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
      is_public: !!parsed.is_public,
      is_featured: !!parsed.is_featured,
      stops: parsed.stops.filter(isValidStop)
    };
  } catch {
    return emptyTrip();
  }
}

function emptyTrip() {
  return { id: null, slug: null, name: '', description: '', is_public: false, is_featured: false, stops: [] };
}

function isValidStop(s) {
  if (!s || typeof s !== 'object') return false;
  const lat = Number(s.latitude);
  const lng = Number(s.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function stopKey(s) {
  if (s.poi_id != null) return `poi:${s.poi_id}`;
  return `coord:${s.latitude},${s.longitude}`;
}

export function TripProvider({ children }) {
  const [trip, setTrip] = useState(() => loadFromStorage());
  const [showBuilder, setShowBuilder] = useState(false);
  const persistTimer = useRef(null);

  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trip));
      } catch (err) {
        console.warn('Could not persist trip-in-progress:', err.message);
      }
    }, 200);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [trip]);

  const addStop = useCallback((stop) => {
    if (!isValidStop(stop)) return;
    setTrip(prev => {
      if (prev.stops.length >= MAX_STOPS) return prev;
      const key = stopKey(stop);
      if (prev.stops.some(s => stopKey(s) === key)) return prev;
      return { ...prev, stops: [...prev.stops, {
        poi_id: stop.poi_id || null,
        label: stop.label || null,
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude)
      }] };
    });
    setShowBuilder(true);
  }, []);

  const removeStop = useCallback((index) => {
    setTrip(prev => ({ ...prev, stops: prev.stops.filter((_, i) => i !== index) }));
  }, []);

  const removeStopByPoi = useCallback((poi_id) => {
    setTrip(prev => ({ ...prev, stops: prev.stops.filter(s => s.poi_id !== poi_id) }));
  }, []);

  const moveStop = useCallback((from, to) => {
    setTrip(prev => {
      if (from === to || from < 0 || to < 0 || from >= prev.stops.length || to >= prev.stops.length) {
        return prev;
      }
      const next = [...prev.stops];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...prev, stops: next };
    });
  }, []);

  const setName = useCallback((name) => setTrip(prev => ({ ...prev, name })), []);
  const setDescription = useCallback((description) => setTrip(prev => ({ ...prev, description })), []);
  const setIsPublic = useCallback((is_public) => setTrip(prev => ({ ...prev, is_public })), []);
  const setIsFeatured = useCallback((is_featured) => setTrip(prev => ({ ...prev, is_featured })), []);

  const clear = useCallback(() => {
    setTrip(emptyTrip());
    setShowBuilder(false);
  }, []);

  const loadTrip = useCallback((next) => {
    if (!next) return;
    setTrip({
      id: next.id || null,
      slug: next.slug || null,
      name: next.name || '',
      description: next.description || '',
      is_public: !!next.is_public,
      is_featured: !!next.is_featured,
      stops: (next.stops || []).map(s => ({
        poi_id: s.poi_id || null,
        label: s.label || s.poi_name || null,
        latitude: Number(s.latitude),
        longitude: Number(s.longitude)
      })).filter(isValidStop)
    });
    setShowBuilder(true);
  }, []);

  const loadFromSlug = useCallback(async (slug) => {
    const res = await fetch(`/api/trips/${encodeURIComponent(slug)}`, { credentials: 'include' });
    if (!res.ok) throw new Error(res.status === 404 ? 'Trip not found' : 'Failed to load trip');
    const data = await res.json();
    loadTrip(data);
    return data;
  }, [loadTrip]);

  const saveTrip = useCallback(async () => {
    const payload = {
      name: trip.name || 'Untitled Trip',
      description: trip.description || null,
      is_public: trip.is_public,
      is_featured: trip.is_featured,
      stops: trip.stops
    };
    const url = trip.id ? `/api/trips/${trip.id}` : '/api/trips';
    const method = trip.id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Save failed' }));
      throw new Error(error.error || 'Save failed');
    }
    const saved = await res.json();
    loadTrip(saved);
    return saved;
  }, [trip, loadTrip]);

  const hasStop = useCallback((poi_id) => {
    if (!poi_id) return false;
    return trip.stops.some(s => s.poi_id === poi_id);
  }, [trip.stops]);

  const value = {
    trip,
    showBuilder,
    setShowBuilder,
    addStop,
    removeStop,
    removeStopByPoi,
    moveStop,
    setName,
    setDescription,
    setIsPublic,
    setIsFeatured,
    clear,
    loadTrip,
    loadFromSlug,
    saveTrip,
    hasStop,
    MAX_STOPS
  };

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}
