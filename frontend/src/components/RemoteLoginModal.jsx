import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const FRAME_INTERVAL_MS = 700;
const FRAME_RETRY_MS = 2000;
// 404/409 mean the server-side session is gone or someone else's — stop polling.
const SESSION_ENDED_STATUSES = new Set([401, 403, 404, 409]);
const TYPE_FLUSH_MS = 120;
const MAX_TEXT_CHUNK = 256; // server-side limit per 'type' event
// Pressed on the remote page directly; they must not edit or move the caret in the local mirror field.
const PASSTHROUGH_KEYS = new Set([
  'Enter', 'Tab', 'Escape', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'
]);
// Keys that move the remote caret to another field, so the mirror starts over.
const FIELD_CHANGE_KEYS = new Set(['Enter', 'Tab']);

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

// Fix: count what one Backspace deletes (a grapheme), not code points, so a ZWJ emoji can't eat preceding text (PR #671 review)
const GRAPHEME_SEGMENTER = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

/**
 * Split text into user-perceived characters (grapheme clusters).
 * @param {string} text
 * @returns {string[]} one entry per grapheme; code points where Intl.Segmenter is unavailable
 */
function graphemes(text) {
  return GRAPHEME_SEGMENTER ? Array.from(GRAPHEME_SEGMENTER.segment(text), s => s.segment) : [...text];
}

/**
 * Edits that turn the remote field's text from `before` into `after`: backspaces
 * past the common prefix, then the new tail. Mobile keyboards (Gboard) rewrite
 * text through composition and autocorrect rather than per-key events, so the
 * mirror field is diffed instead of relaying keydowns. Works on grapheme
 * clusters, matching what one Backspace deletes, so a ZWJ emoji or accented
 * letter is one Backspace.
 * @param {string} before - text already relayed
 * @param {string} after - current mirror value
 * @returns {{backspaces: number, text: string}}
 */
export function diffTyping(before, after) {
  const a = graphemes(before);
  const b = graphemes(after);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  return { backspaces: a.length - common, text: b.slice(common).join('') };
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
  // Hidden input that holds keyboard focus: a real text field is what opens a phone's keyboard.
  const mirrorRef = useRef(null);
  const relayedText = useRef('');
  const typeTimer = useRef(null);
  const sendQueue = useRef(Promise.resolve());
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

  // Every relay goes through one queue so backspaces, text, keys and clicks arrive in order.
  const enqueue = useCallback((task) => {
    sendQueue.current = sendQueue.current.then(task);
    return sendQueue.current;
  }, []);

  // Relay whatever the mirror gained or lost since the last flush. The diff is taken now,
  // synchronously, so a click or key queued right after lands after this text.
  const flushTyping = useCallback(() => {
    clearTimeout(typeTimer.current);
    const current = mirrorRef.current ? mirrorRef.current.value : relayedText.current;
    const { backspaces, text } = diffTyping(relayedText.current, current);
    relayedText.current = current;
    if (!backspaces && !text) return sendQueue.current;
    return enqueue(async () => {
      for (let i = 0; i < backspaces; i += 1) {
        if (!(await sendInput({ type: 'key', key: 'Backspace' }))) return;
      }
      // Stop at the first rejected chunk so the field never gets partial, out-of-order text.
      for (const chunk of chunkText(text)) {
        if (!(await sendInput({ type: 'type', text: chunk }))) return;
      }
    });
  }, [enqueue, sendInput]);

  /** Clear the mirror and the relayed-text record, e.g. when the remote caret moves to another field. */
  const resetMirror = () => {
    if (mirrorRef.current) mirrorRef.current.value = '';
    relayedText.current = '';
  };

  /**
   * Debounce mirror value changes into one flush. Typing, autocorrect and paste
   * (including a password manager's) all land here.
   */
  const handleMirrorInput = () => {
    clearTimeout(typeTimer.current);
    typeTimer.current = setTimeout(flushTyping, TYPE_FLUSH_MS);
  };

  /**
   * Press navigation/editing keys on the remote page. Printable keys are left to the
   * mirror's input event on purpose: that is the only path phone keyboards use.
   * @param {React.KeyboardEvent<HTMLInputElement>} e
   */
  const handleMirrorKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave paste shortcuts to the input event
    const emptyBackspace = e.key === 'Backspace' && !e.currentTarget.value;
    if (!PASSTHROUGH_KEYS.has(e.key) && !emptyBackspace) return;
    e.preventDefault();
    const { key } = e;
    flushTyping();
    if (FIELD_CHANGE_KEYS.has(key)) resetMirror();
    enqueue(() => sendInput({ type: 'key', key }));
  };

  /**
   * Relay a click at the mapped remote point and focus the mirror within the gesture.
   * @param {React.MouseEvent<HTMLImageElement>} e
   */
  const handleClick = (e) => {
    // Fix: map the point before awaiting; React nulls e.currentTarget once dispatch ends, so every real click threw
    const point = toViewportPoint(e, e.currentTarget.getBoundingClientRect(), viewport);
    // Focus inside the tap itself: mobile browsers only open the keyboard for a focus made during a user gesture.
    if (mirrorRef.current) mirrorRef.current.focus({ preventScroll: true });
    flushTyping();
    resetMirror(); // a click may pick a different remote field
    enqueue(() => sendInput({ type: 'click', ...point }));
  };

  useEffect(() => () => clearTimeout(typeTimer.current), []);

  // Fix: scroll joins the same ordered queue as clicks and keys (PR #671 review)
  const handleWheel = (e) => { const dy = e.deltaY; enqueue(() => sendInput({ type: 'scroll', dy })); };

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

  // Fix: portal to <body>; an ancestor forms a stacking context, so z-index alone left the site header
  // (z-index 10000) over the modal's title bar and close button (PR #669 review)
  return createPortal(
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10001 }}>
      <div className="remote-login-modal" onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-primary, #fff)', borderRadius: '8px', maxWidth: '560px', width: '95vw', maxHeight: '95vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <h3>Connect {label}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body" style={{ overflow: 'auto' }}>
          <p className="settings-description" style={{ fontSize: '0.85rem' }}>
            This is a browser running on the ROTV server. Tap or click a field and type as usual
            (your keyboard opens on phones), including any security check. Paste works for passwords.
          </p>
          {error && <div className="sync-error">{error}</div>}
          <div role="application" aria-label={`${label} login browser`} onWheel={handleWheel}
            style={{ position: 'relative', outline: '2px solid #1877f2', borderRadius: '4px', lineHeight: 0 }}>
            {/* Invisible but focusable (not display:none) so phones open their keyboard; type=password keeps
                keyboards from suggesting or learning what's typed. 16px avoids iOS zoom-on-focus. */}
            <input ref={mirrorRef} type="password" aria-label={`${label} keyboard input`}
              autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              onInput={handleMirrorInput} onKeyDown={handleMirrorKeyDown}
              style={{ position: 'absolute', top: 0, left: 0, width: '1px', height: '1px', opacity: 0,
                border: 0, padding: 0, fontSize: '16px', pointerEvents: 'none' }} />
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
    </div>,
    document.body
  );
}

export default RemoteLoginModal;
