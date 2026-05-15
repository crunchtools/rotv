import React, { useState, useEffect } from 'react';

function NewEventForm({ onClose, onCreate }) {
  const [formData, setFormData] = useState({
    poi_id: '',
    title: '',
    start_date: '',
    end_date: '',
    description: '',
    event_type: '',
    location_details: '',
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

    if (!formData.poi_id) {
      setError('Please select a location');
      return;
    }
    if (!formData.title.trim()) {
      setError('Title is required');
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
          poi_id: parseInt(formData.poi_id)
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
            <label>Location *</label>
            <select
              value={formData.poi_id}
              onChange={(e) => handleChange('poi_id', e.target.value)}
              required
            >
              <option value="">Select a location...</option>
              {pois.map(poi => (
                <option key={poi.id} value={poi.id}>{poi.name}</option>
              ))}
            </select>
          </div>

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

          <div className="form-row">
            <div className="form-section">
              <label>Start Date *</label>
              <input
                type="date"
                value={formData.start_date}
                onChange={(e) => handleChange('start_date', e.target.value)}
                required
              />
            </div>
            <div className="form-section">
              <label>End Date</label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => handleChange('end_date', e.target.value)}
              />
            </div>
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

          <div className="form-row">
            <div className="form-section">
              <label>Event Type</label>
              <select
                value={formData.event_type}
                onChange={(e) => handleChange('event_type', e.target.value)}
              >
                <option value="">Select type...</option>
                <option value="hike">Hike</option>
                <option value="race">Race</option>
                <option value="concert">Concert</option>
                <option value="festival">Festival</option>
                <option value="program">Program</option>
                <option value="volunteer">Volunteer</option>
                <option value="arts">Arts</option>
                <option value="community">Community</option>
              </select>
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
          </div>

          <div className="form-section">
            <label>Source URL</label>
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
