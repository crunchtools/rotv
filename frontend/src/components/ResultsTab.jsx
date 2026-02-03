import React, { useMemo, useCallback, memo, useState, useEffect } from 'react';
import ResultsTile from './ResultsTile';
import MapThumbnail from './MapThumbnail';

// Results tab component showing all visible POIs as tiles
const ResultsTab = memo(function ResultsTab({
  viewportFilteredDestinations,
  viewportFilteredLinearFeatures,
  viewportFilteredVirtualPois,
  selectedDestination,
  selectedLinearFeature,
  onSelectDestination,
  onSelectLinearFeature,
  mapState,
  onMapClick,
  initialShowMtbOnly = false,
  onShowMtbOnlyChange
}) {
  // Sub-tab state: 'all' or 'mtb'
  const [activeSubTab, setActiveSubTab] = useState(initialShowMtbOnly ? 'mtb' : 'all');
  const [searchText, setSearchText] = useState('');
  const [typeFilters, setTypeFilters] = useState({
    destination: true,
    trail: true,
    river: true,
    boundary: true,
    organization: true
  });
  // Derive showMtbOnly from activeSubTab
  const showMtbOnly = activeSubTab === 'mtb';
  const [mtbTrailStatuses, setMtbTrailStatuses] = useState({});
  const [allMtbTrails, setAllMtbTrails] = useState(null); // Store fetched MTB trails when using direct link

  // Fetch MTB trail statuses when MTB tab is active
  useEffect(() => {
    if (activeSubTab === 'mtb') {
      fetchMtbStatuses();
    }
  }, [activeSubTab]);

  // Fetch all MTB trails when initialized via URL parameter
  useEffect(() => {
    if (initialShowMtbOnly) {
      fetchAllMtbTrails();
    }
  }, [initialShowMtbOnly]);

  const fetchAllMtbTrails = async () => {
    try {
      const response = await fetch('/api/trails/mtb?includeStatus=true');
      if (response.ok) {
        const trails = await response.json();
        // Format trails to match the expected structure
        // Check actual poi_type - could be 'trail' (linear) or 'point' (destination)
        const formattedTrails = trails.map(trail => ({
          ...trail,
          _isLinear: trail.poi_type === 'trail',
          _isVirtual: false,
          _poiType: trail.poi_type === 'trail' ? 'trail' : 'destination'
        }));
        setAllMtbTrails(formattedTrails);

        // Also populate status map
        const statusMap = {};
        trails.forEach(trail => {
          if (trail.status) {
            statusMap[trail.id] = trail.status;
          }
        });
        setMtbTrailStatuses(statusMap);
      }
    } catch (err) {
      console.error('Error fetching all MTB trails:', err);
    }
  };

  const fetchMtbStatuses = async () => {
    try {
      const response = await fetch('/api/trails/mtb?includeStatus=true');
      if (response.ok) {
        const trails = await response.json();
        const statusMap = {};
        trails.forEach(trail => {
          if (trail.status) {
            statusMap[trail.id] = trail.status;
          }
        });
        setMtbTrailStatuses(statusMap);
      }
    } catch (err) {
      console.error('Error fetching MTB trail statuses:', err);
    }
  };

  // Combine and sort POIs alphabetically - also create a lookup map
  const { sortedPois, poiMap, totalCount } = useMemo(() => {
    // If we have fetched all MTB trails (from URL parameter), use only those
    if (allMtbTrails) {
      const filtered = allMtbTrails;

      // Apply text search if present
      let searchFiltered = filtered;
      if (searchText.trim()) {
        const search = searchText.toLowerCase();
        searchFiltered = filtered.filter(poi =>
          (poi.name || '').toLowerCase().includes(search) ||
          (poi.brief_description || '').toLowerCase().includes(search)
        );
      }

      const sorted = searchFiltered.sort((a, b) =>
        (a.name || '').localeCompare(b.name || '')
      );

      const map = new Map();
      sorted.forEach(poi => {
        const type = poi._isVirtual ? 'virtual' : (poi._isLinear ? 'linear' : 'point');
        const key = `${type}-${poi.id}`;
        map.set(key, poi);
      });

      return {
        sortedPois: sorted,
        poiMap: map,
        totalCount: sorted.length
      };
    }

    // Normal viewport-based filtering
    const dests = (viewportFilteredDestinations || []).map(d => ({
      ...d,
      _isLinear: false,
      _isVirtual: false,
      _poiType: 'destination'
    }));
    const linear = (viewportFilteredLinearFeatures || []).map(f => ({
      ...f,
      _isLinear: true,
      _isVirtual: false,
      _poiType: f.feature_type || 'trail'
    }));
    const virtual = (viewportFilteredVirtualPois || []).map(v => ({
      ...v,
      _isLinear: false,
      _isVirtual: true,
      _poiType: 'organization'
    }));

    const allPois = [...dests, ...linear, ...virtual];
    const total = allPois.length;

    // Apply filters
    let filtered = allPois;

    // Text search filter
    if (searchText.trim()) {
      const search = searchText.toLowerCase();
      filtered = filtered.filter(poi =>
        (poi.name || '').toLowerCase().includes(search) ||
        (poi.brief_description || '').toLowerCase().includes(search)
      );
    }

    // Type filter
    filtered = filtered.filter(poi => typeFilters[poi._poiType]);

    // MTB filter - show only trails with status collection configured
    if (showMtbOnly) {
      filtered = filtered.filter(poi => poi.status_url && poi.status_url.trim() !== '');
    }

    // Sort alphabetically
    const sorted = filtered.sort((a, b) =>
      (a.name || '').localeCompare(b.name || '')
    );

    // Create lookup map for event delegation
    const map = new Map();
    sorted.forEach(poi => {
      const type = poi._isVirtual ? 'virtual' : (poi._isLinear ? 'linear' : 'point');
      const key = `${type}-${poi.id}`;
      map.set(key, poi);
    });

    return { sortedPois: sorted, poiMap: map, totalCount: total };
  }, [viewportFilteredDestinations, viewportFilteredLinearFeatures, viewportFilteredVirtualPois, searchText, typeFilters, showMtbOnly, allMtbTrails]);

  // Event delegation handler - single handler for all tiles
  const handleListClick = useCallback((e) => {
    const tile = e.target.closest('.results-tile');
    if (!tile) return;

    const poiKey = tile.dataset.poiKey;
    const poi = poiMap.get(poiKey);
    if (!poi) return;

    if (poi._isLinear) {
      onSelectLinearFeature(poi);
    } else {
      onSelectDestination(poi);
    }
  }, [poiMap, onSelectDestination, onSelectLinearFeature]);

  // Memoize selected IDs for faster comparison
  const selectedId = selectedDestination?.id;
  const selectedLinearId = selectedLinearFeature?.id;

  const poiCount = sortedPois.length;

  // Handle sub-tab change
  const handleSubTabChange = (tab) => {
    setActiveSubTab(tab);
    if (onShowMtbOnlyChange) {
      onShowMtbOnlyChange(tab === 'mtb');
    }
  };

  if (sortedPois.length === 0) {
    return (
      <div className="results-tab-wrapper">
        <div className="news-events-header">
          <h2>Results</h2>
          <p className="tab-subtitle">Points of interest visible in the current map area</p>
        </div>

        {/* Sub-tabs */}
        <div className="results-subtabs">
          <button
            className={`results-subtab ${activeSubTab === 'all' ? 'active' : ''}`}
            onClick={() => handleSubTabChange('all')}
          >
            All Results
          </button>
          <button
            className={`results-subtab ${activeSubTab === 'mtb' ? 'active' : ''}`}
            onClick={() => handleSubTabChange('mtb')}
          >
            MTB Trail Status
          </button>
        </div>

        <div className="news-events-layout">
          <div className="news-events-content">
            <div className="results-tab-empty">
              <div className="results-tab-empty-icon">{activeSubTab === 'mtb' ? '🚵' : '🗺️'}</div>
              <div className="results-tab-empty-text">
                {activeSubTab === 'mtb'
                  ? 'No MTB trails with status tracking configured.'
                  : 'No points of interest visible in the current map area.'}
              </div>
              <div className="results-tab-empty-hint">
                {activeSubTab === 'mtb'
                  ? 'Configure status_url on trails to enable status tracking.'
                  : 'Try zooming out or panning to see more locations.'}
              </div>
            </div>
          </div>
          {mapState && (
            <div className="map-thumbnail-sidebar">
              <MapThumbnail
                bounds={mapState.bounds}
                aspectRatio={mapState.aspectRatio || 1.5}
                visibleDestinations={viewportFilteredDestinations}
                onClick={onMapClick}
                poiCount={poiCount}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="results-tab-wrapper">
      <div className="news-events-header">
        <h2>Results</h2>
        <p className="tab-subtitle">Points of interest visible in the current map area</p>
      </div>

      {/* Sub-tabs */}
      <div className="results-subtabs">
        <button
          className={`results-subtab ${activeSubTab === 'all' ? 'active' : ''}`}
          onClick={() => handleSubTabChange('all')}
        >
          All Results
        </button>
        <button
          className={`results-subtab ${activeSubTab === 'mtb' ? 'active' : ''}`}
          onClick={() => handleSubTabChange('mtb')}
        >
          MTB Trail Status
        </button>
      </div>

      <div className="results-filters">
        <input
          type="text"
          className="results-search-input"
          placeholder="Search by name or description..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        {activeSubTab === 'all' && (
          <div className="results-type-filters">
            <div
              className={`type-filter-chip destination ${typeFilters.destination ? 'active' : 'inactive'}`}
              onClick={() => setTypeFilters(prev => ({ ...prev, destination: !prev.destination }))}
            >
              <span className="type-filter-icon">D</span>
              Destination
            </div>
            <div
              className={`type-filter-chip trail ${typeFilters.trail ? 'active' : 'inactive'}`}
              onClick={() => setTypeFilters(prev => ({ ...prev, trail: !prev.trail }))}
            >
              <span className="type-filter-icon">T</span>
              Trail
            </div>
            <div
              className={`type-filter-chip river ${typeFilters.river ? 'active' : 'inactive'}`}
              onClick={() => setTypeFilters(prev => ({ ...prev, river: !prev.river }))}
            >
              <span className="type-filter-icon">R</span>
              River
            </div>
            <div
              className={`type-filter-chip boundary ${typeFilters.boundary ? 'active' : 'inactive'}`}
              onClick={() => setTypeFilters(prev => ({ ...prev, boundary: !prev.boundary }))}
            >
              <span className="type-filter-icon">B</span>
              Boundary
            </div>
            <div
              className={`type-filter-chip organization ${typeFilters.organization ? 'active' : 'inactive'}`}
              onClick={() => setTypeFilters(prev => ({ ...prev, organization: !prev.organization }))}
            >
              <span className="type-filter-icon">O</span>
              Organization
            </div>
          </div>
        )}
        <div className="results-count">
          Showing {poiCount} of {totalCount} POIs
        </div>
      </div>

      <div className="news-events-layout">
        <div className="news-events-content">
          <div className="results-tab-list" onClick={handleListClick}>
            {sortedPois.map(poi => {
              const type = poi._isVirtual ? 'virtual' : (poi._isLinear ? 'linear' : 'point');
              const poiKey = `${type}-${poi.id}`;
              const isSelected = poi._isLinear
                ? selectedLinearId === poi.id
                : selectedId === poi.id;
              return (
                <ResultsTile
                  key={poiKey}
                  poiKey={poiKey}
                  poi={poi}
                  isLinear={poi._isLinear}
                  isVirtual={poi._isVirtual}
                  isSelected={isSelected}
                  showStatusBadge={showMtbOnly}
                  status={mtbTrailStatuses[poi.id]}
                />
              );
            })}
          </div>
        </div>
        {mapState && (
          <div className="map-thumbnail-sidebar">
            <MapThumbnail
              bounds={mapState.bounds}
              aspectRatio={mapState.aspectRatio || 1.5}
              visibleDestinations={viewportFilteredDestinations}
              onClick={onMapClick}
              poiCount={poiCount}
            />
          </div>
        )}
      </div>
    </div>
  );
});

export default ResultsTab;
