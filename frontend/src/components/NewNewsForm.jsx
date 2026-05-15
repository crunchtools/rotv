import React, { useState, useEffect } from 'react';
import PoiSearchSelect from './PoiSearchSelect';

// Matches FIELD_CONFIGS.news in ModerationInbox.jsx
const TZ_ABBR = (() => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone: 'America/New_York' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || 'ET';
  } catch { return 'ET'; }
})();

function NewNewsForm({ onClose, onCreate }) {
  const [formData, setFormData] = useState({
    poi_id: '',
    title: '',
    summary: '',
    news_type: 'general',
    publication_date: '',
    source_name: '',
    source_url: ''
  });
  const [pois, setPois] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/pois', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        const sorted = (Array.isArray(data) ? data : [])
          .filter(p => !p.deleted)
          .sort((a, b) => a.name.localeCompare(b.name));
        setPois(sorted);
      })
      .catch(() => setPois([]));
  }, []);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      setError('Title is required');
      return;
    }
    if (!formData.poi_id) {
      setError('Please select a location');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...formData,
          poi_id: parseInt(formData.poi_id),
          publication_date: formData.publication_date || null
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create news item');
      }

      const newItem = await response.json();
      if (onCreate) onCreate(newItem);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="new-content-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="new-content-modal">
        <div className="new-content-header">
          <h3>Create News Item</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="new-content-form">
          {error && <div className="form-error">{error}</div>}

          {/* Primary fields: Title, Summary, POI, Date */}
          <div className="form-section">
            <label>Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="News headline..."
              required
            />
          </div>

          <div className="form-section">
            <label>Summary</label>
            <textarea
              value={formData.summary}
              onChange={(e) => handleChange('summary', e.target.value)}
              placeholder="Brief summary of the news..."
              rows={3}
            />
          </div>

          <div className="form-section">
            <label>POI *</label>
            <PoiSearchSelect
              pois={pois}
              value={formData.poi_id}
              onChange={(id) => handleChange('poi_id', id || '')}
              placeholder="Search POIs..."
            />
          </div>

          <div className="form-section">
            <label>Publication Date ({TZ_ABBR})</label>
            <input
              type="datetime-local"
              value={formData.publication_date}
              onChange={(e) => handleChange('publication_date', e.target.value)}
            />
          </div>

          {/* Secondary fields: Type, Source */}
          <div className="form-section">
            <label>Type</label>
            <select
              value={formData.news_type}
              onChange={(e) => handleChange('news_type', e.target.value)}
            >
              <option value="general">General</option>
              <option value="closure">Closure</option>
              <option value="seasonal">Seasonal</option>
              <option value="maintenance">Maintenance</option>
              <option value="wildlife">Wildlife</option>
            </select>
          </div>

          <div className="form-section">
            <label>Source Name</label>
            <input
              type="text"
              value={formData.source_name}
              onChange={(e) => handleChange('source_name', e.target.value)}
              placeholder="e.g., NPS.gov"
            />
          </div>

          <div className="form-section">
            <label>Primary URL</label>
            <input
              type="url"
              value={formData.source_url}
              onChange={(e) => handleChange('source_url', e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="form-buttons">
            <button type="button" className="cancel-btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="save-btn" disabled={saving}>
              {saving ? 'Creating...' : 'Create News'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewNewsForm;
