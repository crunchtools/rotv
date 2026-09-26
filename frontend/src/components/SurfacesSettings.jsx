import React, { useState } from 'react';
import useOrderedAdminList from '../hooks/useOrderedAdminList';

const EMPTY_SURFACE = { name: '', description: '' };

const surfacePayload = (surface) => ({
  name: surface.name.trim(),
  description: surface.description.trim() || null
});

function SurfacesSettings() {
  const {
    items: surfaces, loading, error, saving,
    createItem, updateItem, deleteItem, saveOrder,
    dragProps, dragClassName
  } = useOrderedAdminList('/api/admin/surfaces', 'surface', 'surfaces');
  const [newSurface, setNewSurface] = useState(EMPTY_SURFACE);
  const [editingId, setEditingId] = useState(null);
  const [editingSurface, setEditingSurface] = useState(EMPTY_SURFACE);

  const handleAddSurface = async (e) => {
    e.preventDefault();
    if (!newSurface.name.trim()) return;
    if (await createItem(surfacePayload(newSurface))) {
      setNewSurface(EMPTY_SURFACE);
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
    setEditingSurface(EMPTY_SURFACE);
  };

  const handleSaveEdit = async (id) => {
    if (!editingSurface.name.trim()) return;
    if (await updateItem(id, surfacePayload(editingSurface))) {
      handleCancelEdit();
    }
  };

  const handleSortAlphabetically = () => {
    saveOrder([...surfaces].sort((a, b) => a.name.localeCompare(b.name)));
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

      <div className="surfaces-list">
        {surfaces.length === 0 ? (
          <p className="no-surfaces">No surfaces defined yet.</p>
        ) : (
          surfaces.map((surface, index) => (
            <div
              key={surface.id}
              className={`surface-item ${dragClassName(index)}`}
              {...dragProps(index, editingId !== surface.id)}
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
                      onClick={() => deleteItem(surface.id, surface.name)}
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
