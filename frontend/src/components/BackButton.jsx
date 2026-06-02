import React from 'react';

/**
 * Standard back control used across the app. Describes the action ("Back"),
 * never the destination — the destination depends on how the user arrived, so a
 * baked-in name (e.g. "Back to <POI>") is misleading when a view is reachable
 * from more than one place. Pass an optional className for layout tweaks.
 */
export default function BackButton({ onClick, className = '' }) {
  return (
    <button type="button" className={`back-button${className ? ` ${className}` : ''}`} onClick={onClick}>
      ← Back
    </button>
  );
}
