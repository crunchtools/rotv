import React, { useState, useEffect } from 'react';

function NewPOIForm({ onClose, onCreate, initialCoords }) {
  const [formData, setFormData] = useState({
    name: '',
    latitude: initialCoords?.lat?.toFixed(6) || '',
    longitude: initialCoords?.lng?.toFixed(6) || '',
    owner_id: null,
    property_owner: '',
    brief_description: '',
    era_id: null,
    historical_description: '',
    primary_activities: '',
    surface: '',
    pets: '',
    cell_signal: '',
    more_info_link: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [availableOwnerOrgs, setAvailableOwnerOrgs] = useState([]);
  const [availableEras, setAvailableEras] = useState([]);

  useEffect(() => {
    async function fetchOwnerOrgs() {
      try {
        const response = await fetch('/api/owner-organizations', {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setAvailableOwnerOrgs(data);
        }
      } catch (err) {
        console.error('Failed to fetch owner organizations:', err);
      }
    }

    async function fetchEras() {
      try {
        const response = await fetch('/api/admin/eras', {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setAvailableEras(data);
        }
      } catch (err) {
        console.error('Failed to fetch eras:', err);
      }
    }

    fetchOwnerOrgs();
    fetchEras();
  }, []);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setError('Name is required');
      return;
    }

    if (!formData.latitude || !formData.longitude) {
      setError('Coordinates are required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/destinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...formData,
          latitude: parseFloat(formData.latitude),
          longitude: parseFloat(formData.longitude),
          cell_signal: formData.cell_signal ? parseInt(formData.cell_signal) : null
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create POI');
      }

      const newDest = await response.json();
      if (onCreate) {
        onCreate(newDest);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="new-poi-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="new-poi-modal">
        <div className="new-poi-header">
          <h2>Create New Point of Interest</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="new-poi-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-section">
            <label>Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="e.g., Towpath Trail - Lock 29"
              required
            />
          </div>

          <div className="form-row">
            <div className="form-section half">
              <label>Latitude *</label>
              <input
                type="number"
                step="0.000001"
                value={formData.latitude}
                onChange={(e) => handleChange('latitude', e.target.value)}
                placeholder="41.2626"
                required
              />
            </div>
            <div className="form-section half">
              <label>Longitude *</label>
              <input
                type="number"
                step="0.000001"
                value={formData.longitude}
                onChange={(e) => handleChange('longitude', e.target.value)}
                placeholder="-81.5604"
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-section half">
              <label>Era</label>
              <select
                value={formData.era_id || ''}
                onChange={(e) => {
                  const eraId = e.target.value ? parseInt(e.target.value) : null;
                  handleChange('era_id', eraId);
                }}
              >
                <option value="">Select an era...</option>
                {availableEras.map(era => (
                  <option key={era.id} value={era.id}>
                    {era.name}
                    {era.year_start || era.year_end
                      ? ` (${era.year_start || ''}${era.year_start && era.year_end ? '-' : ''}${era.year_end || '+'})`
                      : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-section half">
              <label>Property Owner</label>
              <select
                value={formData.owner_id || ''}
                onChange={(e) => {
                  const ownerId = e.target.value ? parseInt(e.target.value) : null;
                  const ownerOrg = availableOwnerOrgs.find(o => o.id === ownerId);
                  handleChange('owner_id', ownerId);
                  handleChange('property_owner', ownerOrg ? ownerOrg.name : '');
                }}
              >
                <option value="">-- No Owner --</option>
                {availableOwnerOrgs.map(org => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-section">
            <label>Brief Description</label>
            <textarea
              value={formData.brief_description}
              onChange={(e) => handleChange('brief_description', e.target.value)}
              rows={2}
              placeholder="A short overview..."
            />
          </div>

          <div className="form-section">
            <label>Historical Description</label>
            <textarea
              value={formData.historical_description}
              onChange={(e) => handleChange('historical_description', e.target.value)}
              rows={4}
              placeholder="Detailed historical significance..."
            />
          </div>

          <div className="form-section">
            <label>Primary Activities</label>
            <input
              type="text"
              value={formData.primary_activities}
              onChange={(e) => handleChange('primary_activities', e.target.value)}
              placeholder="e.g., Hiking, Biking, History"
            />
          </div>

          <div className="form-row">
            <div className="form-section half">
              <label>Surface</label>
              <input
                type="text"
                value={formData.surface}
                onChange={(e) => handleChange('surface', e.target.value)}
                placeholder="e.g., Paved, Gravel"
              />
            </div>
            <div className="form-section half">
              <label>Pets Allowed</label>
              <select
                value={formData.pets}
                onChange={(e) => handleChange('pets', e.target.value)}
              >
                <option value="">Unknown</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
                <option value="Leashed">Leashed Only</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-section half">
              <label>Cell Signal (1-5)</label>
              <select
                value={formData.cell_signal}
                onChange={(e) => handleChange('cell_signal', e.target.value)}
              >
                <option value="">Unknown</option>
                <option value="1">1 - Very Poor</option>
                <option value="2">2 - Poor</option>
                <option value="3">3 - Fair</option>
                <option value="4">4 - Good</option>
                <option value="5">5 - Excellent</option>
              </select>
            </div>
          </div>

          <div className="form-section">
            <label>More Info Link</label>
            <input
              type="text"
              value={formData.more_info_link}
              onChange={(e) => handleChange('more_info_link', e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="form-buttons">
            <button type="button" className="cancel-btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="save-btn" disabled={saving}>
              {saving ? 'Creating...' : 'Create POI'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewPOIForm;
