import React, { useCallback, useEffect, useState } from 'react';
import { useTrip } from '../hooks/useTrip';
import { useAuth } from '../hooks/useAuth';
import './MyTripsModal.css';

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

export default function MyTripsModal({ open, onClose }) {
  const { trip: activeTrip, loadTrip, clear } = useTrip();
  const { isAdmin } = useAuth();
  const [mine, setMine] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [pending, setPending] = useState([]);
  const [view, setView] = useState('mine');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const refreshMine = useCallback(async () => {
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
  }, []);

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
    if (!open) return;
    setView('mine');
    refreshMine();
  }, [open, refreshMine]);

  if (!open) return null;

  const handleOpen = async (slug) => {
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(slug)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Could not load trip');
      const data = await res.json();
      loadTrip(data);
      onClose();
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
      // If the trip currently open in the dock just got deleted, drop it.
      if (activeTrip && activeTrip.id === id) clear();
      await refreshMine();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCopyLink = async (trip) => {
    const url = `${window.location.origin}/trip/${trip.slug}`;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      } else {
        // Fallback for non-secure contexts (clipboard API unavailable)
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
    <div className="my-trips-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="my-trips-modal" onClick={(e) => e.stopPropagation()}>
        <div className="my-trips-header">
          <h2>
            {view === 'mine' && 'My Trips'}
            {view === 'discover' && 'Find Trips'}
            {view === 'pending' && 'Pending Public Trips'}
          </h2>
          <button className="my-trips-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="my-trips-body">
          {error && <div className="my-trips-error">{error}</div>}

          {view === 'mine' && (
            <>
              <div className="my-trips-actions-row">
                <button className="primary" onClick={() => { clear(); onClose(); }}>+ New Trip</button>
                <button onClick={() => { setView('discover'); refreshDiscover(); }}>Find Trips</button>
                {isAdmin && (
                  <button onClick={() => { setView('pending'); refreshPending(); }}>
                    Pending Review
                  </button>
                )}
              </div>
              {loading ? (
                <div className="my-trips-empty">Loading…</div>
              ) : mine.length === 0 ? (
                <div className="my-trips-empty">No saved trips yet. Plan one on the map, then tap Save.</div>
              ) : (
                <ul className="my-trips-list">
                  {mine.map(trip => {
                    const status = shareStatusLabel(trip);
                    return (
                      <li key={trip.id} className="my-trips-row">
                        <div className="my-trips-row-info">
                          <span className="my-trips-row-name">
                            {trip.name}{status ? ` · ${status}` : ''}
                          </span>
                          <span className="my-trips-row-meta">
                            {trip.stop_count} stop{Number(trip.stop_count) === 1 ? '' : 's'} · edited {formatDate(trip.updated_at)}
                          </span>
                        </div>
                        <div className="my-trips-row-actions">
                          <button onClick={() => handleOpen(trip.slug)}>Open</button>
                          <button onClick={() => handleDuplicate(trip.id)}>Duplicate</button>
                          {(trip.is_featured || trip.is_public) && (
                            <button onClick={() => handleCopyLink(trip)}>
                              {copiedId === trip.id ? 'Copied!' : 'Copy link'}
                            </button>
                          )}
                          <button className="danger" onClick={() => handleDelete(trip.id)}>Delete</button>
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
                <button onClick={() => setView('mine')}>&larr; Back to My Trips</button>
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
                <button onClick={() => setView('mine')}>&larr; Back to My Trips</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
