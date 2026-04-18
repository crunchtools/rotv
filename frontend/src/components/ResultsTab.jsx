import React, { useMemo, useCallback, memo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ResultsTile from './ResultsTile';
import MapThumbnail from './MapThumbnail';
import { getDestinationIconTypeFromConfig } from '../utils/iconUtils';

// Default park bounds - same as used in App.jsx
// Expanded to include all MTB trailheads (especially western ones like Reagan-Huffman)
const DEFAULT_PARK_BOUNDS = [
  [41.13, -81.85],  // Southwest corner
  [41.45, -81.50]   // Northeast corner
];

// Results tab component showing all visible POIs as tiles
const ResultsTab = memo(function ResultsTab({
  viewportFilteredDestinations,
  viewportFilteredLinearFeatures,
  viewportFilteredVirtualPois,
  allDestinations,
  allLinearFeatures,
  allVirtualPois,  // All virtual POIs (for organizations mode)
  selectedDestination,
  selectedLinearFeature,
  onSelectDestination,
  onSelectLinearFeature,
  mapState,
  _boundsToFit,
  cachedMtbBoundsRef,  // Pre-calculated MTB bounds for instant access
  onMapClick,
  initialShowMtbOnly = false,
  initialShowOrganizationsOnly = false,  // Whether to show organizations sub-tab (controlled by URL)
  onFilterByTypes,  // Callback to filter by POI types: array of types or null for all
  bypassViewportFilter = false,  // Temporarily show all POIs (bypass viewport filtering)
  visiblePoiCount,  // Global POI count from App.jsx
  iconConfig  // Icon configuration for rendering POI icons
}) {
  const navigate = useNavigate();
  const isNavigatingRef = useRef(false);

  // Sub-tab state: 'all', 'mtb', or 'organizations'
  const [activeSubTab, setActiveSubTab] = useState(
    initialShowMtbOnly ? 'mtb' : initialShowOrganizationsOnly ? 'organizations' : 'all'
  );
  const [searchText, setSearchText] = useState('');

  // Sub-tab configuration (fetched from server, with hardcoded fallback)
  const DEFAULT_SUBTABS = [
    { id: 'all', label: 'Points of Interest', shortLabel: 'POIs', route: '/', filterTypes: null, protected: true },
    { id: 'mtb', label: 'MTB Trail Status', shortLabel: 'MTB Status', route: '/mtb-trail-status', filterTypes: ['mtb-trailhead'], protected: false },
    { id: 'organizations', label: 'Organizations', shortLabel: 'Orgs', route: '/organizations', filterTypes: ['organization'], protected: false }
  ];
  const [subtabConfig, setSubtabConfig] = useState(null);

  // Fetch sub-tab config on mount
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

  // Generate initial filter types from iconConfig + layer types
  const allFilterTypes = useMemo(() => {
    const types = new Set(['trails', 'rivers', 'boundaries']); // Layer types
    if (iconConfig && iconConfig.length > 0) {
      iconConfig.forEach(icon => {
        if (icon.enabled !== false) {
          types.add(icon.name);
        }
      });
    } else {
      // Fallback default POI types
      ['visitor-center', 'waterfall', 'trail', 'mtb-trailhead', 'historic', 'bridge',
       'train', 'nature', 'skiing', 'biking', 'picnic', 'camping', 'music', 'default'].forEach(t => types.add(t));
    }
    return types;
  }, [iconConfig]);

  const [enabledFilters, setEnabledFilters] = useState(() => new Set(allFilterTypes));
  const [mtbTrailStatuses, setMtbTrailStatuses] = useState({});

  // Update enabled filters when allFilterTypes changes (iconConfig loads)
  useEffect(() => {
    setEnabledFilters(new Set(allFilterTypes));
  }, [allFilterTypes]);

  // Transition state - tracks when we're leaving MTB mode but bypassViewportFilter hasn't caught up yet
  const [isInTransition, setIsInTransition] = useState(false);

  // Update sub-tab when initialShowMtbOnly or initialShowOrganizationsOnly changes (e.g., from route navigation)
  // But skip if we initiated the navigation ourselves
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

  // Fetch MTB trail statuses when in MTB mode
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


  // Apply POI type filter when sub-tab changes
  useEffect(() => {
    if (onFilterByTypes) {
      // Determine which POI types to show based on active sub-tab
      let typesToShow = null; // null means "show all"

      if (activeSubTab === 'mtb') {
        typesToShow = ['mtb-trailhead'];
      } else if (activeSubTab === 'organizations') {
        typesToShow = ['organization']; // virtual POIs
      }
      // 'all' sub-tab passes null to show all types

      onFilterByTypes(typesToShow);
    }
  }, [activeSubTab, onFilterByTypes]);

  // Combine and sort POIs alphabetically - also create a lookup map
  const { sortedPois, poiMap, totalCount, thumbnailDestinations } = useMemo(() => {
    // When in MTB mode OR organizations mode OR bypassing viewport filter OR in transition,
    // use ALL destinations/features (not viewport-filtered)
    // This prevents the list from becoming empty during map zoom animations
    const useAllPois = activeSubTab === 'mtb' || activeSubTab === 'organizations' || bypassViewportFilter || isInTransition;


    let sourceDestinations = useAllPois ? (allDestinations || []) : (viewportFilteredDestinations || []);
    let sourceLinear = useAllPois ? (allLinearFeatures || []) : (viewportFilteredLinearFeatures || []);
    let sourceVirtual = useAllPois ? (allVirtualPois || []) : (viewportFilteredVirtualPois || []);


    // When in MTB mode, filter to only MTB trailheads (POIs with status_url)
    if (activeSubTab === 'mtb') {
      sourceDestinations = sourceDestinations.filter(d => d.status_url && d.status_url.trim() !== '');
      sourceLinear = []; // No linear features in MTB mode
      sourceVirtual = []; // No virtual POIs in MTB mode
    } else if (activeSubTab === 'organizations') {
      sourceDestinations = []; // No regular POIs in organizations mode
      sourceLinear = []; // No linear features in organizations mode
      // sourceVirtual stays as-is to show all organizations
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

    // Type filter (only applies to Points of Interest subtab)
    if (activeSubTab === 'all') {
      filtered = filtered.filter(poi => enabledFilters.has(poi._poiType));
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

    return {
      sortedPois: sorted,
      poiMap: map,
      totalCount: total,
      thumbnailDestinations: sourceDestinations // For MapThumbnail - use source destinations (MTB trailheads or all destinations during transition)
    };
  }, [activeSubTab, viewportFilteredDestinations, viewportFilteredLinearFeatures, viewportFilteredVirtualPois, allDestinations, allLinearFeatures, allVirtualPois, searchText, enabledFilters, bypassViewportFilter, isInTransition, iconConfig]);

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

  // Use appropriate POI count based on mode
  // Organizations mode: use count of organizations (sortedPois.length since it's filtered to only organizations)
  // Other modes: use global POI count from App.jsx
  const poiCount = activeSubTab === 'organizations' ? sortedPois.length : visiblePoiCount;

  // Generate filter chips dynamically from iconConfig
  const filterChips = useMemo(() => {
    const chips = [];

    // POI type chips
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

    // Layer chips (trails, rivers, boundaries)
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

    // Sort alphabetically
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
  }, []);

  const showAllFilters = useCallback(() => {
    setEnabledFilters(new Set(allFilterTypes));
  }, [allFilterTypes]);

  const hideAllFilters = useCallback(() => {
    setEnabledFilters(new Set());
  }, []);

  // Clear transition state when App.jsx bypassViewportFilter catches up
  useEffect(() => {
    if (bypassViewportFilter && isInTransition) {
      setIsInTransition(false);
    }
  }, [bypassViewportFilter, isInTransition]);

  // Simple, direct bounds computation - no async effects, no delays
  const stableBoundsRef = useRef(DEFAULT_PARK_BOUNDS);

  let currentBounds;
  if (activeSubTab === 'mtb') {
    // MTB mode: use pre-calculated cached bounds
    currentBounds = cachedMtbBoundsRef?.current || DEFAULT_PARK_BOUNDS;
  } else if (bypassViewportFilter || isInTransition) {
    // Bypass mode OR in transition: use default park bounds constant
    // Stay in transition until bypassViewportFilter catches up to prevent using stale mapState.bounds
    currentBounds = DEFAULT_PARK_BOUNDS;
  } else {
    // Normal mode: use current viewport bounds
    currentBounds = mapState?.bounds || DEFAULT_PARK_BOUNDS;
  }

  // Only update stable ref if coordinates actually changed
  // This prevents MapThumbnail from re-rendering when bounds array reference changes but values don't
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

  // Handle sub-tab change
  const handleSubTabChange = (tab) => {
    // Set flag to prevent redundant sync when URL changes
    isNavigatingRef.current = true;

    // If leaving MTB mode, immediately set transition state
    // This ensures the next render has the correct POI list and bounds
    if (activeSubTab === 'mtb' && tab === 'all') {
      setIsInTransition(true);
    }

    setActiveSubTab(tab);

    // Don't clear bypass filter here - let App.jsx MTB Route Effect handle it
    // This prevents flickering when switching from MTB to All Results

    // Navigate to config-driven route
    const tabConfig = activeSubtabs.find(t => t.id === tab);
    if (tabConfig) {
      navigate(tabConfig.route);
    } else {
      navigate('/');
    }
    // Filter will be applied by useEffect that watches activeSubTab
  };

  if (sortedPois.length === 0) {
    return (
      <div className="results-tab-wrapper">
        <div className="news-events-header">
          <h2>Results</h2>
          <p className="tab-subtitle">Points of interest visible in the current map area</p>
        </div>

        {/* Sub-tabs (data-driven from config) */}
        <div className="results-subtabs">
          {activeSubtabs.map(tab => (
            <button
              key={tab.id}
              className={`results-subtab ${activeSubTab === tab.id ? 'active' : ''}`}
              onClick={() => handleSubTabChange(tab.id)}
            >
              <span className="subtab-label-full">{tab.label}</span>
              <span className="subtab-label-short">{tab.shortLabel || tab.label}</span>
            </button>
          ))}
        </div>

        {/* Filter badges - always visible even when no results */}
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
            Showing {poiCount} of {totalCount} POIs
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

      {/* Sub-tabs (data-driven from config) */}
      <div className="results-subtabs">
        {activeSubtabs.map(tab => (
          <button
            key={tab.id}
            className={`results-subtab ${activeSubTab === tab.id ? 'active' : ''}`}
            onClick={() => handleSubTabChange(tab.id)}
          >
            <span className="subtab-label-full">{tab.label}</span>
            <span className="subtab-label-short">{tab.shortLabel || tab.label}</span>
          </button>
        ))}
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
                  showStatusInfo={activeSubTab === 'mtb'}
                  statusData={mtbTrailStatuses[poi.id]}
                  iconConfig={iconConfig}
                />
              );
            })}
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
});

export default ResultsTab;
