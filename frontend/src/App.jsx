import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './hooks/useAuth';
import useSeasonalTheme from './hooks/useSeasonalTheme';
import Map from './components/Map';
import Sidebar from './components/Sidebar';
import SyncSettings from './components/SyncSettings';
import AISettings from './components/AISettings';
import GeneralSettings from './components/GeneralSettings';
import ThemesSettings from './components/ThemesSettings';
import ActivitiesSettings from './components/ActivitiesSettings';
import ErasSettings from './components/ErasSettings';
import SurfacesSettings from './components/SurfacesSettings';
import IconsSettings from './components/IconsSettings';
import ParkNews from './components/ParkNews';
import ParkEvents from './components/ParkEvents';
import DataCollectionSettings from './components/DataCollectionSettings';
import ModerationInbox from './components/ModerationInbox';
import JobsDashboard from './components/JobsDashboard';
import UsersSettings from './components/UsersSettings';
import UserSettings from './components/UserSettings';
import NewsletterSettings from './components/NewsletterSettings';
import ResultsTab from './components/ResultsTab';

// Default icon type IDs for initializing the filter
const DEFAULT_ICON_TYPES = new Set(['visitor-center', 'waterfall', 'trail', 'mtb-trailhead', 'historic', 'bridge', 'train', 'nature', 'skiing', 'biking', 'picnic', 'camping', 'music', 'default', 'lighthouse', 'cemetery']);

// Generate URL-friendly slug from POI name
function generateSlug(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-')          // Replace spaces with hyphens
    .replace(/-+/g, '-')           // Replace multiple hyphens with single
    .replace(/^-|-$/g, '');        // Remove leading/trailing hyphens
}

// Default park bounds - expanded to include all MTB trailheads
// Includes: Reagan-Huffman (westernmost), Ohio & Erie Canal (northernmost),
// East Rim (easternmost), Hampton Hills (southernmost)
const DEFAULT_PARK_BOUNDS = [
  [41.13, -81.85],  // Southwest corner (expanded west to include Reagan-Huffman at -81.832)
  [41.45, -81.50]   // Northeast corner (expanded to fit all trailheads)
];

