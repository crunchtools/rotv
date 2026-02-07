import React, { useState, useEffect, useCallback } from 'react';
import IconGeneratorModal from './IconGeneratorModal';

function IconsSettings() {
  const [icons, setIcons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingIcon, setEditingIcon] = useState({});
  const [saving, setSaving] = useState(false);
  const [showGeneratorModal, setShowGeneratorModal] = useState(false);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const fetchIcons = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/icons', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setIcons(data);
        setError(null);
      } else {
        setError('Failed to fetch icons');
      }
    } catch {
      setError('Failed to fetch icons');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchActivities = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/activities', {
        credentials: 'include'
      });
      if (response.ok) {
        await response.json(); // Data not used, just fetch for potential future use
      }
    } catch (err) {
      console.error('Failed to fetch activities:', err);
    }
  }, []);

  useEffect(() => {
    fetchIcons();
    fetchActivities();
  }, [fetchIcons, fetchActivities]);

  const handleStartEdit = (icon) => {
    setEditingId(icon.id);
    setEditingIcon({
      name: icon.name,
      label: icon.label,
      title_keywords: icon.title_keywords || '',
      activity_fallbacks: icon.activity_fallbacks || '',
      enabled: icon.enabled !== false
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingIcon({});
  };

  const handleSaveEdit = async (id) => {
    if (!editingIcon.name.trim() || !editingIcon.label.trim()) return;

    setSaving(true);
    try {
      // Find the original icon to preserve svg_filename and svg_content
      const originalIcon = icons.find(i => i.id === id);
      const response = await fetch(`/api/admin/icons/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: editingIcon.name.trim(),
          label: editingIcon.label.trim(),
          svg_filename: originalIcon?.svg_filename || null,
          svg_content: originalIcon?.svg_content || null,
          title_keywords: editingIcon.title_keywords.trim() || null,
          activity_fallbacks: editingIcon.activity_fallbacks.trim() || null,
          enabled: editingIcon.enabled
        })
      });

      if (response.ok) {
        const updated = await response.json();
        setIcons(prev => prev.map(i => i.id === id ? updated : i));
        setEditingId(null);
        setEditingIcon({});
        setError(null);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to update icon');
      }
    } catch {
      setError('Failed to update icon');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (icon) => {
    try {
      const response = await fetch(`/api/admin/icons/${icon.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: icon.name,
          label: icon.label,
          enabled: !icon.enabled
        })
      });

      if (response.ok) {
        const updated = await response.json();
        setIcons(prev => prev.map(i => i.id === icon.id ? updated : i));
      }
    } catch (err) {
      console.error('Failed to toggle icon:', err);
    }
  };

  const handleDelete = async (id, name) => {
    if (name === 'default') {
      setError('Cannot delete the default icon');
      return;
    }
    if (!confirm(`Delete icon "${name}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/admin/icons/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        setIcons(prev => prev.filter(i => i.id !== id));
        setError(null);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to delete icon');
      }
    } catch {
      setError('Failed to delete icon');
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.outerHTML);
    setTimeout(() => {
      e.target.classList.add('dragging');
    }, 0);
  };

  const handleDragEnd = (e) => {
    e.target.classList.remove('dragging');
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (index !== dragOverIndex) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverIndex(null);
    }
  };

  const handleDrop = async (e, dropIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newOrder = [...icons];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, draggedItem);
    setIcons(newOrder);
    setDraggedIndex(null);
    setDragOverIndex(null);

    // Save new order to backend
    try {
      await fetch('/api/admin/icons/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderedIds: newOrder.map(i => i.id) })
      });
    } catch (err) {
      console.error('Failed to save order:', err);
    }
  };

  // Parse comma-separated keywords into display chips
  const parseKeywords = (keywordsStr) => {
    if (!keywordsStr) return [];
    return keywordsStr.split(',').map(k => k.trim()).filter(k => k);
  };

  // Handle new icon saved from generator
  const handleIconGenerated = (newIcon) => {
    setIcons(prev => [...prev, newIcon]);
  };

  if (loading) {
    return (
      <div className="icons-settings">
        <h3>Map Icons</h3>
        <p>Loading icons...</p>
      </div>
    );
  }

  return (
    <div className="icons-settings">
      <h3>Map Icons</h3>
      <p className="settings-description">
        Configure map icons and their matching rules. Icons are matched by title keywords first,
        then by activity fallbacks. Drag to reorder priority.
      </p>

      <div className="icons-toolbar">
        <button
          className="generate-icon-btn"
          onClick={() => setShowGeneratorModal(true)}
        >
          + Generate New Icon
        </button>
      </div>

      {error && <div className="sync-error">{error}</div>}

      {showGeneratorModal && (
        <IconGeneratorModal
          onClose={() => setShowGeneratorModal(false)}
          onSave={handleIconGenerated}
        />
      )}

      {/* Icons list */}
      <div className="icons-list">
        {icons.length === 0 ? (
          <p className="no-icons">No icons defined yet.</p>
        ) : (
          icons.map((icon, index) => (
            <div
              key={icon.id}
              className={`icon-item ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''} ${!icon.enabled ? 'disabled' : ''}`}
              draggable={editingId !== icon.id}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
            >
              <div className="icon-drag-handle" title="Drag to reorder">
                ⋮⋮
              </div>

              {editingId === icon.id ? (
                <div className="icon-edit">
                  <div className="icon-edit-row">
                    {icon.svg_content ? (
                      <div
                        className="icon-preview"
                        dangerouslySetInnerHTML={{ __html: icon.svg_content }}
                      />
                    ) : (
                      <img
                        src={`/icons/${editingIcon.svg_filename || icon.svg_filename || 'default.svg'}`}
                        alt={editingIcon.label}
                        className="icon-preview"
                      />
                    )}
                    <div className="icon-edit-fields">
                      <div className="icon-edit-field">
                        <label>Name (ID):</label>
                        <input
                          type="text"
                          value={editingIcon.name}
                          onChange={(e) => setEditingIcon(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="icon-name"
                        />
                      </div>
                      <div className="icon-edit-field">
                        <label>Label:</label>
                        <input
                          type="text"
                          value={editingIcon.label}
                          onChange={(e) => setEditingIcon(prev => ({ ...prev, label: e.target.value }))}
                          placeholder="Display Label"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="icon-edit-field full-width">
                    <label>Title Keywords (comma-separated):</label>
                    <input
                      type="text"
                      value={editingIcon.title_keywords}
                      onChange={(e) => setEditingIcon(prev => ({ ...prev, title_keywords: e.target.value }))}
                      placeholder="falls,waterfall,cascade"
                    />
                    <p className="field-hint">POI titles containing these words will use this icon</p>
                  </div>
                  <div className="icon-edit-field full-width">
                    <label>Activity Fallbacks (comma-separated):</label>
                    <input
                      type="text"
                      value={editingIcon.activity_fallbacks}
                      onChange={(e) => setEditingIcon(prev => ({ ...prev, activity_fallbacks: e.target.value }))}
                      placeholder="Hiking,Nature Study"
                    />
                    <p className="field-hint">If no title match, POIs with these activities will use this icon</p>
                  </div>
                  <div className="icon-edit-field">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={editingIcon.enabled}
                        onChange={(e) => setEditingIcon(prev => ({ ...prev, enabled: e.target.checked }))}
                      />
                      Enabled
                    </label>
                  </div>
                  <div className="icon-edit-buttons">
                    <button onClick={() => handleSaveEdit(icon.id)} disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={handleCancelEdit} disabled={saving}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="icon-preview-container">
                    {icon.svg_content ? (
                      <div
                        className="icon-preview"
                        dangerouslySetInnerHTML={{ __html: icon.svg_content }}
                      />
                    ) : (
                      <img
                        src={`/icons/${icon.svg_filename || 'default.svg'}`}
                        alt={icon.label}
                        className="icon-preview"
                      />
                    )}
                  </div>
                  <div className="icon-info">
                    <div className="icon-header">
                      <span className="icon-label">{icon.label}</span>
                      <span className="icon-name">({icon.name})</span>
                    </div>
                    {icon.title_keywords && (
                      <div className="icon-keywords">
                        <span className="keywords-label">Keywords:</span>
                        {parseKeywords(icon.title_keywords).map((kw, i) => (
                          <span key={i} className="keyword-chip">{kw}</span>
                        ))}
                      </div>
                    )}
                    {icon.activity_fallbacks && (
                      <div className="icon-activities">
                        <span className="activities-label">Activities:</span>
                        {parseKeywords(icon.activity_fallbacks).map((act, i) => (
                          <span key={i} className="activity-chip">{act}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="icon-actions">
                    <label className="toggle-switch" title={icon.enabled ? 'Enabled' : 'Disabled'}>
                      <input
                        type="checkbox"
                        checked={icon.enabled}
                        onChange={() => handleToggleEnabled(icon)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <button onClick={() => handleStartEdit(icon)}>Edit</button>
                    {icon.name !== 'default' && (
                      <button
                        className="delete-btn-small"
                        onClick={() => handleDelete(icon.id, icon.name)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default IconsSettings;
