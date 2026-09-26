import React, { useState } from 'react';
import useOrderedAdminList from '../hooks/useOrderedAdminList';

const EMPTY_ERA = { name: '', year_start: '', year_end: '', description: '' };

const eraPayload = (era) => ({
  name: era.name.trim(),
  year_start: era.year_start ? parseInt(era.year_start) : null,
  year_end: era.year_end ? parseInt(era.year_end) : null,
  description: era.description.trim() || null
});

function ErasSettings() {
  const {
    items: eras, loading, error, saving,
    createItem, updateItem, deleteItem, saveOrder,
    dragProps, dragClassName
  } = useOrderedAdminList('/api/admin/eras', 'era', 'eras');
  const [newEra, setNewEra] = useState(EMPTY_ERA);
  const [editingId, setEditingId] = useState(null);
  const [editingEra, setEditingEra] = useState(EMPTY_ERA);

  const handleAddEra = async (e) => {
    e.preventDefault();
    if (!newEra.name.trim()) return;
    if (await createItem(eraPayload(newEra))) {
      setNewEra(EMPTY_ERA);
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
    setEditingEra(EMPTY_ERA);
  };

  const handleSaveEdit = async (id) => {
    if (!editingEra.name.trim()) return;
    if (await updateItem(id, eraPayload(editingEra))) {
      handleCancelEdit();
    }
  };

  const handleSortChronologically = () => {
    saveOrder([...eras].sort((a, b) => {
      if (!a.year_start && !b.year_start) return 0;
      if (!a.year_start) return 1;
      if (!b.year_start) return -1;
      return a.year_start - b.year_start;
    }));
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

      <div className="eras-list">
        {eras.length === 0 ? (
          <p className="no-eras">No eras defined yet.</p>
        ) : (
          eras.map((era, index) => (
            <div
              key={era.id}
              className={`era-item ${dragClassName(index)}`}
              {...dragProps(index, editingId !== era.id)}
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
                      onClick={() => deleteItem(era.id, era.name)}
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
