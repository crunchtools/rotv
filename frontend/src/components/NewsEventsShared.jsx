/**
 * Shared components and utilities for News & Events display
 * Used by NewsSettings, NewsEvents, ParkNews, and ParkEvents
 */
import React from 'react';

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
 * Format a date-only string (YYYY-MM-DD) for display, avoiding timezone shift.
 * Uses UTC to prevent off-by-one day for users west of UTC.
 * @param {string} dateString - YYYY-MM-DD date string
 * @returns {string} - Formatted date (e.g., "Mar 15, 2025")
 */
export function formatPublicationDate(dateString) {
  if (!dateString) return '';
  // Handle both YYYY-MM-DD and full ISO timestamps (e.g., 2026-03-27T00:00:00.000Z)
  const str = String(dateString);
  const date = str.includes('T') ? new Date(str) : new Date(str + 'T00:00:00Z');
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
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
        {item.published_at && <span className="item-card-date">{formatDate(item.published_at)}</span>}
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
        {formatDate(item.start_date)}
        {item.end_date && item.end_date !== item.start_date && (
          <> - {formatDate(item.end_date)}</>
        )}
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
