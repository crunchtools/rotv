import React, { useState, useEffect } from 'react';
import MapThumbnail from './MapThumbnail';
import { formatDate, NewsTypeIcon } from './NewsEventsShared';

// Default park bounds - show full park view in mini map
const DEFAULT_PARK_BOUNDS = [
  [41.13, -81.85],  // Southwest corner
  [41.45, -81.50]   // Northeast corner
];

function ParkNews({ isAdmin, onSelectPoi, filteredDestinations, filteredLinearFeatures, filteredVirtualPois, mapState, onMapClick, refreshTrigger }) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [typeFilters, setTypeFilters] = useState({
    closure: true,
    seasonal: true,
    maintenance: true,
    wildlife: true,
    general: true
  });

  useEffect(() => {
    fetchNews();
  }, [refreshTrigger]);

  const fetchNews = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/news/recent?limit=50');
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
    } else if (filteredDestinations || filteredLinearFeatures || filteredVirtualPois) {
      // Combine visible IDs from point destinations, linear features, and virtual POIs (organizations)
      const visiblePoiIds = new Set([
        ...(filteredDestinations || []).map(d => d.id),
        ...(filteredLinearFeatures || []).map(f => f.id),
        ...(filteredVirtualPois || []).map(v => v.id)
      ]);
      filtered = filtered.filter(item => visiblePoiIds.has(item.poi_id));
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

    // Apply type filter
    filtered = filtered.filter(item => typeFilters[item.news_type || 'general']);

    return filtered;
  }, [news, filteredDestinations, filteredLinearFeatures, filteredVirtualPois, searchText, typeFilters]);

  const handleDelete = async (newsId) => {
    if (!confirm('Delete this news item?')) return;

    setDeleting(newsId);
    try {
      const response = await fetch(`/api/admin/news/${newsId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        setNews(prev => prev.filter(n => n.id !== newsId));
      } else {
        alert('Failed to delete news item');
      }
    } catch (err) {
      console.error('Error deleting news:', err);
      alert('Failed to delete news item');
    } finally {
      setDeleting(null);
    }
  };

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
          onChange={(e) => setSearchText(e.target.value)}
        />
        <div className="results-type-filters">
          <div
            className={`type-filter-chip closure ${typeFilters.closure ? 'active' : 'inactive'}`}
            onClick={() => setTypeFilters(prev => ({ ...prev, closure: !prev.closure }))}
          >
            <span className="type-filter-icon">X</span>
            Closure
          </div>
          <div
            className={`type-filter-chip seasonal ${typeFilters.seasonal ? 'active' : 'inactive'}`}
            onClick={() => setTypeFilters(prev => ({ ...prev, seasonal: !prev.seasonal }))}
          >
            <span className="type-filter-icon">S</span>
            Seasonal
          </div>
          <div
            className={`type-filter-chip maintenance ${typeFilters.maintenance ? 'active' : 'inactive'}`}
            onClick={() => setTypeFilters(prev => ({ ...prev, maintenance: !prev.maintenance }))}
          >
            <span className="type-filter-icon">W</span>
            Maintenance
          </div>
          <div
            className={`type-filter-chip wildlife ${typeFilters.wildlife ? 'active' : 'inactive'}`}
            onClick={() => setTypeFilters(prev => ({ ...prev, wildlife: !prev.wildlife }))}
          >
            <span className="type-filter-icon">A</span>
            Wildlife
          </div>
          <div
            className={`type-filter-chip general ${typeFilters.general ? 'active' : 'inactive'}`}
            onClick={() => setTypeFilters(prev => ({ ...prev, general: !prev.general }))}
          >
            <span className="type-filter-icon">N</span>
            General
          </div>
        </div>
        <div className="results-count">
          Showing {filteredNews.length} of {news.length} news items
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
        {filteredNews.map(item => (
          <div key={item.id} className={`park-news-item ${item.news_type || 'general'}`}>
            <div className="park-news-header">
              <NewsTypeIcon type={item.news_type} />
              <div className="park-news-title-section">
                <span className="park-news-title">{item.title}</span>
                <button
                  className="park-news-poi-link"
                  onClick={() => onSelectPoi && onSelectPoi(item.poi_id)}
                  title={`View ${item.poi_name}`}
                >
                  {item.poi_name}
                </button>
              </div>
            </div>
            {item.summary && <p className="park-news-summary">{item.summary}</p>}
            <div className="park-news-meta">
              {item.source_name && <span className="news-source">{item.source_name}</span>}
              {item.published_at && <span className="news-date">{formatDate(item.published_at)}</span>}
              {item.source_url && (
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="news-link"
                >
                  Read more
                </a>
              )}
            </div>
          </div>
        ))}
          </div>
          )}
        </div>
        {/* Map thumbnail sidebar */}
        {mapState && (
          <div className="map-thumbnail-sidebar">
            <MapThumbnail
              bounds={DEFAULT_PARK_BOUNDS}
              aspectRatio={mapState.aspectRatio || 1.5}
              visibleDestinations={filteredDestinations}
              onClick={onMapClick}
              poiCount={(filteredDestinations?.length || 0) + (filteredLinearFeatures?.length || 0)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default ParkNews;
