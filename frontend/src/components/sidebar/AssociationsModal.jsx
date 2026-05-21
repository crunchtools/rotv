import { useState, useMemo } from 'react';

function AssociationsModal({ isOpen, onClose, poi, associations, allDestinations, allLinearFeatures, allVirtualPois, onSelectDestination, onSelectLinearFeature, isAdmin, editMode, onAssociationsChanged }) {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedNewPois, setSelectedNewPois] = useState(new Set());
  const [deleting, setDeleting] = useState(null);

  const availablePois = useMemo(() => {
    if (!isOpen || !poi) return [];

    const isVirtualPoi = poi.poi_roles?.includes('organization');
    if (!isVirtualPoi) return [];

    const poiAssociations = (associations || []).filter(assoc =>
      assoc.virtual_poi_id === poi.id || assoc.physical_poi_id === poi.id
    );

    const currentIds = new Set();

    poiAssociations.forEach(assoc => {
      if (isVirtualPoi) {
        currentIds.add(assoc.physical_poi_id);
      } else {
        currentIds.add(assoc.virtual_poi_id);
      }
    });

    (allDestinations || []).forEach(d => {
      if (Number(d.owner_id) === Number(poi.id)) {
        currentIds.add(d.id);
      }
    });
    (allLinearFeatures || []).forEach(f => {
      if (Number(f.owner_id) === Number(poi.id)) {
        currentIds.add(f.id);
      }
    });

    if (poi.owner_id) {
      currentIds.add(Number(poi.owner_id));
    }

    const allPhysicalPois = [
      ...(allDestinations || []).map(d => ({ ...d, _type: 'point' })),
      ...(allLinearFeatures || []).map(f => ({ ...f, _type: f.poi_roles?.find(r => ['trail', 'river', 'boundary'].includes(r)) || 'trail' }))
    ];

    return allPhysicalPois.filter(p => !currentIds.has(p.id));
  }, [isOpen, poi, associations, allDestinations, allLinearFeatures]);

  if (!isOpen || !poi) return null;

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

  const ownedPois = isVirtualPoi
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

  const associatedPoisWithAssocId = [
    ...(ownerOrg ? [{ ...ownerOrg, _isVirtual: true, _isLinear: false, _isOwner: true }] : []),
    ...ownedPois.filter(p => !regularAssociations.some(a => a.id === p.id)),
    ...regularAssociations.filter(a => (!ownerOrg || a.id !== ownerOrg.id) && !ownedPois.some(p => p.id === a.id))
  ];


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

      if (onAssociationsChanged) {
        onAssociationsChanged();
      }
    } catch (error) {
      console.error('Error adding associations:', error);
      alert('Error adding associations: ' + error.message);
    }
  };

  return (
    <div className="associations-modal-overlay" onClick={onClose}>
      <div className="associations-modal" onClick={(e) => e.stopPropagation()}>
        <div className="associations-modal-header">
          <h3>{isVirtualPoi ? 'Associated Locations' : 'Organizations'}</h3>
          <button className="associations-modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="associations-modal-content">
          <p className="associations-modal-description">
            {isVirtualPoi
              ? 'Physical locations associated with this organization.'
              : 'Organizations associated with this location.'}
          </p>

          {isAdmin && editMode && isVirtualPoi && !isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className="btn-add-association"
              style={{ marginBottom: '1rem' }}
            >
              + Add Associations
            </button>
          )}

          {associatedPoisWithAssocId.length > 0 ? (
            <div className="associations-modal-list">
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
                                      (associatedPoi.poi_roles?.includes('mtb_trail') || (associatedPoi.status_url && associatedPoi.status_url.trim() !== ''));
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
                          onClose();
                        } else if (associatedPoi._isLinear) {
                          onSelectLinearFeature(associatedPoi);
                          onClose();
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
                          {associatedPoi.era_name && !associatedPoi._isVirtual && (
                            <span className="association-item-era">{associatedPoi.era_name}</span>
                          )}
                        </div>
                        {associatedPoi.brief_description && (
                          <div className="association-item-description">{associatedPoi.brief_description}</div>
                        )}
                      </div>
                    </div>
                    {isAdmin && editMode && isVirtualPoi && !associatedPoi._isOwner && !associatedPoi._isOwned && (
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
            <div className="associations-modal-empty">No associations yet.</div>
          )}

          {isAdding && (
            <div className="add-associations-section">
              <h4>Add Associations</h4>
              <div className="available-pois-list">
                {availablePois.length === 0 ? (
                  <div className="empty-message">All locations are already associated</div>
                ) : (
                  availablePois.map(availablePoi => (
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
              <div className="add-associations-actions">
                <button onClick={() => {
                  setIsAdding(false);
                  setSelectedNewPois(new Set());
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
          )}
        </div>
      </div>
    </div>
  );
}

export default AssociationsModal;