function AppContent() {
  const { isAuthenticated, isAdmin, loginWithGoogle, loginWithFacebook, logout, user } = useAuth();
  const { activeTheme, isNightMode, videoUrls } = useSeasonalTheme();
  const [destinations, setDestinations] = useState([]);
  const [filteredDestinations, setFilteredDestinations] = useState([]);
  const [selectedDestination, setSelectedDestination] = useState(null);

  // POI type visibility filter (shared with Map and News/Events tabs)
  // Icon configuration for determining POI types
  const [iconConfig, setIconConfig] = useState([]);

  // Initialize visibleTypes from database after iconConfig loads
  const [visibleTypes, setVisibleTypes] = useState(new Set(DEFAULT_ICON_TYPES));

  // POI IDs currently visible in the map viewport (for News/Events filtering)
  const [visiblePoiIds, setVisiblePoiIds] = useState([]);

  // Global visible POI count (single source of truth for all tabs)
  const visiblePoiCount = visiblePoiIds.length;

  // Layer visibility states (lifted from Map component for unified control)
  const [showNpsMap, setShowNpsMap] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [showRivers, setShowRivers] = useState(true);
  const [visibleBoundaries, setVisibleBoundaries] = useState(new Set()); // Set of boundary IDs

  // Map state for thumbnail display (center, zoom, bounds)
  const [mapState, setMapState] = useState({
    center: [41.26, -81.55],  // Park center default
    zoom: 11,
    bounds: null
  });

  // Linear features (trails and rivers from database)
  const [linearFeatures, setLinearFeatures] = useState([]);
  const [selectedLinearFeature, setSelectedLinearFeature] = useState(null);

  // Virtual POIs and associations state (for Entity: legacy Destination)
  const [virtualPois, setVirtualPois] = useState([]);
  const [associations, setAssociations] = useState([]);

  // Drawing mode for adding associations to existing organization
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

  // Tab state for admin interface: 'view', 'edit', 'settings'
  const [activeTab, setActiveTab] = useState('view');

  // MTB trails viewport state for focus restoration
  const [boundsToFit, setBoundsToFit] = useState(null);

  // Cache pre-calculated MTB bounds for instant access when switching tabs
  const cachedMtbBoundsRef = useRef(null);

  // Settings sub-tab state: 'general', 'activities', 'news', 'google'
  const [settingsTab, setSettingsTab] = useState('general');
  const [jobsExpandTarget, setJobsExpandTarget] = useState(null);

  // Moderation queue pending count for badge
  const [moderationCount, setModerationCount] = useState(0);

  // Focus a specific news item in the moderation queue (from Edit link in news tab)
  const [moderationFocusId, setModerationFocusId] = useState(null);
  const [moderationFocusTitle, setModerationFocusTitle] = useState(null);

  // News refresh trigger - increments when news collection completes
  const [newsRefreshTrigger, setNewsRefreshTrigger] = useState(0);

  // Login/account dropdown state
  const [showLoginDropdown, setShowLoginDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [profileImageError, setProfileImageError] = useState(false);

  // Router hooks
  const location = useLocation();
  const navigate = useNavigate();

  // Track programmatic navigation to avoid effect conflicts
  const isProgrammaticNavigationRef = useRef(false);
  const isLoadingFromUrlRef = useRef(false);
  const prevPathnameRef = useRef(location.pathname);

  // Initial MTB filter state for Results tab (controlled by URL path)
  const [initialShowMtbOnly, setInitialShowMtbOnly] = useState(false);
  const [isInMtbMode, setIsInMtbMode] = useState(false);
  const [selectedFromMtbList, setSelectedFromMtbList] = useState(false);
  const [mtbTrailsList, setMtbTrailsList] = useState([]);
  const [currentMtbIndex, setCurrentMtbIndex] = useState(-1);

  // Organizations mode state for Results tab carousel scrolling (controlled by URL path)
  const [isInOrganizationsMode, setIsInOrganizationsMode] = useState(false);

  // Flag to temporarily show all POIs when transitioning from MTB mode to All Results
  // This prevents showing only viewport-filtered POIs before the map finishes zooming
  const [bypassViewportFilter, setBypassViewportFilter] = useState(false);

  // Pre-calculate and cache MTB bounds when destinations load
  // This ensures bounds are available immediately when switching to MTB mode
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

  // Check URL path for MTB trail status route
  useEffect(() => {
    if (location.pathname.startsWith('/mtb-trail-status')) {
      const pathParts = location.pathname.split('/');
      const poiSlug = pathParts[2]; // /mtb-trail-status/east-rim-trail -> 'east-rim-trail'

      setInitialShowMtbOnly(true);
      setIsInMtbMode(true);
      // Entering MTB mode - clear bypass flag
      setBypassViewportFilter(false);

      // Use pre-calculated cached MTB bounds for instant availability
      // This prevents the thumbnail from drawing with old bounds on first render
      if (cachedMtbBoundsRef.current) {
        setBoundsToFit(cachedMtbBoundsRef.current);
      }

      // Only set to results tab if there's no POI slug in URL (otherwise POI loading will handle it)
      if (!poiSlug) {
        setActiveTab('results');
      }
    } else {
      setIsInMtbMode(false);
      setInitialShowMtbOnly(false);

      // When leaving MTB mode (coming from /mtb-trail-status to /), reset to default park view
      const wasInMtbMode = prevPathnameRef.current.startsWith('/mtb-trail-status');
      const isGoingToRoot = location.pathname === '/';


      if (wasInMtbMode && isGoingToRoot) {
        // Set default park bounds IMMEDIATELY before anything else renders
        // This ensures thumbnail has correct bounds on first render
        setBoundsToFit(DEFAULT_PARK_BOUNDS);
        // Temporarily bypass viewport filtering until map viewport updates
        setBypassViewportFilter(true);
      } else if (!isGoingToRoot) {
        // Clear bypass flag when navigating away from root
        setBypassViewportFilter(false);
      }
    }

    // Update previous pathname at the end
    prevPathnameRef.current = location.pathname;
  }, [location.pathname, destinations]);

  // Check URL path for organizations route
  useEffect(() => {
    if (location.pathname.startsWith('/organizations')) {
      const pathParts = location.pathname.split('/');
      const orgSlug = pathParts[2]; // /organizations/org-name -> 'org-name'

      setIsInOrganizationsMode(true);

      // Only set to results tab if there's no org slug in URL (otherwise org loading will handle it)
      if (!orgSlug) {
        setActiveTab('results');
      }
    } else {
      setIsInOrganizationsMode(false);
    }
  }, [location.pathname]);

  // Helper to handle tab changes and clear MTB mode if needed
  const handleTabChange = useCallback((newTab) => {
    const previousActiveTab = activeTab;
    setActiveTab(newTab);

    // If switching TO Results tab FROM another tab
    if (newTab === 'results' && previousActiveTab !== 'results') {
      // Check if we're in MTB trail status mode
      if (location.pathname.startsWith('/mtb-trail-status')) {
        // Clear selected destination/feature to show all MTB trails
        setSelectedDestination(null);
        setSelectedLinearFeature(null);
      }
    }

    // If switching away from Results tab, clear bypass filter
    if (newTab !== 'results') {
      setBypassViewportFilter(false);
    }

    // If switching away from Results tab and currently on MTB trail status or organizations page, navigate back to home
    // BUT: Don't navigate away if switching to Edit or View - preserve the selected item
    if (newTab !== 'results' && newTab !== 'edit' && newTab !== 'view') {
      if (location.pathname.startsWith('/mtb-trail-status')) {
        navigate('/');
        setSelectedFromMtbList(false);
      } else if (location.pathname.startsWith('/organizations')) {
        navigate('/');
      }
    }
  }, [activeTab, location.pathname, navigate]);

  // Sync URL to settings tab (for direct navigation to /admin/jobs)
  useEffect(() => {
    if (location.pathname === '/admin/jobs') {
      setActiveTab('settings');
      setSettingsTab('jobs');
      // Clear POI selection to prevent updateUrlWithPoi from navigating back to /{slug}
      setSelectedDestination(null);
      setSelectedLinearFeature(null);
      // JobsDashboard will auto-expand based on URL params (job= and type=)
    }
  }, [location.pathname, location.search]);

  // Handle POI type filter - filters map to show only specified types
  // typesToShow: array of POI type names, or null to show all
  const handleFilterByTypes = useCallback((typesToShow) => {
    if (typesToShow && typesToShow.length > 0) {
      // Filtering to specific types
      setVisibleTypes(new Set(typesToShow));
    } else {
      // Restore to "show all" mode - use database-loaded icon types
      if (iconConfig && iconConfig.length > 0) {
        const allTypes = new Set(
          iconConfig
            .filter(icon => icon.enabled !== false)
            .map(icon => icon.name)
        );
        if (!allTypes.has('default')) allTypes.add('default');
        // Include layer types
        allTypes.add('trail');
        allTypes.add('river');
        allTypes.add('boundary');
        allTypes.add('organization');
        setVisibleTypes(allTypes);
      } else {
        // Fallback to hardcoded defaults if iconConfig not loaded yet
        setVisibleTypes(new Set(DEFAULT_ICON_TYPES));
      }
    }
  }, [iconConfig]);

  // Reset to View tab when user loses admin status (e.g., logout)
  useEffect(() => {
    if (!isAdmin && activeTab === 'edit') {
      setActiveTab('view');
    }
  }, [isAdmin, activeTab]);

  // Reset to View tab when user logs out completely
  useEffect(() => {
    if (!isAuthenticated && activeTab === 'settings') {
      setActiveTab('view');
    }
  }, [isAuthenticated, activeTab]);

  // Fetch moderation pending count for admin badge
  const refreshModerationCount = useCallback(async () => {
    console.log('[App] Refreshing moderation count...');
    try {
      const response = await fetch('/api/admin/moderation/queue/count', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        console.log('[App] New moderation count:', data.count);
        setModerationCount(data.count);
      }
    } catch (err) {
      console.error('[App] Failed to refresh moderation count:', err);
      // Silently ignore — badge just won't show
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    refreshModerationCount();
    const interval = setInterval(refreshModerationCount, 60000);

    // Listen for media upload events to refresh count
    const handleCountChanged = () => {
      console.log('[App] Received moderation-count-changed event');
      refreshModerationCount();
    };
    window.addEventListener('moderation-count-changed', handleCountChanged);

    return () => {
      clearInterval(interval);
      window.removeEventListener('moderation-count-changed', handleCountChanged);
    };
  }, [isAdmin, refreshModerationCount]);

  // Preview coordinates for real-time editing sync between Map and Sidebar
  const [previewCoords, setPreviewCoords] = useState(null);

  // New POI being created (temporary, not yet saved)
  const [newPOI, setNewPOI] = useState(null);

  // New organization being created (temporary, not yet saved)
  const [newOrganization, setNewOrganization] = useState(null);

  // Reset preview coords when selection changes or edit mode turns off
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

  // Auto-enable edit mode when Edit tab is selected, disable when leaving
  useEffect(() => {
    if (activeTab === 'edit') {
      setEditMode(true);
    } else {
      setEditMode(false);
    }
  }, [activeTab]);

  // Store initial POI slug for after data loads
  const [initialPoiSlug, setInitialPoiSlug] = useState(null);

  // Handle tab query parameter from auth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'settings' || tab === 'edit' || tab === 'view') {
      setActiveTab(tab);
      // Clean URL but keep other params if any
      params.delete('tab');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
      window.history.replaceState({}, '', newUrl);
    }

    // Check for POI - first check path-based route (/:slug)
    // Then fall back to query parameter (?poi=slug) for backward compatibility
    let poiSlug = null;
    const pathParts = window.location.pathname.split('/').filter(Boolean);

    if (pathParts.length === 1 && pathParts[0] !== 'mtb-trail-status') {
      // POI path: /:slug (but not /mtb-trail-status which is the list page)
      poiSlug = pathParts[0];
    } else {
      // Fall back to query parameter for backward compatibility
      poiSlug = params.get('poi');
    }

    if (poiSlug) {
      setInitialPoiSlug(poiSlug);
    }
  }, []);

  // Auto-select POI from URL after data loads (matches by slug)
  useEffect(() => {
    if (initialPoiSlug && !loading && destinations.length > 0) {
      const isOnMtbPage = location.pathname.startsWith('/mtb-trail-status');

      // First check point destinations by slug match
      const destination = destinations.find(d => generateSlug(d.name) === initialPoiSlug);
      if (destination) {
        setSelectedDestination(destination);
        document.title = `${destination.name} | Roots of The Valley`;
        // If on MTB page, mark as selected from MTB list and switch to view tab
        if (isOnMtbPage) {
          setSelectedFromMtbList(true);
          setActiveTab('view');
        }
        setInitialPoiSlug(null); // Clear so it doesn't re-trigger
        return;
      }

      // Then check virtual POIs (organizations)
      const virtualPoi = virtualPois.find(v => generateSlug(v.name) === initialPoiSlug);
      if (virtualPoi) {
        setSelectedDestination(virtualPoi);
        document.title = `${virtualPoi.name} | Roots of The Valley`;
        // If on MTB page, mark as selected from MTB list and switch to view tab
        if (isOnMtbPage) {
          setSelectedFromMtbList(true);
          setActiveTab('view');
        }
        setInitialPoiSlug(null);
        return;
      }

      // Then check linear features (trails, rivers, boundaries)
      const linearFeature = linearFeatures.find(f => generateSlug(f.name) === initialPoiSlug);
      if (linearFeature) {
        setSelectedLinearFeature(linearFeature);
        document.title = `${linearFeature.name} | Roots of The Valley`;
        // If on MTB page, mark as selected from MTB list and switch to view tab
        if (isOnMtbPage) {
          setSelectedFromMtbList(true);
          setActiveTab('view');
        }
        setInitialPoiSlug(null);
        return;
      }

      // POI not found - clear the param
      setInitialPoiSlug(null);
    }
  }, [initialPoiSlug, loading, destinations, linearFeatures, virtualPois, location.pathname]);

  // Handle browser back/forward navigation for all POI paths
  useEffect(() => {
    // Skip if this is a programmatic navigation (handled by click handler)
    if (isProgrammaticNavigationRef.current) {
      isProgrammaticNavigationRef.current = false;
      return;
    }

    // Only run if data is loaded
    if (loading || destinations.length === 0) {
      return;
    }

    // Check if we're on the MTB trail status list page (no POI slug)
    if (location.pathname === '/mtb-trail-status') {
      // User navigated to MTB trails list
      // Clear any selected POI only if one is currently selected
      // BUT don't clear if we're in the middle of loading from URL
      if (!isLoadingFromUrlRef.current && (selectedDestination || selectedLinearFeature)) {
        setSelectedDestination(null);
        setSelectedLinearFeature(null);
        setActiveTab('results');
        document.title = 'Roots of The Valley';
      }
      return; // MTB list handled, exit early
    }

    // Check if we're on the organizations list page (no POI slug)
    if (location.pathname === '/organizations') {
      // User navigated to organizations list
      // Clear any selected POI only if one is currently selected
      // BUT don't clear if we're in the middle of loading from URL
      if (!isLoadingFromUrlRef.current && (selectedDestination || selectedLinearFeature)) {
        setSelectedDestination(null);
        setSelectedLinearFeature(null);
        setActiveTab('results');
        document.title = 'Roots of The Valley';
      }
      return; // Organizations list handled, exit early
    }

    // Handle root path: "/" should clear any selected POI
    if (location.pathname === '/') {
      if (!isLoadingFromUrlRef.current && (selectedDestination || selectedLinearFeature)) {
        setSelectedDestination(null);
        setSelectedLinearFeature(null);
        document.title = 'Roots of The Valley';
      }
      return;
    }

    // Check if path is a POI slug: /:slug (single segment) or /mtb-trail-status/:slug (2 segments)
    const pathParts = location.pathname.split('/').filter(Boolean); // Remove empty strings

    // Handle /mtb-trail-status/:slug (2 segments)
    if (pathParts.length === 2 && pathParts[0] === 'mtb-trail-status') {
      const poiSlug = pathParts[1];

      // Check if this slug matches currently selected POI
      const currentSlug = selectedDestination ? generateSlug(selectedDestination.name)
        : selectedLinearFeature ? generateSlug(selectedLinearFeature.name)
        : null;

      // If already showing the correct POI, don't re-set state
      if (currentSlug === poiSlug) {
        return;
      }

      // Allow map to fly to POI when using browser navigation
      skipNextFlyRef.current = false;

      // Set flag to prevent URL update effect from running
      isLoadingFromUrlRef.current = true;

      // Find and select the POI - search destinations first (MTB trailheads are destinations)
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

      // Check linear features (in case an MTB trail is a linear feature)
      const linearFeature = linearFeatures.find(f => generateSlug(f.name) === poiSlug);
      if (linearFeature) {
        setSelectedLinearFeature(linearFeature);
        setSelectedDestination(null);
        setSelectedFromMtbList(true);
        setActiveTab('view');
        document.title = `${linearFeature.name} | Roots of The Valley`;

        // Enable layer visibility
        if (linearFeature.feature_type === 'boundary') {
          setVisibleBoundaries(prev => {
            if (prev.has(linearFeature.id)) return prev;
            const next = new Set(prev);
            next.add(linearFeature.id);
            return next;
          });
        } else if (linearFeature.feature_type === 'trail') {
          setShowTrails(true);
        } else if (linearFeature.feature_type === 'river') {
          setShowRivers(true);
        }
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
        return;
      }

      // POI not found - clear flag
      console.warn('[Browser Nav Effect] MTB POI not found for slug:', poiSlug);
      isLoadingFromUrlRef.current = false;
      return;
    }

    // Handle /organizations/:slug (2 segments)
    if (pathParts.length === 2 && pathParts[0] === 'organizations') {
      const orgSlug = pathParts[1];

      // Check if this slug matches currently selected POI
      const currentSlug = selectedDestination ? generateSlug(selectedDestination.name) : null;

      // If already showing the correct organization, don't re-set state
      if (currentSlug === orgSlug) {
        return;
      }

      // Set flag to prevent URL update effect from running
      isLoadingFromUrlRef.current = true;

      // Find and select the organization (virtual POI)
      const virtualPoi = virtualPois.find(v => generateSlug(v.name) === orgSlug);
      if (virtualPoi) {
        setSelectedDestination(virtualPoi);
        setSelectedLinearFeature(null);
        setActiveTab('view');
        document.title = `${virtualPoi.name} | Roots of The Valley`;
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
        return;
      }

      // Organization not found - clear flag
      console.warn('[Browser Nav Effect] Organization not found for slug:', orgSlug);
      isLoadingFromUrlRef.current = false;
      return;
    }

    // Handle /:slug (single segment, not empty)
    if (pathParts.length === 1) {
      const poiSlug = pathParts[0];

      // Check if this slug matches currently selected POI
      const currentSlug = selectedDestination ? generateSlug(selectedDestination.name)
        : selectedLinearFeature ? generateSlug(selectedLinearFeature.name)
        : null;

      // If already showing the correct POI, don't re-set state
      if (currentSlug === poiSlug) {
        return;
      }

      // Allow map to fly to POI when using browser navigation
      skipNextFlyRef.current = false;

      // Set flag to prevent URL update effect from running
      isLoadingFromUrlRef.current = true;

      // Find and select the POI
      const destination = destinations.find(d => generateSlug(d.name) === poiSlug);
      if (destination) {
        setSelectedDestination(destination);
        setSelectedLinearFeature(null);
        // Don't change selectedFromMtbList - preserve state for browser navigation
        setActiveTab('view');
        document.title = `${destination.name} | Roots of The Valley`;
        // Clear flag after state is set
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
        return;
      }

      const virtualPoi = virtualPois.find(v => generateSlug(v.name) === poiSlug);
      if (virtualPoi) {
        setSelectedDestination(virtualPoi);
        setSelectedLinearFeature(null);
        // Don't change selectedFromMtbList - preserve state for browser navigation
        setActiveTab('view');
        document.title = `${virtualPoi.name} | Roots of The Valley`;
        // Clear flag after state is set
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
        return;
      }

      const linearFeature = linearFeatures.find(f => generateSlug(f.name) === poiSlug);
      if (linearFeature) {
        setSelectedLinearFeature(linearFeature);
        setSelectedDestination(null);
        // Don't change selectedFromMtbList - preserve state for browser navigation
        setActiveTab('view');
        document.title = `${linearFeature.name} | Roots of The Valley`;

        // Enable layer visibility so feature appears on map
        if (linearFeature.feature_type === 'boundary') {
          setVisibleBoundaries(prev => {
            if (prev.has(linearFeature.id)) return prev;
            const next = new Set(prev);
            next.add(linearFeature.id);
            return next;
          });
        } else if (linearFeature.feature_type === 'trail') {
          setShowTrails(true);
        } else if (linearFeature.feature_type === 'river') {
          setShowRivers(true);
        }
        // Clear flag after state is set
        setTimeout(() => { isLoadingFromUrlRef.current = false; }, 0);
        return;
      }

      // POI not found - clear flag
      console.warn('[Browser Nav Effect] POI not found for slug:', poiSlug);
      isLoadingFromUrlRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, loading, destinations, linearFeatures, virtualPois]);
  // NOTE: selectedDestination and selectedLinearFeature are intentionally NOT in dependencies
  // We only want this effect to run on URL changes (browser back/forward), not POI state changes

  // URL updates are now handled directly in click handlers with setTimeout
  // This avoids race conditions with state updates and navigation

  // Reusable function to fetch all data (used on mount and after sync operations)
  const refreshAllData = React.useCallback(async () => {
    try {
      const [destResponse, linearResponse, iconResponse, virtualPoisResponse, associationsResponse] = await Promise.all([
        fetch('/api/destinations'),
        fetch('/api/linear-features'),
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

  // Fetch destinations, linear features, and icon config on mount
  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  // Initialize visibleTypes from iconConfig ONCE after it loads from database
  // Use a ref to ensure this only runs once, not every time iconConfig changes
  const hasInitializedVisibleTypes = useRef(false);
  useEffect(() => {
    if (iconConfig && iconConfig.length > 0 && !hasInitializedVisibleTypes.current) {
      const enabledTypes = new Set(
        iconConfig
          .filter(icon => icon.enabled !== false)
          .map(icon => icon.name)
      );
      // Add 'default' if not present
      if (!enabledTypes.has('default')) {
        enabledTypes.add('default');
      }
      // Also include layer types that aren't in icon config
      enabledTypes.add('trail');
      enabledTypes.add('river');
      enabledTypes.add('boundary');
      enabledTypes.add('organization');

      setVisibleTypes(enabledTypes);
      hasInitializedVisibleTypes.current = true;
    }
  }, [iconConfig]);

  // Initialize visibleBoundaries to only show CVNP boundary by default
  const hasInitializedBoundaries = useRef(false);
  useEffect(() => {
    if (linearFeatures && linearFeatures.length > 0 && !hasInitializedBoundaries.current) {
      const cvnpBoundary = linearFeatures.find(
        f => f.feature_type === 'boundary' && f.name === 'Cuyahoga Valley National Park'
      );
      if (cvnpBoundary) {
        setVisibleBoundaries(new Set([cvnpBoundary.id]));
      }
      hasInitializedBoundaries.current = true;
    }
  }, [linearFeatures]);

  // Auto-scroll header tabs to show Login button on mobile
  useEffect(() => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      const headerTabs = document.querySelector('.header-tabs');
      if (headerTabs) {
        // Scroll to the right to show Login button
        headerTabs.scrollLeft = headerTabs.scrollWidth;
      }
    }
  }, [isAuthenticated]); // Re-run when auth state changes

  // Compute destinations filtered by map viewport visibility (for News/Events tabs)
  // This uses the actual POI IDs visible on the map (respects zoom, pan, and legend filters)
  const viewportFilteredDestinations = React.useMemo(() => {
    if (!visiblePoiIds || visiblePoiIds.length === 0) return [];

    const visibleIdSet = new Set(visiblePoiIds);
    return destinations.filter(dest => visibleIdSet.has(dest.id));
  }, [destinations, visiblePoiIds]);

  // Compute linear features filtered by map viewport visibility (for News/Events tabs)
  const viewportFilteredLinearFeatures = useMemo(() => {
    if (!visiblePoiIds || visiblePoiIds.length === 0) return [];

    const visibleIdSet = new Set(visiblePoiIds);
    return linearFeatures.filter(feature => visibleIdSet.has(feature.id));
  }, [linearFeatures, visiblePoiIds]);

  // Compute virtual POIs filtered by map viewport visibility
  // Show virtual POIs when ANY of their associated physical POIs are visible
  const viewportFilteredVirtualPois = useMemo(() => {
    if (!visiblePoiIds || visiblePoiIds.length === 0) return [];

    // Check if we're filtering to show only specific non-organization types
    // If visibleTypes doesn't include 'organization', don't show virtual POIs
    const showingAllTypes = visibleTypes.size >= DEFAULT_ICON_TYPES.size;
    const includingOrganizations = visibleTypes.has('organization');

    if (!showingAllTypes && !includingOrganizations) {
      // Filtered mode but organizations not included - hide them
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

  // Navigation state for Results tab swipe navigation
  const [currentPoiIndex, setCurrentPoiIndex] = useState(-1);

  // Ref to skip map fly animation on next selection (for Results/sidebar clicks)
  const skipNextFlyRef = useRef(false);

  // Combined navigation list (destinations + linear features + virtual POIs, sorted alphabetically)
  // In MTB mode: only MTB trailheads (destinations with status_url), no linear features or virtual POIs
  // In Organizations mode: only virtual POIs (all of them, not viewport-filtered), no destinations or linear features
  // This matches the filtering in ResultsTab.jsx for consistency
  const poiNavigationList = useMemo(() => {
    // In MTB mode: use ALL destinations with status_url (MTB trailheads only)
    // In Organizations mode: no destinations
    // In normal mode: use viewport-filtered destinations
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

    // In MTB mode: NO linear features or virtual POIs (only MTB trailheads)
    // In Organizations mode: NO linear features, use ALL organization POIs
    // In normal mode: include viewport-filtered linear features and organization POIs
    const linear = (isInMtbMode || isInOrganizationsMode) ? [] : (viewportFilteredLinearFeatures || []).map(f => ({ ...f, _isLinear: true }));
    const virtual = isInMtbMode
      ? []
      : isInOrganizationsMode
        ? (virtualPois || []).map(v => ({ ...v, _isLinear: false, _isVirtual: !v.geometry && !v.latitude }))
        : (viewportFilteredVirtualPois || []).map(v => ({ ...v, _isLinear: false, _isVirtual: !v.geometry && !v.latitude }));

    return [...dests, ...linear, ...virtual].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [destinations, virtualPois, viewportFilteredDestinations, viewportFilteredLinearFeatures, viewportFilteredVirtualPois, isInMtbMode, isInOrganizationsMode]);

  // Sync currentPoiIndex when selectedDestination changes (for URL loading and direct selection)
  useEffect(() => {
    if (selectedDestination && poiNavigationList.length > 0) {
      // Convert IDs to strings for comparison to handle number/string mismatches
      const index = poiNavigationList.findIndex(p => !p._isLinear && String(p.id) === String(selectedDestination.id));
      if (index !== -1) {
        setCurrentPoiIndex(index);
      } else {
        console.warn('[Navigation] Could not find selected destination in navigation list:', selectedDestination.name, 'ID:', selectedDestination.id);
      }
    } else if (!selectedDestination && !selectedLinearFeature) {
      setCurrentPoiIndex(-1);
    }
  }, [selectedDestination, selectedLinearFeature, poiNavigationList]);

  // Sync currentPoiIndex when selectedLinearFeature changes (for URL loading and direct selection)
  useEffect(() => {
    if (selectedLinearFeature && poiNavigationList.length > 0) {
      // Convert IDs to strings for comparison to handle number/string mismatches
      const index = poiNavigationList.findIndex(p => p._isLinear && String(p.id) === String(selectedLinearFeature.id));
      if (index !== -1) {
        setCurrentPoiIndex(index);
      } else {
        const linearInList = poiNavigationList.filter(p => p._isLinear);
        console.warn('[Navigation] Could not find selected linear feature in navigation list:', selectedLinearFeature.name, 'ID:', selectedLinearFeature.id);
        console.warn('[Navigation] Navigation list has', linearInList.length, 'linear features out of', poiNavigationList.length, 'total');
        console.warn('[Navigation] Is trail in list?', linearInList.some(p => String(p.id) === String(selectedLinearFeature.id)));
      }
    } else if (!selectedDestination && !selectedLinearFeature) {
      setCurrentPoiIndex(-1);
    }
  }, [selectedLinearFeature, selectedDestination, poiNavigationList]);

  // Apply filters when activeFilters change
  useEffect(() => {
    let filtered = destinations;

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
        d.brief_description?.toLowerCase().includes(searchLower) ||
        d.historical_description?.toLowerCase().includes(searchLower)
      );
    }

    setFilteredDestinations(filtered);
  }, [activeFilters, destinations]);

  const handleFilterChange = (filterType, value) => {
    setActiveFilters(prev => ({
      ...prev,
      [filterType]: value === prev[filterType] ? null : value
    }));
  };

  // Handle destination update from admin panel
  const handleDestinationUpdate = (updatedDest) => {
    setDestinations(prev =>
      prev.map(d => d.id === updatedDest.id ? updatedDest : d)
    );
    if (selectedDestination?.id === updatedDest.id) {
      setSelectedDestination(updatedDest);
    }
  };

  // Handle new destination creation from admin panel
  const handleDestinationCreate = (newDest) => {
    setDestinations(prev => [...prev, newDest]);
    setSelectedDestination(newDest);
  };

  // Handle destination deletion from admin panel (also handles organizations)
  const handleDestinationDelete = (deletedId) => {
    setDestinations(prev => prev.filter(d => d.id !== deletedId));
    setVirtualPois(prev => prev.filter(v => v.id !== deletedId));
    if (selectedDestination?.id === deletedId) {
      setSelectedDestination(null);
    }
  };

  // Helper to update URL with POI slug (for shareable links)
  // Uses path-based routing: /:slug instead of ?poi=slug
  const updateUrlWithPoi = useCallback((poiName) => {
    if (poiName) {
      const slug = generateSlug(poiName);
      // Set flag to prevent browser nav effect from clearing POI
      isProgrammaticNavigationRef.current = true;
      navigate(`/${slug}`);
    } else {
      // No POI - navigate to root
      isProgrammaticNavigationRef.current = true;
      navigate('/');
    }
  }, [navigate]);

  // Handle linear feature selection (clears destination selection) - wrapped in useCallback for stable reference
  const handleSelectLinearFeature = useCallback((feature) => {
    setSelectedDestination(null);
    setNewPOI(null);
    setPreviewCoords(null);
    setSelectedLinearFeature(feature);
    setSelectedFromMtbList(false); // Not from MTB list (map click or other)
    updateUrlWithPoi(feature?.name);
    // Update document title for sharing
    document.title = feature ? `${feature.name} | Roots of The Valley` : 'Roots of The Valley';
    // Sync navigation index
    if (feature) {
      // Convert IDs to strings for comparison to handle number/string mismatches
      const index = poiNavigationList.findIndex(p => p._isLinear && String(p.id) === String(feature.id));
      setCurrentPoiIndex(index);
      if (index === -1) {
        console.warn('[Navigation] Could not find linear feature in list:', feature.name, 'ID:', feature.id);
      }
      // Auto-enable the layer for the selected feature type so it's visible on the map
      if (feature.feature_type === 'boundary') {
        setVisibleBoundaries(prev => {
          if (prev.has(feature.id)) return prev;
          const next = new Set(prev);
          next.add(feature.id);
          return next;
        });
      } else if (feature.feature_type === 'trail') {
        setShowTrails(true);
      } else if (feature.feature_type === 'river') {
        setShowRivers(true);
      }
      // On mobile, switch to Results tab when linear feature is clicked from map (unless already in view mode)
      if (window.innerWidth < 768 && activeTab !== 'view') {
        setActiveTab('results');
      }
    } else {
      setCurrentPoiIndex(-1);
    }
  }, [updateUrlWithPoi, poiNavigationList, activeTab]);

  // Handle destination selection (clears linear feature selection) - wrapped in useCallback for stable reference
  const handleSelectDestination = useCallback((destination) => {
    setSelectedLinearFeature(null);
    setSelectedDestination(destination);
    setSelectedFromMtbList(false); // Not from MTB list (map click or other)
    updateUrlWithPoi(destination?.name);
    // Update document title for sharing
    document.title = destination ? `${destination.name} | Roots of The Valley` : 'Roots of The Valley';
    // Sync navigation index
    if (destination) {
      // Convert IDs to strings for comparison to handle number/string mismatches
      const index = poiNavigationList.findIndex(p => !p._isLinear && String(p.id) === String(destination.id));
      setCurrentPoiIndex(index);
      if (index === -1) {
        console.warn('[Navigation] Could not find destination in list:', destination.name, 'ID:', destination.id);
      }
      // On mobile, switch to Results tab when POI is clicked from map (unless already in view mode)
      if (window.innerWidth < 768 && activeTab !== 'view') {
        setActiveTab('results');
      }
    } else {
      setCurrentPoiIndex(-1);
    }
  }, [updateUrlWithPoi, poiNavigationList, activeTab]);

  // Navigate to next/prev POI in the list
  const handleNavigatePoi = useCallback((direction) => {
    if (poiNavigationList.length === 0) return;

    let newIndex;

    // Support direct index jump (for carousel clicks to distant items)
    if (typeof direction === 'number') {
      newIndex = direction;
    } else if (currentPoiIndex === -1) {
      // No current selection, start from beginning or end
      newIndex = direction === 'next' ? 0 : poiNavigationList.length - 1;
    } else {
      // Calculate new index with wrapping
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
        // In Organizations mode, use /organizations/{slug} URL pattern
        // In MTB mode, preserve the /mtb-trail-status/ URL pattern
        // Otherwise the URL change triggers mode=false and breaks navigation
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

  // Stable callbacks for ResultsTab - always switch to view tab to show sidebar with navigation
  // Skip fly animation when selecting from Results to preserve map view (except in MTB mode where we want to fly to the trail)
  const handleResultsSelectDestination = useCallback((poi, mtbContext) => {
    if (isInMtbMode && poi) {
      const slug = generateSlug(poi.name);

      // If MTB context is provided, set up navigation
      if (mtbContext) {
        setMtbTrailsList(mtbContext.trailsList);
        setCurrentMtbIndex(mtbContext.currentIndex);
        setSelectedFromMtbList(true);
      }

      // Set flag FIRST to prevent browser nav effect from clearing POI
      isProgrammaticNavigationRef.current = true;

      // Explicitly allow fly animation
      skipNextFlyRef.current = false;

      // Switch to view tab first, THEN set destination after a delay
      // This ensures the map container is visible (zIndex=1) before flyTo is called
      setActiveTab('view');
      setSelectedFromMtbList(true);
      document.title = `${poi.name} | Roots of The Valley`;

      // MTB mode: only show MTB trailheads, hide trails and rivers
      setVisibleTypes(new Set(['mtb-trailhead']));
      setShowTrails(false);
      setShowRivers(false);

      // Wait for tab to render and map to be ready, then set destination to trigger zoom
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        setTimeout(() => {
          setSelectedDestination(poi);
          setSelectedLinearFeature(null);
          setNewPOI(null);
          setPreviewCoords(null);

          // Update navigation index
          const index = poiNavigationList.findIndex(p => !p._isLinear && String(p.id) === String(poi.id));
          setCurrentPoiIndex(index);

          // Navigate after setting destination
          setTimeout(() => {
            navigate(`/mtb-trail-status/${slug}`);
          }, 100);
        }, 100); // Delay to let map visibility handler complete
      });
    } else if (isInOrganizationsMode && poi) {
      // Organizations mode - preserve /organizations/ URL pattern
      const slug = generateSlug(poi.name);

      // Set flag to prevent browser nav effect from clearing POI
      isProgrammaticNavigationRef.current = true;

      // No fly animation for organizations (they're virtual, no map location)
      skipNextFlyRef.current = true;

      // Set destination and switch to view tab
      setSelectedDestination(poi);
      setSelectedLinearFeature(null);
      setNewPOI(null);
      setPreviewCoords(null);
      setActiveTab('view');
      document.title = `${poi.name} | Roots of The Valley`;

      // Organizations mode: restore all POI types and show trails/rivers
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

      // Update navigation index
      const index = poiNavigationList.findIndex(p => !p._isLinear && String(p.id) === String(poi.id));
      setCurrentPoiIndex(index);

      // Navigate to organizations URL pattern
      navigate(`/organizations/${slug}`);
    } else {
      // Normal mode - skip fly to preserve map view
      skipNextFlyRef.current = true;
      handleSelectDestination(poi);
      setSelectedFromMtbList(false);
      setActiveTab('view');
    }
  }, [handleSelectDestination, isInMtbMode, isInOrganizationsMode, navigate, poiNavigationList, iconConfig]);

  const handleResultsSelectLinearFeature = useCallback((poi, mtbContext) => {
    if (isInMtbMode && poi) {
      const slug = generateSlug(poi.name);

      // If MTB context is provided, set up navigation
      if (mtbContext) {
        setMtbTrailsList(mtbContext.trailsList);
        setCurrentMtbIndex(mtbContext.currentIndex);
        setSelectedFromMtbList(true);
      }

      // Set flag FIRST to prevent browser nav effect from clearing POI
      isProgrammaticNavigationRef.current = true;

      // CRITICAL: If this trail isn't in linearFeatures yet (MTB trails are fetched separately),
      // add it so the map can work with it
      if (!linearFeatures.find(f => String(f.id) === String(poi.id))) {
        setLinearFeatures(prev => [...prev, poi]);
      }

      // Explicitly allow fly animation
      skipNextFlyRef.current = false;

      // Switch to view tab first, THEN set linear feature after a brief delay
      // This ensures the map container is visible (zIndex=1) before any map operations
      setActiveTab('view');
      if (!mtbContext) {
        setSelectedFromMtbList(true);
      }
      document.title = `${poi.name} | Roots of The Valley`;

      // MTB mode: only show MTB trailheads, hide trails and rivers
      setVisibleTypes(new Set(['mtb-trailhead']));
      setShowTrails(false);
      setShowRivers(false);

      // Wait for tab to render, then set linear feature
      setTimeout(() => {
        setSelectedLinearFeature(poi);
        setSelectedDestination(null);
        setNewPOI(null);
        setPreviewCoords(null);

        // Update navigation index - will be set by the effect after linearFeatures updates
        setCurrentPoiIndex(-1);

        // Navigate after setting linear feature
        setTimeout(() => {
          navigate(`/mtb-trail-status/${slug}`);
        }, 100);
      }, 50); // Small delay to let tab switch complete
    } else {
      // Normal mode - skip fly to preserve map view
      skipNextFlyRef.current = true;
      handleSelectLinearFeature(poi);
      setSelectedFromMtbList(false);
      setActiveTab('view');
    }
  }, [handleSelectLinearFeature, isInMtbMode, navigate, linearFeatures]);

  // Handle linear feature update - merge instead of replace to preserve geometry
  const handleLinearFeatureUpdate = (updatedFeature) => {
    setLinearFeatures(prev =>
      prev.map(f => f.id === updatedFeature.id ? { ...f, ...updatedFeature } : f)
    );
    if (selectedLinearFeature?.id === updatedFeature.id) {
      setSelectedLinearFeature(prev => ({ ...prev, ...updatedFeature }));
    }
  };

  // Handle linear feature deletion
  const handleLinearFeatureDelete = (deletedId) => {
    setLinearFeatures(prev => prev.filter(f => f.id !== deletedId));
    if (selectedLinearFeature?.id === deletedId) {
      setSelectedLinearFeature(null);
    }
  };

  // Start creating a new POI at given coordinates
  const handleStartNewPOI = (coords) => {
    // Clear any existing selection
    setSelectedDestination(null);
    // Create temporary POI object
    setNewPOI({
      id: 'new-temp',
      name: '',
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

  // Cancel new POI creation
  const handleCancelNewPOI = () => {
    setNewPOI(null);
    setPreviewCoords(null);
  };

  // Start creating a new organization with found POIs
  const handleStartNewOrganization = (poisInBounds) => {
    // Clear any existing selection
    setSelectedDestination(null);
    setSelectedLinearFeature(null);
    setNewPOI(null);
    setPreviewCoords(null);

    // Create temporary organization object with found POIs
    setNewOrganization({
      id: 'new-org-temp',
      name: '',
      brief_description: '',
      property_owner: '',
      more_info_link: '',
      events_url: '',
      news_url: '',
      poi_type: 'point',
      poi_roles: ['organization'],
      _poisInBounds: poisInBounds,
      _selectedPoiIds: new Set(poisInBounds.map(p => p.id))
    });
  };

  // Cancel new organization creation
  const handleCancelNewOrganization = () => {
    setNewOrganization(null);
  };

  // Save new POI
  const handleSaveNewPOI = async (poiData) => {
    const response = await fetch('/api/admin/destinations', {
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

  // Save new organization
  const handleSaveNewOrganization = async (organizationData, selectedPoiIds) => {
    // Create virtual POI
    const virtualPoiResponse = await fetch('/api/admin/pois', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: organizationData.name,
        brief_description: organizationData.brief_description,
        property_owner: organizationData.property_owner,
        more_info_link: organizationData.more_info_link,
        poi_type: 'point',
        poi_roles: ['organization']
      })
    });

    if (!virtualPoiResponse.ok) {
      const error = await virtualPoiResponse.json();
      throw new Error(error.error || 'Failed to create organization');
    }

    const virtualPoi = await virtualPoiResponse.json();

    // Create associations
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

    // Refresh data
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
      // Create associations for all POIs found in the rectangle
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

      // Refresh associations data
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

  return (
    <div className="app">
      <header className={`header ${activeTheme ? `theme-${activeTheme}` : ''} ${isNightMode ? 'theme-night' : ''}`}>
        {activeTheme && videoUrls[activeTheme] && (
          <video
            key={activeTheme}
            className="theme-video"
            autoPlay
            loop
            muted
            playsInline
            src={videoUrls[activeTheme]}
            onLoadedData={(e) => { e.target.playbackRate = 0.7; }}
          />
        )}
        <div className="header-content-wrapper">
          <div className="header-left" onClick={() => handleTabChange('view')} style={{ cursor: 'pointer' }}>
            <h1>Roots of The Valley</h1>
            <span className="subtitle">Explore Cuyahoga Valley&apos;s History</span>
          </div>
          <nav className="header-tabs">
          <button
            className={`tab-btn ${activeTab === 'view' ? 'active' : ''}`}
            onClick={() => handleTabChange('view')}
          >
            View
          </button>
          <button
            className={`tab-btn ${activeTab === 'results' ? 'active' : ''}`}
            onClick={() => handleTabChange('results')}
          >
            Results
          </button>
          <button
            className={`tab-btn ${activeTab === 'news' ? 'active' : ''}`}
            onClick={() => handleTabChange('news')}
          >
            News
          </button>
          <button
            className={`tab-btn ${activeTab === 'events' ? 'active' : ''}`}
            onClick={() => handleTabChange('events')}
          >
            Events
          </button>
          {isAdmin && (
            <button
              className={`tab-btn ${activeTab === 'edit' ? 'active' : ''}`}
              onClick={() => handleTabChange('edit')}
            >
              Edit
            </button>
          )}
          {isAuthenticated && (
            <button
              className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => handleTabChange('settings')}
            >
              Settings
            </button>
          )}

          {/* Login/Account tab */}
          {isAuthenticated ? (
            <div className="tab-account-container">
              <button
                className="tab-btn tab-account"
                onClick={() => setShowUserDropdown(!showUserDropdown)}
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
                  <div className="tab-dropdown user-dropdown-inline">
                    <div className="user-info-inline">
                      <span className="user-name-inline">{user?.name}</span>
                      <span className="user-email-inline">{user?.email}</span>
                      {isAdmin && <span className="admin-badge-inline">Admin</span>}
                    </div>
                    <button
                      className="dropdown-item-inline"
                      onClick={() => {
                        setShowUserDropdown(false);
                        logout();
                      }}
                    >
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="tab-account-container">
              <button
                className="tab-btn"
                onClick={() => setShowLoginDropdown(!showLoginDropdown)}
              >
                Login
              </button>
              {showLoginDropdown && (
                <>
                  <div className="tab-dropdown-backdrop" onClick={() => setShowLoginDropdown(false)} />
                  <div className="tab-dropdown login-dropdown-inline">
                    <button className="oauth-btn-inline google-btn" onClick={loginWithGoogle}>
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Continue with Google
                    </button>
                    <button className="oauth-btn-inline facebook-btn" onClick={loginWithFacebook}>
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                      Continue with Facebook
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          </nav>
        </div>
      </header>

      {/* Results tab content - only render when active to avoid processing 300+ tiles on every re-render */}
      {activeTab === 'results' && (
        <main className="main-content-full">
          <ResultsTab
            viewportFilteredDestinations={viewportFilteredDestinations}
            viewportFilteredLinearFeatures={viewportFilteredLinearFeatures}
            viewportFilteredVirtualPois={viewportFilteredVirtualPois}
            allDestinations={destinations}
            allLinearFeatures={linearFeatures}
            allVirtualPois={virtualPois}
            selectedDestination={selectedDestination}
            selectedLinearFeature={selectedLinearFeature}
            onSelectDestination={handleResultsSelectDestination}
            onSelectLinearFeature={handleResultsSelectLinearFeature}
            mapState={mapState}
            boundsToFit={boundsToFit}
            cachedMtbBoundsRef={cachedMtbBoundsRef}
            onMapClick={() => setActiveTab('view')}
            initialShowMtbOnly={initialShowMtbOnly}
            initialShowOrganizationsOnly={isInOrganizationsMode}
            onFilterByTypes={handleFilterByTypes}
            bypassViewportFilter={bypassViewportFilter}
            visiblePoiCount={visiblePoiCount}
            iconConfig={iconConfig}
          />
        </main>
      )}

      {/* News tab content */}
      {activeTab === 'news' && (
        <main className="main-content-full" style={{ display: 'flex', flexDirection: 'column' }}>
          <ParkNews
          isAdmin={isAdmin}
          filteredDestinations={viewportFilteredDestinations}
          filteredLinearFeatures={viewportFilteredLinearFeatures}
          filteredVirtualPois={viewportFilteredVirtualPois}
          mapState={mapState}
          linearFeatures={linearFeatures}
          refreshTrigger={newsRefreshTrigger}
          bypassViewportFilter={bypassViewportFilter}
          visiblePoiCount={visiblePoiCount}
          onMapClick={() => setActiveTab('view')}
          onSelectPoi={(poiId) => {
            const poi = destinations.find(d => d.id === poiId);
            if (poi) {
              setSelectedDestination(poi);
              setActiveTab('view');
            }
          }}
          onEditNewsItem={(newsId, newsTitle) => {
            setModerationFocusId(newsId);
            setModerationFocusTitle(newsTitle || null);
            setActiveTab('settings');
            setSettingsTab('moderation');
          }}
        />
        </main>
      )}

      {/* Events tab content */}
      {activeTab === 'events' && (
        <main className="main-content-full" style={{ display: 'flex', flexDirection: 'column' }}>
          <ParkEvents
          isAdmin={isAdmin}
          filteredDestinations={viewportFilteredDestinations}
          filteredLinearFeatures={viewportFilteredLinearFeatures}
          filteredVirtualPois={viewportFilteredVirtualPois}
          mapState={mapState}
          linearFeatures={linearFeatures}
          refreshTrigger={newsRefreshTrigger}
          bypassViewportFilter={bypassViewportFilter}
          visiblePoiCount={visiblePoiCount}
          onMapClick={() => setActiveTab('view')}
          onSelectPoi={(poiId) => {
            const poi = destinations.find(d => d.id === poiId);
            if (poi) {
              setSelectedDestination(poi);
              setActiveTab('view');
            }
          }}
        />
        </main>
      )}


      {activeTab === 'settings' && (
        <main className="settings-content">
          <div className="settings-panel">
            {isAdmin ? (
            <>
            <nav className="settings-tabs">
              <button
                className={`settings-tab-btn ${settingsTab === 'general' ? 'active' : ''}`}
                onClick={() => setSettingsTab('general')}
              >
                General
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'newsletter' ? 'active' : ''}`}
                onClick={() => setSettingsTab('newsletter')}
              >
                Newsletter
              </button>
            </nav>
            <nav className="settings-tabs settings-tabs-row2">
              <button
                className={`settings-tab-btn ${settingsTab === 'users' ? 'active' : ''}`}
                onClick={() => setSettingsTab('users')}
              >
                Users
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'themes' ? 'active' : ''}`}
                onClick={() => setSettingsTab('themes')}
              >
                Themes
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'activities' ? 'active' : ''}`}
                onClick={() => setSettingsTab('activities')}
              >
                Activities
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'eras' ? 'active' : ''}`}
                onClick={() => setSettingsTab('eras')}
              >
                Eras
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'surfaces' ? 'active' : ''}`}
                onClick={() => setSettingsTab('surfaces')}
              >
                Surfaces
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'icons' ? 'active' : ''}`}
                onClick={() => setSettingsTab('icons')}
              >
                Icons
              </button>
            </nav>
            <nav className="settings-tabs settings-tabs-row3">
              <button
                className={`settings-tab-btn ${settingsTab === 'moderation' ? 'active' : ''}`}
                onClick={() => setSettingsTab('moderation')}
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
                onClick={() => setSettingsTab('jobs')}
              >
                Jobs
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'dataCollection' ? 'active' : ''}`}
                onClick={() => setSettingsTab('dataCollection')}
              >
                Data Collection
              </button>
              <button
                className={`settings-tab-btn ${settingsTab === 'google' ? 'active' : ''}`}
                onClick={() => setSettingsTab('google')}
              >
                Google
              </button>
            </nav>

            <div className="settings-tab-content">
              {settingsTab === 'general' && <GeneralSettings />}
              {settingsTab === 'themes' && <ThemesSettings />}
              {settingsTab === 'activities' && <ActivitiesSettings />}
              {settingsTab === 'eras' && <ErasSettings />}
              {settingsTab === 'surfaces' && <SurfacesSettings />}
              {settingsTab === 'icons' && <IconsSettings />}
              {settingsTab === 'dataCollection' && <DataCollectionSettings />}
              {settingsTab === 'moderation' && <ModerationInbox onCountChange={refreshModerationCount} focusItemId={moderationFocusId} focusItemTitle={moderationFocusTitle} />}
              {settingsTab === 'jobs' && <JobsDashboard expandTarget={jobsExpandTarget} onExpandTargetConsumed={() => setJobsExpandTarget(null)} />}
              {settingsTab === 'google' && (
                <div className="google-integration-tab">
                  <SyncSettings onDataRefresh={refreshAllData} onNavigateToJobs={(jobId) => { setJobsExpandTarget(jobId); setSettingsTab('jobs'); }} />
                  <div className="settings-divider"></div>
                  <AISettings />
                </div>
              )}
              {settingsTab === 'users' && <UsersSettings />}
              {settingsTab === 'newsletter' && <NewsletterSettings user={user} />}
            </div>
            </>
            ) : (
              <UserSettings user={user} />
            )}
          </div>
        </main>
      )}

      {/* Map content - always mounted and visible to Leaflet, layered below Results tab when not active */}
      <main
        className={`main-content ${editMode ? 'edit-mode' : ''}`}
        style={{
          display: 'flex',
          zIndex: (activeTab === 'view' || activeTab === 'edit') ? '1' : '-1',
          pointerEvents: (activeTab === 'view' || activeTab === 'edit') ? 'auto' : 'none'
        }}
      >
        <Map
          destinations={filteredDestinations}
          selectedDestination={selectedDestination}
          onSelectDestination={handleSelectDestination}
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
          selectedLinearFeature={selectedLinearFeature}
          onSelectLinearFeature={handleSelectLinearFeature}
          visibleTypes={visibleTypes}
          onVisibleTypesChange={setVisibleTypes}
          onVisiblePoisChange={setVisiblePoiIds}
          onMapStateChange={setMapState}
          showNpsMap={showNpsMap}
          onToggleNpsMap={setShowNpsMap}
          showTrails={showTrails}
          onToggleTrails={setShowTrails}
          showRivers={showRivers}
          onToggleRivers={setShowRivers}
          visibleBoundaries={visibleBoundaries}
          onToggleBoundary={(id) => setVisibleBoundaries(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
              next.delete(id);
            } else {
              next.add(id);
            }
            return next;
          })}
          onShowAllBoundaries={() => {
            const boundaryIds = linearFeatures.filter(f => f.feature_type === 'boundary').map(f => f.id);
            setVisibleBoundaries(new Set(boundaryIds));
          }}
          onHideAllBoundaries={() => setVisibleBoundaries(new Set())}
          searchQuery={activeFilters.search}
          onSearchChange={(value) => handleFilterChange('search', value)}
          onNewsRefresh={() => setNewsRefreshTrigger(prev => prev + 1)}
          skipFlyRef={skipNextFlyRef}
          boundsToFit={boundsToFit}
          visiblePoiCount={visiblePoiCount}
          iconConfig={iconConfig}
          isDrawingAssociations={isDrawingAssociations}
          addingAssociationsToOrgId={addingAssociationsToOrgId}
          onAddAssociationsFromDrawing={handleAddAssociationsFromDrawing}
          onCancelDrawingAssociations={() => {
            setIsDrawingAssociations(false);
            setAddingAssociationsToOrgId(null);
          }}
        />

        <Sidebar
          destination={newPOI || newOrganization || selectedDestination}
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

            // Select the next/previous trail
            if (nextTrail.poi_roles?.includes('point') || nextTrail.poi_type === 'point') {
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
            setActiveTab('results');
            // Navigate back to MTB trails list
            isProgrammaticNavigationRef.current = true;
            navigate('/mtb-trail-status');
          }}
          isAdmin={isAdmin}
          user={user}
          editMode={editMode}
          onDestinationUpdate={handleDestinationUpdate}
          onDestinationDelete={handleDestinationDelete}
          onSaveNewPOI={handleSaveNewPOI}
          onCancelNewPOI={handleCancelNewPOI}
          onSaveNewOrganization={handleSaveNewOrganization}
          onCancelNewOrganization={handleCancelNewOrganization}
          previewCoords={previewCoords}
          onPreviewCoordsChange={setPreviewCoords}
          linearFeature={selectedLinearFeature}
          onLinearFeatureUpdate={handleLinearFeatureUpdate}
          onLinearFeatureDelete={handleLinearFeatureDelete}
          onNavigate={handleNavigatePoi}
          currentIndex={currentPoiIndex}
          totalCount={poiNavigationList.length}
          poiNavigationList={poiNavigationList}
          associations={associations}
          allDestinations={destinations}
          allLinearFeatures={linearFeatures}
          allVirtualPois={virtualPois}
          onSelectDestination={handleSelectDestination}
          onSelectLinearFeature={handleSelectLinearFeature}
          onAssociationsChanged={refreshAllData}
          onStartDrawingAssociations={handleStartDrawingAssociations}
          showNpsMap={showNpsMap}
          onToggleNpsMap={setShowNpsMap}
        />
      </main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
