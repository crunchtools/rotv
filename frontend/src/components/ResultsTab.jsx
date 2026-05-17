import React, { useMemo, useCallback, memo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ResultsTile from './ResultsTile';
import MapThumbnail from './MapThumbnail';
import { getDestinationIconTypeFromConfig } from '../utils/iconUtils';
import { handleRovingKeyDown } from '../utils/a11yUtils';

const DEFAULT_PARK_BOUNDS = [
  [41.13, -81.85],
  [41.45, -81.50]
];

const ResultsTab = memo(function ResultsTab({
  viewportFilteredDestinations,
  viewportFilteredLinearFeatures,
  viewportFilteredVirtualPois,
  allDestinations,
  allLinearFeatures,
  allVirtualPois,
  selectedDestination,
  selectedLinearFeature,
  onSelectDestination,
  onSelectLinearFeature,
  mapState,
  _boundsToFit,
  cachedMtbBoundsRef,
  onMapClick,
  initialShowMtbOnly = false,
  initialShowOrganizationsOnly = false,
  onFilterByTypes,
  bypassViewportFilter = false,
  visiblePoiCount,
  iconConfig,
  editMode = false,
  isAdmin = false,
  userRole = 'viewer',
  onNewPOI
}) {
  const navigate = useNavigate();
  const isNavigatingRef = useRef(false);

  const [activeSubTab, setActiveSubTab] = useState(
    initialShowMtbOnly ? 'mtb' : initialShowOrganizationsOnly ? 'organizations' : 'all'
  );
  const [searchText, setSearchText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  const DEFAULT_SUBTABS = [
    { id: 'all', label: 'Points of Interest', shortLabel: 'POIs', route: '/', filterTypes: null, protected: true },
    { id: 'mtb', label: 'MTB Trail Status', shortLabel: 'MTB Status', route: '/mtb-trail-status', filterTypes: ['mtb-trailhead'], protected: false },
    { id: 'organizations', label: 'Organizations', shortLabel: 'Orgs', route: '/organizations', filterTypes: ['organization'], protected: false }
  ];
  const [subtabConfig, setSubtabConfig] = useState(null);

  useEffect(() => {
    fetch('/api/results-subtabs')
      .then(res => res.json())
      .then(data => {
        if (data.subtabs && data.subtabs.length > 0) {
          setSubtabConfig(data.subtabs);
        }
      })
      .catch(err => console.error('Failed to fetch subtab config:', err));
  }, []);

  const activeSubtabs = subtabConfig || DEFAULT_SUBTABS;

  const allFilterTypes = useMemo(() => {
    const types = new Set(['trails', 'rivers', 'boundaries']);
    if (iconConfig && iconConfig.length > 0) {
      iconConfig.forEach(icon => {
        if (icon.enabled !== false) {
          types.add(icon.name);
        }
      });
    } else {
      ['visitor-center', 'waterfall', 'trail', 'mtb-trailhead', 'historic', 'bridge',
       'train', 'nature', 'skiing', 'biking', 'picnic', 'camping', 'music', 'default'].forEach(t => types.add(t));
    }
    return types;
  }, [iconConfig]);

  const [enabledFilters, setEnabledFilters] = useState(() => new Set(allFilterTypes));
  const [mtbTrailStatuses, setMtbTrailStatuses] = useState({});

  useEffect(() => {
    setEnabledFilters(new Set(allFilterTypes));
  }, [allFilterTypes]);

  const [isInTransition, setIsInTransition] = useState(false);

  useEffect(() => {
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      return;
    }

    if (initialShowMtbOnly && activeSubTab !== 'mtb') {
      setActiveSubTab('mtb');
    } else if (initialShowOrganizationsOnly && activeSubTab !== 'organizations') {
      setActiveSubTab('organizations');
    } else if (!initialShowMtbOnly && !initialShowOrganizationsOnly && (activeSubTab === 'mtb' || activeSubTab === 'organizations')) {
      setActiveSubTab('all');
    }
  }, [initialShowMtbOnly, initialShowOrganizationsOnly, activeSubTab]);

  useEffect(() => {
    if (activeSubTab === 'mtb') {
      fetch('/api/trail-status/mtb-trails')
        .then(res => res.json())
        .then(trails => {
          const statusMap = {};
          trails.forEach(trail => {
            statusMap[trail.id] = {
              status: trail.status || 'unknown',
              conditions: trail.conditions,
              last_updated: trail.last_updated,
              source_name: trail.source_name
            };
          });
          setMtbTrailStatuses(statusMap);
        })
        .catch(err => console.error('Failed to fetch MTB trail statuses:', err));
    }
  }, [activeSubTab]);


  useEffect(() => {
    if (onFilterByTypes) {
      let typesToShow = null;

      if (activeSubTab === 'mtb') {
        typesToShow = ['mtb-trailhead'];
      } else if (activeSubTab === 'organizations') {
        typesToShow = ['organization'];
      }

      onFilterByTypes(typesToShow);
    }
  }, [activeSubTab, onFilterByTypes]);

  const { sortedPois, poiMap, totalCount, thumbnailDestinations } = useMemo(() => {
    const useAllPois = activeSubTab === 'mtb' || activeSubTab === 'organizations' || bypassViewportFilter || isInTransition;


    let sourceDestinations = useAllPois ? (allDestinations || []) : (viewportFilteredDestinations || []);
    let sourceLinear = useAllPois ? (allLinearFeatures || []) : (viewportFilteredLinearFeatures || []);
    let sourceVirtual = useAllPois ? (allVirtualPois || []) : (viewportFilteredVirtualPois || []);


    if (activeSubTab === 'mtb') {
      sourceDestinations = sourceDestinations.filter(d => d.status_url && d.status_url.trim() !== '');
      sourceLinear = [];
      sourceVirtual = [];
    } else if (activeSubTab === 'organizations') {
      sourceDestinations = [];
      sourceLinear = [];
    }

    const dests = sourceDestinations.map(d => ({
      ...d,
      _isLinear: false,
      _isVirtual: !d.geometry && !d.latitude,
      _poiType: getDestinationIconTypeFromConfig(d, iconConfig)
    }));
    const linear = sourceLinear.map(f => ({
      ...f,
      _isLinear: true,
      _isVirtual: false,
      _poiType: f.feature_type === 'trail' ? 'trails' : f.feature_type === 'river' ? 'rivers' : 'boundaries'
    }));
    const virtual = sourceVirtual.map(v => ({
      ...v,
      _isLinear: false,
      _isVirtual: !v.geometry && !v.latitude,
      _poiType: 'organization'
    }));

    const allPois = [...dests, ...linear, ...virtual];
    const total = allPois.length;

    let filtered = allPois;

    if (searchText.trim()) {
      const search = searchText.toLowerCase();
      filtered = filtered.filter(poi =>
        (poi.name || '').toLowerCase().includes(search) ||
        (poi.brief_description || '').toLowerCase().includes(search)
      );
    }

    if (activeSubTab === 'all') {
      filtered = filtered.filter(poi => enabledFilters.has(poi._poiType));
    }

    const sorted = filtered.sort((a, b) =>
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
      totalCount: total,
      thumbnailDestinations: sourceDestinations
    };
  }, [activeSubTab, viewportFilteredDestinations, viewportFilteredLinearFeatures, viewportFilteredVirtualPois, allDestinations, allLinearFeatures, allVirtualPois, searchText, enabledFilters, bypassViewportFilter, isInTransition, iconConfig]);

  const totalPages = Math.ceil(sortedPois.length / PAGE_SIZE) || 1;
  const clampedPage = Math.min(currentPage, totalPages);
  if (clampedPage !== currentPage) setCurrentPage(clampedPage);
  const paginatedPois = sortedPois.slice(
    (clampedPage - 1) * PAGE_SIZE,
    clampedPage * PAGE_SIZE
  );

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

  const selectedId = selectedDestination?.id;
  const selectedLinearId = selectedLinearFeature?.id;

  const poiCount = activeSubTab === 'organizations' ? sortedPois.length : visiblePoiCount;

  const filterChips = useMemo(() => {
    const chips = [];

    if (iconConfig && iconConfig.length > 0) {
      iconConfig.forEach(icon => {
        if (icon.enabled !== false) {
          const iconUrl = icon.svg_content
            ? `/api/icons/${icon.name}.svg`
            : `/icons/${icon.svg_filename || `${icon.name}.svg`}`;

          chips.push({
            id: icon.name,
            label: icon.name === 'trail' ? 'Trailheads' : (icon.label || icon.name),
            iconUrl,
            type: 'poi'
          });
        }
      });
    }

    chips.push({
      id: 'trails',
      label: 'Trails',
      iconUrl: '/icons/layers/trails.svg',
      type: 'layer'
    });
    chips.push({
      id: 'rivers',
      label: 'Rivers',
      iconUrl: '/icons/layers/rivers.svg',
      type: 'layer'
    });
    chips.push({
      id: 'boundaries',
      label: 'Boundaries',
      iconUrl: '/icons/layers/boundaries.svg',
      type: 'layer'
    });

    return chips.sort((a, b) => a.label.localeCompare(b.label));
  }, [iconConfig]);

  const toggleFilter = useCallback((typeId) => {
    setEnabledFilters(prev => {
      const newSet = new Set(prev);
      if (newSet.has(typeId)) {
        newSet.delete(typeId);
      } else {
        newSet.add(typeId);
      }
      return newSet;
    });
    setCurrentPage(1);
  }, []);

  const showAllFilters = useCallback(() => {
    setEnabledFilters(new Set(allFilterTypes));
    setCurrentPage(1);
  }, [allFilterTypes]);

  const hideAllFilters = useCallback(() => {
    setEnabledFilters(new Set());
    setCurrentPage(1);
  }, []);

  useEffect(() => {
    if (bypassViewportFilter && isInTransition) {
      setIsInTransition(false);
    }
  }, [bypassViewportFilter, isInTransition]);

  const stableBoundsRef = useRef(DEFAULT_PARK_BOUNDS);

  let currentBounds;
  if (activeSubTab === 'mtb') {
    currentBounds = cachedMtbBoundsRef?.current || DEFAULT_PARK_BOUNDS;
  } else if (bypassViewportFilter || isInTransition) {
    currentBounds = DEFAULT_PARK_BOUNDS;
  } else {
    currentBounds = mapState?.bounds || DEFAULT_PARK_BOUNDS;
  }

  const boundsChanged = currentBounds &&
    (!stableBoundsRef.current ||
    currentBounds[0][0] !== stableBoundsRef.current[0][0] ||
    currentBounds[0][1] !== stableBoundsRef.current[0][1] ||
    currentBounds[1][0] !== stableBoundsRef.current[1][0] ||
    currentBounds[1][1] !== stableBoundsRef.current[1][1]);

  if (boundsChanged) {
    stableBoundsRef.current = currentBounds;
  }

  const thumbnailBounds = stableBoundsRef.current;

  const handleSubTabChange = (tab) => {
    isNavigatingRef.current = true;

    if (activeSubTab === 'mtb' && tab === 'all') {
      setIsInTransition(true);
    }

    setActiveSubTab(tab);
    setCurrentPage(1);

    const tabConfig = activeSubtabs.find(t => t.id === tab);
    if (tabConfig) {
      navigate(tabConfig.route);
    } else {
      navigate('/');
    }
  };

  if (sortedPois.length === 0) {
    return (
      <div className="results-tab-wrapper">
        <div className="news-events-header">
          <h2>Results</h2>
          <p className="tab-subtitle">Points of interest visible in the current map area</p>
        </div>


        <div className="results-subtabs" onKeyDown={(e) => handleRovingKeyDown(e, '.results-subtab')}>
          {activeSubtabs.map(tab => (
            <button
              key={tab.id}
              className={`results-subtab ${activeSubTab === tab.id ? 'active' : ''}`}
              data-subtab={tab.id}
              onClick={() => handleSubTabChange(tab.id)}
              tabIndex={activeSubTab === tab.id ? 0 : -1}
            >
              <span className="subtab-label-full">{tab.label}</span>
              <span className="subtab-label-short">{tab.shortLabel || tab.label}</span>
            </button>
          ))}
          {editMode && (isAdmin || userRole === 'poi_admin') && onNewPOI && (
            <button
              className="results-new-btn"
              onClick={() => onNewPOI(activeSubTab)}
              title={`Create new ${activeSubTab === 'mtb' ? 'MTB trailhead' : activeSubTab === 'organizations' ? 'organization' : 'point of interest'}`}
            >
              + New
            </button>
          )}
        </div>


        <div className="results-filters">
          <input
            type="text"
            className="results-search-input"
            placeholder="Search by name or description..."
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setCurrentPage(1); }}
          />
          {activeSubTab === 'all' && (
            <>
              <div className="results-filter-actions">
                <button onClick={showAllFilters} className="filter-action-btn">All</button>
                <button onClick={hideAllFilters} className="filter-action-btn">None</button>
              </div>
              <div className="results-type-filters">
                {filterChips.map(chip => (
                  <div
                    key={chip.id}
                    className={`type-filter-chip ${chip.id} ${enabledFilters.has(chip.id) ? 'active' : 'inactive'}`}
                    onClick={() => toggleFilter(chip.id)}
                  >
                    <img src={chip.iconUrl} alt={chip.label} className="type-filter-icon" />
                    {chip.label}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="results-count">
            Showing {sortedPois.length === 0 ? '0' : `${((currentPage - 1) * PAGE_SIZE) + 1}-${Math.min(currentPage * PAGE_SIZE, sortedPois.length)}`} of {sortedPois.length} POIs
          </div>
        </div>

        <div className="news-events-layout">
          <div className="news-events-content">
            <div className="results-tab-empty">
              <div className="results-tab-empty-icon">
                {activeSubTab === 'mtb' ? '🚵' : activeSubTab === 'organizations' ? '🏢' : '🗺️'}
              </div>
              <div className="results-tab-empty-text">
                {activeSubTab === 'mtb'
                  ? 'No MTB trails with status tracking configured.'
                  : activeSubTab === 'organizations'
                  ? 'No organizations found.'
                  : 'No points of interest visible in the current map area.'}
              </div>
              <div className="results-tab-empty-hint">
                {activeSubTab === 'mtb'
                  ? 'Configure status_url on trails to enable status tracking.'
                  : activeSubTab === 'organizations'
                  ? 'Create POIs with poi_roles including "organization" to add organizations.'
                  : 'Try zooming out or panning to see more locations.'}
              </div>
            </div>
          </div>
          {mapState && (
            <div className="map-thumbnail-sidebar">
              <MapThumbnail
                bounds={thumbnailBounds}
                aspectRatio={mapState.aspectRatio || 1.5}
                visibleDestinations={thumbnailDestinations}
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


      <div className="results-subtabs" onKeyDown={(e) => handleRovingKeyDown(e, '.results-subtab')}>
        {activeSubtabs.map(tab => (
          <button
            key={tab.id}
            className={`results-subtab ${activeSubTab === tab.id ? 'active' : ''}`}
            data-subtab={tab.id}
            onClick={() => handleSubTabChange(tab.id)}
            tabIndex={activeSubTab === tab.id ? 0 : -1}
          >
            <span className="subtab-label-full">{tab.label}</span>
            <span className="subtab-label-short">{tab.shortLabel || tab.label}</span>
          </button>
        ))}
        {editMode && (isAdmin || userRole === 'poi_admin') && onNewPOI && (
          <button
            className="results-new-btn"
            onClick={() => onNewPOI(activeSubTab)}
            title={`Create new ${activeSubTab === 'mtb' ? 'MTB trailhead' : activeSubTab === 'organizations' ? 'organization' : 'point of interest'}`}
          >
            + New
          </button>
        )}
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
          <>
            <div className="results-filter-actions">
              <button onClick={showAllFilters} className="filter-action-btn">All</button>
              <button onClick={hideAllFilters} className="filter-action-btn">None</button>
            </div>
            <div className="results-type-filters">
              {filterChips.map(chip => (
                <div
                  key={chip.id}
                  className={`type-filter-chip ${chip.id} ${enabledFilters.has(chip.id) ? 'active' : 'inactive'}`}
                  onClick={() => toggleFilter(chip.id)}
                >
                  <img src={chip.iconUrl} alt={chip.label} className="type-filter-icon" />
                  {chip.label}
                </div>
              ))}
            </div>
          </>
        )}
        <div className="results-count">
          Showing {sortedPois.length === 0 ? '0' : `${((currentPage - 1) * PAGE_SIZE) + 1}-${Math.min(currentPage * PAGE_SIZE, sortedPois.length)}`} of {sortedPois.length} POIs
        </div>
      </div>

      <div className="news-events-layout">
        <div className="news-events-content">
          <div className="results-tab-list" onClick={handleListClick} onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleListClick(e); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              const tiles = Array.from(e.currentTarget.querySelectorAll('.results-tile'));
              const idx = tiles.indexOf(e.target.closest('.results-tile'));
              if (idx === -1) return;
              e.preventDefault();
              const next = e.key === 'ArrowDown' ? Math.min(idx + 1, tiles.length - 1) : Math.max(idx - 1, 0);
              tiles[next].focus();
            }
          }}>
            {paginatedPois.map(poi => {
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
                  showStatusInfo={activeSubTab === 'mtb'}
                  statusData={mtbTrailStatuses[poi.id]}
                  iconConfig={iconConfig}
                />
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(p => p - 1)}
                disabled={currentPage === 1}
              >
                Back
              </button>
              <span className="pagination-info">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
        {mapState && (
          <div className="map-thumbnail-sidebar">
            <MapThumbnail
              bounds={thumbnailBounds}
              aspectRatio={mapState.aspectRatio || 1.5}
              visibleDestinations={thumbnailDestinations}
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
