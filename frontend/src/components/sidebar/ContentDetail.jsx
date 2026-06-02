import { useState, useEffect } from 'react';
import { formatPublicationDate, NewsTypeIcon, EventTypeIcon } from '../NewsEventsShared';
import ShareButton from '../ShareButton';
import BackButton from '../BackButton';

function ContentDetail({ permalinkInfo, onBack, onItemLoaded, showBack = true }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!permalinkInfo) return;
    const { type, poiSlug, titleSlug } = permalinkInfo;
    const endpoint = type === 'event' ? 'events' : 'news';
    fetch(`/api/pois/${poiSlug}/${endpoint}/${titleSlug}`)
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Not found' : 'Failed to load');
        return res.json();
      })
      .then(data => { setItem(data); setLoading(false); if (onItemLoaded) onItemLoaded(data); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [permalinkInfo, onItemLoaded]);

  if (loading) return <div className="sidebar-tab-loading">Loading...</div>;
  if (error || !item) return (
    <div className="content-detail">
      {showBack && <BackButton onClick={onBack} />}
      <p className="sidebar-tab-empty">{error || 'Not found'}</p>
    </div>
  );

  const isEvent = permalinkInfo.type === 'event';
  const description = isEvent ? item.description : item.summary;
  const dateStr = isEvent
    ? (item.start_date ? new Date(item.start_date).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : '')
    : (item.publication_date ? formatPublicationDate(item.publication_date) : '');

  return (
    <div className="content-detail">
      {showBack && <BackButton onClick={onBack} />}
      <div className="content-detail-header">
        {isEvent ? <EventTypeIcon type={item.event_type} /> : <NewsTypeIcon type={item.news_type} />}
        <h3 className="content-detail-title">{item.title}</h3>
      </div>
      <div className="content-detail-meta">
        {item.source_name && <span className="news-source">{item.source_name}</span>}
        {dateStr && <span className="news-date">{dateStr}</span>}
      </div>
      {isEvent && item.location_details && (
        <div className="content-detail-location"><strong>Location:</strong> {item.location_details}</div>
      )}
      {description && <p className="content-detail-body">{description}</p>}
      <div className="content-detail-actions">
        {item.source_url && (
          <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="news-link">
            {isEvent ? 'More info' : 'Read more'}
          </a>
        )}
        {isEvent && item.start_date && (
          <a
            href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(item.title)}&dates=${String(item.start_date).split('T')[0].replace(/-/g, '')}/${String(item.end_date || item.start_date).split('T')[0].replace(/-/g, '')}&details=${encodeURIComponent(description)}&location=${encodeURIComponent(item.location_details || item.poi_name || '')}`}
            target="_blank" rel="noopener noreferrer" className="news-link"
          >
            + Add to Calendar
          </a>
        )}
        <ShareButton
          compact
          title={item.title}
          text={description || ''}
          url={`/${permalinkInfo.poiSlug}/${isEvent ? 'events' : 'news'}/${permalinkInfo.titleSlug}`}
          label="Share"
        />
      </div>
      {!isEvent && item.additional_urls && item.additional_urls.length > 0 && (
        <div className="content-detail-sources">
          <span>Also reported by: </span>
          {item.additional_urls.map((u, i) => (
            <a key={i} href={u.url} target="_blank" rel="noopener noreferrer" className="news-link">
              {u.source_name || `Source ${i + 2}`}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default ContentDetail;
