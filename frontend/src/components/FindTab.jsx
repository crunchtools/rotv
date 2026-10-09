import React, { useMemo, useCallback, memo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ResultsTile from './ResultsTile';
import FilterSheet, { FilterChip } from './FilterSheet';
import { getDestinationIconTypeFromConfig } from '../utils/iconUtils';
import { rankPois } from '../utils/poiRank';
import { buildParkIndex, findContainingPark } from '../utils/parkContainment';

const PAGE_SIZE = 20;

const DEFAULT_LISTS = [
  { id: 'all', label: 'All places', route: '/find', filterTypes: null, protected: true },
  { id: 'mtb', label: 'MTB Trail Status', route: '/mtb-trail-status', filterTypes: ['mtb-trailhead'], protected: false },
  { id: 'organizations', label: 'Organizations', route: '/organizations', filterTypes: ['organization'], protected: false }
];

const EMPTY_STATES = {
  mtb: { icon: '🚵', text: 'No MTB trails with status tracking configured.', hint: 'Configure status_url on trails to enable status tracking.' },
  organizations: { icon: '🏢', text: 'No organizations found.', hint: 'Create POIs with poi_roles including "organization" to add organizations.' },
  all: { icon: '🗺️', text: 'No places match.', hint: 'Try a different search, or open Filters and show more types.' }
};

const NEW_POI_KINDS = { mtb: 'MTB trailhead', organizations: 'organization', all: 'point of interest' };

/**
 * The Find tab (spec 048): a directory of every place, whatever the map is
 * showing. One search box shared with the map, a list picker (all places, MTB
 * trail status, organizations), and type filters behind a Filters menu.
 *
 * @param {object} props
 * @param {object[]} props.allDestinations Every point POI
 * @param {object[]} props.allLinearFeatures Every trail, river and boundary (POIs with a geometry)
 * @param {object[]} props.allVirtualPois Every organization
 * @param {object|null} props.selectedDestination The selected point or organization, to highlight its row
 * @param {object|null} props.selectedLinearFeature The selected trail, river or boundary
 * @param {(poi: object) => void} props.onSelectDestination Called when a point or organization row is picked
 * @param {(poi: object) => void} props.onSelectLinearFeature Called when a trail, river or boundary row is picked
 * @param {string} [props.searchText=''] The search shared with the map legend
 * @param {(text: string) => void} props.onSearchChange
 * @param {boolean} [props.initialShowMtbOnly=false] The URL asks for the MTB Trail Status list
 * @param {boolean} [props.initialShowOrganizationsOnly=false] The URL asks for the Organizations list
 * @param {(types: string[]|null) => void} [props.onFilterByTypes] Tells the map which marker types
 *   the current list is about; null means all
 * @param {object[]} [props.iconConfig] Icon types, for the type chips and row icons
 * @param {boolean} [props.editMode=false]
 * @param {boolean} [props.isAdmin=false]
 * @param {string} [props.userRole='viewer']
 * @param {(listId: string) => void} [props.onNewPOI] Shown as "+ New" to admins in edit mode
 * @returns {JSX.Element}
 */
const FindTab = memo(function FindTab({
  allDestinations,
  allLinearFeatures,
  allVirtualPois,
  selectedDestination,
  selectedLinearFeature,
  onSelectDestination,
  onSelectLinearFeature,
  searchText = '',
  onSearchChange,
  initialShowMtbOnly = false,
  initialShowOrganizationsOnly = false,
  onFilterByTypes,
  iconConfig,
  editMode = false,
  isAdmin = false,
  userRole = 'viewer',
  onNewPOI
}) {
  const navigate = useNavigate();
  const isNavigatingRef = useRef(false);

  const [activeList, setActiveList] = useState(
    initialShowMtbOnly ? 'mtb' : initialShowOrganizationsOnly ? 'organizations' : 'all'
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [listConfig, setListConfig] = useState(null);
  const [isListMenuOpen, setIsListMenuOpen] = useState(false);
  const listButtonRef = useRef(null);
  const listMenuRef = useRef(null);

  useEffect(() => {
    fetch('/api/results-subtabs')
      .then(res => res.json())
      .then(subtabResponse => {
        if (subtabResponse.subtabs && subtabResponse.subtabs.length > 0) {
          setListConfig(subtabResponse.subtabs);
        }
      })
      .catch(err => console.error('Failed to fetch list config:', err));
  }, []);

  // The stored config predates the Find tab: its first entry is still named
  // for the old Results tab and routed at the map.
  const lists = useMemo(() => (listConfig || DEFAULT_LISTS).map(list =>
    list.id === 'all' ? { ...list, label: 'All places', route: '/find' } : list
  ), [listConfig]);
  const currentList = lists.find(l => l.id === activeList) || lists[0];

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

  useEffect(() => {
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      return;
    }

    if (initialShowMtbOnly && activeList !== 'mtb') {
      setActiveList('mtb');
    } else if (initialShowOrganizationsOnly && activeList !== 'organizations') {
      setActiveList('organizations');
    } else if (!initialShowMtbOnly && !initialShowOrganizationsOnly && (activeList === 'mtb' || activeList === 'organizations')) {
      setActiveList('all');
    }
  }, [initialShowMtbOnly, initialShowOrganizationsOnly, activeList]);

  useEffect(() => {
    if (activeList === 'mtb') {
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
  }, [activeList]);

  useEffect(() => {
    if (onFilterByTypes) {
      let typesToShow = null;

      if (activeList === 'mtb') {
        typesToShow = ['mtb-trailhead'];
      } else if (activeList === 'organizations') {
        typesToShow = ['organization'];
      }

      onFilterByTypes(typesToShow);
    }
  }, [activeList, onFilterByTypes]);

  const parkIndex = useMemo(() => buildParkIndex(allLinearFeatures), [allLinearFeatures]);

  const { rankedPois, poiMap } = useMemo(() => {
    let sourceDestinations = allDestinations || [];
    let sourceLinear = allLinearFeatures || [];
    let sourceVirtual = allVirtualPois || [];

    if (activeList === 'mtb') {
      sourceDestinations = sourceDestinations.filter(d => d.status_url && d.status_url.trim() !== '');
      sourceLinear = [];
      sourceVirtual = [];
    } else if (activeList === 'organizations') {
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

    let filtered = [...dests, ...linear, ...virtual];

    const search = searchText.trim().toLowerCase();
    if (search) {
      filtered = filtered.filter(poi =>
        (poi.name || '').toLowerCase().includes(search) ||
        (poi.brief_description || '').toLowerCase().includes(search) ||
        (poi.primary_activities || '').toLowerCase().includes(search)
      );
    }

    if (activeList === 'all') {
      filtered = filtered.filter(poi => enabledFilters.has(poi._poiType));
    }

    const ranked = rankPois(filtered, search);

    const map = new Map();
    ranked.forEach(poi => {
      const type = poi._isVirtual ? 'virtual' : (poi._isLinear ? 'linear' : 'point');
      map.set(`${type}-${poi.id}`, poi);
    });

    return { rankedPois: ranked, poiMap: map };
  }, [activeList, allDestinations, allLinearFeatures, allVirtualPois, searchText, enabledFilters, iconConfig]);

  const totalPages = Math.ceil(rankedPois.length / PAGE_SIZE) || 1;
  // The list can shrink under the stored page; show the last page that exists
  const clampedPage = Math.min(currentPage, totalPages);
  const paginatedPois = rankedPois.slice(
    (clampedPage - 1) * PAGE_SIZE,
    clampedPage * PAGE_SIZE
  );

  const handleListClick = useCallback((e) => {
    const tile = e.target.closest('.results-tile');
    if (!tile) return;

    const poi = poiMap.get(tile.dataset.poiKey);
    if (!poi) return;

    if (poi._isLinear) {
      onSelectLinearFeature(poi);
    } else {
      onSelectDestination(poi);
    }
  }, [poiMap, onSelectDestination, onSelectLinearFeature]);

  const selectedId = selectedDestination?.id;
  const selectedLinearId = selectedLinearFeature?.id;

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
            iconUrl
          });
        }
      });
    }

    chips.push({ id: 'trails', label: 'Trails', iconUrl: '/icons/layers/trails.svg' });
    chips.push({ id: 'rivers', label: 'Rivers', iconUrl: '/icons/layers/rivers.svg' });
    chips.push({ id: 'boundaries', label: 'Boundaries', iconUrl: '/icons/layers/boundaries.svg' });

    return chips.sort((a, b) => a.label.localeCompare(b.label));
  }, [iconConfig]);

  const hiddenTypeCount = filterChips.filter(chip => !enabledFilters.has(chip.id)).length;

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

  const closeListMenu = () => {
    setIsListMenuOpen(false);
    listButtonRef.current?.focus();
  };

  useEffect(() => {
    if (isListMenuOpen) listMenuRef.current?.querySelector('[aria-checked="true"]')?.focus();
  }, [isListMenuOpen]);

  const handleListChange = (listId) => {
    setIsListMenuOpen(false);
    listButtonRef.current?.focus();
    if (listId === activeList) return;

    isNavigatingRef.current = true;
    setActiveList(listId);
    setCurrentPage(1);
    navigate((lists.find(l => l.id === listId) || lists[0]).route);
  };

  const handleListMenuKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeListMenu();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = Array.from(e.currentTarget.querySelectorAll('[role="menuitemradio"]'));
      const idx = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  };

  const firstShown = rankedPois.length === 0 ? 0 : ((clampedPage - 1) * PAGE_SIZE) + 1;
  const lastShown = Math.min(clampedPage * PAGE_SIZE, rankedPois.length);
  const emptyState = EMPTY_STATES[activeList] || EMPTY_STATES.all;

  return (
    <div className="results-tab-wrapper find-tab">
      <div className="news-events-header">
        <h2>Find</h2>
        <p className="tab-subtitle">Every park, trail and place in the valley</p>
      </div>

      <div className="results-filters find-controls">
        <input
          type="search"
          className="results-search-input"
          placeholder="Search places, trails, activities..."
          aria-label="Search places"
          value={searchText}
          onChange={(e) => { onSearchChange(e.target.value); setCurrentPage(1); }}
        />
        <div className="find-controls-row">
          <div className="find-list-picker">
            <button
              type="button"
              ref={listButtonRef}
              className="find-list-btn"
              aria-haspopup="menu"
              aria-expanded={isListMenuOpen}
              onClick={() => setIsListMenuOpen(prev => !prev)}
            >
              <span className="find-list-btn-label">{currentList.label}</span>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d="M7 10l5 5 5-5z" />
              </svg>
            </button>
            {isListMenuOpen && (
              <>
                <div className="tab-dropdown-backdrop" onClick={closeListMenu} />
                <div className="tab-dropdown find-list-menu" role="menu" aria-label="Lists" ref={listMenuRef} onKeyDown={handleListMenuKeyDown}>
                  {lists.map(list => (
                    <button
                      key={list.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={list.id === activeList}
                      className={`dropdown-item-inline find-list-item ${list.id === activeList ? 'active' : ''}`}
                      data-list={list.id}
                      onClick={() => handleListChange(list.id)}
                    >
                      {list.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {activeList === 'all' && (
            <FilterSheet activeCount={hiddenTypeCount}>
              <div className="results-filter-actions">
                <button type="button" onClick={showAllFilters} className="filter-action-btn">All</button>
                <button type="button" onClick={hideAllFilters} className="filter-action-btn">None</button>
              </div>
              <div className="results-type-filters">
                {filterChips.map(chip => (
                  <FilterChip key={chip.id} id={chip.id} active={enabledFilters.has(chip.id)} onToggle={() => toggleFilter(chip.id)}>
                    <img src={chip.iconUrl} alt="" className="type-filter-icon" />
                    {chip.label}
                  </FilterChip>
                ))}
              </div>
            </FilterSheet>
          )}
          {editMode && (isAdmin || userRole === 'poi_admin') && onNewPOI && (
            <button
              type="button"
              className="results-new-btn"
              onClick={() => onNewPOI(activeList)}
              title={`Create new ${NEW_POI_KINDS[activeList] || NEW_POI_KINDS.all}`}
            >
              + New
            </button>
          )}
        </div>
        <div className="results-count" aria-live="polite">
          {rankedPois.length === 0
            ? 'No places'
            : `Showing ${firstShown}-${lastShown} of ${rankedPois.length} places`}
        </div>
      </div>

      {rankedPois.length === 0 ? (
        <div className="results-tab-empty">
          <div className="results-tab-empty-icon">{emptyState.icon}</div>
          <div className="results-tab-empty-text">{emptyState.text}</div>
          <div className="results-tab-empty-hint">{emptyState.hint}</div>
        </div>
      ) : (
        <>
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
                  parkName={poi._isVirtual ? null : findContainingPark(poi, parkIndex)?.name}
                  showStatusInfo={activeList === 'mtb'}
                  statusData={mtbTrailStatuses[poi.id]}
                  iconConfig={iconConfig}
                />
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="pagination-controls">
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setCurrentPage(clampedPage - 1)}
                disabled={clampedPage === 1}
              >
                Back
              </button>
              <span className="pagination-info">
                Page {clampedPage} of {totalPages}
              </span>
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setCurrentPage(clampedPage + 1)}
                disabled={clampedPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
});

export default FindTab;
