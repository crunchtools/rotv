import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { readTrips as readLocalTrips } from '../utils/anonSettings';
import TripsManager from './TripsManager';
import './MyValley.css';

/**
 * "My Valley" — the personalization hub. Combines the user's exploration
 * progress (Visited), followed places (Following), and saved Trips in one
 * place. Local-first: works for anonymous visitors from localStorage-backed
 * AuthContext state (favorites/visited) and a sign-in nudge, and shows the
 * richer server-backed lists once signed in. Foundation for #141's
 * personalized home.
 */
export default function MyValley({ open, onClose, destinations = [] }) {
  const { isAuthenticated, visited, favorites, toggleVisited, toggleFavorite } = useAuth();
  const [view, setView] = useState('visited');
  const [visitedList, setVisitedList] = useState([]);
  const [followingList, setFollowingList] = useState([]);
  const [tripCount, setTripCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // id -> name lookup over the markable locations the map already loaded, used
  // to render names for anonymous (localStorage-only) visited/followed ids.
  const nameById = useMemo(() => {
    const map = new Map();
    for (const d of destinations) map.set(d.id, d.name);
    return map;
  }, [destinations]);

  const total = destinations.length;
  const exploredCount = isAuthenticated ? visitedList.length : visited.length;
  const percent = total > 0 ? Math.min(100, Math.round((exploredCount / total) * 100)) : 0;

  const toRows = useCallback(
    (ids) => ids
      .map(id => ({ id, name: nameById.get(id) }))
      .filter(row => row.name),
    [nameById]
  );

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setVisitedList(toRows(visited));
      setFollowingList(toRows(favorites));
      setTripCount(readLocalTrips().length);
      return;
    }
    setLoading(true);
    try {
      const [visRes, favRes, tripsRes] = await Promise.all([
        fetch('/api/visited', { credentials: 'include' }),
        fetch('/api/favorites', { credentials: 'include' }),
        fetch('/api/trips/mine', { credentials: 'include' })
      ]);
      if (visRes.ok) setVisitedList(await visRes.json());
      if (favRes.ok) setFollowingList(await favRes.json());
      if (tripsRes.ok) setTripCount((await tripsRes.json()).length);
    } catch {
      setVisitedList([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, visited, favorites, toRows]);

  useEffect(() => {
    if (!open) return;
    setView('visited');
    load();
  }, [open, load]);

  if (!open) return null;

  const handleUnvisit = async (poiId) => {
    setVisitedList(prev => prev.filter(p => p.id !== poiId));
    await toggleVisited(poiId);
  };

  const handleUnfollow = async (poiId) => {
    setFollowingList(prev => prev.filter(p => p.id !== poiId));
    await toggleFavorite(poiId);
  };

  return (
    <div className="my-valley-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="my-valley-modal" onClick={(e) => e.stopPropagation()}>
        <div className="my-valley-header">
          <h2>My Valley</h2>
          <button className="my-valley-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="my-valley-progress">
          <div className="my-valley-progress-label">
            <strong>{exploredCount}</strong> of {total} explored
          </div>
          <div className="my-valley-progress-track">
            <div className="my-valley-progress-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>

        {!isAuthenticated && (
          <div className="my-valley-nudge">
            Sign in with Google to save your valley across devices.
          </div>
        )}

        <nav className="settings-tabs">
          <button
            className={`settings-tab-btn ${view === 'visited' ? 'active' : ''}`}
            onClick={() => setView('visited')}
          >
            🧭 Visited ({isAuthenticated ? visitedList.length : visited.length})
          </button>
          <button
            className={`settings-tab-btn ${view === 'following' ? 'active' : ''}`}
            onClick={() => setView('following')}
          >
            ⭐ Following ({isAuthenticated ? followingList.length : favorites.length})
          </button>
          <button
            className={`settings-tab-btn ${view === 'trips' ? 'active' : ''}`}
            onClick={() => setView('trips')}
          >
            🗺️ Trips ({tripCount})
          </button>
        </nav>

        <div className="my-valley-body">
          {loading && <p className="my-valley-hint">Loading…</p>}

          {view === 'visited' && !loading && (
            visitedList.length === 0 ? (
              <div className="my-valley-empty">
                <strong>No places visited yet</strong>
                <p>Open a place on the map and tap “Mark visited” to start your exploration log.</p>
              </div>
            ) : (
              <ul className="my-valley-list">
                {visitedList.map(poi => (
                  <li key={poi.id} className="my-valley-row">
                    <span className="my-valley-row-name">{poi.name}</span>
                    <button className="my-valley-remove-btn" onClick={() => handleUnvisit(poi.id)} title={`Unmark ${poi.name}`}>
                      Unmark
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          {view === 'following' && !loading && (
            followingList.length === 0 ? (
              <div className="my-valley-empty">
                <strong>Not following any places yet</strong>
                <p>Open a place and tap “Follow” to get news and event updates in your notifications.</p>
              </div>
            ) : (
              <ul className="my-valley-list">
                {followingList.map(poi => (
                  <li key={poi.id} className="my-valley-row">
                    <span className="my-valley-row-name">{poi.name}</span>
                    <button className="my-valley-remove-btn" onClick={() => handleUnfollow(poi.id)} title={`Unfollow ${poi.name}`}>
                      Unfollow
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          {view === 'trips' && (
            <TripsManager active={view === 'trips'} onClosed={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}
