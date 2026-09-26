import React, { useState, useEffect, useRef, useCallback } from 'react';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const FRAME_INTERVAL_MS = 700;
const FRAME_RETRY_MS = 2000;
// 404/409 mean the server-side session is gone or someone else's — stop polling.
const SESSION_ENDED_STATUSES = new Set([401, 403, 404, 409]);
const TYPE_FLUSH_MS = 120;
const MAX_TEXT_CHUNK = 256; // server-side limit per 'type' event
const SPECIAL_KEYS = new Set([
  'Enter', 'Backspace', 'Tab', 'Escape', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'
]);

/**
 * Map a click on the scaled screenshot to remote-viewport pixels.
 * @param {{clientX: number, clientY: number}} evt
 * @param {{left: number, top: number, width: number, height: number}} rect - the displayed
 *   image's DOMRect (from getBoundingClientRect), in CSS pixels
 * @param {{width: number, height: number}} viewport - remote browser viewport
 * @returns {{x: number, y: number}}
 */
export function toViewportPoint(evt, rect, viewport) {
  const scaledX = Math.round((evt.clientX - rect.left) * viewport.width / rect.width);
  const scaledY = Math.round((evt.clientY - rect.top) * viewport.height / rect.height);
  return {
    x: Math.min(viewport.width, Math.max(0, scaledX)),
    y: Math.min(viewport.height, Math.max(0, scaledY))
  };
}

/**
 * Split text into chunks the server accepts, so long pastes arrive whole.
 * Splits on code points (never inside a surrogate pair); each chunk's UTF-16
 * length stays within `size`, which is what the server checks.
 * @param {string} text
 * @param {number} [size=256]
 * @returns {string[]}
 */
