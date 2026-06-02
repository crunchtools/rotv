import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatPublicationDate } from '../NewsEventsShared';
import { generateSlug } from './helpers';

function PoiEvents({ poiId, poiName, isAdmin, editMode, onCountChange, onSelectEvent, navigateOnSelect = true }) {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [collecting, setCollecting] = useState(false);

  const fetchEvents = async () => {
    if (!poiId) return;
    setLoading(true);
    try {
      const tz = localStorage.getItem('app-timezone')
        || Intl.DateTimeFormat().resolvedOptions().timeZone
        || 'America/New_York';
      const response = await fetch(`/api/pois/${poiId}/events?limit=50&tz=${encodeURIComponent(tz)}`);
      if (response.ok) {
        const data = await response.json();
        setEvents(data);
        if (onCountChange) onCountChange(data.length);
      }
    } catch (err) {
      console.error('Error fetching POI events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiId]); // fetchEvents intentionally excluded — re-fetch only on POI change, not on function reference churn

  const handleCollectEvents = async () => {
    if (!poiId) return;
    setCollecting(true);

    try {
      const timezone = localStorage.getItem('app-timezone') || 'America/New_York';
      const response = await fetch(`/api/admin/pois/${poiId}/events/collect`, {
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

  const handleDelete = async (eventId) => {
    setDeleting(eventId);
    try {
      const response = await fetch(`/api/admin/events/${eventId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (response.ok) {
        setEvents(prev => prev.filter(e => e.id !== eventId));
      }
    } catch (err) {
      console.error('Error deleting event:', err);
    } finally {
      setDeleting(null);
    }
  };

  const createGoogleCalendarLink = (event, poiName) => {
    const title = encodeURIComponent(event.title);
    const description = encodeURIComponent(event.description || '');
    const location = encodeURIComponent(event.location_details || poiName || '');

    const formatForGoogle = (dateStr) => {
      if (!dateStr) return '';
      const [year, month, day] = dateStr.split('T')[0].split('-');
      return `${year}${month}${day}`;
    };

    const startDate = formatForGoogle(event.start_date);
    const endDate = formatForGoogle(event.end_date || event.start_date);

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDate}/${endDate}&details=${description}&location=${location}`;
  };

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
