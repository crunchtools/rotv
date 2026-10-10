import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { TripProvider } from './contexts/TripContext';
import { useAuth } from './hooks/useAuth';
import { useTrip } from './hooks/useTrip';
import TripBuilder from './components/TripBuilder';
import MyTripsModal from './components/MyTripsModal';
import MyValley from './components/MyValley';
import useSeasonalTheme from './hooks/useSeasonalTheme';
import useBoatPosition from './hooks/useBoatPosition';
import useTrainPosition from './hooks/useTrainPosition';
import Map from './components/Map';
import Sidebar from './components/Sidebar';
import NotificationBell from './components/NotificationBell';
import SyncSettings from './components/SyncSettings';
import AISettings from './components/AISettings';
import GeneralSettings from './components/GeneralSettings';
import ThemesSettings from './components/ThemesSettings';
import ActivitiesSettings from './components/ActivitiesSettings';
import { generateSlug } from './components/sidebar/helpers';
import ErasSettings from './components/ErasSettings';
import SurfacesSettings from './components/SurfacesSettings';
import IconsSettings from './components/IconsSettings';
import HappeningTab from './components/HappeningTab';
import DataCollectionSettings from './components/DataCollectionSettings';
import ModerationInbox from './components/ModerationInbox';
import JobsDashboard from './components/JobsDashboard';
import UsersSettings from './components/UsersSettings';
import UserSettings from './components/UserSettings';
import NewsletterSettings from './components/NewsletterSettings';
import FindTab from './components/FindTab';
import PrivacyPolicy from './components/PrivacyPolicy';
import SignInConfirm from './components/SignInConfirm';
import SignupPage from './components/auth/SignupPage';
import LoginPage from './components/auth/LoginPage';
import WelcomePage from './components/auth/WelcomePage';
import ResetPasswordPage from './components/auth/ResetPasswordPage';
import FeedbackForm from './components/FeedbackForm';
import AboutPage from './components/AboutPage';
import GuidedTour, { TOUR_STEPS, TRIP_TOUR_STEPS } from './components/GuidedTour';
import TourPrompt from './components/TourPrompt';
import McpSettings from './components/McpSettings';
import useIsMobile from './hooks/useIsMobile';
import { parseTabPath } from './utils/tabPaths';
import StatsSettings from './components/StatsSettings';
import { handleRovingKeyDown } from './utils/a11yUtils';
import { initAnalytics, excludeThisDevice, track, trackerVehicle } from './utils/analytics';
import { isParkPin } from './utils/poiKind';

const DEFAULT_ICON_TYPES = new Set(['visitor-center', 'waterfall', 'trail', 'mtb-trailhead', 'historic', 'bridge', 'train', 'nature', 'skiing', 'biking', 'picnic', 'camping', 'music', 'default', 'lighthouse', 'cemetery']);

// Linear roles whose geometry is a followable route; a slug matching one of
// these must select as linear (highlighted path), even when the same POI also
// carries the organization role. Boundaries are deliberately excluded — org
// boundaries render as destinations (#412).
const ROUTE_ROLES = ['trail', 'river', 'water_taxi', 'railroad'];

const DEFAULT_PARK_BOUNDS = [
  [41.13, -81.85],  // Southwest corner (expanded west to include Reagan-Huffman at -81.832)
  [41.45, -81.50]   // Northeast corner (expanded to fit all trailheads)
];

// Feature: auto-zoom legend toggles to what was just enabled (#396 follow-up).
// Walk arbitrarily-nested GeoJSON coordinate arrays ([lng, lat] order) and return
// Leaflet bounds [[swLat, swLng], [neLat, neLng]], or null if no coordinates found.
function geometryBounds(geometries) {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    } else {
      for (const c of coords) visit(c);
    }
  };
  for (const g of geometries) {
    if (g && Array.isArray(g.coordinates)) visit(g.coordinates);
  }
  if (minLat === Infinity) return null;
  return [[minLat, minLng], [maxLat, maxLng]];
}

// Combine a list of Leaflet bounds into one enclosing bounds, or null if empty.
function unionBounds(boundsList) {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const b of boundsList) {
    if (!b) continue;
    if (b[0][0] < minLat) minLat = b[0][0];
    if (b[0][1] < minLng) minLng = b[0][1];
    if (b[1][0] > maxLat) maxLat = b[1][0];
    if (b[1][1] > maxLng) maxLng = b[1][1];
  }
  if (minLat === Infinity) return null;
  return [[minLat, minLng], [maxLat, maxLng]];
}

