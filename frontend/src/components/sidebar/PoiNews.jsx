import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatPublicationDate, NewsTypeIcon } from '../NewsEventsShared';
import { generateSlug } from './helpers';

function PoiNews({ poiId, poiName, isAdmin, editMode, onCountChange, onSelectNews }) {
  const navigate = useNavigate();
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [collecting, setCollecting] = useState(false);

  const fetchNews = async () => {
    if (!poiId) {
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/pois/${poiId}/news?limit=50`);
      if (response.ok) {
        const data = await response.json();
        setNews(data);
        if (onCountChange) onCountChange(data.length);
      } else {
        console.error(`[fetchNews] Request failed: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error('[fetchNews] Error fetching POI news:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiId]); // fetchNews intentionally excluded — re-fetch only on POI change, not on function reference churn

  const handleCollectNews = async () => {
    if (!poiId) return;
    setCollecting(true);

    try {
      const timezone = localStorage.getItem('app-timezone') || 'America/New_York';
      const response = await fetch(`/api/admin/pois/${poiId}/news/collect`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone })
      });

      if (response.ok) {
        const result = await response.json();
        const targetUrl = `/admin/jobs?job=${result.jobId}&type=${result.jobType}&poi=${result.poiId || result.jobId}`;
        navigate(targetUrl);
      } else {
        const error = await response.json();
        alert(`Collection failed: ${error.error || 'Unknown error'}`);
        setCollecting(false);
      }
    } catch (err) {
      alert(`Collection failed: ${err.message}`);
      setCollecting(false);
    }
  };

  const handleDelete = async (newsId) => {
    setDeleting(newsId);
    try {
      const response = await fetch(`/api/admin/news/${newsId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (response.ok) {
        setNews(prev => prev.filter(n => n.id !== newsId));
      }
    } catch (err) {
      console.error('Error deleting news:', err);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) return <div className="sidebar-tab-loading">Loading news...</div>;

  return (
    <div className="poi-news-list">
      {isAdmin && editMode && (
        <div className="poi-tab-actions">
          <button
            className="refresh-content-btn"
            onClick={handleCollectNews}
            disabled={collecting}
          >
            {collecting ? '🔄 Searching...' : `🔍 Refresh News${news.length > 0 ? ` (${news.length})` : ''}`}
          </button>
        </div>
      )}

      <div className="poi-news-list-content">
        {news.length === 0 ? (
          <div className="sidebar-tab-empty">No news for this location.</div>
        ) : news.map(item => (
        <div key={item.id} className={`poi-news-item ${item.news_type || 'general'}`}
             onClick={() => {
               if (!poiName) return;
               const poiSlug = generateSlug(poiName);
               const titleSlug = generateSlug(item.title);
               navigate(`/${poiSlug}/news/${titleSlug}`);
               if (onSelectNews) onSelectNews({ type: 'news', poiSlug, titleSlug });
             }}
             style={{ cursor: 'pointer' }}>
          <div className="poi-news-header">
            <NewsTypeIcon type={item.news_type} />
            <span className="poi-news-title">{item.title}</span>
            {isAdmin && editMode && (
              <button
                className="news-delete-btn"
                onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                disabled={deleting === item.id}
              >
                {deleting === item.id ? '...' : '×'}
              </button>
            )}
          </div>
          {(item.publication_date || item.collection_date) && (
            <div className="poi-event-date">
              {item.publication_date
                ? formatPublicationDate(item.publication_date)
                : new Date(item.collection_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' })}
            </div>
          )}
          {item.summary && <p className="poi-news-summary">{item.summary}</p>}
          <div className="poi-news-meta">
            {item.source_name && <span className="news-source">{item.source_name}</span>}
          </div>
        </div>
        ))}
      </div>
    </div>
  );
}

export default PoiNews;
