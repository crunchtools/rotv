import React, { useState, useEffect, useCallback } from 'react';

function ErasSettings() {
  const [eras, setEras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newEra, setNewEra] = useState({ name: '', year_start: '', year_end: '', description: '' });
  const [editingId, setEditingId] = useState(null);
  const [editingEra, setEditingEra] = useState({ name: '', year_start: '', year_end: '', description: '' });
  const [saving, setSaving] = useState(false);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const fetchEras = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/eras', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setEras(data);
        setError(null);
      } else {
        setError('Failed to fetch eras');
      }
    } catch {
      setError('Failed to fetch eras');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEras();
  }, [fetchEras]);

  const handleAddEra = async (e) => {
    e.preventDefault();
    if (!newEra.name.trim()) return;

    setSaving(true);
    try {
      const response = await fetch('/api/admin/eras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newEra.name.trim(),
          year_start: newEra.year_start ? parseInt(newEra.year_start) : null,
          year_end: newEra.year_end ? parseInt(newEra.year_end) : null,
          description: newEra.description.trim() || null
        })
      });

      if (response.ok) {
        const created = await response.json();
        setEras(prev => [...prev, created]);
        setNewEra({ name: '', year_start: '', year_end: '', description: '' });
        setError(null);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to add era');
      }
    } catch {
      setError('Failed to add era');
    } finally {
      setSaving(false);
    }
  };

  const handleStartEdit = (era) => {
    setEditingId(era.id);
    setEditingEra({
      name: era.name,
      year_start: era.year_start || '',
      year_end: era.year_end || '',
      description: era.description || ''
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingEra({ name: '', year_start: '', year_end: '', description: '' });
  };

  const handleSaveEdit = async (id) => {
    if (!editingEra.name.trim()) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/eras/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: editingEra.name.trim(),
          year_start: editingEra.year_start ? parseInt(editingEra.year_start) : null,
          year_end: editingEra.year_end ? parseInt(editingEra.year_end) : null,
          description: editingEra.description.trim() || null
        })
      });

      if (response.ok) {
        const updated = await response.json();
        setEras(prev => prev.map(e => e.id === id ? updated : e));
        setEditingId(null);
        setEditingEra({ name: '', year_start: '', year_end: '', description: '' });
        setError(null);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to update era');
      }
    } catch {
      setError('Failed to update era');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete era "${name}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/admin/eras/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        setEras(prev => prev.filter(e => e.id !== id));
        setError(null);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to delete era');
      }
    } catch {
      setError('Failed to delete era');
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

    const newOrder = [...eras];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, draggedItem);
    setEras(newOrder);
    setDraggedIndex(null);
    setDragOverIndex(null);

    // Save new order to backend
    try {
      await fetch('/api/admin/eras/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderedIds: newOrder.map(e => e.id) })
      });
    } catch (err) {
      console.error('Failed to save order:', err);
    }
  };

  // Sort by chronological order (year_start)
  const handleSortChronologically = async () => {
    const sorted = [...eras].sort((a, b) => {
      // Eras without year_start go to the end
      if (!a.year_start && !b.year_start) return 0;
      if (!a.year_start) return 1;
      if (!b.year_start) return -1;
      return a.year_start - b.year_start;
    });
    setEras(sorted);

    // Save new order to backend
    try {
      await fetch('/api/admin/eras/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderedIds: sorted.map(e => e.id) })
      });
    } catch (err) {
      console.error('Failed to save order:', err);
    }
  };

  const formatYearRange = (era) => {
    if (!era.year_start && !era.year_end) return '';
    if (!era.year_start) return `until ${era.year_end}`;
    if (!era.year_end) return `${era.year_start}+`;
    return `${era.year_start}-${era.year_end}`;
  };

  if (loading) {
    return (
      <div className="eras-settings">
        <h3>Historical Eras</h3>
        <p>Loading eras...</p>
      </div>
    );
  }

  return (
    <div className="eras-settings">
      <h3>Historical Eras</h3>
      <p className="settings-description">
        Manage the standardized list of historical eras for the Cuyahoga Valley.
        These eras are used to categorize points of interest, trails, and park boundaries.
      </p>

      {error && <div className="sync-error">{error}</div>}

      {/* Add new era form and sort button */}
      <div className="eras-toolbar">
        <form className="add-era-form" onSubmit={handleAddEra}>
          <input
            type="text"
            value={newEra.name}
            onChange={(e) => setNewEra(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Era name..."
            disabled={saving}
            className="era-name-input"
          />
          <input
            type="number"
            value={newEra.year_start}
            onChange={(e) => setNewEra(prev => ({ ...prev, year_start: e.target.value }))}
            placeholder="Start year"
            disabled={saving}
            className="era-year-input"
          />
          <input
            type="number"
            value={newEra.year_end}
            onChange={(e) => setNewEra(prev => ({ ...prev, year_end: e.target.value }))}
            placeholder="End year"
            disabled={saving}
            className="era-year-input"
          />
          <button type="submit" disabled={saving || !newEra.name.trim()}>
            {saving ? 'Adding...' : 'Add'}
          </button>
        </form>
        <button
          className="sort-btn"
          onClick={handleSortChronologically}
          disabled={eras.length < 2}
          title="Sort eras chronologically by start year"
        >
          Sort Chronologically
        </button>
      </div>

      {/* Eras list */}
      <div className="eras-list">
        {eras.length === 0 ? (
          <p className="no-eras">No eras defined yet.</p>
        ) : (
          eras.map((era, index) => (
            <div
              key={era.id}
              className={`era-item ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
              draggable={editingId !== era.id}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
            >
              <div className="era-drag-handle" title="Drag to reorder">
                ⋮⋮
              </div>

              {editingId === era.id ? (
                <div className="era-edit">
                  <div className="era-edit-row">
                    <input
                      type="text"
                      value={editingEra.name}
                      onChange={(e) => setEditingEra(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Era name"
                      autoFocus
                      className="era-name-input"
                    />
                    <input
                      type="number"
                      value={editingEra.year_start}
                      onChange={(e) => setEditingEra(prev => ({ ...prev, year_start: e.target.value }))}
                      placeholder="Start"
                      className="era-year-input"
                    />
                    <input
                      type="number"
                      value={editingEra.year_end}
                      onChange={(e) => setEditingEra(prev => ({ ...prev, year_end: e.target.value }))}
                      placeholder="End"
                      className="era-year-input"
                    />
                  </div>
                  <input
                    type="text"
                    value={editingEra.description}
                    onChange={(e) => setEditingEra(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Description (optional)"
                    className="era-description-input"
                  />
                  <div className="era-edit-buttons">
                    <button onClick={() => handleSaveEdit(era.id)} disabled={saving}>
                      Save
                    </button>
                    <button onClick={handleCancelEdit} disabled={saving}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="era-info">
                    <span className="era-name">{era.name}</span>
                    {formatYearRange(era) && (
                      <span className="era-years">{formatYearRange(era)}</span>
                    )}
                    {era.description && (
                      <span className="era-description">{era.description}</span>
                    )}
                  </div>
                  <div className="era-actions">
                    <button onClick={() => handleStartEdit(era)}>Edit</button>
                    <button
                      className="delete-btn-small"
                      onClick={() => handleDelete(era.id, era.name)}
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

export default ErasSettings;
