import { useNavigate } from 'react-router-dom';
import { formatPublicationDate, NewsTypeIcon } from '../NewsEventsShared';
import { generateSlug } from './helpers';
import usePoiContentList from '../../hooks/usePoiContentList';

function PoiNews({ poiId, poiName, isAdmin, editMode, onCountChange, onSelectNews, navigateOnSelect = true }) {
  const navigate = useNavigate();
  const {
    items: news, loading, deleting, collecting, error,
    handleCollect: handleCollectNews, handleDelete
  } = usePoiContentList({ poiId, kind: 'news', listUrl: `/api/pois/${poiId}/news?limit=50`, onCountChange });


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

      {error && <div className="error-message">{error}</div>}

      <div className="poi-news-list-content">
        {news.length === 0 ? (
          <div className="sidebar-tab-empty">No news for this location.</div>
        ) : news.map(item => (
        <div key={item.id} className={`poi-news-item ${item.news_type || 'general'}`}
             onClick={() => {
               // Rolled-up items belong to a contained/owned POI — link to that POI's permalink (#406)
               const sourceName = item.poi_name || poiName;
               if (!sourceName) return;
               const poiSlug = generateSlug(sourceName);
               const titleSlug = generateSlug(item.title);
               if (navigateOnSelect) navigate(`/${poiSlug}/news/${titleSlug}`);
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
          {item.pipeline === 'historical' ? (
            // Historical News: the story's year matters, not when a page was posted (spec 044)
            <div className="poi-event-date">
              {/* Fix: no web publish date here — it would read as when the history happened (PR #623 review) */}
              <span className="poi-news-history-tag">History{item.story_year ? ` · ${item.story_year}` : ''}</span>
            </div>
          ) : (item.publication_date || item.collection_date) && (
            <div className="poi-event-date">
              {item.publication_date
                ? formatPublicationDate(item.publication_date)
                : new Date(item.collection_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' })}
            </div>
          )}
          {item.summary && <p className="poi-news-summary">{item.summary}</p>}
          <div className="poi-news-meta">
            {item.poi_name && Number(item.poi_id) !== Number(poiId) && (
              <span className="poi-item-source">📍 {item.poi_name}</span>
            )}
            {item.source_name && <span className="news-source">{item.source_name}</span>}
          </div>
        </div>
        ))}
      </div>
    </div>
  );
}

export default PoiNews;
