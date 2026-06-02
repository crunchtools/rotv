import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { readTrips as readLocalTrips } from '../utils/anonSettings';
import { generateSlug } from './sidebar/helpers';
import { StatusBadge } from './StatusBadge';
import PoiNews from './sidebar/PoiNews';
import PoiEvents from './sidebar/PoiEvents';
import ContentDetail from './sidebar/ContentDetail';
import BackButton from './BackButton';
import TripsManager from './TripsManager';
import './MyValley.css';

/**
 * "My Valley" — the personalization hub. Combines the user's exploration
 * progress (Visited), favorite places (Favorites), and saved Trips in one
 * place. Local-first: works for anonymous visitors from localStorage-backed
 * AuthContext state (favorites/visited) and a sign-in nudge, and shows the
 * richer server-backed lists once signed in. Foundation for #141's
 * personalized home.
 */
const FAV_TYPE_LABELS = {
  trail: 'Trails',
  river: 'Rivers',
  water_taxi: 'Water Taxis',
  boundary: 'Areas',
  astronomy: 'Astronomy'
};

export default function MyValley({ open, onClose, destinations = [] }) {
  const { isAuthenticated, visited, favorites, toggleVisited, toggleFavorite } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState('visited');
  const [visitedList, setVisitedList] = useState([]);
  const [favoriteList, setFavoriteList] = useState([]);
  const [favSort, setFavSort] = useState('recent');
  const [favTypeFilter, setFavTypeFilter] = useState('all');
  // When set, the Favorites tab shows an in-panel news/events detail for one POI
  // instead of the list — { id, name, tab: 'news' | 'events' }.
  const [favDetail, setFavDetail] = useState(null);
  // When set, a single news/event article is shown in-panel — { type, poiSlug, titleSlug }.
  const [favArticle, setFavArticle] = useState(null);
  const [tripCount, setTripCount] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  // id -> name lookup over the markable locations the map already loaded, used
  // to render names for anonymous (localStorage-only) visited/followed ids.
  const nameById = useMemo(() => {
    const map = new Map();
    for (const d of destinations) map.set(d.id, d.name);
    return map;
  }, [destinations]);

  // Signed-in: trust the server's point-based counters (/api/visited/stats) so N
  // and M match the spec's "markable point locations". Signed-out: derive from
  // localStorage against the loaded destinations (point POIs) as the denominator.
  const total = isAuthenticated && stats ? stats.total : destinations.length;
  const exploredCount = isAuthenticated
    ? (stats ? stats.visited : visitedList.length)
    : visited.length;
  const percent = total > 0 ? Math.min(100, Math.round((exploredCount / total) * 100)) : 0;

  const toRows = useCallback(
    (ids) => ids.map(id => ({ id, name: nameById.get(id) || 'Saved place' })),
    [nameById]
  );

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setStats(null);
      setVisitedList(toRows(visited));
      setTripCount(readLocalTrips().length);
      const baseRows = toRows(favorites);
      setFavoriteList(baseRows);
      // Local-first parity (#437): enrich anonymous (localStorage) favorites with the
      // same public status/counts the signed-in list gets, via the batch summary endpoint.
      if (favorites.length > 0) {
        try {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
          const res = await fetch(`/api/pois/summary?ids=${favorites.join(',')}&tz=${encodeURIComponent(tz)}`);
          if (res.ok) {
            const byId = new Map((await res.json()).map(s => [s.id, s]));
            setFavoriteList(baseRows.map(r => ({ ...r, ...(byId.get(r.id) || {}) })));
          }
        } catch (err) {
          console.warn('Favorite enrichment failed; showing names only:', err);
        }
      }
      return;
    }
    setLoading(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      const [visRes, favRes, tripsRes, statsRes] = await Promise.all([
        fetch('/api/visited', { credentials: 'include' }),
        fetch(`/api/favorites?tz=${encodeURIComponent(tz)}`, { credentials: 'include' }),
        fetch('/api/trips/mine', { credentials: 'include' }),
        fetch('/api/visited/stats', { credentials: 'include' })
      ]);
      if (visRes.ok) setVisitedList(await visRes.json());
      if (favRes.ok) setFavoriteList(await favRes.json());
      if (tripsRes.ok) setTripCount((await tripsRes.json()).length);
      if (statsRes.ok) setStats(await statsRes.json());
    } catch {
      setVisitedList([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, visited, favorites, toRows]);

  useEffect(() => {
    if (!open) return;
    setView('favorites');
    setFavDetail(null);
    setFavArticle(null);
    load();
  }, [open, load]);

  // The distinct POI types present in favorites, used to offer type-filter chips.
  const favTypes = useMemo(() => {
    const seen = new Set();
    for (const p of favoriteList) {
      const role = Array.isArray(p.poi_roles) && p.poi_roles.length ? p.poi_roles[0] : null;
      if (role) seen.add(role);
    }
    return Array.from(seen);
  }, [favoriteList]);

  // Client-side filter + sort over the loaded favorites (lists are small).
  const visibleFavorites = useMemo(() => {
    let rows = favoriteList;
    if (favTypeFilter !== 'all') {
      rows = rows.filter(p => Array.isArray(p.poi_roles) && p.poi_roles[0] === favTypeFilter);
    }
    if (favSort === 'name') {
      rows = [...rows].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (favSort === 'activity') {
      const score = (p) => (p.news_count || 0) + (p.events_count || 0);
      rows = [...rows].sort((a, b) => score(b) - score(a));
    }
    return rows;
  }, [favoriteList, favTypeFilter, favSort]);

  if (!open) return null;

  const handleUnvisit = async (poiId) => {
    setVisitedList(prev => prev.filter(p => p.id !== poiId));
    await toggleVisited(poiId);
  };

  const handleRemoveFavorite = async (poiId) => {
    setFavoriteList(prev => prev.filter(p => p.id !== poiId));
    await toggleFavorite(poiId);
  };

  // Switch My Valley tabs, leaving any favorites detail/article view first.
  const selectView = (next) => {
    setFavArticle(null);
    setFavDetail(null);
    setView(next);
  };

  // Open a favorite's POI on the map (resolved by App's location effect for the
  // 'info' sub-tab). Close the modal first so the map is visible underneath.
  const handleOpenOnMap = (poi) => {
    const slug = generateSlug(poi.name);
    onClose();
    if (slug) navigate(`/${slug}/info`);
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
            className={`settings-tab-btn ${view === 'favorites' ? 'active' : ''}`}
            onClick={() => selectView('favorites')}
          >
            ★ Favorites ({isAuthenticated ? favoriteList.length : favorites.length})
          </button>
          <button
            className={`settings-tab-btn ${view === 'visited' ? 'active' : ''}`}
            onClick={() => selectView('visited')}
          >
            🧭 Visited ({isAuthenticated ? visitedList.length : visited.length})
          </button>
          <button
            className={`settings-tab-btn ${view === 'trips' ? 'active' : ''}`}
            onClick={() => selectView('trips')}
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

          {view === 'favorites' && !loading && favDetail && (
            <div className="my-valley-detail">
              <BackButton onClick={() => (favArticle ? setFavArticle(null) : setFavDetail(null))} />
              {favArticle ? (
                <ContentDetail permalinkInfo={favArticle} onBack={() => setFavArticle(null)} showBack={false} />
              ) : (
                <>
                  <div className="my-valley-detail-name">{favDetail.name}</div>
                  <div className="my-valley-detail-tabs">
                    <button
                      className={`my-valley-detail-tab ${favDetail.tab === 'news' ? 'active' : ''}`}
                      onClick={() => setFavDetail(d => ({ ...d, tab: 'news' }))}
                    >
                      News
                    </button>
                    <button
                      className={`my-valley-detail-tab ${favDetail.tab === 'events' ? 'active' : ''}`}
                      onClick={() => setFavDetail(d => ({ ...d, tab: 'events' }))}
                    >
                      Events
                    </button>
                  </div>
                  {favDetail.tab === 'news' ? (
                    <PoiNews poiId={favDetail.id} poiName={favDetail.name} isAdmin={false} editMode={false}
                      navigateOnSelect={false} onSelectNews={setFavArticle} />
                  ) : (
                    <PoiEvents poiId={favDetail.id} poiName={favDetail.name} isAdmin={false} editMode={false}
                      navigateOnSelect={false} onSelectEvent={setFavArticle} />
                  )}
                </>
              )}
            </div>
          )}

          {view === 'favorites' && !loading && !favDetail && (
            favoriteList.length === 0 ? (
              <div className="my-valley-empty">
                <strong>No favorite places yet</strong>
                <p>Open a place and tap “Favorite” to get news and event updates in your notifications.</p>
              </div>
            ) : (
              <>
                <div className="my-valley-controls">
                  <label className="my-valley-sort">
                    Sort
                    <select value={favSort} onChange={(e) => setFavSort(e.target.value)}>
                      <option value="recent">Recently added</option>
                      <option value="name">Name (A–Z)</option>
                      <option value="activity">Most activity</option>
                    </select>
                  </label>
                  {favTypes.length > 1 && (
                    <div className="my-valley-type-filter">
                      <button
                        className={`my-valley-chip ${favTypeFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setFavTypeFilter('all')}
                      >
                        All
                      </button>
                      {favTypes.map(t => (
                        <button
                          key={t}
                          className={`my-valley-chip ${favTypeFilter === t ? 'active' : ''}`}
                          onClick={() => setFavTypeFilter(t)}
                        >
                          {FAV_TYPE_LABELS[t] || t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <ul className="my-valley-list">
                  {visibleFavorites.map(poi => (
                    <li key={poi.id} className="my-valley-row">
                      <button
                        className="my-valley-row-open"
                        onClick={() => handleOpenOnMap(poi)}
                        title={`Open ${poi.name}`}
                      >
                        <span className="my-valley-row-name">{poi.name}</span>
                      </button>
                      <span className="my-valley-row-meta">
                        {poi.trail_status && <StatusBadge status={poi.trail_status} />}
                        {typeof poi.news_count === 'number' && (
                          <button
                            className="my-valley-count"
                            onClick={() => { setFavArticle(null); setFavDetail({ id: poi.id, name: poi.name, tab: 'news' }); }}
                            title={`${poi.news_count} news — view`}
                          >
                            📰 {poi.news_count}
                          </button>
                        )}
                        {typeof poi.events_count === 'number' && (
                          <button
                            className="my-valley-count"
                            onClick={() => { setFavArticle(null); setFavDetail({ id: poi.id, name: poi.name, tab: 'events' }); }}
                            title={`${poi.events_count} upcoming events — view`}
                          >
                            📅 {poi.events_count}
                          </button>
                        )}
                      </span>
                      <button className="my-valley-remove-btn" onClick={() => handleRemoveFavorite(poi.id)} title={`Remove ${poi.name}`}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </>
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