// Icon + label for each primary tab. 'view' is the map.
const NAV_TABS = [
  { id: 'view', nav: 'map', label: 'Map', icon: 'M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z' },
  { id: 'find', nav: 'find', label: 'Find', icon: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z' },
  { id: 'happening', nav: 'happening', label: 'Happening', icon: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z' }
];

// The legend's owner / era / pets / search filters, for anything drawn as a marker.
function applyMarkerFilters(pois, activeFilters) {
  let filtered = pois;

  if (activeFilters.owner) {
    filtered = filtered.filter(d => d.property_owner === activeFilters.owner);
  }

  if (activeFilters.era) {
    filtered = filtered.filter(d => d.era_name === activeFilters.era);
  }

  if (activeFilters.pets === 'yes') {
    filtered = filtered.filter(d => d.pets?.toLowerCase() === 'yes');
  } else if (activeFilters.pets === 'no') {
    filtered = filtered.filter(d => d.pets?.toLowerCase() === 'no');
  }

  if (activeFilters.search) {
    const searchLower = activeFilters.search.toLowerCase();
    filtered = filtered.filter(d =>
      d.name?.toLowerCase().includes(searchLower) ||
      (d.primary_activities || '').toLowerCase().includes(searchLower)
    );
  }

  return filtered;
}

function AppContent() {
  const { isAuthenticated, isAdmin, role, logout, user } = useAuth();
  const { activeTheme, isNightMode, videoUrls } = useSeasonalTheme();
  const isMobile = useIsMobile();
  const [destinations, setDestinations] = useState([]);
  const [filteredDestinations, setFilteredDestinations] = useState([]);

  const [iconConfig, setIconConfig] = useState([]);

  const [visibleTypes, setVisibleTypes] = useState(new Set(DEFAULT_ICON_TYPES));

  const [visiblePoiIds, setVisiblePoiIds] = useState([]);

  const visiblePoiCount = visiblePoiIds.length;

  const [showTrails, setShowTrails] = useState(true);
  const [showRivers, setShowRivers] = useState(true);
  const [showWaterTaxis, setShowWaterTaxis] = useState(true);
  const boatPosition = useBoatPosition();
  const trainPosition = useTrainPosition();
  const [visibleBoundaries, setVisibleBoundaries] = useState(new Set()); // Set of boundary IDs

  // URL-specified legend filters (#531): parsed on load, consumed by init effects
  const urlTypesRef = useRef(null);
  const urlBoundariesRef = useRef(null);
  const urlLayersRef = useRef(null);
  const defaultTypesRef = useRef(null);
  const defaultBoundaryIdsRef = useRef(null);

  const [linearFeatures, setLinearFeatures] = useState([]);

  // One selection slot: the POI plus the "kind" it was selected as. Kind comes
  // from the selection path, not geometry — a dual-role org+boundary (City of
  // Akron) has geometry but can be selected either way (PR #348).
  const [selection, setSelection] = useState({ poi: null, kind: null });
  const selectedPoi = selection.poi;
  const selectedKind = selection.kind;
  const selectedDestination = selection.kind === 'destination' ? selection.poi : null;
  const selectedLinearFeature = selection.kind === 'linear' ? selection.poi : null;

  // Analytics (#637): whoever changes the selection says where it came from,
  // and one effect reports the view so no selection path is missed.
  const viewSourceRef = useRef(null);
  useEffect(() => { initAnalytics(); }, []);
  // Admin browsing isn't visitor traffic; this device stays excluded after logout
  useEffect(() => { if (isAdmin) excludeThisDevice(); }, [isAdmin]);
  useEffect(() => {
    const poi = selection.poi;
    const source = viewSourceRef.current || 'other';
    viewSourceRef.current = null;
    if (!poi?.id) return;
    track('poi_view', { poi_id: poi.id, name: poi.name, kind: selection.kind, source });
    const vehicle = trackerVehicle(poi);
    if (vehicle) track('tracker_route_open', { vehicle, source });
  }, [selection.poi?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const setSelectedDestination = useCallback((value) => {
    setSelection((prev) => {
      const next = typeof value === 'function'
        ? value(prev.kind === 'destination' ? prev.poi : null)
        : value;
      // Clearing the destination slot leaves a linear selection intact.
      if (next == null) return prev.kind === 'linear' ? prev : { poi: null, kind: null };
      return { poi: next, kind: 'destination' };
    });
  }, []);
  const setSelectedLinearFeature = useCallback((value) => {
    setSelection((prev) => {
      const next = typeof value === 'function'
        ? value(prev.kind === 'linear' ? prev.poi : null)
        : value;
      if (next == null) return prev.kind === 'destination' ? prev : { poi: null, kind: null };
      return { poi: next, kind: 'linear' };
    });
  }, []);
  // Generic setter (initial URL load): organizations render as destinations even
  // when they carry boundary geometry; otherwise geometry decides the kind.
  const setSelectedPoi = useCallback((value) => {
    setSelection((prev) => {
      const next = typeof value === 'function' ? value(prev.poi) : value;
      if (next == null) return { poi: null, kind: null };
      const hasLinearRole = next.poi_roles?.some(r => ['trail', 'river', 'boundary', 'water_taxi', 'railroad'].includes(r));
      const kind = (next.geometry && hasLinearRole) ? 'linear'
        : next.poi_roles?.includes('organization') ? 'destination'
        : (next.geometry ? 'linear' : 'destination');
      return { poi: next, kind };
    });
  }, []);

  const [virtualPois, setVirtualPois] = useState([]);
  const [associations, setAssociations] = useState([]);

  // Single role-based POI collection merged client-side from the three fetches
  // (destinations, linear-features, organizations) — all read the same backend
  // `pois` table. Deduped by id; first occurrence wins. Used for slug/id lookups
  // so selection resolution has one source of truth instead of three sequential
  // `.find()` chains.
  // NOTE: `Map` is the imported map component in this module, so the built-in
  // Map constructor is shadowed — dedupe with a Set of seen ids instead.
  const pois = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const list of [destinations, linearFeatures, virtualPois]) {
      for (const poi of list) {
        if (poi && poi.id != null && !seen.has(poi.id)) {
          seen.add(poi.id);
          result.push(poi);
        }
      }
    }
    return result;
  }, [destinations, linearFeatures, virtualPois]);
  const findPoiBySlug = useCallback(
    (slug) => pois.find((poi) => generateSlug(poi.name) === slug) || null,
    [pois]
  );

  const [isDrawingAssociations, setIsDrawingAssociations] = useState(false);
  const [addingAssociationsToOrgId, setAddingAssociationsToOrgId] = useState(null);

  const [activeFilters, setActiveFilters] = useState({
    owner: null,
    era: null,
    pets: null,
    search: ''
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editMode, setEditMode] = useState(false);

  const [activeTab, setActiveTab] = useState('view');

  const [boundsToFit, setBoundsToFit] = useState(null);
  // Bumped on every explicit user-driven fit so BoundsFitter re-zooms even when the
  // target bounds match the previous fit (e.g. re-enabling the same
  // boundary). (#396 follow-up)
  const [fitNonce, setFitNonce] = useState(0);

  // Request a guaranteed map fit to the given bounds (always re-zooms).
  const requestFit = useCallback((bounds) => {
    if (!bounds) return;
    setBoundsToFit(bounds);
    setFitNonce(n => n + 1);
  }, []);

  // Pre-compute each boundary's bounds once per data load so toggles don't re-walk
  // geometry on every click. (PR #401 review)
  const boundaryBoundsById = useMemo(() => {
    // globalThis.Map: the bare name `Map` resolves to our imported <Map> component
    // in this module, so `new Map()` would construct the component. (PR #401 review)
    const byId = new globalThis.Map();
    for (const f of linearFeatures) {
      if (!f.geometry) continue;
      const b = geometryBounds([f.geometry]);
      if (b) byId.set(f.id, b);
    }
    return byId;
  }, [linearFeatures]);

  // Fit the map to the union of the given boundary ids (from cached bounds); falls
  // back to the default park view when none have geometry.
  const fitToBoundaries = useCallback((ids) => {
    const bounds = ids.map(id => boundaryBoundsById.get(id)).filter(Boolean);
    requestFit(unionBounds(bounds) || DEFAULT_PARK_BOUNDS);
  }, [boundaryBoundsById, requestFit]);

  const cachedMtbBoundsRef = useRef(null);

  const [settingsTab, setSettingsTab] = useState('general');
  const [aboutTab, setAboutTab] = useState('story');
  const [happeningView, setHappeningView] = useState('news');
  // Where the selection's URL was when the map was last left with something selected
  const selectionPathRef = useRef(null);
  const [jobsExpandTarget, setJobsExpandTarget] = useState(null);

  const [moderationCount, setModerationCount] = useState(0);

  const [moderationFocusId, setModerationFocusId] = useState(null);
  const [moderationFocusTitle, setModerationFocusTitle] = useState(null);

  const [newsRefreshTrigger, setNewsRefreshTrigger] = useState(0);

  const [showLoginDropdown, setShowLoginDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showMyTrips, setShowMyTrips] = useState(false);
  const [showMyValley, setShowMyValley] = useState(false);
  const [tourVariant, setTourVariant] = useState('default');
  const {
    loadFromSlug: loadTripFromSlug,
    addStop: tripAddStop,
    clear: tripClear,
    setShowBuilder: tripSetShowBuilder,
    trip: activeTrip
  } = useTrip();

  const [kbdFocusIndex, setKbdFocusIndex] = useState(null);

  useEffect(() => {
    if (!showLoginDropdown && !showUserDropdown) return;
  }, [showLoginDropdown, showUserDropdown]);
  const [profileImageError, setProfileImageError] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);

  const [showTourPrompt, setShowTourPrompt] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();

  const isProgrammaticNavigationRef = useRef(false);
  const isLoadingFromUrlRef = useRef(false);
  const prevPathnameRef = useRef(location.pathname);

  const [initialShowMtbOnly, setInitialShowMtbOnly] = useState(false);
  const [findListSlug, setFindListSlug] = useState(null);
  const [isInMtbMode, setIsInMtbMode] = useState(false);
  const [selectedFromMtbList, setSelectedFromMtbList] = useState(false);
  const [mtbTrailsList, setMtbTrailsList] = useState([]);
  const [currentMtbIndex, setCurrentMtbIndex] = useState(-1);

  const [isInOrganizationsMode, setIsInOrganizationsMode] = useState(false);

  const [isLegendExpanded, setIsLegendExpanded] = useState(false);

  useEffect(() => {
    if (destinations && destinations.length > 0) {
      const mtbTrailheads = destinations.filter(d => d.status_url && d.status_url.trim() !== '');
      if (mtbTrailheads.length > 0) {
        const lats = mtbTrailheads.map(t => parseFloat(t.latitude)).filter(lat => !isNaN(lat));
        const lngs = mtbTrailheads.map(t => parseFloat(t.longitude)).filter(lng => !isNaN(lng));

        if (lats.length > 0 && lngs.length > 0) {
          const bounds = [
            [Math.min(...lats), Math.min(...lngs)], // southwest: [lat, lng]
            [Math.max(...lats), Math.max(...lngs)]  // northeast: [lat, lng]
          ];
          cachedMtbBoundsRef.current = bounds;
        }
      }
    }
  }, [destinations]);

  useEffect(() => {
    if (location.pathname.startsWith('/mtb-trail-status')) {
      const pathParts = location.pathname.split('/');
      const poiSlug = pathParts[2]; // /mtb-trail-status/east-rim-trail -> 'east-rim-trail'

      setInitialShowMtbOnly(true);
      setIsInMtbMode(true);

      if (cachedMtbBoundsRef.current) {
        setBoundsToFit(cachedMtbBoundsRef.current);
      }

      if (!poiSlug) {
        setActiveTab('find');
      }
    } else {
      setIsInMtbMode(false);
      setInitialShowMtbOnly(false);

      // Leaving the MTB list for the map or the full directory puts the map
      // back on the whole valley; the MTB view had zoomed it to the trailheads.
      const wasInMtbMode = prevPathnameRef.current.startsWith('/mtb-trail-status');
      if (wasInMtbMode && (location.pathname === '/' || location.pathname === '/find')) {
        setBoundsToFit(DEFAULT_PARK_BOUNDS);
      }
    }

    prevPathnameRef.current = location.pathname;
  }, [location.pathname, destinations]);

  useEffect(() => {
    if (!location.pathname.startsWith('/trip/')) return;
    const slug = location.pathname.split('/')[2];
    if (!slug) return;
    loadTripFromSlug(slug)
      .catch(err => console.warn(`[App] Could not load shared trip ${slug}:`, err))
      .finally(() => navigate('/', { replace: true }));
  }, [location.pathname, loadTripFromSlug, navigate]);

  useEffect(() => {
    if (location.pathname.startsWith('/organizations')) {
      const pathParts = location.pathname.split('/');
      const orgSlug = pathParts[2]; // /organizations/org-name -> 'org-name'

      setIsInOrganizationsMode(true);

      if (!orgSlug) {
        setActiveTab('find');
      }
    } else {
      setIsInOrganizationsMode(false);
    }
  }, [location.pathname]);

  const startTour = useCallback(() => {
    track('tour_start', { variant: 'default' });
    setShowTourPrompt(false);
    setTourStep(0);
    setTourVariant('default');
    setTourActive(true);
    localStorage.setItem('rotv-tour-seen', 'true');
    setActiveTab('view');
    setSelectedDestination(null);
    setSelectedLinearFeature(null);
    isProgrammaticNavigationRef.current = true;
    navigate('/');
  }, [navigate]);

  const startTripTour = useCallback(() => {
    track('tour_start', { variant: 'trips' });
    setShowTourPrompt(false);
    setTourStep(0);
    setTourVariant('trips');
    setTourActive(true);
    setActiveTab('view');
    setSelectedDestination(null);
    setSelectedLinearFeature(null);
    // Pre-populate a demo trip so the Trip Builder dock is mounted in the
    // DOM before steps 2-4 poll for it. Using a label without a poi_id so
    // the VC selected in step 1 still shows "+ Add to Trip" rather than
    // "✓ In Trip" (hasStop() matches by poi_id).
    tripClear();
    tripAddStop({
      poi_id: null,
      label: 'Brandywine Falls',
      latitude: 41.276,
      longitude: -81.538
    });
    tripSetShowBuilder(false);
    isProgrammaticNavigationRef.current = true;
    navigate('/');
  }, [navigate, tripClear, tripAddStop, tripSetShowBuilder]);

  useEffect(() => {
    if (tourActive) track('tour_step', { variant: tourVariant, step: tourStep });
  }, [tourActive, tourVariant, tourStep]);

  const endTour = useCallback(() => {
    track('tour_end', { variant: tourVariant, last_step: tourStep });
    setTourActive(false);
    setTourStep(0);
    setActiveTab('view');
    setSelectedDestination(null);
    setSelectedLinearFeature(null);
    if (tourVariant === 'trips') {
      tripClear();
    }
    setTourVariant('default');
    isProgrammaticNavigationRef.current = true;
    navigate('/');
  }, [navigate, tourVariant, tourStep, tripClear]);

  const handleTourStepAction = useCallback((action) => {
    switch (action) {
      case 'showFind': {
        setActiveTab('find');
        isProgrammaticNavigationRef.current = true;
        navigate('/find');
        break;
      }
      case 'showHappening': {
        setActiveTab('happening');
        setHappeningView('news');
        isProgrammaticNavigationRef.current = true;
        navigate('/happening');
        break;
      }
      case 'expandLegend': {
        setActiveTab('view');
        setSelectedDestination(null);
        setSelectedLinearFeature(null);
        isProgrammaticNavigationRef.current = true;
        navigate('/');
        setTimeout(() => {
          if (!document.querySelector('.legend.legend-expanded')) {
            const btn = document.querySelector('.map-poi-count');
            if (btn) btn.click();
          }
        }, 100);
        break;
      }
      case 'collapseLegendThenSelectVisitorCenter': {
        if (document.querySelector('.legend.legend-expanded')) {
          const btn = document.querySelector('.map-poi-count');
          if (btn) btn.click();
        }
        setActiveTab('view');
        const visitorCenter = destinations.find(d => d.name === 'Boston Mill Visitor Center');
        if (visitorCenter) {
          // Fix: open the card in full the way a /place/info link does, not by clicking its button on a timer (PR #745 review)
          // Add to Trip is on the full card, not the half-height summary.
          setInitialSidebarTab('view');
          setSelectedDestination(visitorCenter);
        }
        break;
      }
      case 'selectVisitorCenter': {
        setActiveTab('view');
        const visitorCenter = destinations.find(d => d.name === 'Boston Mill Visitor Center');
        if (visitorCenter) {
          setSelectedDestination(visitorCenter);
        }
        break;
      }
      case 'showMapView': {
        setActiveTab('view');
        setSelectedDestination(null);
        setSelectedLinearFeature(null);
        isProgrammaticNavigationRef.current = true;
        navigate('/');
        if (document.querySelector('.legend.legend-expanded')) {
          const btn = document.querySelector('.map-poi-count');
          if (btn) btn.click();
        }
        break;
      }
      case 'showNewsletter': {
        setActiveTab('settings');
        setSettingsTab('newsletter');
        isProgrammaticNavigationRef.current = true;
        navigate('/settings/newsletter');
        break;
      }
      case 'tripTourAddDemoStop': {
        // Demo a stop so the Trip Builder appears for the next steps.
        // Coords are Boston Mill Visitor Center (picked by selectVisitorCenter).
        const vc = destinations.find(d => d.name === 'Boston Mill Visitor Center');
        const lat = vc && vc.latitude != null ? Number(vc.latitude) : 41.273;
        const lng = vc && vc.longitude != null ? Number(vc.longitude) : -81.566;
        tripAddStop({
          poi_id: vc ? vc.id : null,
          label: vc ? vc.name : 'Sample Stop',
          latitude: lat,
          longitude: lng
        });
        tripSetShowBuilder(true);
        break;
      }
      case 'tripTourExpandBuilder': {
        tripSetShowBuilder(true);
        break;
      }
      case 'tripTourEndDemo': {
        // Back to the bar, so the open trip does not sit over the menu and My Valley
        tripSetShowBuilder(false);
        setSelectedDestination(null);
        if (isAuthenticated) {
          setShowUserDropdown(true);
        } else {
          setShowLoginDropdown(true);
        }
        break;
      }
      case 'tripTourOpenMyValley': {
        setShowUserDropdown(false);
        setShowLoginDropdown(false);
        setShowMyValley(true);
        break;
      }
    }
  }, [destinations, isAuthenticated, isAdmin, navigate, tripAddStop, tripSetShowBuilder]);

  // Switching tabs keeps whatever is selected (spec 048). The POI card shows
  // only on the map, so away from it the URL and title belong to the tab, and
  // coming back hands them to the selection again.
  const handleTabChange = useCallback((newTab) => {
    const previousActiveTab = activeTab;
    setActiveTab(newTab);
    if (newTab !== previousActiveTab) track('tab_view', { tab: newTab });

    const selected = selectedDestination || selectedLinearFeature;
    isProgrammaticNavigationRef.current = true;

    if (newTab === 'view') {
      if (selected) {
        navigate(selectionPathRef.current || `/${generateSlug(selected.name)}`);
        document.title = `${selected.name} | Roots of The Valley`;
      } else {
        navigate('/');
      }
      return;
    }

    if (previousActiveTab === 'view') {
      selectionPathRef.current = selected ? location.pathname : null;
    }
    document.title = 'Roots of The Valley';
    if (newTab === 'settings') {
      navigate(`/settings/${settingsTab}`);
    } else if (newTab === 'about') {
      navigate(`/about/${aboutTab}`);
    } else if (newTab === 'happening' && happeningView === 'events') {
      navigate('/happening/events');
    } else {
      navigate(`/${newTab}`);
    }
  }, [activeTab, location.pathname, navigate, selectedDestination, selectedLinearFeature, settingsTab, aboutTab, happeningView]);

  const handleHappeningViewChange = useCallback((view) => {
    setHappeningView(view);
    isProgrammaticNavigationRef.current = true;
    navigate(view === 'events' ? '/happening/events' : '/happening');
  }, [navigate]);

  const handleSettingsTabChange = useCallback((tab) => {
    setSettingsTab(tab);
    isProgrammaticNavigationRef.current = true;
    navigate(`/settings/${tab}`);
  }, [navigate]);

  const handleAboutTabChange = useCallback((tab) => {
    setAboutTab(tab);
    isProgrammaticNavigationRef.current = true;
    navigate(`/about/${tab}`);
  }, [navigate]);

  useEffect(() => {
    if (location.pathname === '/admin/jobs') {
      setActiveTab('settings');
      setSettingsTab('jobs');
      setSelectedDestination(null);
      setSelectedLinearFeature(null);
    }
  }, [location.pathname, location.search]);

  const handleFilterByTypes = useCallback((typesToShow) => {
    if (typesToShow && typesToShow.length > 0) {
      setVisibleTypes(new Set(typesToShow));
    } else {
      if (iconConfig && iconConfig.length > 0) {
        const allTypes = new Set(
          iconConfig
            .filter(icon => icon.enabled !== false)
            .map(icon => icon.name)
        );
        if (!allTypes.has('default')) allTypes.add('default');
        allTypes.add('trail');
        allTypes.add('river');
        allTypes.add('boundary');
        allTypes.add('organization');
        setVisibleTypes(allTypes);
      } else {
        setVisibleTypes(new Set(DEFAULT_ICON_TYPES));
      }
    }
  }, [iconConfig]);

  useEffect(() => {
    if (role !== 'admin' && role !== 'poi_admin') {
      setEditMode(false);
    }
  }, [role]);


  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key !== 'Escape') return;
      const main = document.getElementById('main-content');
      if (main && main.contains(document.activeElement)) {
        const activeTabBtn = document.querySelector('.tab-btn.active');
        if (activeTabBtn) activeTabBtn.focus();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const prevTabRef = useRef(activeTab);
  const arrowNavRef = useRef(false);
  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      prevTabRef.current = activeTab;
      if (arrowNavRef.current) {
        arrowNavRef.current = false;
        return;
      }
      requestAnimationFrame(() => {
        const main = document.getElementById('main-content');
        if (main) main.focus();
      });
    }
  }, [activeTab]);

  const refreshModerationCount = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/moderation/queue/count', { credentials: 'include', cache: 'no-store' });
      if (response.ok) {
        const { count } = await response.json();
        setModerationCount(count);
      }
    } catch (err) {
      console.error('[App] Failed to refresh moderation count:', err);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    refreshModerationCount();
    const interval = setInterval(refreshModerationCount, 5000);

    const handleCountChanged = () => {
      refreshModerationCount();
    };
    window.addEventListener('moderation-count-changed', handleCountChanged);

    return () => {
      clearInterval(interval);
      window.removeEventListener('moderation-count-changed', handleCountChanged);
    };
  }, [isAdmin, refreshModerationCount]);

  const [previewCoords, setPreviewCoords] = useState(null);

  const [newPOI, setNewPOI] = useState(null);

  const [newOrganization, setNewOrganization] = useState(null);

  useEffect(() => {
    if (selectedDestination && editMode && selectedDestination.latitude && selectedDestination.longitude) {
      setPreviewCoords({
        lat: parseFloat(selectedDestination.latitude),
        lng: parseFloat(selectedDestination.longitude)
      });
    } else {
      setPreviewCoords(null);
    }
    // Only depend on ID, not full object - prevent reset during coordinate editing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDestination?.id, editMode]);

  const [initialPoiSlug, setInitialPoiSlug] = useState(null);
  const [initialSidebarTab, setInitialSidebarTab] = useState(null);
  // River Levels carousel (#92): the gauge currently shown, so the map can highlight + fly to it
  const [activeGauge, setActiveGauge] = useState(null);
  const [permalinkInfo, setPermalinkInfo] = useState(null); // { type: 'news'|'event', poiSlug, titleSlug }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'settings' || tab === 'view') {
      setActiveTab(tab);
      params.delete('tab');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
      window.history.replaceState({}, '', newUrl);
    }

    // Shareable legend filters (#531)
    const typesParam = params.get('types');
    if (typesParam) {
      urlTypesRef.current = new Set(typesParam.split(',').map(t => t.trim()).filter(Boolean));
    }
    const boundariesParam = params.get('boundaries');
    if (boundariesParam) {
      urlBoundariesRef.current = new Set(
        boundariesParam.split(',').map(b => parseInt(b.trim(), 10)).filter(id => !isNaN(id))
      );
    }
    const layersParam = params.get('layers');
    if (typesParam || layersParam) {
      const layers = layersParam ? new Set(layersParam.split(',').map(l => l.trim()).filter(Boolean)) : new Set();
      urlLayersRef.current = layers;
    }

    let poiSlug = null;
    const pathParts = window.location.pathname.split('/').filter(Boolean);

    const sidebarSubTabs = ['info', 'news', 'events', 'history', 'associations', 'river_levels'];
    const tabPath = parseTabPath(pathParts);

    if (tabPath) {
      setActiveTab(tabPath.tab);
      if (tabPath.view) setHappeningView(tabPath.view);
      if (tabPath.tab === 'find') setFindListSlug(tabPath.list || null);
      if (tabPath.redirectTo) navigate(tabPath.redirectTo, { replace: true });
    } else if (pathParts.length === 3 && (pathParts[1] === 'news' || pathParts[1] === 'events')) {
      poiSlug = pathParts[0];
      setPermalinkInfo({ type: pathParts[1] === 'events' ? 'event' : 'news', poiSlug: pathParts[0], titleSlug: pathParts[2] });
    } else if (pathParts.length === 2 && sidebarSubTabs.includes(pathParts[1])) {
      poiSlug = pathParts[0];
      setInitialSidebarTab(pathParts[1] === 'info' ? 'view' : pathParts[1]);
    } else if (pathParts.length === 2 && pathParts[0] === 'about' && ['story', 'tutorial', 'feedback', 'privacy'].includes(pathParts[1])) {
      setActiveTab('about');
      setAboutTab(pathParts[1]);
    } else if (pathParts.length === 1 && pathParts[0] !== 'mtb-trail-status') {
      poiSlug = pathParts[0];
    } else {
      poiSlug = params.get('poi');
    }

    if (poiSlug) {
      setInitialPoiSlug(poiSlug);
    }
  }, []);

  useEffect(() => {
    if (initialPoiSlug && !loading && destinations.length > 0) {
      const isOnMtbPage = location.pathname.startsWith('/mtb-trail-status');

      const poi = findPoiBySlug(initialPoiSlug);
      if (poi) {
        viewSourceRef.current = 'link';
        if (poi.poi_roles?.includes('railroad')) {
          fetch('/api/train/position').then(r => r.json()).then(positions => {
            const pos = positions?.cvsr;
            if (pos) {
              const pad = 0.005;
              setBoundsToFit([[pos.latitude - pad, pos.longitude - pad],
                              [pos.latitude + pad, pos.longitude + pad]]);
              setFitNonce(n => n + 1);
            }
          }).catch(err => console.warn('[App] Could not fetch train position to center the map:', err));
        }
        setSelectedPoi(poi);
        document.title = `${poi.name} | Roots of The Valley`;
        if (isOnMtbPage) {
          setSelectedFromMtbList(true);
          setActiveTab('view');
        }
      }
      setInitialPoiSlug(null); // Clear so it doesn't re-trigger
    }
  }, [initialPoiSlug, loading, findPoiBySlug, location.pathname]);

  useEffect(() => {
    if (isProgrammaticNavigationRef.current) {
      isProgrammaticNavigationRef.current = false;
      return;
    }

    if (loading || destinations.length === 0) {
      return;
    }

    if (location.pathname === '/mtb-trail-status') {
      if (!isLoadingFromUrlRef.current && (selectedDestination || selectedLinearFeature)) {
        setSelectedDestination(null);
        setSelectedLinearFeature(null);
        setActiveTab('find');
        document.title = 'Roots of The Valley';
      }
      return; // MTB list handled, exit early
    }

    if (location.pathname === '/organizations') {
      if (!isLoadingFromUrlRef.current && (selectedDestination || selectedLinearFeature)) {
        setSelectedDestination(null);
        setSelectedLinearFeature(null);
        setActiveTab('find');
        document.title = 'Roots of The Valley';
      }
      return; // Organizations list handled, exit early
    }

    if (location.pathname === '/') {
      if (!isLoadingFromUrlRef.current && (selectedDestination || selectedLinearFeature)) {
        setSelectedDestination(null);
        setSelectedLinearFeature(null);
        document.title = 'Roots of The Valley';
      }
      return;
    }

    const pathParts = location.pathname.split('/').filter(Boolean);

    // A tab path changes the tab and nothing else: the selection waits for
    // the map to come back (spec 048).
    const tabPath = parseTabPath(pathParts);
    if (tabPath) {
      setActiveTab(tabPath.tab);
      if (tabPath.view) setHappeningView(tabPath.view);
      if (tabPath.tab === 'find') setFindListSlug(tabPath.list || null);
      if (tabPath.redirectTo) navigate(tabPath.redirectTo, { replace: true });
      document.title = 'Roots of The Valley';
      return;
    }

    const settingsSubTabs = ['general', 'newsletter', 'rss', 'mcp', 'users', 'themes', 'activities', 'eras', 'surfaces', 'icons', 'moderation', 'jobs', 'dataCollection', 'google', 'stats'];
    if (pathParts.length === 2 && pathParts[0] === 'settings' && settingsSubTabs.includes(pathParts[1])) {
      setActiveTab('settings');
      setSettingsTab(pathParts[1]);
      document.title = 'Roots of The Valley';
      return;
    }

    const aboutSubTabs = ['story', 'tutorial', 'feedback', 'privacy'];
    if (pathParts.length === 2 && pathParts[0] === 'about' && aboutSubTabs.includes(pathParts[1])) {
      setActiveTab('about');
      setAboutTab(pathParts[1]);
      document.title = 'Roots of The Valley';
      return;
    }

    const sidebarSubTabs = ['info', 'news', 'events', 'history', 'associations', 'river_levels'];
    if (pathParts.length === 2 && sidebarSubTabs.includes(pathParts[1])
        && pathParts[0] !== 'mtb-trail-status' && pathParts[0] !== 'organizations' && pathParts[0] !== 'admin') {
      const poiSlug = pathParts[0];
      const subTab = pathParts[1] === 'info' ? 'view' : pathParts[1];
      setInitialSidebarTab(subTab);

      const currentSlug = selectedDestination ? generateSlug(selectedDestination.name)
        : selectedLinearFeature ? generateSlug(selectedLinearFeature.name) : null;
      if (currentSlug !== poiSlug) {
        skipNextFlyRef.current = false;
        isLoadingFromUrlRef.current = true;
        const destination = destinations.find(d => generateSlug(d.name) === poiSlug);
        if (destination) {
          setSelectedDestination(destination);
          setSelectedLinearFeature(null);
          setActiveTab('view');
          document.title = `${destination.name} | Roots of The Valley`;
          setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
          return;
        }
        // Resolve organization (virtual) POIs for sub-tab paths too, so a favorite (or
        // permalink) to an org opens its sidebar — not just destinations & linear features (#437)
        const virtualPoi = virtualPois.find(v => generateSlug(v.name) === poiSlug);
        if (virtualPoi) {
          setSelectedDestination(virtualPoi);
          setSelectedLinearFeature(null);
          setActiveTab('view');
          document.title = `${virtualPoi.name} | Roots of The Valley`;
          setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
          return;
        }
        const lf = linearFeatures.find(f => generateSlug(f.name) === poiSlug);
        if (lf) {
          setSelectedLinearFeature(lf);
          setSelectedDestination(null);
          setActiveTab('view');
          document.title = `${lf.name} | Roots of The Valley`;
          setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
          return;
        }
        isLoadingFromUrlRef.current = false;
      } else {
        setActiveTab('view');
      }
      return;
    }

    if (pathParts.length === 2 && pathParts[0] === 'mtb-trail-status') {
      const poiSlug = pathParts[1];

      const currentSlug = selectedDestination ? generateSlug(selectedDestination.name)
        : selectedLinearFeature ? generateSlug(selectedLinearFeature.name)
        : null;

      if (currentSlug === poiSlug) {
        setActiveTab('view');
        return;
      }

      skipNextFlyRef.current = false;

      isLoadingFromUrlRef.current = true;

      const destination = destinations.find(d => generateSlug(d.name) === poiSlug);
      if (destination) {
        setSelectedDestination(destination);
        setSelectedLinearFeature(null);
        setSelectedFromMtbList(true); // Mark as selected from MTB list
        setActiveTab('view');
        document.title = `${destination.name} | Roots of The Valley`;
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
        return;
      }

      const linearFeature = linearFeatures.find(f => generateSlug(f.name) === poiSlug);
      if (linearFeature) {
        setSelectedLinearFeature(linearFeature);
        setSelectedDestination(null);
        setSelectedFromMtbList(true);
        setActiveTab('view');
        document.title = `${linearFeature.name} | Roots of The Valley`;

        if (linearFeature.poi_roles?.includes('boundary')) {
          setVisibleBoundaries(prev => {
            if (prev.has(linearFeature.id)) return prev;
            const next = new Set(prev);
            next.add(linearFeature.id);
            return next;
          });
        } else if (linearFeature.poi_roles?.includes('trail')) {
          setShowTrails(true);
        } else if (linearFeature.poi_roles?.includes('river')) {
          setShowRivers(true);
        } else if (linearFeature.poi_roles?.includes('water_taxi')) {
          setShowWaterTaxis(true);
        }
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
        return;
      }

      console.warn('[Browser Nav Effect] MTB POI not found for slug:', poiSlug);
      isLoadingFromUrlRef.current = false;
      return;
    }

    if (pathParts.length === 2 && pathParts[0] === 'organizations') {
      const orgSlug = pathParts[1];

      const currentSlug = selectedDestination ? generateSlug(selectedDestination.name) : null;

      if (currentSlug === orgSlug) {
        setActiveTab('view');
        return;
      }

      isLoadingFromUrlRef.current = true;

      const virtualPoi = virtualPois.find(v => generateSlug(v.name) === orgSlug);
      if (virtualPoi) {
        setSelectedDestination(virtualPoi);
        setSelectedLinearFeature(null);
        setActiveTab('view');
        document.title = `${virtualPoi.name} | Roots of The Valley`;
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
        return;
      }

      console.warn('[Browser Nav Effect] Organization not found for slug:', orgSlug);
      isLoadingFromUrlRef.current = false;
      return;
    }

    if (pathParts.length === 3 && (pathParts[1] === 'news' || pathParts[1] === 'events')) {
      const type = pathParts[1] === 'events' ? 'event' : 'news';
      const poiSlug = pathParts[0];
      const titleSlug = pathParts[2];

      setPermalinkInfo({ type, poiSlug, titleSlug });

      const currentSlug = selectedDestination ? generateSlug(selectedDestination.name)
        : selectedLinearFeature ? generateSlug(selectedLinearFeature.name) : null;
      if (currentSlug !== poiSlug) {
        isLoadingFromUrlRef.current = true;
        // Fix: open the permalink sidebar for organization (virtual) and linear
        // POIs too, not just destinations — notification/shared links to org
        // news & events were navigating but rendering nothing (#412)
        const destination = destinations.find(d => generateSlug(d.name) === poiSlug);
        const linearFeature = !destination
          && linearFeatures.find(f => generateSlug(f.name) === poiSlug);
        // Route-role POIs win over their org copy — see the length-1 branch (#554)
        const isRoutePoi = linearFeature && linearFeature.poi_roles?.some(r => ROUTE_ROLES.includes(r));
        const virtualPoi = !destination && !isRoutePoi
          && virtualPois.find(v => generateSlug(v.name) === poiSlug);
        const pointPoi = destination || virtualPoi;
        if (pointPoi) {
          setSelectedDestination(pointPoi);
          setSelectedLinearFeature(null);
          setActiveTab('view');
          document.title = `${pointPoi.name} | Roots of The Valley`;
        } else if (linearFeature) {
          setSelectedLinearFeature(linearFeature);
          setSelectedDestination(null);
          setActiveTab('view');
          document.title = `${linearFeature.name} | Roots of The Valley`;
        }
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
      } else {
        setActiveTab('view');
      }
      return;
    }

    if (pathParts.length === 1) {
      const poiSlug = pathParts[0];

      const currentSlug = selectedDestination ? generateSlug(selectedDestination.name)
        : selectedLinearFeature ? generateSlug(selectedLinearFeature.name)
        : null;

      if (currentSlug === poiSlug) {
        setActiveTab('view');
        return;
      }

      skipNextFlyRef.current = false;

      isLoadingFromUrlRef.current = true;

      const destination = destinations.find(d => generateSlug(d.name) === poiSlug);
      if (destination) {
        setSelectedDestination(destination);
        setSelectedLinearFeature(null);
        setActiveTab('view');
        document.title = `${destination.name} | Roots of The Valley`;
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
        return;
      }

      // Dual-role org POIs (e.g. CVSR = organization + railroad) exist in BOTH
      // virtualPois and linearFeatures; the route copy must win the slug match
      // or the permalink selects the org as a destination and the route never
      // highlights (#554). Boundary orgs stay destinations (#412).
      const linearFeature = linearFeatures.find(f => generateSlug(f.name) === poiSlug);
      const isRoutePoi = linearFeature?.poi_roles?.some(r => ROUTE_ROLES.includes(r));

      const virtualPoi = !isRoutePoi && virtualPois.find(v => generateSlug(v.name) === poiSlug);
      if (virtualPoi) {
        setSelectedDestination(virtualPoi);
        setSelectedLinearFeature(null);
        setActiveTab('view');
        document.title = `${virtualPoi.name} | Roots of The Valley`;
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
        return;
      }

      if (linearFeature) {
        setSelectedLinearFeature(linearFeature);
        setSelectedDestination(null);
        setActiveTab('view');
        document.title = `${linearFeature.name} | Roots of The Valley`;

        if (linearFeature.poi_roles?.includes('boundary')) {
          setVisibleBoundaries(prev => {
            if (prev.has(linearFeature.id)) return prev;
            const next = new Set(prev);
            next.add(linearFeature.id);
            return next;
          });
        } else if (linearFeature.poi_roles?.includes('trail')) {
          setShowTrails(true);
        } else if (linearFeature.poi_roles?.includes('river')) {
          setShowRivers(true);
        } else if (linearFeature.poi_roles?.includes('water_taxi')) {
          setShowWaterTaxis(true);
        } else if (linearFeature.poi_roles?.includes('railroad')) {
          setVisibleTypes(prev => prev.has('train') ? prev : new Set(prev).add('train'));
        }
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
        return;
      }

      console.warn('[Browser Nav Effect] POI not found for slug:', poiSlug);
      isLoadingFromUrlRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, loading, destinations, linearFeatures, virtualPois]);
  // NOTE: selectedDestination and selectedLinearFeature are intentionally NOT in dependencies
  // We only want this effect to run on URL changes (browser back/forward), not POI state changes


  const refreshAllData = React.useCallback(async () => {
    try {
      const [destResponse, linearResponse, iconResponse, virtualPoisResponse, associationsResponse] = await Promise.all([
        fetch('/api/pois?role=point'),
        fetch('/api/pois?role=trail,river,boundary,water_taxi,railroad'),
        fetch('/api/admin/icons'),
        fetch('/api/pois?role=organization'),
        fetch('/api/associations')
      ]);

      if (!destResponse.ok) {
        throw new Error('Failed to fetch data');
      }

      const destData = await destResponse.json();
      const linearData = linearResponse.ok ? await linearResponse.json() : [];
      const iconData = iconResponse.ok ? await iconResponse.json() : [];
      const virtualPoisData = virtualPoisResponse.ok ? await virtualPoisResponse.json() : [];
      const associationsData = associationsResponse.ok ? await associationsResponse.json() : [];

      setDestinations(destData);
      setFilteredDestinations(destData);
      setLinearFeatures(linearData);
      setIconConfig(iconData);
      setVirtualPois(virtualPoisData);
      setAssociations(associationsData);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  useEffect(() => {
    if (!localStorage.getItem('rotv-tour-seen')) {
      setShowTourPrompt(true);
    }
  }, []);

  useEffect(() => {
    const match = location.pathname.match(/^\/tutorial\/step(\d+)$/);
    if (match && !tourActive) {
      const stepNum = parseInt(match[1], 10) - 1;
      if (stepNum >= 0 && stepNum < TOUR_STEPS.length) {
        setTourStep(stepNum);
        setTourActive(true);
        setShowTourPrompt(false);
        localStorage.setItem('rotv-tour-seen', 'true');
      }
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  // tourActive intentionally excluded — only react to URL path changes for /tutorial/stepN deep-links

  const hasInitializedVisibleTypes = useRef(false);
  useEffect(() => {
    if (iconConfig && iconConfig.length > 0 && !hasInitializedVisibleTypes.current) {
      // default_hidden types (e.g. amenities) stay in the legend but start toggled off
      const enabledTypes = new Set(
        iconConfig
          .filter(icon => icon.enabled !== false && icon.default_hidden !== true)
          .map(icon => icon.name)
      );
      if (!enabledTypes.has('default')) {
        enabledTypes.add('default');
      }
      enabledTypes.add('trail');
      enabledTypes.add('river');
      enabledTypes.add('boundary');
      enabledTypes.add('organization');

      defaultTypesRef.current = new Set(enabledTypes);

      if (urlTypesRef.current) {
        setVisibleTypes(urlTypesRef.current);
        urlTypesRef.current = null;
      } else {
        setVisibleTypes(enabledTypes);
      }
      if (urlLayersRef.current !== null) {
        const layers = urlLayersRef.current;
        setShowTrails(layers.has('trails'));
        setShowRivers(layers.has('rivers'));
        setShowWaterTaxis(layers.has('water-taxis'));
        urlLayersRef.current = null;
      }
      hasInitializedVisibleTypes.current = true;
    }
  }, [iconConfig]);

  const hasInitializedBoundaries = useRef(false);
  useEffect(() => {
    if (linearFeatures && linearFeatures.length > 0 && !hasInitializedBoundaries.current) {
      const cvnpBoundary = linearFeatures.find(
        f => f.poi_roles?.includes('boundary') && f.name === 'Cuyahoga Valley National Park'
      );
      if (cvnpBoundary) {
        defaultBoundaryIdsRef.current = new Set([cvnpBoundary.id]);
      }

      if (urlBoundariesRef.current) {
        setVisibleBoundaries(urlBoundariesRef.current);
        urlBoundariesRef.current = null;
      } else if (cvnpBoundary) {
        setVisibleBoundaries(new Set([cvnpBoundary.id]));
      }
      hasInitializedBoundaries.current = true;
    }
  }, [linearFeatures]);

  // Sync legend filter state to URL query params (#531)
  useEffect(() => {
    if (!hasInitializedVisibleTypes.current || !hasInitializedBoundaries.current) return;

    const params = new URLSearchParams(window.location.search);
    let changed = false;

    const defaultTypes = defaultTypesRef.current;
    const typesDefault = defaultTypes && visibleTypes.size === defaultTypes.size &&
      [...visibleTypes].every(t => defaultTypes.has(t));
    const layersDefault = showTrails && showRivers && showWaterTaxis;
    const allPoiDefault = typesDefault && layersDefault;

    if (allPoiDefault) {
      if (params.has('types')) { params.delete('types'); changed = true; }
      if (params.has('layers')) { params.delete('layers'); changed = true; }
    } else {
      if (defaultTypes) {
        if (typesDefault) {
          if (params.has('types')) { params.delete('types'); changed = true; }
        } else {
          const sorted = [...visibleTypes].sort().join(',');
          if (params.get('types') !== sorted) { params.set('types', sorted); changed = true; }
        }
      }
      const activeLayers = [
        showTrails && 'trails', showRivers && 'rivers', showWaterTaxis && 'water-taxis'
      ].filter(Boolean);
      if (layersDefault) {
        if (params.has('layers')) { params.delete('layers'); changed = true; }
      } else if (activeLayers.length === 0) {
        if (params.get('layers') !== '') { params.set('layers', ''); changed = true; }
      } else {
        const val = activeLayers.sort().join(',');
        if (params.get('layers') !== val) { params.set('layers', val); changed = true; }
      }
    }

    const defaultBoundaries = defaultBoundaryIdsRef.current;
    if (defaultBoundaries) {
      const sameAsDefault = visibleBoundaries.size === defaultBoundaries.size &&
        [...visibleBoundaries].every(id => defaultBoundaries.has(id));
      if (sameAsDefault) {
        if (params.has('boundaries')) { params.delete('boundaries'); changed = true; }
      } else {
        const sorted = [...visibleBoundaries].sort((a, b) => a - b).join(',');
        if (params.get('boundaries') !== sorted) { params.set('boundaries', sorted); changed = true; }
      }
    }

    if (changed) {
      const search = params.toString();
      const newUrl = window.location.pathname + (search ? `?${search}` : '');
      window.history.replaceState({}, '', newUrl);
    }
  }, [visibleTypes, visibleBoundaries, showTrails, showRivers, showWaterTaxis]);

  useEffect(() => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      const headerTabs = document.querySelector('.header-tabs');
      if (headerTabs) {
        headerTabs.scrollLeft = headerTabs.scrollWidth;
      }
    }
  }, [isAuthenticated]); // Re-run when auth state changes

  const viewportFilteredDestinations = React.useMemo(() => {
    if (!visiblePoiIds || visiblePoiIds.length === 0) return [];

    const visibleIdSet = new Set(visiblePoiIds);
    return destinations.filter(dest => visibleIdSet.has(dest.id));
  }, [destinations, visiblePoiIds]);

  const viewportFilteredLinearFeatures = useMemo(() => {
    if (!visiblePoiIds || visiblePoiIds.length === 0) return [];

    const visibleIdSet = new Set(visiblePoiIds);
    return linearFeatures.filter(feature => visibleIdSet.has(feature.id));
  }, [linearFeatures, visiblePoiIds]);

  const viewportFilteredVirtualPois = useMemo(() => {
    if (!visiblePoiIds || visiblePoiIds.length === 0) return [];

    const showingAllTypes = visibleTypes.size >= DEFAULT_ICON_TYPES.size;
    const includingOrganizations = visibleTypes.has('organization');

    if (!showingAllTypes && !includingOrganizations) {
      return [];
    }

    const visibleIdSet = new Set(visiblePoiIds);
    return virtualPois.filter(vpoi => {
      return associations.some(assoc =>
        assoc.virtual_poi_id === vpoi.id &&
        visibleIdSet.has(assoc.physical_poi_id)
      );
    });
  }, [virtualPois, associations, visiblePoiIds, visibleTypes]);

  const [currentPoiIndex, setCurrentPoiIndex] = useState(-1);

  const skipNextFlyRef = useRef(false);

  const poiNavigationList = useMemo(() => {
    let destSource = isInMtbMode
      ? (destinations || []).filter(d => d.status_url && d.status_url.trim() !== '')
      : isInOrganizationsMode
        ? []
        : (viewportFilteredDestinations || []);

    const dests = destSource.map(d => ({
      ...d,
      _isLinear: false,
      _isVirtual: !d.geometry && !d.latitude
    }));

    const linear = (isInMtbMode || isInOrganizationsMode) ? [] : (viewportFilteredLinearFeatures || []).map(f => ({ ...f, _isLinear: true }));
    const virtual = isInMtbMode
      ? []
      : isInOrganizationsMode
        ? (virtualPois || []).map(v => ({ ...v, _isLinear: false, _isVirtual: !v.geometry && !v.latitude }))
        : (viewportFilteredVirtualPois || []).map(v => ({ ...v, _isLinear: false, _isVirtual: !v.geometry && !v.latitude }));

    return [...dests, ...linear, ...virtual].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [destinations, virtualPois, viewportFilteredDestinations, viewportFilteredLinearFeatures, viewportFilteredVirtualPois, isInMtbMode, isInOrganizationsMode]);

  useEffect(() => {
    if (selectedDestination && poiNavigationList.length > 0) {
      const index = poiNavigationList.findIndex(p => !p._isLinear && String(p.id) === String(selectedDestination.id));
      setCurrentPoiIndex(index);
    } else if (!selectedDestination && !selectedLinearFeature) {
      setCurrentPoiIndex(-1);
    }
  }, [selectedDestination, selectedLinearFeature, poiNavigationList]);

  useEffect(() => {
    if (selectedLinearFeature && poiNavigationList.length > 0) {
      const index = poiNavigationList.findIndex(p => p._isLinear && String(p.id) === String(selectedLinearFeature.id));
      setCurrentPoiIndex(index);
    } else if (!selectedDestination && !selectedLinearFeature) {
      setCurrentPoiIndex(-1);
    }
  }, [selectedLinearFeature, selectedDestination, poiNavigationList]);

  useEffect(() => {
    setFilteredDestinations(applyMarkerFilters(destinations, activeFilters));
  }, [activeFilters, destinations]);

  // Parks are boundary POIs, but each still gets a map pin (spec 048), under
  // the same filters as every other marker.
  const parkPins = useMemo(
    () => applyMarkerFilters(linearFeatures.filter(isParkPin), activeFilters),
    [linearFeatures, activeFilters]
  );

  // Search filters as you type, so report a search once typing settles (#637).
  // A data refresh re-runs the filter; don't report the same search twice.
  // The full query text is recorded by product decision (Scott, #637): it is
  // the best signal for places we're missing. It's disclosed in the privacy
  // policy, admin-only, and search here is place names, not personal data.
  const lastSearchRef = useRef(null);
  useEffect(() => {
    const query = activeFilters.search?.trim();
    if (!query) { lastSearchRef.current = null; return undefined; }
    if (query === lastSearchRef.current) return undefined;
    const timer = setTimeout(() => {
      lastSearchRef.current = query;
      const q = query.toLowerCase();
      const resultCount = filteredDestinations.length
        + linearFeatures.filter(f => f.name?.toLowerCase().includes(q)).length;
      track('search', { query, result_count: resultCount });
      if (resultCount === 0) track('search_no_results', { query });
    }, 1500);
    return () => clearTimeout(timer);
  }, [activeFilters.search, filteredDestinations, linearFeatures]);

  // One search box for the map legend and the Find tab.
  const handleSearchChange = useCallback((value) => {
    setActiveFilters(prev => ({ ...prev, search: value }));
  }, []);

  const handleFilterChange = (filterType, value) => {
    setActiveFilters(prev => ({
      ...prev,
      [filterType]: value === prev[filterType] ? null : value
    }));
  };

  const handleDestinationUpdate = (updatedDest) => {
    setDestinations(prev =>
      prev.map(d => d.id === updatedDest.id ? updatedDest : d)
    );
    if (selectedDestination?.id === updatedDest.id) {
      setSelectedDestination(updatedDest);
    }
  };

  const handleDestinationCreate = (newDest) => {
    setDestinations(prev => [...prev, newDest]);
    setSelectedDestination(newDest);
  };

  const handleDestinationDelete = (deletedId) => {
    setDestinations(prev => prev.filter(d => d.id !== deletedId));
    setVirtualPois(prev => prev.filter(v => v.id !== deletedId));
    if (selectedDestination?.id === deletedId) {
      setSelectedDestination(null);
    }
  };

  const updateUrlWithPoi = useCallback((poiName) => {
    if (poiName) {
      const slug = generateSlug(poiName);
      isProgrammaticNavigationRef.current = true;
      navigate(`/${slug}`);
    } else {
      isProgrammaticNavigationRef.current = true;
      navigate('/');
    }
  }, [navigate]);

  const handleSelectLinearFeature = useCallback((feature) => {
    setSelectedDestination(null);
    setNewPOI(null);
    setPreviewCoords(null);
    setSelectedLinearFeature(feature);
    setSelectedFromMtbList(false); // Not from MTB list (map click or other)
    updateUrlWithPoi(feature?.name);
    document.title = feature ? `${feature.name} | Roots of The Valley` : 'Roots of The Valley';
    if (feature) {
      const index = poiNavigationList.findIndex(p => p._isLinear && String(p.id) === String(feature.id));
      // -1 when it is outside the map view: the card then shows no position counter
      setCurrentPoiIndex(index);
      setActiveTab('view');
      if (feature.poi_roles?.includes('boundary')) {
        setVisibleBoundaries(prev => {
          if (prev.has(feature.id)) return prev;
          const next = new Set(prev);
          next.add(feature.id);
          return next;
        });
      } else if (feature.poi_roles?.includes('trail')) {
        setShowTrails(true);
      } else if (feature.poi_roles?.includes('river')) {
        setShowRivers(true);
      }
    } else {
      setCurrentPoiIndex(-1);
    }
  }, [updateUrlWithPoi, poiNavigationList]);

  const handleSelectDestination = useCallback((destination) => {
    setSelectedLinearFeature(null);
    setSelectedDestination(destination);
    setSelectedFromMtbList(false); // Not from MTB list (map click or other)
    updateUrlWithPoi(destination?.name);
    document.title = destination ? `${destination.name} | Roots of The Valley` : 'Roots of The Valley';
    if (destination) {
      const index = poiNavigationList.findIndex(p => !p._isLinear && String(p.id) === String(destination.id));
      setCurrentPoiIndex(index);
      setActiveTab('view');
    } else {
      setCurrentPoiIndex(-1);
    }
  }, [updateUrlWithPoi, poiNavigationList]);

  // Unified map selection entry point. Dispatches by geometry to the existing
  // destination/linear handlers (which carry distinct side effects), and fully
  // clears the single selection slot on null.
  const handleSelectPoi = useCallback((poi) => {
    // Clear any pending deep-link subtab intent so it doesn't stick to a newly picked POI
    setInitialSidebarTab(null);
    if (poi && poi.geometry) {
      handleSelectLinearFeature(poi);
    } else if (poi) {
      handleSelectDestination(poi);
    } else {
      handleSelectDestination(null);
      handleSelectLinearFeature(null);
    }
  }, [handleSelectDestination, handleSelectLinearFeature]);

  const handleMapSelectPoi = useCallback((poi) => {
    viewSourceRef.current = 'map';
    handleSelectPoi(poi);
  }, [handleSelectPoi]);
  const handleSidebarSelectPoi = useCallback((poi) => {
    viewSourceRef.current = 'sidebar';
    handleSelectPoi(poi);
  }, [handleSelectPoi]);

  // A place named on a news or event card: open it on the map.
  const handleContentSelectPoi = useCallback((poiId, source) => {
    const poi = destinations.find(d => d.id === poiId);
    if (!poi) return;
    viewSourceRef.current = source;
    skipNextFlyRef.current = false;
    handleSelectPoi(poi);
  }, [destinations, handleSelectPoi]);

  const handleModerateItem = useCallback((itemId, itemTitle) => {
    setModerationFocusId(itemId);
    setModerationFocusTitle(itemTitle || null);
    setActiveTab('settings');
    handleSettingsTabChange('moderation');
  }, [handleSettingsTabChange]);

  const handleNavigatePoi = useCallback((direction) => {
    if (poiNavigationList.length === 0) return;
    viewSourceRef.current = 'nav';

    let newIndex;

    if (typeof direction === 'number') {
      newIndex = direction;
    } else if (currentPoiIndex === -1) {
      newIndex = direction === 'next' ? 0 : poiNavigationList.length - 1;
    } else {
      newIndex = currentPoiIndex + (direction === 'next' ? 1 : -1);
      if (newIndex < 0) newIndex = poiNavigationList.length - 1;
      if (newIndex >= poiNavigationList.length) newIndex = 0;
    }

    const poi = poiNavigationList[newIndex];
    if (poi) {
      if (poi._isLinear) {
        setSelectedDestination(null);
        setNewPOI(null);
        setPreviewCoords(null);
        setSelectedLinearFeature(poi);
        updateUrlWithPoi(poi.name);
        document.title = `${poi.name} | Roots of The Valley`;
      } else {
        setSelectedLinearFeature(null);
        setSelectedDestination(poi);
        if (isInOrganizationsMode) {
          const slug = generateSlug(poi.name);
          isProgrammaticNavigationRef.current = true;
          navigate(`/organizations/${slug}`);
        } else if (isInMtbMode) {
          const slug = generateSlug(poi.name);
          isProgrammaticNavigationRef.current = true;
          navigate(`/mtb-trail-status/${slug}`);
        } else {
          updateUrlWithPoi(poi.name);
        }
        document.title = `${poi.name} | Roots of The Valley`;
      }
      setCurrentPoiIndex(newIndex);
    }
  }, [poiNavigationList, currentPoiIndex, updateUrlWithPoi, isInMtbMode, isInOrganizationsMode, navigate]);

  const handleFindSelectDestination = useCallback((poi, mtbContext) => {
    viewSourceRef.current = 'find';
    if (isInMtbMode && poi) {
      const slug = generateSlug(poi.name);

      if (mtbContext) {
        setMtbTrailsList(mtbContext.trailsList);
        setCurrentMtbIndex(mtbContext.currentIndex);
        setSelectedFromMtbList(true);
      }

      isProgrammaticNavigationRef.current = true;

      skipNextFlyRef.current = false;

      setActiveTab('view');
      setSelectedFromMtbList(true);
      document.title = `${poi.name} | Roots of The Valley`;

      setVisibleTypes(new Set(['mtb-trailhead']));
      setShowTrails(false);
      setShowRivers(false);

      requestAnimationFrame(() => {
        setTimeout(() => {
          setSelectedDestination(poi);
          setSelectedLinearFeature(null);
          setNewPOI(null);
          setPreviewCoords(null);

          const index = poiNavigationList.findIndex(p => !p._isLinear && String(p.id) === String(poi.id));
          setCurrentPoiIndex(index);

          setTimeout(() => {
            navigate(`/mtb-trail-status/${slug}`);
          }, 100);
        }, 100); // Delay to let map visibility handler complete
      });
    } else if (isInOrganizationsMode && poi) {
      const slug = generateSlug(poi.name);

      isProgrammaticNavigationRef.current = true;

      skipNextFlyRef.current = true;

      setSelectedDestination(poi);
      setSelectedLinearFeature(null);
      setNewPOI(null);
      setPreviewCoords(null);
      setActiveTab('view');
      document.title = `${poi.name} | Roots of The Valley`;

      if (iconConfig && iconConfig.length > 0) {
        const allTypes = new Set(
          iconConfig
            .filter(icon => icon.enabled !== false)
            .map(icon => icon.name)
        );
        allTypes.add('trail');
        allTypes.add('river');
        allTypes.add('boundary');
        allTypes.add('organization');
        setVisibleTypes(allTypes);
      }
      setShowTrails(true);
      setShowRivers(true);

      const index = poiNavigationList.findIndex(p => !p._isLinear && String(p.id) === String(poi.id));
      setCurrentPoiIndex(index);

      navigate(`/organizations/${slug}`);
    } else {
      // The map frames whatever was picked from the list (#712).
      skipNextFlyRef.current = false;
      handleSelectDestination(poi);
      setSelectedFromMtbList(false);
      setActiveTab('view');
    }
  }, [handleSelectDestination, isInMtbMode, isInOrganizationsMode, navigate, poiNavigationList, iconConfig]);

  const handleFindSelectLinearFeature = useCallback((poi, mtbContext) => {
    viewSourceRef.current = 'find';
    if (isInMtbMode && poi) {
      const slug = generateSlug(poi.name);

      if (mtbContext) {
        setMtbTrailsList(mtbContext.trailsList);
        setCurrentMtbIndex(mtbContext.currentIndex);
        setSelectedFromMtbList(true);
      }

      isProgrammaticNavigationRef.current = true;

      if (!linearFeatures.find(f => String(f.id) === String(poi.id))) {
        setLinearFeatures(prev => [...prev, poi]);
      }

      skipNextFlyRef.current = false;

      setActiveTab('view');
      if (!mtbContext) {
        setSelectedFromMtbList(true);
      }
      document.title = `${poi.name} | Roots of The Valley`;

      setVisibleTypes(new Set(['mtb-trailhead']));
      setShowTrails(false);
      setShowRivers(false);

      setTimeout(() => {
        setSelectedLinearFeature(poi);
        setSelectedDestination(null);
        setNewPOI(null);
        setPreviewCoords(null);

        setCurrentPoiIndex(-1);

        setTimeout(() => {
          navigate(`/mtb-trail-status/${slug}`);
        }, 100);
      }, 50); // Small delay to let tab switch complete
    } else {
      skipNextFlyRef.current = false;
      handleSelectLinearFeature(poi);
      setSelectedFromMtbList(false);
      setActiveTab('view');
    }
  }, [handleSelectLinearFeature, isInMtbMode, navigate, linearFeatures]);

  const handleLinearFeatureUpdate = (updatedFeature) => {
    setLinearFeatures(prev =>
      prev.map(f => f.id === updatedFeature.id ? { ...f, ...updatedFeature } : f)
    );
    if (selectedLinearFeature?.id === updatedFeature.id) {
      setSelectedLinearFeature(prev => ({ ...prev, ...updatedFeature }));
    }
  };

  const handleLinearFeatureDelete = (deletedId) => {
    setLinearFeatures(prev => prev.filter(f => f.id !== deletedId));
    if (selectedLinearFeature?.id === deletedId) {
      setSelectedLinearFeature(null);
    }
  };

  // Unified POI update/delete for the Sidebar (spec 019). Update dispatches by
  // geometry; delete only carries an id, so both array filters run (the id lives
  // in exactly one collection, and the selection-clear shims are no-ops otherwise).
  const handlePoiUpdate = (updated) => {
    if (updated && updated.geometry) {
      handleLinearFeatureUpdate(updated);
    } else {
      handleDestinationUpdate(updated);
    }
  };

  const handlePoiDelete = (deletedId) => {
    handleDestinationDelete(deletedId);
    handleLinearFeatureDelete(deletedId);
  };

  const handleStartNewPOI = (coords) => {
    setSelectedDestination(null);
    setNewPOI({
      id: 'new-temp',
      name: '',
      poi_roles: ['point'],
      latitude: coords.lat,
      longitude: coords.lng,
      property_owner: '',
      brief_description: '',
      historical_description: '',
      primary_activities: '',
      surface: '',
      pets: '',
      cell_signal: null,
      more_info_link: '',
      events_url: '',
      news_url: ''
    });
    setPreviewCoords(coords);
  };

  const handleCancelNewPOI = () => {
    setNewPOI(null);
    setPreviewCoords(null);
  };

  const handleNewPOIFromFind = (subTab) => {
    setSelectedDestination(null);
    setSelectedLinearFeature(null);

    if (subTab === 'organizations') {
      setNewPOI({
        id: 'new-temp',
        name: '',
        poi_roles: ['organization'],
        brief_description: '',
        property_owner: '',
        more_info_link: '',
        events_url: '',
        news_url: ''
      });
      setActiveTab('view');
    } else {
      const defaults = {
        id: 'new-temp',
        name: '',
        poi_roles: subTab === 'mtb' ? ['mtb_trail'] : ['point'],
        brief_description: '',
        historical_description: '',
        primary_activities: '',
        surface: '',
        pets: '',
        cell_signal: null,
        more_info_link: '',
        events_url: '',
        news_url: '',
        status_url: subTab === 'mtb' ? '' : undefined
      };
      setNewPOI(defaults);
      setActiveTab('view');
    }
  };

  const handleStartNewOrganization = (poisInBounds) => {
    setSelectedDestination(null);
    setSelectedLinearFeature(null);
    setNewPOI(null);
    setPreviewCoords(null);

    setNewOrganization({
      id: 'new-org-temp',
      name: '',
      brief_description: '',
      property_owner: '',
      more_info_link: '',
      events_url: '',
      news_url: '',
      poi_roles: ['organization'],
      _poisInBounds: poisInBounds,
      _selectedPoiIds: new Set(poisInBounds.map(p => p.id))
    });
  };

  const handleCancelNewOrganization = () => {
    setNewOrganization(null);
  };

  const handleSaveNewPOI = async (poiData) => {
    const endpoint = poiData.poi_roles ? '/api/admin/pois' : '/api/admin/destinations';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(poiData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create POI');
    }

    const newDest = await response.json();
    setDestinations(prev => [...prev, newDest]);
    setNewPOI(null);
    setSelectedDestination(newDest);
    setPreviewCoords(null);
    return newDest;
  };

  const handleSaveNewOrganization = async (organizationData, selectedPoiIds) => {
    const virtualPoiResponse = await fetch('/api/admin/pois', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: organizationData.name,
        brief_description: organizationData.brief_description,
        property_owner: organizationData.property_owner,
        more_info_link: organizationData.more_info_link,
        poi_roles: ['organization']
      })
    });

    if (!virtualPoiResponse.ok) {
      const error = await virtualPoiResponse.json();
      throw new Error(error.error || 'Failed to create organization');
    }

    const virtualPoi = await virtualPoiResponse.json();

    if (selectedPoiIds && selectedPoiIds.length > 0) {
      const associationsResponse = await fetch('/api/admin/poi-associations/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          virtual_poi_id: virtualPoi.id,
          physical_poi_ids: selectedPoiIds,
          association_type: 'manages'
        })
      });

      if (!associationsResponse.ok) {
        throw new Error('Failed to create associations');
      }
    }

    await refreshAllData();

    setNewOrganization(null);
    setSelectedDestination(virtualPoi);
    return virtualPoi;
  };

  const handleStartDrawingAssociations = (orgId) => {
    setAddingAssociationsToOrgId(orgId);
    setIsDrawingAssociations(true);
  };

  const handleAddAssociationsFromDrawing = async (orgId, poisInBounds) => {
    try {
      if (poisInBounds && poisInBounds.length > 0) {
        await fetch('/api/admin/poi-associations/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            virtual_poi_id: orgId,
            physical_poi_ids: poisInBounds.map(p => p.id),
            association_type: 'manages'
          })
        });
      }

      await refreshAllData();
      setIsDrawingAssociations(false);
      setAddingAssociationsToOrgId(null);
    } catch (err) {
      console.error('Error adding associations:', err);
      alert('Error adding associations: ' + err.message);
      setIsDrawingAssociations(false);
      setAddingAssociationsToOrgId(null);
    }
  };

  // Accounts made outside the sign-up form (a first Google sign-in) finish
  // sign-up on /welcome before using the map (spec 046).
  const finishSignupFirst = Boolean(user?.needsSignupCompletion) &&
    !['/welcome', '/terms', '/privacy', '/signin', '/reset-password', '/data-deletion'].includes(location.pathname);
  useEffect(() => {
    if (finishSignupFirst) navigate('/welcome', { replace: true });
  }, [finishSignupFirst, navigate]);

  // Standalone pages don't use the map data, so they render without waiting for it.
  if (location.pathname === '/privacy') {
    return <PrivacyPolicy />;
  }

  if (location.pathname === '/data-deletion') {
    return <PrivacyPolicy contentKey="about_data_deletion_md" />;
  }

  if (location.pathname === '/terms') {
    return <PrivacyPolicy contentKey="about_terms_md" />;
  }

  if (location.pathname === '/signin') {
    return <SignInConfirm />;
  }

  if (location.pathname === '/signup') {
    return <SignupPage />;
  }

  if (location.pathname === '/login') {
    return <LoginPage />;
  }

  if (location.pathname === '/reset-password') {
    return <ResetPasswordPage />;
  }

  if (location.pathname === '/welcome') {
    return <WelcomePage />;
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading Roots of The Valley...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-error">
        <h2>Error loading data</h2>
        <p>{error}</p>
        <p>Make sure the backend server is running.</p>
      </div>
    );
  }




  // The three primary tabs: in the header on a wide screen, in a bar along
  // the bottom on a phone, where a thumb can reach them (spec 048).
  const primaryNavButtons = NAV_TABS.map((tab, i) => (
    <button
      key={tab.id}
      className={`tab-btn tab-icon-btn ${activeTab === tab.id ? 'active' : ''} ${kbdFocusIndex === i ? 'kbd-focus' : ''}`}
      data-nav={tab.nav}
      onClick={() => handleTabChange(tab.id)}
      aria-current={activeTab === tab.id ? 'page' : undefined}
      tabIndex={activeTab === tab.id || (i === 0 && !NAV_TABS.some(t => t.id === activeTab)) ? 0 : -1}
    >
      <svg className="nav-tab-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path fill="currentColor" d={tab.icon} />
      </svg>
      <span className="nav-tab-label">{tab.label}</span>
    </button>
  ));

  return (
    <div className={`app${activeTrip.stops.length > 0 ? ' has-trip' : ''}`}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className={`header ${activeTheme ? `theme-${activeTheme}` : ''} ${isNightMode ? 'theme-night' : ''}`}>
        {activeTheme && videoUrls[activeTheme] && (
          <video
            key={activeTheme}
            className="theme-video"
            autoPlay
            loop
            muted
            playsInline
            aria-hidden="true"
            src={videoUrls[activeTheme]}
            onLoadedData={(e) => { e.target.playbackRate = 0.7; }}
          />
        )}
        <div className="header-content-wrapper">
          <div className="header-left" onClick={() => handleTabChange('view')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTabChange('view'); }}} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
            <h1>Roots of The Valley</h1>
            <span className="subtitle">Explore Cuyahoga Valley&apos;s History</span>
          </div>
          <nav className={`header-tabs ${kbdFocusIndex !== null ? 'kbd-nav' : ''}`} aria-label={isMobile ? 'Account' : 'Main navigation'}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setKbdFocusIndex(null);
              }
            }}
            onKeyDown={(e) => {
              const tabs = Array.from(e.currentTarget.querySelectorAll('.tab-btn'));
              const currentIndex = tabs.indexOf(e.target);
              if (currentIndex === -1) return;

              const isMenuButton = e.target.classList.contains('tab-account');

              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                let nextIndex;
                if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
                else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                else if (e.key === 'Home') nextIndex = 0;
                else if (e.key === 'End') nextIndex = tabs.length - 1;
                arrowNavRef.current = true;
                setKbdFocusIndex(nextIndex);
                tabs[nextIndex].focus();
              } else if ((e.key === 'Enter' || e.key === ' ') && isMenuButton) {
                e.preventDefault();
                e.target.click();
              } else if (e.key === 'ArrowDown' && isMenuButton) {
                e.preventDefault();
                if (!showLoginDropdown && !showUserDropdown) {
                  e.target.click(); // open it
                }
                setKbdFocusIndex(null);
                setTimeout(() => {
                  const dropdown = e.target.closest('.tab-account-container')?.querySelector('.tab-dropdown');
                  const firstItem = dropdown?.querySelector('a, button');
                  if (firstItem) firstItem.focus();
                }, 50);
              } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setKbdFocusIndex(null);
                e.target.click();
              }
            }}
          >
          {!isMobile && primaryNavButtons}

          {(() => {
            const menuIdx = isMobile ? 0 : NAV_TABS.length;
            return (
            <>
            <NotificationBell />
            {isAuthenticated ? (
            <div className="tab-account-container">
              <button
                className={`tab-btn tab-account ${kbdFocusIndex === menuIdx ? 'kbd-focus' : ''}`}
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                tabIndex={isMobile ? 0 : -1}
                aria-expanded={showUserDropdown}
                aria-haspopup="true"
              >
                {user?.pictureUrl && !profileImageError ? (
                  <img
                    src={user.pictureUrl}
                    alt={user.name}
                    className="tab-user-avatar"
                    referrerPolicy="no-referrer"
                    onError={() => setProfileImageError(true)}
                  />
                ) : (
                  <div className="tab-user-avatar-placeholder">
                    {user?.name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
              </button>
              {showUserDropdown && (
                <>
                  <div className="tab-dropdown-backdrop" onClick={() => setShowUserDropdown(false)} />
                  <div className="tab-dropdown user-dropdown-inline" role="menu" onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowUserDropdown(false); setKbdFocusIndex(menuIdx); document.querySelector('.tab-btn.tab-account')?.focus(); }
                    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const items = Array.from(e.currentTarget.querySelectorAll('a, button'));
                      const idx = items.indexOf(document.activeElement);
                      const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
                      items[next]?.focus();
                    }
                  }}>
                    <div className="user-info-inline">
                      <span className="user-name-inline">{user?.name}</span>
                      <span className="user-email-inline">{user?.email}</span>
                      {isAdmin && <span className="admin-badge-inline">Admin</span>}
                    </div>
                    <button
                      className="dropdown-item-inline my-valley-menu-item"
                      onClick={() => { setShowUserDropdown(false); setShowMyValley(true); }}
                    >
                      My Valley
                    </button>
                    <button
                      className="dropdown-item-inline settings-item-inline"
                      onClick={() => { setShowUserDropdown(false); handleTabChange('settings'); }}
                    >
                      Settings
                    </button>
                    <button
                      className="dropdown-item-inline about-menu-item"
                      onClick={() => { setShowUserDropdown(false); handleTabChange('about'); }}
                    >
                      About
                    </button>
                    <button
                      className="dropdown-item-inline"
                      onClick={() => {
                        setShowUserDropdown(false);
                        logout();
                      }}
                    >
                      Sign Out
                    </button>
                    {(role === 'admin' || role === 'poi_admin') && (
                      <label className="edit-mode-toggle" onClick={(e) => e.stopPropagation()}>
                        Edit Mode
                        <input
                          type="checkbox"
                          checked={editMode}
                          onChange={(e) => {
                            setEditMode(e.target.checked);
                          }}
                        />
                      </label>
                    )}
                  </div>
                </>
              )}
            </div>
            ) : (
            <div className="tab-account-container">
              <button
                className={`tab-btn tab-account tab-login-dot ${kbdFocusIndex === menuIdx ? 'kbd-focus' : ''}`}
                onClick={() => setShowLoginDropdown(!showLoginDropdown)}
                tabIndex={isMobile ? 0 : -1}
                aria-expanded={showLoginDropdown}
                aria-haspopup="true"
                aria-label="Sign in"
                title="Sign in"
              >
                <div className="tab-user-avatar-placeholder login-dot-placeholder">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                </div>
              </button>
              {showLoginDropdown && (
                <>
                  <div className="tab-dropdown-backdrop" onClick={() => setShowLoginDropdown(false)} />
                  <div className="tab-dropdown login-dropdown-inline" role="menu" onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowLoginDropdown(false); setKbdFocusIndex(menuIdx); e.currentTarget.closest('.tab-account-container')?.querySelector('.tab-btn')?.focus(); }
                    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const items = Array.from(e.currentTarget.querySelectorAll('a, button'));
                      const idx = items.indexOf(document.activeElement);
                      const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
                      items[next]?.focus();
                    }
                  }}>
                    <button
                      className="dropdown-item-inline my-valley-menu-item"
                      onClick={() => { setShowLoginDropdown(false); setShowMyValley(true); }}
                    >
                      My Valley
                    </button>
                    <button
                      className="dropdown-item-inline settings-item-inline"
                      onClick={() => { setShowLoginDropdown(false); handleTabChange('settings'); }}
                    >
                      Settings
                    </button>
                    <button
                      className="dropdown-item-inline about-menu-item"
                      onClick={() => { setShowLoginDropdown(false); handleTabChange('about'); }}
                    >
                      About
                    </button>
                    <div className="tab-dropdown-divider" />
                    <button
                      className="oauth-btn-inline signup-btn"
                      onClick={() => { setShowLoginDropdown(false); navigate('/signup'); }}
                    >
                      Sign up
                    </button>
                    <button
                      className="oauth-btn-inline signin-btn"
                      onClick={() => { setShowLoginDropdown(false); navigate('/login'); }}
                    >
                      Sign in
                    </button>
                  </div>
                </>
              )}
            </div>
            )}
            </>
          );
          })()}
          </nav>
        </div>
      </header>

      {isMobile && (
        <nav className="bottom-nav" aria-label="Main navigation" onKeyDown={(e) => handleRovingKeyDown(e, '.tab-btn')}>
          {primaryNavButtons}
        </nav>
      )}

      {activeTab === 'find' && (
        <main id="main-content" className="main-content-full" tabIndex="-1" role="tabpanel">
          <FindTab
            allDestinations={destinations}
            allLinearFeatures={linearFeatures}
            allVirtualPois={virtualPois}
            selectedDestination={selectedDestination}
            selectedLinearFeature={selectedLinearFeature}
            onSelectDestination={handleFindSelectDestination}
            onSelectLinearFeature={handleFindSelectLinearFeature}
            searchText={activeFilters.search || ''}
            onSearchChange={handleSearchChange}
            initialShowMtbOnly={initialShowMtbOnly}
            initialShowOrganizationsOnly={isInOrganizationsMode}
            listSlug={findListSlug}
            onFilterByTypes={handleFilterByTypes}
            iconConfig={iconConfig}
            editMode={editMode}
            isAdmin={isAdmin}
            userRole={role}
            onNewPOI={handleNewPOIFromFind}
          />
        </main>
      )}

      {activeTab === 'happening' && (
        <main id="main-content" className="main-content-full" tabIndex="-1" style={{ display: 'flex', flexDirection: 'column' }}>
          <HappeningTab
            view={happeningView}
            onViewChange={handleHappeningViewChange}
            newsProps={{
              isAdmin,
              editMode,
              refreshTrigger: newsRefreshTrigger,
              onSelectPoi: (poiId) => handleContentSelectPoi(poiId, 'news'),
              onEditNewsItem: handleModerateItem
            }}
            eventsProps={{
              isAdmin,
              editMode,
              refreshTrigger: newsRefreshTrigger,
              onSelectPoi: (poiId) => handleContentSelectPoi(poiId, 'events'),
              onEditEventItem: handleModerateItem
            }}
          />
        </main>
      )}

      {activeTab === 'about' && (
        <main id="main-content" className="main-content-full" tabIndex="-1">
          <AboutPage onStartTour={startTour} onStartTripTour={startTripTour} aboutTab={aboutTab} onTabChange={handleAboutTabChange} isAdmin={isAdmin} editMode={editMode} />
        </main>
      )}

      {activeTab === 'settings' && (
        <main id="main-content" className="settings-content" tabIndex="-1" role="tabpanel">
          <div className="settings-panel">
            {isAdmin ? (
            <>
            <div className="settings-tabs-wrapper" onKeyDown={(e) => handleRovingKeyDown(e, '.settings-tab-btn')}>
            <nav className="settings-tabs">
              <button
                className={`settings-tab-btn ${settingsTab === 'general' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('general')}
                tabIndex={settingsTab === 'general' ? 0 : -1}
              >
                General
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'newsletter' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('newsletter')}
                tabIndex={settingsTab === 'newsletter' ? 0 : -1}
              >
                Newsletter
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'rss' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('rss')}
                tabIndex={settingsTab === 'rss' ? 0 : -1}
              >
                RSS Feed
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'mcp' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('mcp')}
                tabIndex={settingsTab === 'mcp' ? 0 : -1}
              >
                MCP
              </button>
            </nav>
            <nav className="settings-tabs settings-tabs-row2">
              <button
                className={`settings-tab-btn ${settingsTab === 'users' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('users')}
                tabIndex={settingsTab === 'users' ? 0 : -1}
              >
                Users
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'themes' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('themes')}
                tabIndex={settingsTab === 'themes' ? 0 : -1}
              >
                Themes
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'activities' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('activities')}
                tabIndex={settingsTab === 'activities' ? 0 : -1}
              >
                Activities
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'eras' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('eras')}
                tabIndex={settingsTab === 'eras' ? 0 : -1}
              >
                Eras
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'surfaces' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('surfaces')}
                tabIndex={settingsTab === 'surfaces' ? 0 : -1}
              >
                Surfaces
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'icons' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('icons')}
                tabIndex={settingsTab === 'icons' ? 0 : -1}
              >
                Icons
              </button>
            </nav>
            <nav className="settings-tabs settings-tabs-row3">
              <button
                className={`settings-tab-btn ${settingsTab === 'moderation' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('moderation')}
                tabIndex={settingsTab === 'moderation' ? 0 : -1}
                style={{ position: 'relative' }}
              >
                Moderation
                {moderationCount > 0 && (
                  <span style={{
                    marginLeft: '4px',
                    backgroundColor: '#f44336', color: 'white',
                    borderRadius: '10px', minWidth: '18px', height: '18px', padding: '0 5px',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.7rem', fontWeight: 'bold', verticalAlign: 'middle'
                  }}>
                    {moderationCount > 99 ? '99+' : moderationCount}
                  </span>
                )}
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'jobs' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('jobs')}
                tabIndex={settingsTab === 'jobs' ? 0 : -1}
              >
                Jobs
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'dataCollection' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('dataCollection')}
                tabIndex={settingsTab === 'dataCollection' ? 0 : -1}
              >
                Data Collection
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'google' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('google')}
                tabIndex={settingsTab === 'google' ? 0 : -1}
              >
                Google
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'stats' ? 'active' : ''}`}
                onClick={() => handleSettingsTabChange('stats')}
                tabIndex={settingsTab === 'stats' ? 0 : -1}
              >
                Stats
              </button>
            </nav>
            </div>

            <div className="settings-tab-content">
              {settingsTab === 'general' && <GeneralSettings />}
              {settingsTab === 'themes' && <ThemesSettings />}
              {settingsTab === 'activities' && <ActivitiesSettings />}
              {settingsTab === 'eras' && <ErasSettings />}
              {settingsTab === 'surfaces' && <SurfacesSettings />}
              {settingsTab === 'icons' && <IconsSettings />}
              {settingsTab === 'dataCollection' && <DataCollectionSettings />}
              {settingsTab === 'stats' && <StatsSettings />}
              {settingsTab === 'moderation' && <ModerationInbox onCountChange={refreshModerationCount} focusItemId={moderationFocusId} focusItemTitle={moderationFocusTitle} onSelectPoi={(poiId) => {
                const poi = destinations.find(d => d.id === poiId);
                if (poi) {
                  setSelectedDestination(poi);
                  setActiveTab('view');
                }
              }} />}
              {settingsTab === 'jobs' && <JobsDashboard expandTarget={jobsExpandTarget} onExpandTargetConsumed={() => setJobsExpandTarget(null)} />}
              {settingsTab === 'google' && (
                <div className="google-integration-tab">
                  <SyncSettings onDataRefresh={refreshAllData} onNavigateToJobs={(jobId) => { setJobsExpandTarget(jobId); handleSettingsTabChange('jobs'); }} />
                  <div className="settings-divider"></div>
                  <AISettings />
                </div>
              )}
              {settingsTab === 'users' && <UsersSettings />}
              {settingsTab === 'newsletter' && <NewsletterSettings user={user} />}
              {settingsTab === 'rss' && (
                <div className="settings-section">
                  <h3>RSS Feed</h3>
                  <p>Subscribe to the Roots of the Valley RSS feed to get news and events delivered to your favorite feed reader.</p>
                  <a
                    href="https://buttondown.com/rotv/rss"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rss-feed-link"
                  >
                    https://buttondown.com/rotv/rss
                  </a>
                </div>
              )}
              {settingsTab === 'mcp' && (
                <McpSettings />
              )}
            </div>
            </>
            ) : (
              <UserSettings user={user} initialTab={settingsTab === 'newsletter' ? 'newsletter' : 'general'} />
            )}
          </div>
        </main>
      )}

      <main
        id={(activeTab === 'view' || activeTab === 'edit') ? 'main-content' : undefined}
        className={`main-content ${editMode ? 'edit-mode' : ''} ${activeTab === 'view' || activeTab === 'edit' ? '' : 'main-content-behind'}`}
        tabIndex="-1"
               aria-hidden={(activeTab !== 'view' && activeTab !== 'edit') ? 'true' : undefined}
        style={{
          display: 'flex',
          zIndex: activeTab === 'view' ? '1' : '-1',
          pointerEvents: activeTab === 'view' ? 'auto' : 'none'
        }}
      >
        <Map
          destinations={filteredDestinations}
          parkPins={parkPins}
          selectedPoi={selectedPoi}
          selectedIsLinear={selectedKind === 'linear'}
          onSelectPoi={handleMapSelectPoi}
          isAdmin={isAdmin}
          onDestinationUpdate={handleDestinationUpdate}
          onDestinationCreate={handleDestinationCreate}
          editMode={editMode}
          activeTab={activeTab}
          previewCoords={previewCoords}
          onPreviewCoordsChange={setPreviewCoords}
          newPOI={newPOI}
          onStartNewPOI={handleStartNewPOI}
          newOrganization={newOrganization}
          onStartNewOrganization={handleStartNewOrganization}
          linearFeatures={linearFeatures}
          visibleTypes={visibleTypes}
          onVisibleTypesChange={setVisibleTypes}
          onVisiblePoisChange={setVisiblePoiIds}
          showTrails={showTrails}
          onToggleTrails={setShowTrails}
          showRivers={showRivers}
          onToggleRivers={setShowRivers}
          showWaterTaxis={showWaterTaxis}
          onToggleWaterTaxis={setShowWaterTaxis}
          boatPosition={boatPosition}
          trainPosition={trainPosition}
          visibleBoundaries={visibleBoundaries}
          onToggleBoundary={(id) => {
            const willEnable = !visibleBoundaries.has(id);
            setVisibleBoundaries(prev => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            });
            // Enabling: zoom to the boundary just enabled. Disabling the last visible
            // boundary: zoom back to the default view. (#396 follow-up)
            if (willEnable) {
              fitToBoundaries([id]);
            } else if (visibleBoundaries.size === 1 && visibleBoundaries.has(id)) {
              requestFit(DEFAULT_PARK_BOUNDS);
            }
          }}
          onShowBoundaries={(ids) => {
            setVisibleBoundaries(prev => {
              const next = new Set(prev);
              ids.forEach(id => next.add(id));
              return next;
            });
            fitToBoundaries(ids); // fit to the whole set just shown
          }}
          onHideBoundaries={(ids) => {
            setVisibleBoundaries(prev => {
              const next = new Set(prev);
              ids.forEach(id => next.delete(id));
              return next;
            });
            const remaining = new Set(visibleBoundaries);
            ids.forEach(id => remaining.delete(id));
            if (remaining.size === 0) requestFit(DEFAULT_PARK_BOUNDS);
          }}
          searchQuery={activeFilters.search}
          onSearchChange={handleSearchChange}
          onNewsRefresh={() => setNewsRefreshTrigger(prev => prev + 1)}
          skipFlyRef={skipNextFlyRef}
          boundsToFit={boundsToFit}
          fitNonce={fitNonce}
          onFitBounds={requestFit}
          defaultBounds={DEFAULT_PARK_BOUNDS}
          visiblePoiCount={visiblePoiCount}
          iconConfig={iconConfig}
          activeGauge={activeGauge}
          isLegendExpanded={isLegendExpanded}
          setIsLegendExpanded={setIsLegendExpanded}
          isDrawingAssociations={isDrawingAssociations}
          addingAssociationsToOrgId={addingAssociationsToOrgId}
          onAddAssociationsFromDrawing={handleAddAssociationsFromDrawing}
          onCancelDrawingAssociations={() => {
            setIsDrawingAssociations(false);
            setAddingAssociationsToOrgId(null);
          }}
        />

        <Sidebar
          tourActive={tourActive}
          poi={newPOI || newOrganization || selectedPoi}
          isLinearPoi={!newPOI && !newOrganization && selectedKind === 'linear'}
          isNewPOI={!!newPOI}
          newOrganization={newOrganization}
          isNewOrganization={!!newOrganization}
          onClose={() => {
            if (newPOI) {
              handleCancelNewPOI();
            } else if (newOrganization) {
              handleCancelNewOrganization();
            } else if (selectedLinearFeature) {
              setSelectedLinearFeature(null);
            } else {
              setSelectedDestination(null);
            }
            updateUrlWithPoi(null); // Clear POI from URL
            document.title = 'Roots of The Valley'; // Reset title
            setCurrentPoiIndex(-1); // Reset navigation index
          }}
          isInMtbMode={isInMtbMode}
          selectedFromMtbList={selectedFromMtbList}
          mtbTrailsList={mtbTrailsList}
          currentMtbIndex={currentMtbIndex}
          onNavigateMtbTrail={(direction) => {
            if (mtbTrailsList.length === 0) return;

            const newIndex = direction === 'next'
              ? (currentMtbIndex + 1) % mtbTrailsList.length
              : (currentMtbIndex - 1 + mtbTrailsList.length) % mtbTrailsList.length;

            const nextTrail = mtbTrailsList[newIndex];
            setCurrentMtbIndex(newIndex);

            if (nextTrail.poi_roles?.includes('point')) {
              const fullDestination = destinations?.find(d => d.id === nextTrail.id);
              if (fullDestination) {
                setSelectedDestination(fullDestination);
                setSelectedLinearFeature(null);
                updateUrlWithPoi(fullDestination);
              }
            } else {
              const fullTrail = linearFeatures?.find(f => f.id === nextTrail.id);
              if (fullTrail) {
                setSelectedLinearFeature(fullTrail);
                setSelectedDestination(null);
                updateUrlWithPoi(fullTrail);
              }
            }
          }}
          onBackToMtbList={() => {
            setSelectedDestination(null);
            setSelectedLinearFeature(null);
            setSelectedFromMtbList(false);
            setCurrentMtbIndex(-1);
            setActiveTab('find');
            isProgrammaticNavigationRef.current = true;
            navigate('/mtb-trail-status');
          }}
          isAdmin={isAdmin}
          user={user}
          editMode={editMode}
          onPoiUpdate={handlePoiUpdate}
          onPoiDelete={handlePoiDelete}
          onSaveNewPOI={handleSaveNewPOI}
          onCancelNewPOI={handleCancelNewPOI}
          onSaveNewOrganization={handleSaveNewOrganization}
          onCancelNewOrganization={handleCancelNewOrganization}
          previewCoords={previewCoords}
          onPreviewCoordsChange={setPreviewCoords}
          onNavigate={handleNavigatePoi}
          currentIndex={currentPoiIndex}
          totalCount={poiNavigationList.length}
          poiNavigationList={poiNavigationList}
          associations={associations}
          allDestinations={destinations}
          allLinearFeatures={linearFeatures}
          allVirtualPois={virtualPois}
          onSelectPoi={handleSidebarSelectPoi}
          onAssociationsChanged={refreshAllData}
          onStartDrawingAssociations={handleStartDrawingAssociations}
          permalinkInfo={permalinkInfo}
          onSetPermalink={setPermalinkInfo}
          onClearPermalink={() => setPermalinkInfo(null)}
          initialSidebarTab={initialSidebarTab}
          onSidebarTabChange={(tab) => setInitialSidebarTab(null)}
          onActiveGaugeChange={setActiveGauge}
          boatPosition={boatPosition}
          trainPosition={trainPosition}
        />
      </main>
      {showFeedbackForm && (
        <FeedbackForm onClose={() => setShowFeedbackForm(false)} />
      )}

      <TripBuilder onOpenMyTrips={() => setShowMyTrips(true)} />
      <MyTripsModal open={showMyTrips} onClose={() => setShowMyTrips(false)} />
      <MyValley
        open={showMyValley}
        onClose={() => setShowMyValley(false)}
        destinations={destinations}
      />

      {showTourPrompt && (
        <TourPrompt
          onStartTour={startTour}
          onDismiss={() => {
            setShowTourPrompt(false);
            localStorage.setItem('rotv-tour-seen', 'true');
          }}
        />
      )}

      {tourActive && (
        <GuidedTour
          onEnd={endTour}
          currentStep={tourStep}
          setCurrentStep={setTourStep}
          onStepAction={handleTourStepAction}
          steps={tourVariant === 'trips' ? TRIP_TOUR_STEPS : undefined}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <TripProvider>
        <AppContent />
      </TripProvider>
    </AuthProvider>
  );
}

export default App;
