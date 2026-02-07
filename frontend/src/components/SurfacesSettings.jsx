import React, { useState, useEffect, useCallback } from 'react';

function SurfacesSettings() {
  const [surfaces, setSurfaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newSurface, setNewSurface] = useState({ name: '', description: '' });
  const [editingId, setEditingId] = useState(null);
  const [editingSurface, setEditingSurface] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const fetchSurfaces = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/surfaces', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setSurfaces(data);
        setError(null);
      } else {
        setError('Failed to fetch surfaces');
      }
    } catch {
      setError('Failed to fetch surfaces');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSurfaces();
  }, [fetchSurfaces]);

  const handleAddSurface = async (e) => {
    e.preventDefault();
    if (!newSurface.name.trim()) return;

    setSaving(true);
    try {
      const response = await fetch('/api/admin/surfaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newSurface.name.trim(),
          description: newSurface.description.trim() || null
        })
      });

      if (response.ok) {
        const created = await response.json();
        setSurfaces(prev => [...prev, created]);
        setNewSurface({ name: '', description: '' });
        setError(null);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to add surface');
      }
    } catch {
      setError('Failed to add surface');
    } finally {
      setSaving(false);
    }
  };

  const handleStartEdit = (surface) => {
    setEditingId(surface.id);
    setEditingSurface({
      name: surface.name,
      description: surface.description || ''
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingSurface({ name: '', description: '' });
  };

  const handleSaveEdit = async (id) => {
    if (!editingSurface.name.trim()) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/surfaces/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: editingSurface.name.trim(),
          description: editingSurface.description.trim() || null
        })
      });

      if (response.ok) {
        const updated = await response.json();
        setSurfaces(prev => prev.map(s => s.id === id ? updated : s));
        setEditingId(null);
        setEditingSurface({ name: '', description: '' });
        setError(null);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to update surface');
      }
    } catch {
      setError('Failed to update surface');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete surface "${name}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/admin/surfaces/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        setSurfaces(prev => prev.filter(s => s.id !== id));
        setError(null);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to delete surface');
      }
    } catch {
      setError('Failed to delete surface');
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

    const newOrder = [...surfaces];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, draggedItem);
    setSurfaces(newOrder);
    setDraggedIndex(null);
    setDragOverIndex(null);

    // Save new order to backend
    try {
      await fetch('/api/admin/surfaces/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderedIds: newOrder.map(s => s.id) })
      });
    } catch {
      console.error('Failed to save order:', err);
    }
  };

  // Sort alphabetically
  const handleSortAlphabetically = async () => {
    const sorted = [...surfaces].sort((a, b) => a.name.localeCompare(b.name));
    setSurfaces(sorted);

    // Save new order to backend
    try {
      await fetch('/api/admin/surfaces/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderedIds: sorted.map(s => s.id) })
      });
    } catch {
      console.error('Failed to save order:', err);
    }
  };

  if (loading) {
    return (
      <div className="surfaces-settings">
        <h3>Trail Surfaces</h3>
        <p>Loading surfaces...</p>
      </div>
    );
  }

  return (
    <div className="surfaces-settings">
      <h3>Trail Surfaces</h3>
      <p className="settings-description">
        Manage the standardized list of trail and path surfaces for the Cuyahoga Valley.
        These surfaces are used to describe trails, roads, and waterways.
      </p>

      {error && <div className="sync-error">{error}</div>}

      {/* Add new surface form and sort button */}
      <div className="surfaces-toolbar">
        <form className="add-surface-form" onSubmit={handleAddSurface}>
          <input
            type="text"
            value={newSurface.name}
            onChange={(e) => setNewSurface(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Surface name..."
            disabled={saving}
            className="surface-name-input"
          />
          <input
            type="text"
            value={newSurface.description}
            onChange={(e) => setNewSurface(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Description (optional)"
            disabled={saving}
            className="surface-description-input"
          />
          <button type="submit" disabled={saving || !newSurface.name.trim()}>
            {saving ? 'Adding...' : 'Add'}
          </button>
        </form>
        <button
          className="sort-btn"
          onClick={handleSortAlphabetically}
          disabled={surfaces.length < 2}
          title="Sort surfaces alphabetically"
        >
          Sort A-Z
        </button>
      </div>

      {/* Surfaces list */}
      <div className="surfaces-list">
        {surfaces.length === 0 ? (
          <p className="no-surfaces">No surfaces defined yet.</p>
        ) : (
          surfaces.map((surface, index) => (
            <div
              key={surface.id}
              className={`surface-item ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
              draggable={editingId !== surface.id}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
            >
              <div className="surface-drag-handle" title="Drag to reorder">
                ⋮⋮
              </div>

              {editingId === surface.id ? (
                <div className="surface-edit">
                  <div className="surface-edit-row">
                    <input
                      type="text"
                      value={editingSurface.name}
                      onChange={(e) => setEditingSurface(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Surface name"
                      autoFocus
                      className="surface-name-input"
                    />
                  </div>
                  <input
                    type="text"
                    value={editingSurface.description}
                    onChange={(e) => setEditingSurface(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Description (optional)"
                    className="surface-description-input"
                  />
                  <div className="surface-edit-buttons">
                    <button onClick={() => handleSaveEdit(surface.id)} disabled={saving}>
                      Save
                    </button>
                    <button onClick={handleCancelEdit} disabled={saving}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="surface-info">
                    <span className="surface-name">{surface.name}</span>
                    {surface.description && (
                      <span className="surface-description">{surface.description}</span>
                    )}
                  </div>
                  <div className="surface-actions">
                    <button onClick={() => handleStartEdit(surface)}>Edit</button>
                    <button
                      className="delete-btn-small"
                      onClick={() => handleDelete(surface.id, surface.name)}
                    >
                      Delete
                    </button>
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

export default SurfacesSettings;
