import React, { useState, useEffect } from 'react';
import PoiSearchSelect from './PoiSearchSelect';

const TZ_ABBR = (() => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone: 'America/New_York' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || 'ET';
  } catch { return 'ET'; }
})();

function NewEventForm({ onClose, onCreate }) {
  const [formData, setFormData] = useState({
    poi_id: '',
    title: '',
    description: '',
    start_date: '',
    end_date: '',
    event_type: '',
    location_details: '',
    publication_date: '',
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
    if (!formData.start_date) {
      setError('Start date is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/events', {
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
        throw new Error(err.error || 'Failed to create event');
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
          <h3>Create Event</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="new-content-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-section">
            <label>Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="Event title..."
              required
            />
          </div>

          <div className="form-section">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Event description..."
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
            <label>Start Date/Time ({TZ_ABBR}) *</label>
            <input
              type="datetime-local"
              value={formData.start_date}
              onChange={(e) => handleChange('start_date', e.target.value)}
              required
            />
          </div>

          <div className="form-section">
            <label>End Date/Time ({TZ_ABBR})</label>
            <input
              type="datetime-local"
              value={formData.end_date}
              onChange={(e) => handleChange('end_date', e.target.value)}
            />
          </div>

          <div className="form-section">
            <label>Event Type</label>
            <input
              type="text"
              value={formData.event_type}
              onChange={(e) => handleChange('event_type', e.target.value)}
              placeholder="e.g., hike, concert, festival"
            />
          </div>

          <div className="form-section">
            <label>Location Details</label>
            <input
              type="text"
              value={formData.location_details}
              onChange={(e) => handleChange('location_details', e.target.value)}
              placeholder="e.g., Howe Meadow"
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
              {saving ? 'Creating...' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewEventForm;
