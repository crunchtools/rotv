// Shared editor for the News & Events filter lists. `type` drives the color:
// allow lists are green, block lists are red, consistently across the section.
export const FILTER_COLORS = {
  allow: { heading: '#28a745', chipBg: '#d4edda', chipText: '#155724' },
  block: { heading: '#dc3545', chipBg: '#f8d7da', chipText: '#721c24' }
};

export function FilterChip({ label, type, onRemove }) {
  const c = FILTER_COLORS[type];
  return (
    <span style={{
      padding: '0.25rem 0.5rem',
      backgroundColor: c.chipBg,
      color: c.chipText,
      borderRadius: '4px',
      fontSize: '0.85rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem'
    }}>
      {label}
      <button onClick={onRemove} style={{
        background: 'none', border: 'none', color: c.chipText,
        cursor: 'pointer', padding: '0', fontSize: '1rem', lineHeight: '1'
      }}>×</button>
    </span>
  );
}

export default function FilterList({ title, type, hint, items, value, onValueChange, onAdd, onRemove, placeholder, disabled }) {
  const c = FILTER_COLORS[type];
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h5 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: c.heading }}>{title}</h5>
      <p className="config-hint" style={{ marginBottom: '0.75rem' }}>{hint}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {items.map(item => (
          <FilterChip key={item} label={item} type={type} onRemove={() => onRemove(item)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          value={value}
          onChange={e => onValueChange(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && onAdd()}
          placeholder={placeholder}
          style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}
          disabled={disabled}
        />
        <button className="action-btn secondary" onClick={onAdd} disabled={disabled || !value.trim()}>Add</button>
      </div>
    </div>
  );
}
