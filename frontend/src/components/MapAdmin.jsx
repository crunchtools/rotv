import React, { useState } from 'react';

const DEFAULT_BOUNDS = {
  south: 41.1390,
  west: -81.6654,
  north: 41.4226,
  east: -81.4706
};

function MapAdmin({ bounds, onBoundsChange, onClose, opacity, onOpacityChange }) {
  const [localBounds, setLocalBounds] = useState(bounds || DEFAULT_BOUNDS);

  const updateBounds = (newBounds) => {
    setLocalBounds(newBounds);
    onBoundsChange([[newBounds.south, newBounds.west], [newBounds.north, newBounds.east]]);
  };

  const handleChange = (key, value) => {
    const newBounds = { ...localBounds, [key]: parseFloat(value) };
    updateBounds(newBounds);
  };

  const shiftOverlay = (direction, amount) => {
    const newBounds = { ...localBounds };
    switch (direction) {
      case 'north':
        newBounds.north += amount;
        newBounds.south += amount;
        break;
      case 'south':
        newBounds.north -= amount;
        newBounds.south -= amount;
        break;
      case 'east':
        newBounds.east += amount;
        newBounds.west += amount;
        break;
      case 'west':
        newBounds.east -= amount;
        newBounds.west -= amount;
        break;
    }
    updateBounds(newBounds);
  };

  const stretchEdge = (edge, amount) => {
    const newBounds = { ...localBounds };
    newBounds[edge] += amount;
    updateBounds(newBounds);
  };

  const copyToClipboard = () => {
    const code = `const NPS_MAP_BOUNDS = [
  [${localBounds.south.toFixed(4)}, ${localBounds.west.toFixed(4)}],  // Southwest corner
  [${localBounds.north.toFixed(4)}, ${localBounds.east.toFixed(4)}]   // Northeast corner
];`;
    navigator.clipboard.writeText(code);
    alert('Bounds copied to clipboard! Paste into Map.jsx to save permanently.');
  };

  return (
    <div className="map-admin">
      <div className="admin-header">
        <h3>Map Overlay Alignment</h3>
        <button className="close-btn" onClick={onClose}>&times;</button>
      </div>

      <div className="admin-content">
        <div className="admin-section">
          <h4>Transparency</h4>
          <div className="opacity-controls">
            <button
              className={opacity === 1.0 ? 'active' : ''}
              onClick={() => onOpacityChange(1.0)}
            >
              100%
            </button>
            <button
              className={opacity === 0.7 ? 'active' : ''}
              onClick={() => onOpacityChange(0.7)}
            >
              70%
            </button>
            <button
              className={opacity === 0.5 ? 'active' : ''}
              onClick={() => onOpacityChange(0.5)}
            >
              50%
            </button>
            <button
              className={opacity === 0.3 ? 'active' : ''}
              onClick={() => onOpacityChange(0.3)}
            >
              30%
            </button>
          </div>
        </div>

        <div className="admin-section">
          <h4>Move Entire Overlay</h4>
          <p className="admin-hint">Shifts the whole map without stretching</p>
          <div className="shift-controls">
            <div className="shift-row">
              <button onClick={() => shiftOverlay('north', 0.001)}>↑</button>
              <button onClick={() => shiftOverlay('north', 0.005)}>↑↑</button>
            </div>
            <div className="shift-row">
              <button onClick={() => shiftOverlay('west', 0.005)}>←←</button>
              <button onClick={() => shiftOverlay('west', 0.001)}>←</button>
              <button onClick={() => shiftOverlay('east', 0.001)}>→</button>
              <button onClick={() => shiftOverlay('east', 0.005)}>→→</button>
            </div>
            <div className="shift-row">
              <button onClick={() => shiftOverlay('south', 0.001)}>↓</button>
              <button onClick={() => shiftOverlay('south', 0.005)}>↓↓</button>
            </div>
          </div>
        </div>

        <div className="admin-section">
          <h4>Stretch Edges</h4>
          <p className="admin-hint">Coarse (0.005) | Fine (0.001) | Ultra-fine (0.0002)</p>

          <div className="stretch-controls">
            <div className="stretch-group">
              <label>North:</label>
              <div className="stretch-buttons">
                <button onClick={() => stretchEdge('north', -0.005)}>−−</button>
                <button onClick={() => stretchEdge('north', -0.001)}>−</button>
                <button onClick={() => stretchEdge('north', -0.0002)}>-</button>
                <button onClick={() => stretchEdge('north', 0.0002)}>+</button>
                <button onClick={() => stretchEdge('north', 0.001)}>+</button>
                <button onClick={() => stretchEdge('north', 0.005)}>++</button>
              </div>
            </div>

            <div className="stretch-group">
              <label>South:</label>
              <div className="stretch-buttons">
                <button onClick={() => stretchEdge('south', 0.005)}>−−</button>
                <button onClick={() => stretchEdge('south', 0.001)}>−</button>
                <button onClick={() => stretchEdge('south', 0.0002)}>-</button>
                <button onClick={() => stretchEdge('south', -0.0002)}>+</button>
                <button onClick={() => stretchEdge('south', -0.001)}>+</button>
                <button onClick={() => stretchEdge('south', -0.005)}>++</button>
              </div>
            </div>

            <div className="stretch-group">
              <label>East:</label>
              <div className="stretch-buttons">
                <button onClick={() => stretchEdge('east', -0.005)}>−−</button>
                <button onClick={() => stretchEdge('east', -0.001)}>−</button>
                <button onClick={() => stretchEdge('east', -0.0002)}>-</button>
                <button onClick={() => stretchEdge('east', 0.0002)}>+</button>
                <button onClick={() => stretchEdge('east', 0.001)}>+</button>
                <button onClick={() => stretchEdge('east', 0.005)}>++</button>
              </div>
            </div>

            <div className="stretch-group">
              <label>West:</label>
              <div className="stretch-buttons">
                <button onClick={() => stretchEdge('west', 0.005)}>−−</button>
                <button onClick={() => stretchEdge('west', 0.001)}>−</button>
                <button onClick={() => stretchEdge('west', 0.0002)}>-</button>
                <button onClick={() => stretchEdge('west', -0.0002)}>+</button>
                <button onClick={() => stretchEdge('west', -0.001)}>+</button>
                <button onClick={() => stretchEdge('west', -0.005)}>++</button>
              </div>
            </div>
          </div>
        </div>

        <div className="admin-section">
          <h4>Fine Tuning</h4>
          <div className="bounds-inputs">
            <div className="input-group">
              <label>North:</label>
              <input
                type="number"
                step="0.001"
                value={localBounds.north}
                onChange={(e) => handleChange('north', e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>South:</label>
              <input
                type="number"
                step="0.001"
                value={localBounds.south}
                onChange={(e) => handleChange('south', e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>East:</label>
              <input
                type="number"
                step="0.001"
                value={localBounds.east}
                onChange={(e) => handleChange('east', e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>West:</label>
              <input
                type="number"
                step="0.001"
                value={localBounds.west}
                onChange={(e) => handleChange('west', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="admin-actions">
          <button className="copy-btn" onClick={copyToClipboard}>
            Copy Bounds to Clipboard
          </button>
        </div>

        <div className="current-values">
          <code>
            South: {localBounds.south.toFixed(4)}, West: {localBounds.west.toFixed(4)}<br/>
            North: {localBounds.north.toFixed(4)}, East: {localBounds.east.toFixed(4)}
          </code>
        </div>
      </div>
    </div>
  );
}

export default MapAdmin;
