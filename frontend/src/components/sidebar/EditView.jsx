import { useState, useEffect } from 'react';
import ImageUploader from '../ImageUploader';
import RoleEditor from '../RoleEditor';
import GeoJSONUploader from '../GeoJSONUploader';
import { EditableCellSignal } from './CellSignal';

function EditView({ destination, editedData, setEditedData, onSave, onCancel, onDelete, saving, deleting, onPreviewCoordsChange, isNewPOI, isNewOrganization, _onImageUpdate, isLinearFeature, showImage }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [aiError, setAiError] = useState(null);

  const [researching, setResearching] = useState(false);

  const [researchDraft, setResearchDraft] = useState(null);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [draftFieldStates, setDraftFieldStates] = useState({});

  const [pendingImage, setPendingImage] = useState(null);

  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch('/api/auth/status', { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(data => setUser(data?.user || null))
      .catch(() => setUser(null));
  }, []);

  const handleMediaUpdate = () => {
  };

  const handleSaveWithImage = async () => {
    if (!destination?.id) {
      await onSave();
      return;
    }

    try {
      if (pendingImage) {
        if (pendingImage.deleted) {
          await fetch(`/api/admin/pois/${destination.id}/image`, {
            method: 'DELETE',
            credentials: 'include'
          });
        } else if (pendingImage.data) {
          const endpoint = `/api/admin/pois/${destination.id}/image-base64`;
          await fetch(endpoint, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData: pendingImage.data,
              mimeType: pendingImage.mimeType
            })
          });
        }
        setPendingImage(null);
      }

      await onSave();
    } catch (err) {
      alert(`Error processing image: ${err.message}`);
      throw err;
    }
  };

  const handleCancelWithCleanup = () => {
    setPendingImage(null);
    onCancel();
  };

  const [availableActivities, setAvailableActivities] = useState([]);
  const [showActivityDropdown, setShowActivityDropdown] = useState(false);

  const [availableEras, setAvailableEras] = useState([]);

  const [availableSurfaces, setAvailableSurfaces] = useState([]);

  const [availableOwnerOrgs, setAvailableOwnerOrgs] = useState([]);

  useEffect(() => {
    async function fetchActivities() {
      try {
        const response = await fetch('/api/admin/activities', {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setAvailableActivities(data);
        }
      } catch (err) {
        console.error('Failed to fetch activities:', err);
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

    async function fetchSurfaces() {
      try {
        const response = await fetch('/api/admin/surfaces', {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setAvailableSurfaces(data);
        }
      } catch (err) {
        console.error('Failed to fetch surfaces:', err);
      }
    }

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

    fetchActivities();
    fetchEras();
    fetchSurfaces();
    fetchOwnerOrgs();
  }, []);

  const selectedActivities = (editedData.primary_activities || '')
    .split(',')
    .map(a => a.trim())
    .filter(a => a);

  const toggleActivity = (activityName) => {
    const current = new Set(selectedActivities);
    if (current.has(activityName)) {
      current.delete(activityName);
    } else {
      current.add(activityName);
    }
    setEditedData(prev => ({
      ...prev,
      primary_activities: Array.from(current).join(', ')
    }));
  };

  const handleResearch = async () => {
    setResearching(true);
    setAiError(null);

    try {
      const response = await fetch('/api/admin/ai/research-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          destination: editedData,
          adminContext: editedData.research_context || ''
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Research failed');
      }

      const result = await response.json();

      setResearchDraft(result.data);
      const fields = ['era_id', 'property_owner', 'primary_activities', 'surface', 'pets', 'brief_description', 'historical_description'];
      const initialStates = {};
      for (const field of fields) {
        initialStates[field] = result.data[field] != null;
      }
      setDraftFieldStates(initialStates);
      setShowDraftModal(true);

    } catch (err) {
      setAiError(err.message);
    } finally {
      setResearching(false);
    }
  };

  const handleAcceptDraft = async () => {
    const updates = {};
    if (draftFieldStates.era_id && researchDraft.era_id) updates.era_id = researchDraft.era_id;
    if (draftFieldStates.property_owner && researchDraft.property_owner) updates.property_owner = researchDraft.property_owner;
    if (draftFieldStates.primary_activities && researchDraft.primary_activities) updates.primary_activities = researchDraft.primary_activities;
    if (draftFieldStates.surface && researchDraft.surface) updates.surface = researchDraft.surface;
    if (draftFieldStates.pets && researchDraft.pets) updates.pets = researchDraft.pets;
    if (draftFieldStates.brief_description && researchDraft.brief_description) updates.brief_description = researchDraft.brief_description;
    if (draftFieldStates.historical_description && researchDraft.historical_description) updates.historical_description = researchDraft.historical_description;

    setEditedData(prev => ({ ...prev, ...updates }));

    setShowDraftModal(false);
    setResearchDraft(null);
  };

  const handleChange = (field, value) => {
    setEditedData(prev => ({ ...prev, [field]: value }));
  };

  const handleCoordChange = (field, value) => {
    const numValue = value ? parseFloat(value) : null;
    setEditedData(prev => {
      const updated = { ...prev, [field]: numValue };
      if (onPreviewCoordsChange) {
        const lat = field === 'latitude' ? numValue : parseFloat(prev.latitude);
        const lng = field === 'longitude' ? numValue : parseFloat(prev.longitude);
        if (!isNaN(lat) && !isNaN(lng) && lat && lng) {
          onPreviewCoordsChange({ lat, lng });
        }
      }
      return updated;
    });
  };

  return (
    <div className="edit-view-container">
      <div className="edit-view-scroll">
      {showImage && (
        !isNewPOI && destination?.id ? (
          <ImageUploader
            destinationId={destination.id}
            hasImage={!!editedData.has_primary_image}
            pendingImage={pendingImage}
            onPendingImageChange={setPendingImage}
            updatedAt={editedData.updated_at}
            disabled={saving}
            isVirtualPoi={destination?.poi_roles?.includes('organization') && !destination?.geometry && !destination?.latitude}
            user={user}
            poiId={destination.id}
            onMediaUpdate={handleMediaUpdate}
          />
        ) : (
          <div className="sidebar-image">
            {(() => {
              const thumbUrl = isLinearFeature
                ? (destination?.poi_roles?.includes('river') ? '/icons/thumbnails/river.svg'
                  : destination?.poi_roles?.includes('boundary') ? '/icons/thumbnails/boundary.svg'
                  : '/icons/thumbnails/trail.svg')
                : '/icons/thumbnails/destination.svg';
              return <img src={thumbUrl} alt={destination?.name || 'New POI'} className="default-thumbnail" />;
            })()}
          </div>
        )
      )}

      {aiError && (
        <div className="ai-error-banner">
          <span>AI Error: {aiError}</span>
          <button onClick={() => setAiError(null)}>Dismiss</button>
        </div>
      )}

      <div className="research-section">
        <button
          className="research-btn"
          onClick={handleResearch}
          disabled={researching || !editedData.name}
          title={!editedData.name ? 'Enter a name first' : 'Research this location and fill all fields'}
        >
          {researching ? 'Researching...' : 'Research with AI'}
        </button>
        <span className="research-hint">Multi-pass research with draft approval</span>
      </div>

      <div className="edit-section">
        <label title="Optional notes to guide AI research (e.g., 'This is a historic gristmill built in 1810, focus on canal era connections')">Research Context</label>
        <textarea
          value={editedData.research_context || ''}
          onChange={(e) => handleChange('research_context', e.target.value)}
          placeholder="Optional notes to guide AI research..."
          rows={2}
          style={{ resize: 'vertical' }}
        />
      </div>

      <div className="edit-section">
        <label title="The display name for this location">Name *</label>
        <input
          type="text"
          value={editedData.name || ''}
          onChange={(e) => handleChange('name', e.target.value)}
          placeholder="Enter POI name..."
        />
      </div>

      {(isNewPOI || isNewOrganization || editedData.poi_roles) && (
        <RoleEditor
          roles={editedData.poi_roles || []}
          onChange={(roles) => handleChange('poi_roles', roles)}
        />
      )}

      {editedData.poi_roles && (editedData.poi_roles.includes('trail') || editedData.poi_roles.includes('river') || editedData.poi_roles.includes('boundary')) && (
        <GeoJSONUploader
          geometry={editedData.geometry}
          onChange={(geometry) => handleChange('geometry', geometry)}
        />
      )}

      <div className="edit-section">
        <label title="A short public-facing description of this location">Overview</label>
        <textarea
          value={editedData.brief_description || ''}
          onChange={(e) => {
            handleChange('brief_description', e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          style={{ overflow: 'hidden', resize: 'none' }}
          placeholder="A short overview of this location..."
          onInput={(e) => {
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
        />
      </div>

      {!isNewOrganization && !destination?.poi_roles?.includes('organization') && (
        <>
          <div className="edit-row">
            <div className="edit-section half">
              <label title="Historical era this location is associated with">Era</label>
              <select
                value={editedData.era_id || ''}
                onChange={(e) => {
                  const eraId = e.target.value ? parseInt(e.target.value) : null;
                  handleChange('era_id', eraId);
                }}
                className="era-select"
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
            <div className="edit-section half">
              <label title="Organization that owns or manages this property">Property Owner</label>
              <select
                value={editedData.owner_id || ''}
                onChange={(e) => {
                  const ownerId = e.target.value ? parseInt(e.target.value) : null;
                  const ownerOrg = availableOwnerOrgs.find(o => o.id === ownerId);
                  handleChange('owner_id', ownerId);
                  handleChange('property_owner', ownerOrg ? ownerOrg.name : null);
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

          <div className="edit-section">
            <label title="Activities available at this location (hiking, biking, fishing, etc.)">Primary Activities</label>
            <div className="activities-selector">
              <div
                className="activities-toggle"
                onClick={() => setShowActivityDropdown(!showActivityDropdown)}
              >
                <span className="activities-summary">
                  {selectedActivities.length > 0
                    ? selectedActivities.join(', ')
                    : 'Select activities...'}
                </span>
                <span className="activities-arrow">{showActivityDropdown ? '▲' : '▼'}</span>
              </div>
              {showActivityDropdown && (
                <div className="activities-dropdown">
                  {availableActivities.length === 0 ? (
                    <div className="activities-empty">No activities configured. Add them in Settings.</div>
                  ) : (
                    availableActivities.map(activity => (
                      <label key={activity.id} className="activity-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedActivities.includes(activity.name)}
                          onChange={() => toggleActivity(activity.name)}
                        />
                        <span>{activity.name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="edit-row">
            <div className="edit-section half">
              <label title="Trail or path surface type">Surface</label>
              <select
                value={editedData.surface || ''}
                onChange={(e) => handleChange('surface', e.target.value)}
              >
                <option value="">Select surface...</option>
                {availableSurfaces.map(surface => (
                  <option key={surface.id} value={surface.name}>
                    {surface.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="edit-section half">
              <label title="Whether pets are allowed at this location">Pets Allowed</label>
              <select
                value={editedData.pets || ''}
                onChange={(e) => handleChange('pets', e.target.value)}
              >
                <option value="">Unknown</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
                <option value="Leashed">Leashed Only</option>
              </select>
            </div>
          </div>

          <div className="edit-row">
            <div className="edit-section half">
              <label title="Typical cell signal strength at this location">Cell Signal</label>
              <EditableCellSignal
                level={editedData.cell_signal}
                onChange={(val) => handleChange('cell_signal', val)}
              />
            </div>
          </div>

          <div className="edit-section">
            <label title="Operating hours, in OpenStreetMap opening_hours syntax (e.g. Mo-Su 06:00-22:00)">Hours</label>
            <input
              type="text"
              value={editedData.opening_hours || ''}
              onChange={(e) => handleChange('opening_hours', e.target.value || null)}
              placeholder="e.g. Mo-Su 06:00-22:00"
            />
          </div>

          <div className="edit-row">
            <div className="edit-section half">
              <label title="Wheelchair accessibility (OpenStreetMap wheelchair tag)">Accessibility</label>
              <select
                value={editedData.wheelchair || ''}
                onChange={(e) => handleChange('wheelchair', e.target.value || null)}
              >
                <option value="">Unknown</option>
                <option value="yes">Accessible</option>
                <option value="designated">Designated accessible</option>
                <option value="limited">Limited</option>
                <option value="no">Not accessible</option>
              </select>
            </div>
            <div className="edit-section half">
              <label title="Whether a fee is charged (OpenStreetMap fee tag)">Fee</label>
              <select
                value={editedData.fee || ''}
                onChange={(e) => handleChange('fee', e.target.value || null)}
              >
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="conditional">Varies</option>
              </select>
            </div>
          </div>

          <div className="edit-row">
            <div className="edit-section half">
              <label className="activity-checkbox" title="Parking available at this location">
                <input
                  type="checkbox"
                  checked={!!editedData.has_parking}
                  onChange={(e) => handleChange('has_parking', e.target.checked)}
                />
                Parking
              </label>
            </div>
            <div className="edit-section half">
              <label className="activity-checkbox" title="Restrooms available at this location">
                <input
                  type="checkbox"
                  checked={!!editedData.has_restrooms}
                  onChange={(e) => handleChange('has_restrooms', e.target.checked)}
                />
                Restrooms
              </label>
            </div>
          </div>
        </>
      )}

      {isLinearFeature && editedData.feature_type !== 'boundary' && (
        <>
          <div className="edit-row">
            <div className="edit-section half">
              <label title="Type of linear feature (trail, river, boundary)">Feature Type</label>
              <select
                value={editedData.feature_type || 'trail'}
                onChange={(e) => handleChange('feature_type', e.target.value)}
              >
                <option value="trail">Trail</option>
              </select>
            </div>
            <div className="edit-section half">
              <label title="Trail difficulty rating">Difficulty</label>
              <select
                value={editedData.difficulty || ''}
                onChange={(e) => handleChange('difficulty', e.target.value)}
              >
                <option value="">Not specified</option>
                <option value="Easy">Easy</option>
                <option value="Moderate">Moderate</option>
                <option value="Difficult">Difficult</option>
              </select>
            </div>
          </div>
          <div className="edit-section">
            <label title="Total length of the trail in miles">Length (miles)</label>
            <input
              type="number"
              step="0.1"
              value={editedData.length_miles || ''}
              onChange={(e) => handleChange('length_miles', e.target.value ? parseFloat(e.target.value) : null)}
              placeholder="e.g., 2.5"
            />
          </div>
        </>
      )}

      {isLinearFeature && editedData.feature_type === 'boundary' && (
        <div className="edit-section">
          <label title="Color used to display this boundary on the map">Boundary Color</label>
          <div className="boundary-color-palette">
            {[
              '#228B22', // Forest Green
              '#2E8B57', // Sea Green
              '#006400', // Dark Green
              '#8B4513', // Saddle Brown
              '#A0522D', // Sienna
              '#CD853F', // Peru
              '#4169E1', // Royal Blue
              '#1E90FF', // Dodger Blue
              '#4682B4', // Steel Blue
              '#8B008B', // Dark Magenta
              '#9932CC', // Dark Orchid
              '#DC143C', // Crimson
              '#FF6347', // Tomato
              '#FF8C00', // Dark Orange
              '#FFD700', // Gold
            ].map(color => (
              <button
                key={color}
                type="button"
                className={`color-swatch ${editedData.boundary_color === color ? 'selected' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => handleChange('boundary_color', color)}
                title={color}
              />
            ))}
          </div>
          <div className="current-color-display">
            Current: <span style={{ backgroundColor: editedData.boundary_color || '#228B22' }} className="color-preview" />
            <span className="color-hex">{editedData.boundary_color || '#228B22'}</span>
          </div>
        </div>
      )}

      {!isLinearFeature && !destination?.poi_roles?.includes('organization') && (
        <div className="edit-row">
          <div className="edit-section half">
            <label title="GPS latitude coordinate">Latitude</label>
            <input
              type="number"
              step="0.000001"
              value={editedData.latitude || ''}
              onChange={(e) => handleCoordChange('latitude', e.target.value)}
            />
          </div>
          <div className="edit-section half">
            <label title="GPS longitude coordinate">Longitude</label>
            <input
              type="number"
              step="0.000001"
              value={editedData.longitude || ''}
              onChange={(e) => handleCoordChange('longitude', e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="edit-row">
        <div className="edit-section half">
          <label title="Optional override for Google Maps navigation. Set to a parking lot or visitor entrance if the main coordinates are off-road. Leave blank to use main coordinates (or first trail geometry point for trails).">Nav Latitude (optional)</label>
          <input
            type="number"
            step="0.000001"
            value={editedData.navigation_latitude ?? ''}
            onChange={(e) => handleChange('navigation_latitude', e.target.value === '' ? null : parseFloat(e.target.value))}
          />
        </div>
        <div className="edit-section half">
          <label title="Optional override for Google Maps navigation.">Nav Longitude (optional)</label>
          <input
            type="number"
            step="0.000001"
            value={editedData.navigation_longitude ?? ''}
            onChange={(e) => handleChange('navigation_longitude', e.target.value === '' ? null : parseFloat(e.target.value))}
          />
        </div>
      </div>
      {((editedData.navigation_latitude != null && editedData.navigation_latitude !== '') !==
        (editedData.navigation_longitude != null && editedData.navigation_longitude !== '')) && (
        <div className="edit-section" style={{ color: '#b00', fontSize: '0.85rem', marginTop: '-0.5rem' }}>
          Set both Nav Latitude and Nav Longitude, or leave both blank.
        </div>
      )}

      <div className="edit-section">
        <label title="Primary website or information page for this location">More Info Link</label>
        <input
          type="text"
          value={editedData.more_info_link || ''}
          onChange={(e) => handleChange('more_info_link', e.target.value)}
          placeholder="https://..."
        />
      </div>

      <div className="edit-section">
        <label title="URL of the news or blog page to crawl for this POI">News Page URL</label>
        <input
          type="text"
          value={editedData.news_url || ''}
          onChange={(e) => handleChange('news_url', e.target.value)}
          placeholder="https://example.com/news or /blog"
        />
      </div>

      <div className="edit-section">
        <label title="Auto-approve score for news from this URL. Blank uses global default (4). Only applies to items from the News Page URL, not Serper results.">News Score Threshold</label>
        <input
          type="number"
          min="1"
          max="8"
          value={editedData.news_score_threshold ?? ''}
          onChange={(e) => handleChange('news_score_threshold', e.target.value ? parseInt(e.target.value) : null)}
          placeholder="Default: 4"
        />
      </div>

      <div className="edit-section">
        <label title="URL of the events or calendar page to crawl for this POI">Events Page URL</label>
        <input
          type="text"
          value={editedData.events_url || ''}
          onChange={(e) => handleChange('events_url', e.target.value)}
          placeholder="https://example.com/events or /adventures"
        />
      </div>

      <div className="edit-section">
        <label title="Auto-approve score for events from this URL. Blank uses global default (4). Only applies to items from the Events Page URL, not Serper results.">Events Score Threshold</label>
        <input
          type="number"
          min="1"
          max="8"
          value={editedData.events_score_threshold ?? ''}
          onChange={(e) => handleChange('events_score_threshold', e.target.value ? parseInt(e.target.value) : null)}
          placeholder="Default: 4"
        />
      </div>

      <div className="edit-section">
        <label title="Trail status page URL. If set, this trail will appear in MTB status collection.">MTB Trail Status URL</label>
        <input
          type="text"
          value={editedData.status_url || ''}
          onChange={(e) => handleChange('status_url', e.target.value)}
          placeholder="https://example.com/trail-status"
        />
      </div>

      <div className="edit-section">
        <label title="How often this POI is included in scheduled news and events collection">Collection Tier</label>
        <select
          value={editedData.collection_tier || 'weekly'}
          onChange={(e) => handleChange('collection_tier', e.target.value)}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>


      </div>

      <div className="edit-buttons-footer">
        {!isNewPOI && !isNewOrganization && (
          <button
            className="delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={saving || deleting}
          >
            Delete
          </button>
        )}
        <div className={`edit-buttons-right ${(isNewPOI || isNewOrganization) ? 'full-width' : ''}`}>
          <button className="cancel-btn" onClick={handleCancelWithCleanup} disabled={saving || deleting}>
            Cancel
          </button>
          <button className="save-btn" onClick={handleSaveWithImage} disabled={saving || deleting || researching}>
            {saving ? 'Saving...' : (isNewPOI ? 'Create POI' : isNewOrganization ? 'Create Organization' : 'Save Changes')}
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="delete-confirm-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Point of Interest?</h3>
            <p className="delete-dest-name">{destination.name}</p>
            <p className="delete-warning">This action cannot be undone.</p>
            <div className="delete-confirm-buttons">
              <button
                className="cancel-btn"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="confirm-delete-btn"
                onClick={() => {
                  onDelete();
                  setShowDeleteConfirm(false);
                }}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDraftModal && researchDraft && (
        <div className="prompt-editor-overlay" onClick={() => { setShowDraftModal(false); setResearchDraft(null); }}>
          <div className="draft-approval-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="prompt-editor-header">
              <h3>Research Draft</h3>
              <button className="close-btn" onClick={() => { setShowDraftModal(false); setResearchDraft(null); }}>&times;</button>
            </div>
            <p className="prompt-editor-hint">Review AI research results. Toggle fields to accept or skip.</p>

            <div className="draft-fields">
              {[
                { key: 'era_id', label: 'Era', display: researchDraft.era, short: true },
                { key: 'property_owner', label: 'Property Owner', display: researchDraft.property_owner, short: true },
                { key: 'primary_activities', label: 'Activities', display: researchDraft.primary_activities, short: true },
                { key: 'surface', label: 'Surface', display: researchDraft.surface, short: true },
                { key: 'pets', label: 'Pets', display: researchDraft.pets, short: true },
                { key: 'brief_description', label: 'Brief Description', display: researchDraft.brief_description },
                { key: 'historical_description', label: 'Historical Description', display: researchDraft.historical_description },
              ].filter(f => f.display != null).map(field => (
                <div key={field.key} className={`draft-field ${draftFieldStates[field.key] ? 'accepted' : 'rejected'}`}>
                  <div className="draft-field-header">
                    <label>
                      <input
                        type="checkbox"
                        checked={draftFieldStates[field.key] || false}
                        onChange={(e) => setDraftFieldStates(prev => ({ ...prev, [field.key]: e.target.checked }))}
                      />
                      {field.label}
                    </label>
                  </div>
                  {field.short ? (
                    <input
                      type="text"
                      className="draft-field-input"
                      value={researchDraft[field.key === 'era_id' ? 'era' : field.key] || ''}
                      onChange={(e) => {
                        const dataKey = field.key === 'era_id' ? 'era' : field.key;
                        setResearchDraft(prev => ({ ...prev, [dataKey]: e.target.value }));
                      }}
                    />
                  ) : (
                    <textarea
                      className="draft-field-textarea"
                      value={researchDraft[field.key] || ''}
                      onChange={(e) => setResearchDraft(prev => ({ ...prev, [field.key]: e.target.value }))}
                      rows={field.key === 'historical_description' ? 8 : 4}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="prompt-editor-buttons">
              <button className="reject-btn" onClick={() => { setShowDraftModal(false); setResearchDraft(null); }}>
                Reject
              </button>
              <button className="research-btn" onClick={handleAcceptDraft}>
                Accept
              </button>
            </div>

            {researchDraft.sources && researchDraft.sources.length > 0 && (
              <div className="draft-sources">
                <strong>Sources:</strong>
                <ul>
                  {researchDraft.sources.map((source, i) => (
                    <li key={i}>
                      {source.startsWith('http') ? (
                        <a href={source} target="_blank" rel="noopener noreferrer">{source}</a>
                      ) : source}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default EditView;
