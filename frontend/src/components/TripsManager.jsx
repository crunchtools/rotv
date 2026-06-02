import React, { useCallback, useEffect, useState } from 'react';
import { useTrip } from '../hooks/useTrip';
import { useAuth } from '../hooks/useAuth';
import { readTrips as readLocalTrips, removeTrip as removeLocalTrip } from '../utils/anonSettings';
import BackButton from './BackButton';
import './TripsManager.css';

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function shareStatusLabel(trip) {
  if (trip.is_featured) return '⭐ Featured';
  if (trip.is_public && trip.is_approved) return '🌐 Shared';
  if (trip.is_public && !trip.is_approved) return '⏳ Pending review';
  return null;
}

/**
 * The trip management UI (mine / discover / pending views) without any modal
 * chrome. Rendered both inside the standalone MyTripsModal and embedded in the
 * My Valley hub's Trips subtab. `onClosed` is called when opening a trip should
 * dismiss the surrounding container; `active` (re)loads the user's trips when
 * the host becomes visible.
 */
export default function TripsManager({ active = true, onClosed }) {
  const { trip: activeTrip, loadTrip, clear } = useTrip();
  const { isAdmin, isAuthenticated } = useAuth();
  const [mine, setMine] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [pending, setPending] = useState([]);
  const [view, setView] = useState('mine');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const refreshMine = useCallback(async () => {
    if (!isAuthenticated) {
      setMine(readLocalTrips().map(t => ({
        ...t,
        stop_count: t.stops?.length || 0,
        updated_at: t.savedAt
      })));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trips/mine', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load trips');
      setMine(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  const refreshDiscover = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trips/discover', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load trips');
      setDiscover(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trips/pending', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load pending trips');
      setPending(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    setView('mine');
    refreshMine();
  }, [active, refreshMine]);

  if (!active) return null;

  const closeAfterOpen = () => { if (onClosed) onClosed(); };

  const handleOpen = async (slug) => {
    if (!isAuthenticated) {
      const local = readLocalTrips().find(t => t.slug === slug);
      if (local) {
        loadTrip(local);
        closeAfterOpen();
      } else {
        setError('Could not load trip');
      }
      return;
    }
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(slug)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Could not load trip');
      const data = await res.json();
      loadTrip(data);
      closeAfterOpen();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDuplicate = async (id) => {
    try {
      const res = await fetch(`/api/trips/${id}/duplicate`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Could not duplicate trip');
      await refreshMine();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this trip?')) return;
    try {
      const res = await fetch(`/api/trips/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Could not delete trip');
      if (activeTrip && activeTrip.id === id) clear();
      await refreshMine();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteLocal = (slug) => {
    if (!window.confirm('Delete this trip?')) return;
    removeLocalTrip(slug);
    if (activeTrip && activeTrip.slug === slug) clear();
    refreshMine();
  };

  const handleCopyLink = async (trip) => {
    const url = `${window.location.origin}/trip/${trip.slug}`;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        document.body.removeChild(ta);
      }
    } catch {
      ok = false;
    }
    if (ok) {
      setCopiedId(trip.id);
      setTimeout(() => setCopiedId(prev => (prev === trip.id ? null : prev)), 1800);
    } else {
      window.prompt('Copy this link:', url);
    }
  };

  const handleClone = async (id) => {
    try {
      const res = await fetch(`/api/trips/${id}/duplicate`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Could not add trip to your list');
      setView('mine');
      await refreshMine();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleModerate = async (id, action) => {
    try {
      const res = await fetch(`/api/trips/${id}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action })
      });
      if (!res.ok) throw new Error(`Could not ${action} trip`);
      await refreshPending();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {error && <div className="my-trips-error">{error}</div>}

      {view === 'mine' && (
        <>
          <div className="my-trips-actions-row">
            <button className="primary" onClick={() => { clear(); closeAfterOpen(); }}>+ New Trip</button>
            {isAuthenticated && (
              <button onClick={() => { setView('discover'); refreshDiscover(); }}>Find Trips</button>
            )}
            {isAdmin && (
              <button onClick={() => { setView('pending'); refreshPending(); }}>
                Pending Review
              </button>
            )}
          </div>
          {!isAuthenticated && mine.length > 0 && (
            <p className="my-trips-anon-hint">
              These trips are saved to this browser. Sign in to keep them on your account and share them.
            </p>
          )}
          {loading ? (
            <div className="my-trips-empty">Loading…</div>
          ) : mine.length === 0 ? (
            <div className="my-trips-empty">No saved trips yet. Plan one on the map, then tap Save.</div>
          ) : (
            <ul className="my-trips-list">
              {mine.map(trip => {
                const status = shareStatusLabel(trip);
                return (
                  <li key={trip.id || trip.slug} className="my-trips-row">
                    <div className="my-trips-row-info">
                      <span className="my-trips-row-name">
                        {trip.name}{status ? ` · ${status}` : ''}
                      </span>
                      <span className="my-trips-row-meta">
                        {trip.stop_count} stop{Number(trip.stop_count) === 1 ? '' : 's'}
                        {trip.updated_at ? ` · edited ${formatDate(trip.updated_at)}` : ''}
                      </span>
                    </div>
                    <div className="my-trips-row-actions">
                      <button onClick={() => handleOpen(trip.slug)}>Open</button>
                      {isAuthenticated && (
                        <button onClick={() => handleDuplicate(trip.id)}>Duplicate</button>
                      )}
                      {isAuthenticated && (trip.is_featured || trip.is_public) && (
                        <button onClick={() => handleCopyLink(trip)}>
                          {copiedId === trip.id ? 'Copied!' : 'Copy link'}
                        </button>
                      )}
                      <button
                        className="danger"
                        onClick={() => isAuthenticated ? handleDelete(trip.id) : handleDeleteLocal(trip.slug)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {view === 'discover' && (
        <>
          {loading ? (
            <div className="my-trips-empty">Loading…</div>
          ) : discover.length === 0 ? (
            <div className="my-trips-empty">No shared trips yet.</div>
          ) : (
            <ul className="my-trips-list">
              {discover.map(trip => (
                <li key={trip.id} className="my-trips-row">
                  <div className="my-trips-row-info">
                    <span className="my-trips-row-name">
                      {trip.name}
                      {trip.is_featured ? ' · ⭐ Featured' : (trip.owner_name ? ` · by ${trip.owner_name}` : '')}
                    </span>
                    <span className="my-trips-row-meta">
                      {trip.stop_count} stop{Number(trip.stop_count) === 1 ? '' : 's'}
                      {trip.description ? ` · ${trip.description}` : ''}
                    </span>
                  </div>
                  <div className="my-trips-row-actions">
                    <button onClick={() => handleClone(trip.id)}>Add to my trips</button>
                    <button onClick={() => handleOpen(trip.slug)}>Preview</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: '0.75rem' }}>
            <BackButton onClick={() => setView('mine')} />
          </div>
        </>
      )}

      {view === 'pending' && isAdmin && (
        <>
          {loading ? (
            <div className="my-trips-empty">Loading…</div>
          ) : pending.length === 0 ? (
            <div className="my-trips-empty">No trips awaiting review.</div>
          ) : (
            <ul className="my-trips-list">
              {pending.map(trip => (
                <li key={trip.id} className="my-trips-row">
                  <div className="my-trips-row-info">
                    <span className="my-trips-row-name">{trip.name}</span>
                    <span className="my-trips-row-meta">
                      {trip.stop_count} stop{Number(trip.stop_count) === 1 ? '' : 's'} · by {trip.owner_name || trip.owner_email || 'unknown'} · submitted {formatDate(trip.updated_at)}
                    </span>
                  </div>
                  <div className="my-trips-row-actions">
                    <button onClick={() => handleOpen(trip.slug)}>Preview</button>
                    <button className="primary" onClick={() => handleModerate(trip.id, 'approve')}>Approve</button>
                    <button className="danger" onClick={() => handleModerate(trip.id, 'reject')}>Reject</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: '0.75rem' }}>
            <BackButton onClick={() => setView('mine')} />
          </div>
        </>
      )}
    </>
  );
}
