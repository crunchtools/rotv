import React, { useEffect, useRef, useState } from 'react';

/**
 * A button that names the current choice and opens a menu of the others: the
 * list Find is showing, or News and Events on Happening. It sits beside the
 * Filters button and looks like it.
 *
 * @param {object} props
 * @param {string} props.label What the menu chooses between, for screen readers
 * @param {{id: string, label: string}[]} props.options
 * @param {string} props.value The id of the current choice
 * @param {(id: string) => void} props.onChange Called with the id picked, the current one included
 * @returns {JSX.Element}
 */
export default function MenuPicker({ label, options, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const current = options.find(option => option.id === value) || options[0];

  useEffect(() => {
    if (isOpen) menuRef.current?.querySelector('[aria-checked="true"]')?.focus();
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = Array.from(e.currentTarget.querySelectorAll('[role="menuitemradio"]'));
      const idx = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  };

  return (
    <div className="find-list-picker">
      <button
        type="button"
        ref={buttonRef}
        className="find-list-btn"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(prev => !prev)}
      >
        <span className="find-list-btn-label">{current?.label}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M7 10l5 5 5-5z" />
        </svg>
      </button>
      {isOpen && (
        <>
          <div className="tab-dropdown-backdrop" onClick={close} />
          <div className="tab-dropdown find-list-menu" role="menu" aria-label={label} ref={menuRef} onKeyDown={handleKeyDown}>
            {options.map(option => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={option.id === value}
                className={`dropdown-item-inline find-list-item ${option.id === value ? 'active' : ''}`}
                data-list={option.id}
                onClick={() => { close(); onChange(option.id); }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