export function chunkText(text, size = MAX_TEXT_CHUNK) {
  const chunks = [];
  let current = '';
  for (const char of text) {
    if (current.length + char.length > size) { chunks.push(current); current = ''; }
    current += char;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Decide how a keydown is relayed: printable characters are batched as text,
 * navigation/editing keys are pressed individually, shortcuts are ignored.
 * @param {{key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean}} evt - a React/DOM
 *   KeyboardEvent (only these fields are read)
 * @returns {'text'|'key'|null}
 */
export function classifyKey(evt) {
  if (evt.ctrlKey || evt.metaKey || evt.altKey) return null;
  if (evt.key.length === 1) return 'text';
  if (SPECIAL_KEYS.has(evt.key)) return 'key';
  return null;
}

/**
 * Interactive login to a third-party site through a browser running on the
 * ROTV server (see backend/services/remoteLoginSession.js). Screenshots are
 * polled; clicks, typing, paste and scroll are relayed back.
 *
 * @param {object} props
 * @param {string} props.provider - Provider key, e.g. 'facebook'.
 * @param {string} props.label - Display name, e.g. 'Facebook'.
 * @param {() => void} props.onClose - Called when the modal closes (session is cancelled unless saved).
 * @param {(result: {cookiesCount: number, expires: string|null}) => void} props.onSaved - Called after the session is saved.
 */
function RemoteLoginModal({ provider, label, onClose, onSaved }) {
  const base = `/api/admin/remote-login/${provider}`;
  const [viewport, setViewport] = useState(null);
  const [frameUrl, setFrameUrl] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(false);
  const typeBuffer = useRef('');
  const typeTimer = useRef(null);
  const refreshNow = useRef(null);

  // Start the remote session once; cancel it on unmount unless it was saved.
  useEffect(() => {
    let cancelled = false;
    const cancelRemote = () => fetch(`${base}/cancel`, { method: 'POST', credentials: 'include' })
      .catch(err => console.warn('Remote login cancel failed:', err.message));
    fetch(`${base}/start`, { method: 'POST', credentials: 'include' })
      .then(r => r.json())
      .then(outcome => {
        // Unmounted before start finished: our earlier cancel may have beaten it to the server.
        if (cancelled) { if (outcome.success) cancelRemote(); return; }
        if (outcome.success) setViewport(outcome.viewport);
        else setError(outcome.error || 'Could not start the login browser');
      })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => {
      cancelled = true;
      if (!savedRef.current) cancelRemote();
    };
  }, [base]);

  // Poll frames sequentially (never overlapping) while the session runs.
  useEffect(() => {
    if (!viewport) return undefined;
    let stopped = false;
    let timer = null;
    let currentUrl = null;
    let inFlight = false;
    let refreshQueued = false;
    const poll = async () => {
      // Coalesce: an input-triggered refresh during a poll becomes one follow-up poll.
      if (inFlight) { refreshQueued = true; return; }
      inFlight = true;
      clearTimeout(timer);
      try {
        await pollOnce();
      } finally {
        inFlight = false;
      }
      if (refreshQueued && !stopped) { refreshQueued = false; poll(); }
    };
    const pollOnce = async () => {
      try {
        const response = await fetch(`${base}/frame`, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) {
          const outcome = await response.json().catch(err => ({ error: `Screen update failed (${err.message})` }));
          if (stopped) return;
          if (SESSION_ENDED_STATUSES.has(response.status)) {
            setError(outcome.error || 'Login session ended');
            return;
          }
          setError(outcome.error || 'Screen update failed — retrying');
          timer = setTimeout(poll, FRAME_RETRY_MS);
          return;
        }
        const blob = await response.blob();
        if (stopped) return;
        const nextUrl = URL.createObjectURL(blob);
        setFrameUrl(nextUrl);
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = nextUrl;
        setLoggedIn(response.headers.get('X-Logged-In') === 'true');
        setError(null);
      } catch (err) {
        if (!stopped) {
          setError(`${err.message} — retrying`);
          timer = setTimeout(poll, FRAME_RETRY_MS);
        }
        return;
      }
      if (!stopped) timer = setTimeout(poll, FRAME_INTERVAL_MS);
    };
    refreshNow.current = poll;
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      refreshNow.current = null;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [base, viewport]);

  // Resolves true when the server accepted the event; failures are shown, not thrown.
  const sendInput = useCallback(async (evt) => {
    let accepted = false;
    try {
      const response = await fetch(`${base}/input`, {
        method: 'POST', headers: JSON_HEADERS, credentials: 'include', body: JSON.stringify(evt)
      });
      if (response.ok) {
        accepted = true;
      } else {
        const outcome = await response.json().catch(err => ({ error: `Input was rejected (${err.message})` }));
        setError(outcome.error || 'Input was rejected');
      }
    } catch (err) { setError(err.message); }
    if (refreshNow.current) refreshNow.current();
    return accepted;
  }, [base]);

  const flushTyping = useCallback(async () => {
    clearTimeout(typeTimer.current);
    const text = typeBuffer.current;
    typeBuffer.current = '';
    for (const chunk of chunkText(text)) {
      if (!(await sendInput({ type: 'type', text: chunk }))) break;
    }
  }, [sendInput]);

  const handleKeyDown = async (e) => {
    const kind = classifyKey(e);
    if (!kind) return;
    e.preventDefault();
    if (kind === 'text') {
      typeBuffer.current += e.key;
      clearTimeout(typeTimer.current);
      typeTimer.current = setTimeout(flushTyping, TYPE_FLUSH_MS);
      return;
    }
    await flushTyping();
    await sendInput({ type: 'key', key: e.key });
  };

  // Paste is how password-manager users get credentials in — autofill can't reach the remote browser.
  const handlePaste = async (e) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    await flushTyping();
    // Stop at the first rejected chunk so the field never gets partial, out-of-order text.
    for (const chunk of chunkText(text)) {
      if (!(await sendInput({ type: 'type', text: chunk }))) break;
    }
  };

  const handleClick = async (e) => {
    await flushTyping();
    await sendInput({ type: 'click', ...toViewportPoint(e, e.currentTarget.getBoundingClientRect(), viewport) });
  };

  const handleWheel = (e) => { sendInput({ type: 'scroll', dy: e.deltaY }); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${base}/save`, { method: 'POST', credentials: 'include' });
      const outcome = await response.json();
      if (!outcome.success) { setError(outcome.error || 'Could not save the session'); return; }
      savedRef.current = true;
      onSaved(outcome);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="remote-login-modal" onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-primary, #fff)', borderRadius: '8px', maxWidth: '560px', width: '95vw', maxHeight: '95vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <h3>Connect {label}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body" style={{ overflow: 'auto' }}>
          <p className="settings-description" style={{ fontSize: '0.85rem' }}>
            This is a browser running on the ROTV server. Click into it and log in as usual,
            including any security check. Paste works for passwords.
          </p>
          {error && <div className="sync-error">{error}</div>}
          {/* The frame is a live remote screen, so it needs raw keyboard focus rather than a form control. */}
          <div tabIndex={0} role="application" aria-label={`${label} login browser`}
            onKeyDown={handleKeyDown} onPaste={handlePaste} onWheel={handleWheel}
            style={{ outline: '2px solid #1877f2', borderRadius: '4px', lineHeight: 0 }}>
            {frameUrl
              ? <img src={frameUrl} alt={`${label} login screen`} onClick={handleClick}
                  style={{ width: '100%', height: 'auto', cursor: 'pointer', userSelect: 'none' }} draggable={false} />
              : <div style={{ padding: '2rem', lineHeight: 1.4 }}>{error ? 'Login browser unavailable.' : 'Starting login browser…'}</div>}
          </div>
        </div>
        <div className="modal-footer" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center' }}>
          {loggedIn && <span style={{ color: '#4caf50', fontWeight: 'bold' }}>Logged in ✓</span>}
          <button className="action-btn secondary" onClick={onClose}>Cancel</button>
          <button className="action-btn primary" onClick={handleSave} disabled={!loggedIn || saving}>
            {saving ? 'Saving…' : 'Save session'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RemoteLoginModal;
