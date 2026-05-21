function CellSignal({ level }) {
  const bars = [1, 2, 3, 4, 5];
  return (
    <div className="cell-signal">
      {bars.map(bar => (
        <div
          key={bar}
          className={`signal-bar ${bar <= level ? 'active' : ''}`}
          style={{ height: `${8 + bar * 3}px` }}
        />
      ))}
    </div>
  );
}

export function EditableCellSignal({ level, onChange }) {
  return (
    <select value={level || ''} onChange={(e) => onChange(e.target.value ? parseInt(e.target.value) : null)}>
      <option value="">Unknown</option>
      <option value="1">1 - Very Poor</option>
      <option value="2">2 - Poor</option>
      <option value="3">3 - Fair</option>
      <option value="4">4 - Good</option>
      <option value="5">5 - Excellent</option>
    </select>
  );
}

export default CellSignal;
