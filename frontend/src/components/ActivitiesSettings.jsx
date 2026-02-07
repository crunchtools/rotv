import React, { useState, useEffect, useCallback } from 'react';

function ActivitiesSettings() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newActivityName, setNewActivityName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [saving, setSaving] = useState(false);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const fetchActivities = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/activities', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setActivities(data);
        setError(null);
      } else {
        setError('Failed to fetch activities');
      }
    } catch {
      setError('Failed to fetch activities');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handleAddActivity = async (e) => {
    e.preventDefault();
    if (!newActivityName.trim()) return;

    setSaving(true);
    try {
      const response = await fetch('/api/admin/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newActivityName.trim() })
      });

      if (response.ok) {
        const newActivity = await response.json();
        setActivities(prev => [...prev, newActivity]);
        setNewActivityName('');
        setError(null);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to add activity');
      }
    } catch {
      setError('Failed to add activity');
    } finally {
      setSaving(false);
    }
  };

  const handleStartEdit = (activity) => {
    setEditingId(activity.id);
    setEditingName(activity.name);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleSaveEdit = async (id) => {
    if (!editingName.trim()) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/activities/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: editingName.trim() })
      });

      if (response.ok) {
        const updated = await response.json();
        setActivities(prev => prev.map(a => a.id === id ? updated : a));
        setEditingId(null);
        setEditingName('');
        setError(null);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to update activity');
      }
    } catch {
      setError('Failed to update activity');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete activity "${name}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/admin/activities/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        setActivities(prev => prev.filter(a => a.id !== id));
        setError(null);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to delete activity');
      }
    } catch {
      setError('Failed to delete activity');
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.outerHTML);
    // Add dragging class after a brief delay for visual feedback
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
    // Only clear if leaving the list entirely
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

    const newOrder = [...activities];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, draggedItem);
    setActivities(newOrder);
    setDraggedIndex(null);
    setDragOverIndex(null);

    // Save new order to backend
    try {
      await fetch('/api/admin/activities/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderedIds: newOrder.map(a => a.id) })
      });
    } catch {
      console.error('Failed to save order');
    }
  };

  // Sort alphabetically
  const handleSortAlphabetically = async () => {
    const sorted = [...activities].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
    setActivities(sorted);

    // Save new order to backend
    try {
      await fetch('/api/admin/activities/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderedIds: sorted.map(a => a.id) })
      });
    } catch {
      console.error('Failed to save order');
    }
  };

  if (loading) {
    return (
      <div className="activities-settings">
        <h3>Activities</h3>
        <p>Loading activities...</p>
      </div>
    );
  }

  return (
    <div className="activities-settings">
      <h3>Activities</h3>
      <p className="settings-description">
        Manage the standardized list of activities that can be assigned to points of interest.
      </p>

      {error && <div className="sync-error">{error}</div>}

      {/* Add new activity form and sort button */}
      <div className="activities-toolbar">
        <form className="add-activity-form" onSubmit={handleAddActivity}>
          <input
            type="text"
            value={newActivityName}
            onChange={(e) => setNewActivityName(e.target.value)}
            placeholder="New activity name..."
            disabled={saving}
          />
          <button type="submit" disabled={saving || !newActivityName.trim()}>
            {saving ? 'Adding...' : 'Add'}
          </button>
        </form>
        <button
          className="sort-btn"
          onClick={handleSortAlphabetically}
          disabled={activities.length < 2}
          title="Sort activities alphabetically"
        >
          Sort A-Z
        </button>
      </div>

      {/* Activities list */}
      <div className="activities-list">
        {activities.length === 0 ? (
          <p className="no-activities">No activities defined yet.</p>
        ) : (
          activities.map((activity, index) => (
            <div
              key={activity.id}
              className={`activity-item ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
              draggable={editingId !== activity.id}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
            >
              <div className="activity-drag-handle" title="Drag to reorder">
                ⋮⋮
              </div>

              {editingId === activity.id ? (
                <div className="activity-edit">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    autoFocus
                  />
                  <button onClick={() => handleSaveEdit(activity.id)} disabled={saving}>
                    Save
                  </button>
                  <button onClick={handleCancelEdit} disabled={saving}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <span className="activity-name">{activity.name}</span>
                  <div className="activity-actions">
                    <button onClick={() => handleStartEdit(activity)}>Edit</button>
                    <button
                      className="delete-btn-small"
                      onClick={() => handleDelete(activity.id, activity.name)}
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

export default ActivitiesSettings;
