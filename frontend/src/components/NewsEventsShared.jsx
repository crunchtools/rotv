import React from 'react';
import ShareButton from './ShareButton';
import { generateSlug } from './sidebar/helpers';

export function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  });
}

function formatDateWithWeekday(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  });
}

export function formatPublicationDate(dateString) {
  if (!dateString) return '';
  const str = String(dateString).trim();
  const isFullTimestamp = str.includes('T') || /^\d{4}-\d{2}-\d{2} /.test(str);
  const date = isFullTimestamp ? new Date(str) : new Date(str + 'T12:00:00Z');
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York'
  });
}

export function formatDateTime(dateString) {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

const NEWS_TYPES = {
  general: { icon: 'N', label: 'General', color: '#6a1b9a' },
  alert: { icon: '!', label: 'Alert', color: '#c62828' },
  wildlife: { icon: 'W', label: 'Wildlife', color: '#2e7d32' },
  infrastructure: { icon: 'I', label: 'Infrastructure', color: '#f57c00' },
  community: { icon: 'M', label: 'Community', color: '#1565c0' }
};

const EVENT_TYPES = {
  'hike': { icon: 'H', label: 'Hike', color: '#2e7d32' },
  'race': { icon: 'R', label: 'Race', color: '#e65100' },
  'concert': { icon: 'C', label: 'Concert', color: '#e91e63' },
  'festival': { icon: 'F', label: 'Festival', color: '#c62828' },
  'program': { icon: 'P', label: 'Program', color: '#6a1b9a' },
  'volunteer': { icon: 'V', label: 'Volunteer', color: '#4caf50' },
  'arts': { icon: 'A', label: 'Arts', color: '#1565c0' },
  'community': { icon: 'M', label: 'Community', color: '#ff9800' },
  'alert': { icon: '!', label: 'Alert', color: '#f44336' }
};

export function DetailImage({ imageUrl, poiId, alt }) {
  const isSafeUrl = (u) => typeof u === 'string' && (/^https?:\/\//i.test(u) || u.startsWith('/'));
  const sources = [];
  if (isSafeUrl(imageUrl)) sources.push(imageUrl);
  if (poiId) sources.push(`/api/pois/${poiId}/thumbnail?size=large`);
  sources.push('/brand/rotv-logo.png');

  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => { setIdx(0); }, [imageUrl, poiId]);

  const isLogo = idx === sources.length - 1;
  return (
    <div style={{
      width: '100%', height: '180px', marginBottom: '12px', borderRadius: '8px',
      overflow: 'hidden', background: '#eef2ea', display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }}>
      <img
        src={sources[idx]}
        alt={alt || ''}
        loading="lazy"
        onError={() => setIdx(i => (i < sources.length - 1 ? i + 1 : i))}
        style={{
          width: isLogo ? 'auto' : '100%',
          height: '100%',
          objectFit: isLogo ? 'contain' : 'cover',
          padding: isLogo ? '28px' : 0,
          boxSizing: 'border-box'
        }}
      />
    </div>
  );
}

function TypeIcon({ types, fallbackType, iconClass, type }) {
  const config = types[type] || types[fallbackType];
  return (
    <span
      className={`${iconClass} ${type || fallbackType}`}
      title={config.label}
    >
      {config.icon}
    </span>
  );
}

export function NewsTypeIcon({ type }) {
  return <TypeIcon types={NEWS_TYPES} fallbackType="general" iconClass="news-type-icon" type={type} />;
}

export function EventTypeIcon({ type }) {
  return <TypeIcon types={EVENT_TYPES} fallbackType="program" iconClass="event-type-icon" type={type} />;
}

function formatEventDateRange(startDate, endDate) {
  const startStr = String(startDate || '');
  const endStr = String(endDate || '');
  if (!startStr) return '';
  const hasNonMidnightTime = (s) => {
    const m = s.match(/[T ](\d{2}:\d{2}:\d{2})/);
    return m && m[1] !== '00:00:00';
  };
  const toISO = (s) => s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/, '$1T$2').replace(/([+-]\d{2})$/, '$1:00');
  const endHasTime = hasNonMidnightTime(endStr);
  const startHasTime = hasNonMidnightTime(startStr) || endHasTime;
  const localDate = (s) => new Date(toISO(s)).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const sameDay = endStr ? localDate(startStr) === localDate(endStr) : true;
  const fmtTime = (s) => new Date(toISO(s)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

  if (sameDay && startHasTime) {
    const d = new Date(toISO(startStr));
    const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
    const startTime = fmtTime(startStr);
    if (endHasTime) return `${dateLabel}, ${startTime} – ${fmtTime(endStr)}`;
    return `${dateLabel}, ${startTime}`;
  } else if (endStr && !sameDay) {
    return `${formatDateWithWeekday(startStr)} – ${formatDateWithWeekday(endStr)}`;
  }
  return formatDateWithWeekday(startStr);
}

export function NewsCardBody({ item, onSelectPoi, children, className, id }) {
  const summary = item.summary || item.description;
  return (
    <div className={`park-news-item ${item.news_type || 'general'}${className ? ' ' + className : ''}`} id={id} tabIndex={0}>
      <div className="park-news-header">
        <NewsTypeIcon type={item.news_type} />
        <div className="park-news-title-section">
          <span className="park-news-title">{item.title || '(untitled)'}</span>
          {item.poi_name && onSelectPoi ? (
            <button
              className="park-news-poi-link"
              onClick={() => onSelectPoi(item.poi_id)}
              title={`View ${item.poi_name}`}
            >
              {item.poi_name}
            </button>
          ) : item.poi_name ? (
            <span className="park-news-poi-link" style={{ cursor: 'default' }}>{item.poi_name}</span>
          ) : null}
        </div>
      </div>
      {(item.publication_date || item.collection_date) && (
        <div className="park-news-date">
          {item.publication_date
            ? formatPublicationDate(item.publication_date)
            : new Date(item.collection_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' })}
        </div>
      )}
      {summary && <p className="park-news-summary">{summary}</p>}
      <div className="park-news-meta">
        {item.source_name && <span className="news-source">{item.source_name}</span>}
        {item.source_url && item.additional_urls && item.additional_urls.length > 0 ? (
          <span className="news-sources-group">
            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="news-link">Source</a>
            {item.additional_urls.map((u, i) => (
              <a key={i} href={u.url} target="_blank" rel="noopener noreferrer" className="news-link">
                {u.source_name || `Source ${i + 2}`}
              </a>
            ))}
          </span>
        ) : item.source_url ? (
          <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="news-link">Read more</a>
        ) : null}
        {item.poi_name && (
          <ShareButton
            compact
            title={item.title}
            text={item.summary || ''}
            url={`/${generateSlug(item.poi_name)}/news/${generateSlug(item.title)}`}
          />
        )}
      </div>
      {children}
    </div>
  );
}

export function EventCardBody({ item, onSelectPoi, calendarButtons, children, className, id }) {
  return (
    <div className={`park-event-item ${item.event_type || 'program'}${className ? ' ' + className : ''}`} id={id} tabIndex={0}>
      <div className="park-event-header">
        <EventTypeIcon type={item.event_type} />
        <div className="park-event-title-section">
          <span className="park-event-title">{item.title || '(untitled)'}</span>
          {item.poi_name && onSelectPoi ? (
            <button
              className="park-event-poi-link"
              onClick={() => onSelectPoi(item.poi_id)}
              title={`View ${item.poi_name}`}
            >
              {item.poi_name}
            </button>
          ) : item.poi_name ? (
            <span className="park-event-poi-link" style={{ cursor: 'default' }}>{item.poi_name}</span>
          ) : null}
        </div>
      </div>

      {(item.start_date || item.end_date) && (
        <div className="park-event-date">
          {formatEventDateRange(item.start_date, item.end_date)}
        </div>
      )}

      {item.description && <p className="park-event-description">{item.description}</p>}

      {(item.venue_name || item.location_details) && (
        <div className="park-event-location">
          <strong>Location:</strong>{' '}
          {item.venue_name ? (
            onSelectPoi && item.venue_poi_id ? (
              <button
                className="park-event-poi-link"
                onClick={() => onSelectPoi(item.venue_poi_id)}
                title={`View ${item.venue_name}`}
              >
                {item.venue_name}
              </button>
            ) : (
              <span>{item.venue_name}</span>
            )
          ) : (
            item.location_details
          )}
        </div>
      )}

      {item.is_recurring && item.cadence_label && (
        <div className="park-event-recurring" title="Recurring event">
          {item.cadence_label.includes(':') ? (
            <>
              <strong>{item.cadence_label.slice(0, item.cadence_label.indexOf(':') + 1)}</strong>
              {' ' + item.cadence_label.slice(item.cadence_label.indexOf(':') + 1).trim()}
            </>
          ) : (
            <strong>{item.cadence_label}</strong>
          )}
        </div>
      )}

      <div className="park-event-actions">
        {calendarButtons}
        {item.source_url && item.additional_urls && item.additional_urls.length > 0 ? (
          <span className="event-sources-group">
            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="event-link">Source</a>
            {item.additional_urls.map((u, i) => (
              <a key={i} href={u.url} target="_blank" rel="noopener noreferrer" className="event-link">
                {u.source_name || `Source ${i + 2}`}
              </a>
            ))}
          </span>
        ) : item.source_url ? (
          <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="event-link">More info</a>
        ) : null}
        {item.poi_name && (
          <ShareButton
            compact
            title={item.title}
            text={item.description || ''}
            url={`/${generateSlug(item.poi_name)}/events/${generateSlug(item.title)}`}
          />
        )}
      </div>
      {children}
    </div>
  );
}
