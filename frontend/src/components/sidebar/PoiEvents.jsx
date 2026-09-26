import { useNavigate } from 'react-router-dom';
import { formatPublicationDate } from '../NewsEventsShared';
import { generateSlug } from './helpers';
import usePoiContentList from '../../hooks/usePoiContentList';

function PoiEvents({ poiId, poiName, isAdmin, editMode, onCountChange, onSelectEvent, navigateOnSelect = true }) {
  const navigate = useNavigate();
  const tz = localStorage.getItem('app-timezone')
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'America/New_York';
  const {
    items: events, loading, deleting, collecting, error,
    handleCollect: handleCollectEvents, handleDelete
  } = usePoiContentList({ poiId, kind: 'events', listUrl: `/api/pois/${poiId}/events?limit=50&tz=${encodeURIComponent(tz)}`, onCountChange });


  if (loading) return <div className="sidebar-tab-loading">Loading events...</div>;

  return (
    <div className="poi-events-list">
      {isAdmin && editMode && (
        <div className="poi-tab-actions">
          <button
            className="refresh-content-btn"
            onClick={handleCollectEvents}
            disabled={collecting}
          >
            {collecting ? '🔄 Searching...' : `🔍 Refresh Events${events.length > 0 ? ` (${events.length})` : ''}`}
          </button>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="poi-events-list-content">
        {events.length === 0 ? (
          <div className="sidebar-tab-empty">No upcoming events for this location.</div>
        ) : events.map(item => (
        <div key={item.id} className={`poi-event-item ${item.event_type || 'program'}`}
             onClick={() => {
               // Rolled-up items belong to a contained/owned POI — link to that POI's permalink (#406)
               const sourceName = item.poi_name || poiName;
               if (!sourceName) return;
               const poiSlug = generateSlug(sourceName);
               const titleSlug = generateSlug(item.title);
               if (navigateOnSelect) navigate(`/${poiSlug}/events/${titleSlug}`);
               if (onSelectEvent) onSelectEvent({ type: 'event', poiSlug, titleSlug });
             }}
             style={{ cursor: 'pointer' }}>
          <div className="poi-event-header">
            <span className="poi-event-title">{item.title}</span>
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
          <div className="poi-event-date">
            {formatPublicationDate(item.start_date)}
            {item.end_date && String(item.end_date).substring(0, 10) !== String(item.start_date).substring(0, 10) && (
              <> - {formatPublicationDate(item.end_date)}</>
            )}
          </div>
          {item.description && <p className="poi-event-description">{item.description}</p>}
          {item.location_details && (
            <div className="poi-event-location">
              <strong>Location:</strong> {item.location_details}
            </div>
          )}
          {item.poi_name && Number(item.poi_id) !== Number(poiId) && (
            <div className="poi-event-meta">
              <span className="poi-item-source">📍 {item.poi_name}</span>
            </div>
          )}
        </div>
        ))}
      </div>
    </div>
  );
}

export default PoiEvents;
