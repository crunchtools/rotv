import React from 'react';
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

export function formatDateWithWeekday(dateString) {
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

export const NEWS_TYPES = {
  general: { icon: 'N', label: 'General', color: '#6a1b9a' },
  alert: { icon: '!', label: 'Alert', color: '#c62828' },
  wildlife: { icon: 'W', label: 'Wildlife', color: '#2e7d32' },
  infrastructure: { icon: 'I', label: 'Infrastructure', color: '#f57c00' },
  community: { icon: 'M', label: 'Community', color: '#1565c0' }
};

export const EVENT_TYPES = {
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

export function NewsTypeIcon({ type }) {
  const config = NEWS_TYPES[type] || NEWS_TYPES.general;
  return (
    <span
      className={`news-type-icon ${type || 'general'}`}
      title={config.label}
    >
      {config.icon}
    </span>
  );
}

export function EventTypeIcon({ type }) {
  const config = EVENT_TYPES[type] || EVENT_TYPES.program;
  return (
    <span
      className={`event-type-icon ${type || 'program'}`}
      title={config.label}
    >
      {config.icon}
    </span>
  );
}

export function NewsItemCard({ item, onDelete, deleting, isAdmin }) {
  return (
    <div className={`news-item-card ${item.news_type || 'general'}`}>
      <div className="item-card-header">
        <NewsTypeIcon type={item.news_type} />
        <span className="item-card-title">{item.title}</span>
        {isAdmin && onDelete && (
          <button
            className="item-card-delete"
            onClick={() => onDelete(item.id)}
            disabled={deleting === item.id}
            title="Delete"
          >
            {deleting === item.id ? '...' : '×'}
          </button>
        )}
      </div>
      {item.summary && <p className="item-card-summary">{item.summary}</p>}
      <div className="item-card-meta">
        {item.poi_name && <span className="item-card-poi">{item.poi_name}</span>}
        {item.source_name && <span className="item-card-source">{item.source_name}</span>}
        {(item.publication_date || item.collection_date) && (
          <span className="item-card-date">
            {item.publication_date
              ? formatPublicationDate(item.publication_date)
              : new Date(item.collection_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' })}
          </span>
        )}
        {item.source_url && (
          <a
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="item-card-link"
          >
            Read more
          </a>
        )}
      </div>
    </div>
  );
}

export function EventItemCard({ item, onDelete, deleting, isAdmin }) {
  return (
    <div className={`event-item-card ${item.event_type || 'program'}`}>
      <div className="item-card-header">
        <EventTypeIcon type={item.event_type} />
        <span className="item-card-title">{item.title}</span>
        {isAdmin && onDelete && (
          <button
            className="item-card-delete"
            onClick={() => onDelete(item.id)}
            disabled={deleting === item.id}
            title="Delete"
          >
            {deleting === item.id ? '...' : '×'}
          </button>
        )}
      </div>
      <div className="item-card-date-row">
        {(() => {
          const startStr = String(item.start_date || '');
          const endStr = String(item.end_date || '');
          const _hasTime = (s) => { const m = s.match(/[T ](\d{2}:\d{2}:\d{2})/); return m && m[1] !== '00:00:00'; };
          const _toISO = (s) => s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/, '$1T$2').replace(/([+-]\d{2})$/, '$1:00');
          const endHasTime = _hasTime(endStr);
          const startHasTime = _hasTime(startStr) || endHasTime;
          const _localDate = (s) => new Date(_toISO(s)).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
          const sameDay = endStr ? _localDate(startStr) === _localDate(endStr) : true;

          if (sameDay && startHasTime) {
            const startDate = new Date(_toISO(startStr));
            const dateLabel = startDate.toLocaleDateString('en-US', {
              weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York'
            });
            const startTime = startDate.toLocaleTimeString('en-US', {
              hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
            });
            if (endHasTime) {
              const endTime = new Date(_toISO(endStr)).toLocaleTimeString('en-US', {
                hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
              });
              return `${dateLabel}, ${startTime} – ${endTime}`;
            }
            return `${dateLabel}, ${startTime}`;
          } else if (endStr && !sameDay) {
            return <>{formatPublicationDate(startStr)} – {formatPublicationDate(endStr)}</>;
          }
          return formatPublicationDate(startStr);
        })()}
      </div>
      {item.description && <p className="item-card-summary">{item.description}</p>}
      <div className="item-card-meta">
        {item.poi_name && <span className="item-card-poi">{item.poi_name}</span>}
        {item.location_details && <span className="item-card-location">{item.location_details}</span>}
        {item.source_url && (
          <a
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="item-card-link"
          >
            More info
          </a>
        )}
      </div>
    </div>
  );
}

export function formatEventDateRange(startDate, endDate) {
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

      {item.location_details && (
        <div className="park-event-location">
          <strong>Location:</strong> {item.location_details}
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

export function NewsTypeFilters({ filters, onChange }) {
  return (
    <div className="type-filter-chips">
      {Object.entries(NEWS_TYPES).map(([type, config]) => (
        <div
          key={type}
          className={`type-filter-chip ${type} ${filters[type] ? 'active' : 'inactive'}`}
          onClick={() => onChange({ ...filters, [type]: !filters[type] })}
        >
          <span className="type-filter-icon">{config.icon}</span>
          {config.label}
        </div>
      ))}
    </div>
  );
}

export function EventTypeFilters({ filters, onChange }) {
  return (
    <div className="type-filter-chips">
      {Object.entries(EVENT_TYPES).map(([type, config]) => (
        <div
          key={type}
          className={`type-filter-chip ${type} ${filters[type] ? 'active' : 'inactive'}`}
          onClick={() => onChange({ ...filters, [type]: !filters[type] })}
        >
          <span className="type-filter-icon">{config.icon}</span>
          {config.label}
        </div>
      ))}
    </div>
  );
}
