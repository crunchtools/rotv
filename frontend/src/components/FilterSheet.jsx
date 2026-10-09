import React, { useState, useEffect, useRef } from 'react';

/**
 * The collapsed Filters menu (spec 048): one button that opens the filter
 * chips, a bottom sheet on a phone and a popover on a wide screen, so nobody
 * scrolls past a wall of chips to reach the list.
 *
 * @param {object} props
 * @param {number} [props.activeCount] Filters currently narrowing the list; shown on the button
 * @param {React.ReactNode} props.children The chips and actions
 * @returns {JSX.Element}
 */
export default function FilterSheet({ activeCount = 0, children }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const sheetRef = useRef(null);

  useEffect(() => {
    if (open) sheetRef.current?.querySelector('button')?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="filter-sheet-container">
      <button
        type="button"
        ref={buttonRef}
        className={`filter-sheet-btn ${activeCount > 0 ? 'has-active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
        </svg>
        Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
      </button>
      {open && (
        <>
          <div className="filter-sheet-backdrop" onClick={close} />
          <div
            ref={sheetRef}
            className="filter-sheet"
            role="dialog"
            aria-label="Filters"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}
          >
            <div className="filter-sheet-header">
              <span className="filter-sheet-title">Filters</span>
              <button type="button" className="filter-sheet-done" onClick={close}>Done</button>
            </div>
            <div className="filter-sheet-body">{children}</div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One toggle inside a FilterSheet.
 *
 * @param {object} props
 * @param {string} props.id Type key; also a class name, which carries the chip's color
 * @param {boolean} props.active
 * @param {() => void} props.onToggle
 * @param {React.ReactNode} props.children Icon and label
 * @returns {JSX.Element}
 */
export function FilterChip({ id, active, onToggle, children }) {
  return (
    <button
      type="button"
      className={`type-filter-chip ${id} ${active ? 'active' : 'inactive'}`}
      aria-pressed={active}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}
