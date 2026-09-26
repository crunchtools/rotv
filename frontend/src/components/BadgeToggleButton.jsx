import React, { useState } from 'react';

/**
 * Pill-style on/off badge button shared by the per-POI toggles (favorite, visited).
 *
 * @param {object} props
 * @param {boolean} props.active - Current state; picks the icon, activeClassName and aria-pressed.
 * @param {() => Promise<void>|void} props.onToggle - Called on click; the button is disabled
 *   until it settles, and a rejection propagates to the caller's handler.
 * @param {string} props.className - Base class for the button.
 * @param {string} props.activeClassName - Extra class applied while active.
 * @param {string} props.title - Tooltip text.
 * @param {string} props.activeIconPath - SVG path data shown while active.
 * @param {string} props.inactiveIconPath - SVG path data shown while inactive.
 * @param {import('react').ReactNode} props.label - Text after the icon.
 */
export default function BadgeToggleButton({ active, onToggle, className, activeClassName, title, activeIconPath, inactiveIconPath, label }) {
  const [busy, setBusy] = useState(false);

  const handleClick = async (e) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await onToggle();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className={`${className} ${active ? activeClassName : ''}`}
      onClick={handleClick}
      disabled={busy}
      title={title}
      aria-pressed={active}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d={active ? activeIconPath : inactiveIconPath} />
      </svg>
      {label}
    </button>
  );
}
