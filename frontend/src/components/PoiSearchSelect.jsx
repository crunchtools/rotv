import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Searchable POI selector — replaces plain <select> dropdowns.
 * Shows a text input that filters POIs by name as you type,
 * with a dropdown of matching results.
 */
function PoiSearchSelect({ pois, value, onChange, placeholder = 'Search POIs...', disabled = false, style = {} }) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Find the currently selected POI name for display
  const selectedPoi = value ? pois.find(p => p.id === parseInt(value)) : null;

  const filtered = search.trim()
    ? pois.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 50)
    : pois.slice(0, 50);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current && listRef.current.children[highlightIndex]) {
      listRef.current.children[highlightIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex, isOpen]);

  const handleKeyDown = useCallback((e) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHighlightIndex(i => Math.min(i + 1, filtered.length - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlightIndex(i => Math.max(i - 1, 0));
      e.preventDefault();
    } else if (e.key === 'Enter' && filtered[highlightIndex]) {
      onChange(filtered[highlightIndex].id);
      setSearch('');
      setIsOpen(false);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, [isOpen, filtered, highlightIndex, onChange]);

  const handleSelect = (poi) => {
    onChange(poi.id);
    setSearch('');
    setIsOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setSearch('');
  };

  const handleFocus = () => {
    setIsOpen(true);
    setHighlightIndex(0);
  };

  const handleInputChange = (e) => {
    setSearch(e.target.value);
    setIsOpen(true);
    setHighlightIndex(0);
  };

  const containerStyle = {
    position: 'relative',
    width: '100%',
    ...style
  };

  const inputWrapStyle = {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid #d0d0d0',
    borderRadius: '6px',
    backgroundColor: disabled ? '#f5f5f5' : 'white',
    overflow: 'hidden'
  };

  const inputStyle = {
    flex: 1,
    padding: '6px 10px',
    border: 'none',
    outline: 'none',
    fontSize: '0.85rem',
    backgroundColor: 'transparent',
    minWidth: 0
  };

  const dropdownStyle = {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    maxHeight: '200px',
    overflowY: 'auto',
    backgroundColor: 'white',
    border: '1px solid #d0d0d0',
    borderTop: 'none',
    borderRadius: '0 0 6px 6px',
    zIndex: 1000,
    boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
  };

  const itemStyle = (isHighlighted) => ({
    padding: '6px 10px',
    fontSize: '0.85rem',
    cursor: 'pointer',
    backgroundColor: isHighlighted ? '#e8f0fe' : 'white',
    borderBottom: '1px solid #f0f0f0'
  });

  const clearBtnStyle = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 8px',
    fontSize: '1rem',
    color: '#999',
    lineHeight: 1
  };

  return (
    <div ref={containerRef} style={containerStyle}>
      <div style={inputWrapStyle}>
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? search : (selectedPoi ? selectedPoi.name : '')}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={selectedPoi ? selectedPoi.name : placeholder}
          disabled={disabled}
          style={inputStyle}
        />
        {selectedPoi && !disabled && (
          <button onClick={handleClear} style={clearBtnStyle} title="Clear selection" type="button">&times;</button>
        )}
      </div>
      {isOpen && !disabled && (
        <div ref={listRef} style={dropdownStyle}>
          {filtered.length === 0 ? (
            <div style={{ padding: '8px 10px', fontSize: '0.85rem', color: '#999' }}>No matches</div>
          ) : (
            filtered.map((poi, idx) => (
              <div
                key={poi.id}
                style={itemStyle(idx === highlightIndex)}
                onMouseEnter={() => setHighlightIndex(idx)}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(poi); }}
              >
                {poi.name}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default PoiSearchSelect;
