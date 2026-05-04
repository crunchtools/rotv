import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDateWithWeekday, EventTypeIcon } from './NewsEventsShared';
import ShareButton from './ShareButton';

function generateSlug(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function EventPermalink({ poiSlug, titleSlug }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`/api/events/${poiSlug}/${titleSlug}`)
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Event not found' : 'Failed to load');
        return res.json();
      })
      .then(data => { setItem(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [poiSlug, titleSlug]);

  if (loading) {
    return (
      <div className="permalink-page">
        <div className="permalink-loading">Loading...</div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="permalink-page">
        <div className="permalink-error">
          <h2>{error || 'Event not found'}</h2>
          <p>This event may have been removed or the link may be incorrect.</p>
          <button onClick={() => navigate('/')} className="permalink-back-btn">
            Back to Map
          </button>
        </div>
      </div>
    );
  }

  const permalinkUrl = `/events/${poiSlug}/${titleSlug}`;

  return (
    <div className="permalink-page">
      <div className="permalink-card">
        <div className="permalink-nav">
          <button onClick={() => navigate('/')} className="permalink-back-btn">
            &larr; Back to Map
          </button>
        </div>

        <div className="permalink-header">
          <EventTypeIcon type={item.event_type} />
          <h1 className="permalink-title">{item.title}</h1>
        </div>

        {item.poi_name && (
          <button
            className="permalink-poi-link"
            onClick={() => navigate(`/?poi=${generateSlug(item.poi_name)}`)}
          >
            {item.poi_name}
          </button>
        )}

        <div className="permalink-meta">
          {item.start_date && (
            <span className="permalink-date">{formatDateWithWeekday(item.start_date)}</span>
          )}
          {item.end_date && item.end_date.substring(0, 10) !== item.start_date?.substring(0, 10) && (
            <span className="permalink-date"> &ndash; {formatDateWithWeekday(item.end_date)}</span>
          )}
          {item.location_details && (
            <span className="permalink-location">{item.location_details}</span>
          )}
        </div>

        {item.description && <p className="permalink-summary">{item.description}</p>}

        <div className="permalink-actions">
          {item.source_url && (
            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="permalink-read-more">
              View original &rarr;
            </a>
          )}
          <ShareButton
            title={item.title}
            text={item.description || ''}
            url={permalinkUrl}
          />
        </div>
      </div>
    </div>
  );
}
