import React, { useState } from 'react';

const COLOR_PALETTE = [
  { name: 'Park Green', hex: '#2d5016' },
  { name: 'Water Blue', hex: '#0288d1' },
  { name: 'Historic Brown', hex: '#795548' },
  { name: 'Trail Brown', hex: '#8B4513' },
  { name: 'Historic Orange', hex: '#e65100' },
  { name: 'Train Gray', hex: '#455a64' },
  { name: 'Music Purple', hex: '#7b1fa2' },
  { name: 'Warning Orange', hex: '#f57c00' },
  { name: 'Default Gray', hex: '#607d8b' },
];

function IconGeneratorModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState('#0288d1');
  const [customColor, setCustomColor] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatedSvg, setGeneratedSvg] = useState(null);
  const [error, setError] = useState(null);

  const handleLabelChange = (newLabel) => {
    setLabel(newLabel);
    const suggestedName = newLabel.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!name || name === label.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')) {
      setName(suggestedName);
    }
  };

  const handleColorSelect = (hex) => {
    setSelectedColor(hex);
    setCustomColor('');
  };

  const handleCustomColorChange = (value) => {
    setCustomColor(value);
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      setSelectedColor(value);
    }
  };

  const handleGenerate = async () => {
    if (!description.trim()) {
      setError('Please enter a description of the icon');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/icons/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          description: description.trim(),
          color: selectedColor
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate icon');
      }

      const data = await response.json();
      setGeneratedSvg(data.svg_content);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter an icon name');
      return;
    }
    if (!label.trim()) {
      setError('Please enter an icon label');
      return;
    }
    if (!generatedSvg) {
      setError('Please generate an icon first');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/icons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          label: label.trim(),
          svg_content: generatedSvg
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save icon');
      }

      const savedIcon = await response.json();
      onSave(savedIcon);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const activeColor = customColor && /^#[0-9A-Fa-f]{6}$/.test(customColor) ? customColor : selectedColor;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="icon-generator-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Generate New Icon</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {error && <div className="sync-error">{error}</div>}

          <div className="generator-layout">
            <div className="generator-form">
              <div className="form-group">
                <label>Icon Label:</label>
                <input
                  type="text"
                  value={label}
                  onChange={e => handleLabelChange(e.target.value)}
                  placeholder="e.g., Lighthouse"
                />
                <p className="field-hint">Display name shown in settings</p>
              </div>

              <div className="form-group">
                <label>Icon Name (ID):</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="e.g., lighthouse"
                />
                <p className="field-hint">Unique identifier (lowercase, no spaces)</p>
              </div>

              <div className="form-group">
                <label>Description (for AI):</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Describe what the icon should look like, e.g., 'A tall lighthouse with light beam shining'"
                  rows={3}
                />
                <p className="field-hint">Describe the icon for AI generation</p>
              </div>

              <div className="form-group">
                <label>Background Color:</label>
                <div className="color-palette">
                  {COLOR_PALETTE.map(color => (
                    <button
                      key={color.hex}
                      className={`color-swatch ${selectedColor === color.hex && !customColor ? 'selected' : ''}`}
                      style={{ backgroundColor: color.hex }}
                      onClick={() => handleColorSelect(color.hex)}
                      title={color.name}
                    />
                  ))}
                </div>
                <div className="custom-color">
                  <label>Custom:</label>
                  <input
                    type="text"
                    value={customColor}
                    onChange={e => handleCustomColorChange(e.target.value)}
                    placeholder="#0288d1"
                    maxLength={7}
                  />
                  <div
                    className="color-preview"
                    style={{ backgroundColor: activeColor }}
                  />
                </div>
              </div>

              <div className="generator-actions">
                <button
                  onClick={handleGenerate}
                  disabled={generating || !description.trim()}
                  className="generate-btn"
                >
                  {generating ? 'Generating...' : generatedSvg ? 'Regenerate' : 'Generate Icon'}
                </button>
              </div>
            </div>

            <div className="generator-preview">
              <label>Preview:</label>
              <div className="preview-container">
                {generatedSvg ? (
                  <div
                    className="svg-preview"
                    dangerouslySetInnerHTML={{ __html: generatedSvg }}
                  />
                ) : (
                  <div className="preview-placeholder">
                    {generating ? 'Generating...' : 'Click Generate to create an icon'}
                  </div>
                )}
              </div>
              {generatedSvg && (
                <div className="preview-sizes">
                  <span className="size-label">Sizes:</span>
                  <div
                    className="svg-preview size-32"
                    dangerouslySetInnerHTML={{ __html: generatedSvg }}
                    title="32x32"
                  />
                  <div
                    className="svg-preview size-24"
                    dangerouslySetInnerHTML={{ __html: generatedSvg }}
                    title="24x24"
                  />
                  <div
                    className="svg-preview size-16"
                    dangerouslySetInnerHTML={{ __html: generatedSvg }}
                    title="16x16"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !generatedSvg || !name.trim() || !label.trim()}
            className="save-btn"
          >
            {saving ? 'Saving...' : 'Save Icon'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default IconGeneratorModal;
