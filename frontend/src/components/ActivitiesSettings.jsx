import React, { useState } from 'react';
import useOrderedAdminList from '../hooks/useOrderedAdminList';

function ActivitiesSettings() {
  const {
    items: activities, loading, error, saving,
    createItem, updateItem, deleteItem, saveOrder,
    dragProps, dragClassName
  } = useOrderedAdminList('/api/admin/activities', 'activity', 'activities');
  const [newActivityName, setNewActivityName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const handleAddActivity = async (e) => {
    e.preventDefault();
    if (!newActivityName.trim()) return;
    if (await createItem({ name: newActivityName.trim() })) {
      setNewActivityName('');
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
    if (await updateItem(id, { name: editingName.trim() })) {
      handleCancelEdit();
    }
  };

  const handleSortAlphabetically = () => {
    saveOrder([...activities].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    ));
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

      <div className="activities-list">
        {activities.length === 0 ? (
          <p className="no-activities">No activities defined yet.</p>
        ) : (
          activities.map((activity, index) => (
            <div
              key={activity.id}
              className={`activity-item ${dragClassName(index)}`}
              {...dragProps(index, editingId !== activity.id)}
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
                      onClick={() => deleteItem(activity.id, activity.name)}
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
