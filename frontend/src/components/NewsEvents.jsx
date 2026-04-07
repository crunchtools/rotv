import React, { useState, useEffect } from 'react';
import { formatPublicationDate, NewsTypeIcon, EventTypeIcon } from './NewsEventsShared';

function NewsEvents({ poiId, isAdmin }) {
  const [news, setNews] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('news');
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (!poiId) return;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const [newsRes, eventsRes] = await Promise.all([
          fetch(`/api/pois/${poiId}/news?limit=10`),
          fetch(`/api/pois/${poiId}/events`)
        ]);

        if (newsRes.ok) {
          const newsData = await newsRes.json();
          setNews(newsData);
        }

        if (eventsRes.ok) {
          const eventsData = await eventsRes.json();
          setEvents(eventsData);
        }
      } catch (err) {
        setError('Failed to load news and events');
        console.error('Error fetching news/events:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [poiId]);

  const handleDeleteNews = async (newsId) => {
    if (!confirm('Delete this news item?')) return;

    setDeleting(`news-${newsId}`);
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

  const handleDeleteEvent = async (eventId) => {
    if (!confirm('Delete this event?')) return;

    setDeleting(`event-${eventId}`);
    try {
      const response = await fetch(`/api/admin/events/${eventId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        setEvents(prev => prev.filter(e => e.id !== eventId));
      } else {
        alert('Failed to delete event');
      }
    } catch (err) {
      console.error('Error deleting event:', err);
      alert('Failed to delete event');
    } finally {
      setDeleting(null);
    }
  };

  // Don't render anything if no news and no events
  if (!loading && news.length === 0 && events.length === 0) {
    return null;
  }

  if (loading) {
    return (
      <div className="section news-events-section">
        <h3>News & Events</h3>
        <div className="loading-indicator">Loading...</div>
      </div>
    );
  }

  if (error) {
    return null;
  }

  const hasNews = news.length > 0;
  const hasEvents = events.length > 0;

  return (
    <div className="section news-events-section">
      <div className="news-events-tabs">
        {hasNews && (
          <button
            className={`tab-btn ${activeTab === 'news' ? 'active' : ''}`}
            onClick={() => setActiveTab('news')}
          >
            News ({news.length})
          </button>
        )}
        {hasEvents && (
          <button
            className={`tab-btn ${activeTab === 'events' ? 'active' : ''}`}
            onClick={() => setActiveTab('events')}
          >
            Events ({events.length})
          </button>
        )}
      </div>

      {activeTab === 'news' && hasNews && (
        <div className="news-list">
          {news.map(item => (
            <div key={item.id} className={`news-item ${item.news_type || 'general'}`}>
              <div className="news-header">
                <NewsTypeIcon type={item.news_type} />
                <span className="news-title">{item.title}</span>
                {isAdmin && (
                  <button
                    className="news-delete-btn"
                    onClick={() => handleDeleteNews(item.id)}
                    disabled={deleting === `news-${item.id}`}
                    title="Delete this news item"
                  >
                    {deleting === `news-${item.id}` ? '...' : '×'}
                  </button>
                )}
              </div>
              {item.summary && <p className="news-summary">{item.summary}</p>}
              <div className="news-meta">
                {item.source_name && <span className="news-source">{item.source_name}</span>}
                {item.published_at && <span className="news-date">{formatPublicationDate(item.published_at)}</span>}
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

      {activeTab === 'events' && hasEvents && (
        <div className="events-list">
          {events.map(item => (
            <div key={item.id} className={`event-item ${item.event_type || 'program'}`}>
              <div className="event-header">
                <EventTypeIcon type={item.event_type} />
                <span className="event-title">{item.title}</span>
                {isAdmin && (
                  <button
                    className="news-delete-btn"
                    onClick={() => handleDeleteEvent(item.id)}
                    disabled={deleting === `event-${item.id}`}
                    title="Delete this event"
                  >
                    {deleting === `event-${item.id}` ? '...' : '×'}
                  </button>
                )}
              </div>
              <div className="event-date">
                {formatPublicationDate(item.start_date)}
                {item.end_date && item.end_date !== item.start_date && (
                  <> - {formatPublicationDate(item.end_date)}</>
                )}
              </div>
              {item.description && <p className="event-description">{item.description}</p>}
              {item.location_details && (
                <div className="event-location">
                  <span className="location-label">Location:</span> {item.location_details}
                </div>
              )}
              <div className="event-actions">
                {item.source_url && (
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="event-link"
                  >
                    More info
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NewsEvents;
