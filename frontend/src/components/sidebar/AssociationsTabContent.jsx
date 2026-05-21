import { useState, useMemo } from 'react';

function AssociationsTabContent({ poi, associations, allDestinations, allLinearFeatures, allVirtualPois, onSelectDestination, onSelectLinearFeature, isAdmin, editMode, onAssociationsChanged, onStartDrawingAssociations }) {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedNewPois, setSelectedNewPois] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [filterText, setFilterText] = useState('');

  const poiAssociations = associations.filter(assoc =>
    assoc.virtual_poi_id === poi.id || assoc.physical_poi_id === poi.id
  );

  const isVirtualPoi = poi.poi_roles?.includes('organization');

  const regularAssociations = poiAssociations.map(assoc => {
    if (isVirtualPoi) {
      const physicalId = assoc.physical_poi_id;
      let associatedPoi = allDestinations?.find(d => d.id === physicalId);
      if (!associatedPoi) {
        associatedPoi = allLinearFeatures?.find(f => f.id === physicalId);
      }
      return associatedPoi ? { ...associatedPoi, _isLinear: !!allLinearFeatures?.find(f => f.id === physicalId), _isVirtual: false, _assocId: assoc.id } : null;
    } else {
      const virtualId = assoc.virtual_poi_id;
      const associatedPoi = allVirtualPois?.find(v => v.id === virtualId);
      return associatedPoi ? { ...associatedPoi, _isVirtual: true, _isLinear: false, _assocId: assoc.id } : null;
    }
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

  const ownerOrg = !isVirtualPoi && poi.owner_id
    ? allVirtualPois?.find(v => Number(v.id) === Number(poi.owner_id))
    : null;

  const ownedPois = useMemo(() => {
    return isVirtualPoi
      ? [
          ...(allDestinations || []).filter(d => Number(d.owner_id) === Number(poi.id)),
          ...(allLinearFeatures || []).filter(f => Number(f.owner_id) === Number(poi.id))
        ].map(p => ({
          ...p,
          _isLinear: !!(allLinearFeatures || []).find(f => f.id === p.id),
          _isVirtual: false,
          _isOwned: true
        })).sort((a, b) => a.name.localeCompare(b.name))
      : [];
  }, [isVirtualPoi, poi.id, allDestinations, allLinearFeatures]);

  const associatedPoisWithAssocId = useMemo(() => [
    ...(ownerOrg ? [{ ...ownerOrg, _isVirtual: true, _isLinear: false, _isOwner: true }] : []),
    ...ownedPois.filter(p => !regularAssociations.some(a => a.id === p.id)),
    ...regularAssociations.filter(a => (!ownerOrg || a.id !== ownerOrg.id) && !ownedPois.some(p => p.id === a.id))
  ], [ownerOrg, ownedPois, regularAssociations]);

  const availablePois = useMemo(() => {
    if (!isVirtualPoi) return []; // Only virtual POIs can add associations

    const currentIds = new Set(associatedPoisWithAssocId.map(p => p.id));
    const allPhysicalPois = [
      ...(allDestinations || []).map(d => ({ ...d, _type: 'point' })),
      ...(allLinearFeatures || []).map(f => ({ ...f, _type: f.poi_roles?.find(r => ['trail', 'river', 'boundary'].includes(r)) || 'trail' }))
    ];

    return allPhysicalPois.filter(p => !currentIds.has(p.id));
  }, [isVirtualPoi, associatedPoisWithAssocId, allDestinations, allLinearFeatures]);

  const handleDeleteAssociation = async (assocId, poiName) => {
    if (!confirm(`Remove association with "${poiName}"?`)) return;

    setDeleting(assocId);
    try {
      const response = await fetch(`/api/admin/poi-associations/${assocId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete association');
      }

      if (onAssociationsChanged) {
        onAssociationsChanged();
      }
    } catch (error) {
      console.error('Error deleting association:', error);
      alert('Error removing association: ' + error.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleAddAssociations = async () => {
    if (selectedNewPois.size === 0) {
      alert('Please select at least one location to associate');
      return;
    }

    try {
      const response = await fetch('/api/admin/poi-associations/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          virtual_poi_id: poi.id,
          physical_poi_ids: Array.from(selectedNewPois),
          association_type: 'manages'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to add associations');
      }

      setIsAdding(false);
      setSelectedNewPois(new Set());
      setFilterText('');

      if (onAssociationsChanged) {
        onAssociationsChanged();
      }
    } catch (error) {
      console.error('Error adding associations:', error);
      alert('Error adding associations: ' + error.message);
    }
  };

  if (poiAssociations.length === 0 && !ownerOrg && ownedPois.length === 0 && !isAdmin) {
    return (
      <div className="sidebar-tab-empty">
        No associated entities for this location.
      </div>
    );
  }

  return (
    <div className="associations-tab-content">
      <div className="section">
        <div className="section-header-with-actions">
          <div>
            <h3>{isVirtualPoi ? 'Associated Locations' : 'Organizations'}</h3>
            <p className="associations-description">
              {isVirtualPoi
                ? 'Physical locations associated with this organization.'
                : 'Organizations associated with this location.'}
            </p>
          </div>
          {isAdmin && editMode && isVirtualPoi && !isAdding && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  if (onStartDrawingAssociations) {
                    onStartDrawingAssociations(poi.id);
                  }
                }}
                className="btn-add-association"
                title="Draw rectangle on map to select multiple locations"
              >
                Add from Map
              </button>
              <button
                onClick={() => setIsAdding(true)}
                className="btn-add-association"
              >
                Add from List
              </button>
            </div>
          )}
        </div>

        {associatedPoisWithAssocId.length > 0 ? (
          <div className={`associations-list ${isAdding ? 'compact' : ''}`}>
            {associatedPoisWithAssocId.map(associatedPoi => {
              const imageUrl = associatedPoi.has_primary_image
                ? `/api/pois/${associatedPoi.id}/thumbnail?size=small&v=${associatedPoi.updated_at || Date.now()}`
                : null;

              const getDefaultThumbnail = () => {
                if (associatedPoi._isVirtual) return '/icons/thumbnails/virtual.svg';
                if (associatedPoi._isLinear) {
                  if (associatedPoi.poi_roles?.includes('river')) return '/icons/thumbnails/river.svg';
                  if (associatedPoi.poi_roles?.includes('boundary')) return '/icons/thumbnails/boundary.svg';
                  return '/icons/thumbnails/trail.svg';
                }
                return '/icons/thumbnails/destination.svg';
              };

              const isMtbTrailhead = !associatedPoi._isLinear && !associatedPoi._isVirtual &&
                                    associatedPoi.status_url && associatedPoi.status_url.trim() !== '';
              const poiType = associatedPoi._isVirtual ? 'virtual' :
                              !associatedPoi._isLinear ? (isMtbTrailhead ? 'mtb' : 'destination') :
                              (associatedPoi.poi_roles?.find(r => ['trail', 'river', 'boundary'].includes(r)) || 'trail');

              return (
                <div
                  key={associatedPoi.id}
                  className="association-item"
                >
                  <div
                    className="association-item-clickable"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (associatedPoi._isVirtual || (!associatedPoi._isLinear && !associatedPoi._isVirtual)) {
                        onSelectDestination(associatedPoi);
                      } else if (associatedPoi._isLinear) {
                        onSelectLinearFeature(associatedPoi);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.currentTarget.click();
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className={`association-item-thumbnail ${associatedPoi._isVirtual ? 'virtual-thumbnail' : ''}`}>
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={associatedPoi.name}
                          loading="lazy"
                          className={associatedPoi._isVirtual ? 'logo-image' : ''}
                          onError={(e) => {
                            e.target.src = getDefaultThumbnail();
                            e.target.className = 'default-thumbnail';
                          }}
                        />
                      ) : (
                        <img src={getDefaultThumbnail()} alt={associatedPoi.name} className="default-thumbnail" loading="lazy" />
                      )}
                    </div>
                    <div className="association-item-content">
                      <div className="association-item-name">{associatedPoi.name}</div>
                      <div className="association-item-badges">
                        <span className={`poi-type-icon ${poiType}`}>
                          {associatedPoi._isVirtual ? 'O' :
                           isMtbTrailhead ? 'M' :
                           !associatedPoi._isLinear ? 'D' :
                           associatedPoi.poi_roles?.includes('river') ? 'R' :
                           associatedPoi.poi_roles?.includes('boundary') ? 'B' : 'T'}
                        </span>
                        {associatedPoi._isOwner && (
                          <span className="owner-badge-small">Owner</span>
                        )}
                        {associatedPoi._isOwned && (
                          <span className="owner-badge-small">Owned</span>
                        )}
                        {associatedPoi.era && !associatedPoi._isVirtual && (
                          <span className="association-item-era">{associatedPoi.era}</span>
                        )}
                      </div>
                      {associatedPoi.brief_description && (
                        <div className="association-item-description">{associatedPoi.brief_description}</div>
                      )}
                    </div>
                  </div>
                  {isAdmin && editMode && isVirtualPoi && !associatedPoi._isOwned && (
                    <button
                      onClick={() => handleDeleteAssociation(associatedPoi._assocId, associatedPoi.name)}
                      className="btn-delete-association"
                      disabled={deleting === associatedPoi._assocId}
                      title="Remove association"
                    >
                      {deleting === associatedPoi._assocId ? '...' : '×'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="sidebar-tab-empty">No associations yet.</div>
        )}

      </div>

      {isAdding && (
        <div className="add-associations-modal-overlay" onClick={() => {
          setIsAdding(false);
          setFilterText('');
        }}>
          <div className="add-associations-modal" onClick={(e) => e.stopPropagation()}>
            <div className="add-associations-modal-header">
              <h3>Add Associations</h3>
              <button className="add-associations-modal-close" onClick={() => {
                setIsAdding(false);
                setFilterText('');
              }}>&times;</button>
            </div>
            <div className="add-associations-modal-content">
              {availablePois.length > 0 && (
                <div className="filter-input-container">
                  <input
                    type="text"
                    placeholder="Search locations..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    className="filter-input"
                  />
                </div>
              )}
              <div className="available-pois-list">
                {availablePois.length === 0 ? (
                  <div className="empty-message">All locations are already associated</div>
                ) : (
                  availablePois
                    .filter(poi => filterText === '' || poi.name.toLowerCase().includes(filterText.toLowerCase()))
                    .map(availablePoi => (
                    <label key={availablePoi.id} className="poi-checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedNewPois.has(availablePoi.id)}
                        onChange={() => {
                          setSelectedNewPois(prev => {
                            const next = new Set(prev);
                            if (next.has(availablePoi.id)) {
                              next.delete(availablePoi.id);
                            } else {
                              next.add(availablePoi.id);
                            }
                            return next;
                          });
                        }}
                      />
                      <span className={`poi-type-badge ${availablePoi._type === 'point' ? 'destination' : availablePoi._type}`}>
                        {availablePoi._type === 'point' ? 'D' :
                         availablePoi._type === 'river' ? 'R' :
                         availablePoi._type === 'boundary' ? 'B' : 'T'}
                      </span>
                      <span className="poi-name">{availablePoi.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="add-associations-modal-footer">
              <button onClick={() => {
                setIsAdding(false);
                setSelectedNewPois(new Set());
                setFilterText('');
              }} className="btn-cancel">
                Cancel
              </button>
              <button
                onClick={handleAddAssociations}
                className="btn-save"
                disabled={selectedNewPois.size === 0}
              >
                Add {selectedNewPois.size > 0 ? `(${selectedNewPois.size})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AssociationsTabContent;
