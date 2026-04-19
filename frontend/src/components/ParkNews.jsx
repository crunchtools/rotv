import React, { useState, useEffect, useRef } from 'react';
import MapThumbnail from './MapThumbnail';
import { NewsCardBody } from './NewsEventsShared';

// Default park bounds - show full park view in mini map
const DEFAULT_PARK_BOUNDS = [
  [41.13, -81.85],  // Southwest corner
  [41.45, -81.50]   // Northeast corner
];

function ParkNews({ isAdmin, onSelectPoi, onEditNewsItem, filteredDestinations, filteredLinearFeatures, filteredVirtualPois, mapState, onMapClick, refreshTrigger, bypassViewportFilter, visiblePoiCount }) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const stableBoundsRef = useRef(DEFAULT_PARK_BOUNDS);
  const [searchText, setSearchText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 50;
  const [typeFilters, setTypeFilters] = useState({
    general: true,
    alert: true,
    wildlife: true,
    infrastructure: true,
    community: true
  });

  useEffect(() => {
    fetchNews();
  }, [refreshTrigger]);

  const fetchNews = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/news/recent');
      if (response.ok) {
        const data = await response.json();
        setNews(data);
      } else {
        setError('Failed to load news');
      }
    } catch (err) {
      setError('Failed to load news');
      console.error('Error fetching park news:', err);
    } finally {
      setLoading(false);
    }
  };

  // Simple, direct bounds computation - matches ResultsTab pattern
  let currentBounds;
  if (bypassViewportFilter) {
    // Bypass mode: use default park bounds constant (e.g., after returning from single POI view)
    currentBounds = DEFAULT_PARK_BOUNDS;
  } else {
    // Normal mode: use current viewport bounds
    currentBounds = mapState?.bounds || DEFAULT_PARK_BOUNDS;
  }

  // Only update stable ref if coordinates actually changed
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

  // Filter news based on visible POIs (destinations, linear features, and organizations)
  const filteredNews = React.useMemo(() => {
    const hasDestinations = Array.isArray(filteredDestinations);
    const hasLinearFeatures = Array.isArray(filteredLinearFeatures);
    const hasVirtualPois = Array.isArray(filteredVirtualPois);

    // Start with all news or filter by visible POIs
    let filtered = news;

    // If all filters are explicitly empty arrays, show no news (all filters deselected)
    if (hasDestinations && filteredDestinations.length === 0 &&
        hasLinearFeatures && filteredLinearFeatures.length === 0 &&
        hasVirtualPois && filteredVirtualPois.length === 0) {
      filtered = [];
    }

    // Apply text search filter
    if (searchText.trim()) {
      const search = searchText.toLowerCase();
      filtered = filtered.filter(item =>
        (item.title || '').toLowerCase().includes(search) ||
        (item.summary || '').toLowerCase().includes(search) ||
        (item.poi_name || '').toLowerCase().includes(search)
      );
    }

    // Apply type filter (unknown types default to visible)
    filtered = filtered.filter(item => typeFilters[item.news_type || 'general'] !== false);

    return filtered;
  }, [news, filteredDestinations, filteredLinearFeatures, filteredVirtualPois, searchText, typeFilters]);

  const totalPages = Math.ceil(filteredNews.length / PAGE_SIZE);
  const paginatedNews = filteredNews.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  if (loading) {
    return (
      <div className="park-news-tab">
        <h2>Park News</h2>
        <div className="loading-indicator">Loading news...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="park-news-tab">
        <h2>Park News</h2>
        <div className="error-message">{error}</div>
      </div>
    );
  }

  return (
    <div className="park-news-tab">
      <div className="news-events-header">
        <h2>Park News</h2>
        <p className="tab-subtitle">Recent news from across Cuyahoga Valley National Park</p>
      </div>

      <div className="results-filters">
        <input
          type="text"
          className="results-search-input"
          placeholder="Search news by title, summary, or location..."
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setCurrentPage(1); }}
        />
        <div className="results-type-filters">
          {[
            { key: 'general', icon: 'N', label: 'General' },
            { key: 'alert', icon: '!', label: 'Alert' },
            { key: 'wildlife', icon: 'W', label: 'Wildlife' },
            { key: 'infrastructure', icon: 'I', label: 'Infrastructure' },
            { key: 'community', icon: 'M', label: 'Community' },
          ].map(f => (
            <div
              key={f.key}
              className={`type-filter-chip ${f.key} ${typeFilters[f.key] ? 'active' : 'inactive'}`}
              onClick={() => { setTypeFilters(prev => ({ ...prev, [f.key]: !prev[f.key] })); setCurrentPage(1); }}
            >
              <span className="type-filter-icon">{f.icon}</span>
              {f.label}
            </div>
          ))}
        </div>
        <div className="results-count">
          Showing {filteredNews.length === 0 ? '0' : `${((currentPage - 1) * PAGE_SIZE) + 1}-${Math.min(currentPage * PAGE_SIZE, filteredNews.length)}`} of {filteredNews.length} news items
        </div>
      </div>

      <div className="news-events-layout">
        <div className="news-events-content">
          {filteredNews.length === 0 ? (
            <p className="no-content">
              {news.length > 0
                ? 'No news matches the current filters. Try adjusting the type filters above or the map view.'
                : 'No recent news available.'}
            </p>
          ) : (
          <div className="park-news-list">
        {paginatedNews.map(item => (
          <NewsCardBody
            key={item.id}
            item={item}
            onSelectPoi={onSelectPoi}
          />
        ))}
          </div>
          )}
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
        {/* Map thumbnail sidebar */}
        {mapState && (
          <div className="map-thumbnail-sidebar">
            <MapThumbnail
              bounds={thumbnailBounds}
              aspectRatio={mapState.aspectRatio || 1.5}
              visibleDestinations={filteredDestinations}
              onClick={onMapClick}
              poiCount={visiblePoiCount}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default ParkNews;
