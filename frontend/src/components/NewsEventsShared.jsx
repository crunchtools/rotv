/**
 * Shared components and utilities for News & Events display
 * Used by NewsSettings, NewsEvents, ParkNews, and ParkEvents
 */
import React from 'react';
import ShareButton from './ShareButton';

// Generate URL-friendly slug (must match backend generateSlug)
function generateSlug(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Format a date string for display in US format (MM/DD/YYYY)
 * @param {string} dateString - ISO date string
 * @returns {string} - Formatted date string
 */
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

/**
 * Format a date with weekday included in US format (Sat, MM/DD/YYYY)
 * @param {string} dateString - ISO date string
 * @returns {string} - Formatted date with weekday
 */
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

/**
 * Format a publication date for display in Eastern time.
 * Date-only values are stored as noon UTC so Eastern conversion never shifts the date.
 * Full UTC timestamps (e.g., from Facebook OG tags) display the correct local date.
 * @param {string} dateString - ISO timestamp or YYYY-MM-DD
 * @returns {string} - Formatted date (e.g., "Mar 15, 2025")
 */
export function formatPublicationDate(dateString) {
  if (!dateString) return '';
  const str = String(dateString).trim();
  // Full datetime: contains 'T' or a space after the date part (PostgreSQL format)
  const isFullTimestamp = str.includes('T') || /^\d{4}-\d{2}-\d{2} /.test(str);
  const date = isFullTimestamp ? new Date(str) : new Date(str + 'T12:00:00Z');
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York'
  });
}

/**
 * Format a date with time in US format (MM/DD/YYYY h:mm AM/PM)
 * @param {string} dateString - ISO date string
 * @returns {string} - Formatted date with time
 */
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

/**
 * News type configuration
 */
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

/**
 * News type icon component
 */
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

/**
 * Event type icon component
 */
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

/**
 * News item card for settings display
 */
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

/**
 * Event item card for settings display
 */
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
          const startDateOnly = startStr.substring(0, 10);
          const endDateOnly = endStr.substring(0, 10);
          // Detect non-midnight time in both ISO ('T') and pg space format
          const _hasTime = (s) => { const m = s.match(/[T ](\d{2}:\d{2}:\d{2})/); return m && m[1] !== '00:00:00'; };
          const _toISO = (s) => s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/, '$1T$2');
          const startHasTime = _hasTime(startStr);
          const endHasTime = _hasTime(endStr);
          const sameDay = endDateOnly === startDateOnly;

          if (sameDay && startHasTime) {
            // Same-day event with times: "Sun, Apr 19, 2026, 10:30 AM – 12:00 PM"
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
            // Multi-day event: "Apr 5 – Apr 26, 2026"
            return <>{formatPublicationDate(startStr)} – {formatPublicationDate(endStr)}</>;
          }
          // Date only or no end date
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

/**
 * Format event date range for display.
 * Shared between ParkEvents and ModerationInbox.
 */
export function formatEventDateRange(startDate, endDate) {
  const startStr = String(startDate || '');
  const endStr = String(endDate || '');
  if (!startStr) return '';
  const startDateOnly = startStr.substring(0, 10);
  const endDateOnly = endStr.substring(0, 10);
  // Detect non-midnight time in both ISO ('T') and pg space format ("2026-04-22 18:30:00+00")
  const hasNonMidnightTime = (s) => {
    const m = s.match(/[T ](\d{2}:\d{2}:\d{2})/);
    return m && m[1] !== '00:00:00';
  };
  // Normalize pg space format to ISO for Date parsing
  const toISO = (s) => s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/, '$1T$2');
  const startHasTime = hasNonMidnightTime(startStr);
  const endHasTime = hasNonMidnightTime(endStr);
  const sameDay = endDateOnly === startDateOnly;
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

/**
 * Shared news card body — single source of truth for news item rendering.
 * Used by ParkNews, ModerationInbox, and anywhere news items appear.
 *
 * Props:
 *   item         - news item data (title, summary/description, news_type, poi_name, source_url, publication_date, source_name, additional_urls)
 *   onSelectPoi  - optional callback when POI name is clicked
 *   children     - optional content rendered below the meta row (moderation extras, action buttons)
 *   className    - optional extra class on the outer div
 *   id           - optional id attribute on the outer div
 */
export function NewsCardBody({ item, onSelectPoi, children, className, id }) {
  const summary = item.summary || item.description;
  return (
    <div className={`park-news-item ${item.news_type || 'general'}${className ? ' ' + className : ''}`} id={id}>
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
      {summary && <p className="park-news-summary">{summary}</p>}
      <div className="park-news-meta">
        {item.source_name && <span className="news-source">{item.source_name}</span>}
        {(item.publication_date || item.collection_date) && (
          <span className="news-date">
            {item.publication_date
              ? formatPublicationDate(item.publication_date)
              : new Date(item.collection_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' })}
          </span>
        )}
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
            url={`/news/${generateSlug(item.poi_name)}/${generateSlug(item.title)}`}
          />
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Shared event card body — single source of truth for event item rendering.
 * Used by ParkEvents, ModerationInbox, and anywhere event items appear.
 *
 * Props:
 *   item             - event item data (title, description, event_type, poi_name, start_date, end_date, source_url, location_details, additional_urls)
 *   onSelectPoi      - optional callback when POI name is clicked
 *   calendarButtons  - optional ReactNode for calendar action buttons
 *   children         - optional content rendered below the actions row (moderation extras, action buttons)
 *   className        - optional extra class on the outer div
 *   id               - optional id attribute on the outer div
 */
export function EventCardBody({ item, onSelectPoi, calendarButtons, children, className, id }) {
  return (
    <div className={`park-event-item ${item.event_type || 'program'}${className ? ' ' + className : ''}`} id={id}>
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
            url={`/events/${generateSlug(item.poi_name)}/${generateSlug(item.title)}`}
          />
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Type filter chips component for news
 */
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

/**
 * Type filter chips component for events
 */
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
