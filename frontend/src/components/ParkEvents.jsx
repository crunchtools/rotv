import React, { useState, useEffect, useRef } from 'react';
import MapThumbnail from './MapThumbnail';
import { formatDateWithWeekday, EventTypeIcon } from './NewsEventsShared';

// Default park bounds - show full park view in mini map
const DEFAULT_PARK_BOUNDS = [
  [41.13, -81.85],  // Southwest corner
  [41.45, -81.50]   // Northeast corner
];

// Calendar-specific date formatting (local to this component)
function formatDateForCalendar(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toISOString().replace(/-|:|\.\d{3}/g, '').slice(0, 15) + 'Z';
}

function ParkEvents({ _isAdmin, onSelectPoi, filteredDestinations, filteredLinearFeatures, filteredVirtualPois, mapState, onMapClick, refreshTrigger, bypassViewportFilter, visiblePoiCount }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const stableBoundsRef = useRef(DEFAULT_PARK_BOUNDS);
  const [searchText, setSearchText] = useState('');
  const [activeSubTab, setActiveSubTab] = useState('future');
  const [pastEvents, setPastEvents] = useState([]);
  const [pastLoading, setPastLoading] = useState(false);
  const [typeFilters, setTypeFilters] = useState({
    'hike': true,
    'race': true,
    'concert': true,
    'festival': true,
    'program': true,
    'volunteer': true,
    'arts': true,
    'community': true,
    'alert': true
  });

  useEffect(() => {
    fetchEvents();
  }, [refreshTrigger]);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/events/upcoming');
      if (response.ok) {
        const data = await response.json();
        setEvents(data);
      } else {
        setError('Failed to load events');
      }
    } catch (err) {
      setError('Failed to load events');
      console.error('Error fetching park events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'past' && pastEvents.length === 0 && !pastLoading) {
      fetchPastEvents();
    }
  }, [activeSubTab]);

  const fetchPastEvents = async () => {
    setPastLoading(true);
    try {
      const response = await fetch('/api/events/past?limit=50');
      if (response.ok) {
        const data = await response.json();
        setPastEvents(data);
      }
    } catch (err) {
      console.error('Error fetching past events:', err);
    } finally {
      setPastLoading(false);
    }
  };

  // Simple, direct bounds computation - matches ResultsTab pattern
  let currentBounds;
  if (bypassViewportFilter) {
    // Bypass mode: use default park bounds constant (e.g., after returning from single POI view)
    currentBounds = DEFAULT_PARK_BOUNDS;
  } else {
    // Normal mode: use current viewport bounds
    currentBounds = mapState?.bounds || DEFAULT_PARK_BOUNDS;
  }

  // Only update stable ref if coordinates actually changed
  const boundsChanged = currentBounds &&
    (!stableBoundsRef.current ||
    currentBounds[0][0] !== stableBoundsRef.current[0][0] ||
    currentBounds[0][1] !== stableBoundsRef.current[0][1] ||
    currentBounds[1][0] !== stableBoundsRef.current[1][0] ||
    currentBounds[1][1] !== stableBoundsRef.current[1][1]);

  if (boundsChanged) {
    stableBoundsRef.current = currentBounds;
  }

  const thumbnailBounds = stableBoundsRef.current;

  // Filter events based on visible POIs (destinations, linear features, and organizations)
  const sourceEvents = activeSubTab === 'future' ? events : pastEvents;
  const filteredEvents = React.useMemo(() => {
    const hasDestinations = Array.isArray(filteredDestinations);
    const hasLinearFeatures = Array.isArray(filteredLinearFeatures);
    const hasVirtualPois = Array.isArray(filteredVirtualPois);

    // Start with all events or filter by visible POIs
    let filtered = sourceEvents;

    // If all filters are explicitly empty arrays, show no events (all filters deselected)
    if (hasDestinations && filteredDestinations.length === 0 &&
        hasLinearFeatures && filteredLinearFeatures.length === 0 &&
        hasVirtualPois && filteredVirtualPois.length === 0) {
      filtered = [];
    }

    // Apply text search filter
    if (searchText.trim()) {
      const search = searchText.toLowerCase();
      filtered = filtered.filter(item =>
        (item.title || '').toLowerCase().includes(search) ||
        (item.description || '').toLowerCase().includes(search) ||
        (item.poi_name || '').toLowerCase().includes(search) ||
        (item.location_details || '').toLowerCase().includes(search)
      );
    }

    // Apply type filter
    filtered = filtered.filter(item => typeFilters[item.event_type || 'program'] !== false);

    return filtered;
  }, [sourceEvents, filteredDestinations, filteredLinearFeatures, filteredVirtualPois, searchText, typeFilters]);

  const generateCalendarUrl = (event) => {
    const title = encodeURIComponent(event.title);
    const startDate = formatDateForCalendar(event.start_date);
    const endDate = event.end_date
      ? formatDateForCalendar(event.end_date)
      : formatDateForCalendar(new Date(new Date(event.start_date).getTime() + 2 * 60 * 60 * 1000)); // Default 2 hours
    const description = encodeURIComponent(
      `${event.description || ''}\n\nLocation: ${event.poi_name}\n${event.location_details || ''}\n\nMore info: ${event.source_url || 'Cuyahoga Valley National Park'}`
    );
    const location = encodeURIComponent(`${event.poi_name}, Cuyahoga Valley National Park, Ohio`);

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDate}/${endDate}&details=${description}&location=${location}`;
  };

  const generateIcsContent = (event) => {
    const startDate = formatDateForCalendar(event.start_date);
    const endDate = event.end_date
      ? formatDateForCalendar(event.end_date)
      : formatDateForCalendar(new Date(new Date(event.start_date).getTime() + 2 * 60 * 60 * 1000));

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Roots of The Valley//EN
BEGIN:VEVENT
DTSTART:${startDate}
DTEND:${endDate}
SUMMARY:${event.title}
DESCRIPTION:${event.description || ''} - ${event.poi_name}
LOCATION:${event.poi_name}, Cuyahoga Valley National Park, Ohio
URL:${event.source_url || ''}
END:VEVENT
END:VCALENDAR`;

    return icsContent;
  };

  const downloadIcs = (event) => {
    const icsContent = generateIcsContent(event);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${event.title.replace(/[^a-z0-9]/gi, '_')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const isLoading = activeSubTab === 'future' ? loading : pastLoading;
  const tabLabel = activeSubTab === 'future' ? 'Future Events' : 'Past Events';

  if (isLoading) {
    return (
      <div className="park-events-tab">
        <h2>{tabLabel}</h2>
        <div className="results-subtabs">
          <button
            className={`results-subtab ${activeSubTab === 'future' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('future')}
          >
            Future
          </button>
          <button
            className={`results-subtab ${activeSubTab === 'past' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('past')}
          >
            Past
          </button>
        </div>
        <div className="loading-indicator">Loading events...</div>
      </div>
    );
  }

  if (error && activeSubTab === 'future') {
    return (
      <div className="park-events-tab">
        <h2>{tabLabel}</h2>
        <div className="error-message">{error}</div>
      </div>
    );
  }

  return (
    <div className="park-events-tab">
      <div className="news-events-header">
        <h2>{tabLabel}</h2>
        <p className="tab-subtitle">Events across Cuyahoga Valley National Park</p>
      </div>

      {/* Sub-tabs */}
      <div className="results-subtabs">
        <button
          className={`results-subtab ${activeSubTab === 'future' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('future')}
        >
          Future
        </button>
        <button
          className={`results-subtab ${activeSubTab === 'past' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('past')}
        >
          Past
        </button>
      </div>

      <div className="results-filters">
        <input
          type="text"
          className="results-search-input"
          placeholder="Search events by title, description, or location..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <div className="results-type-filters">
          {[
            { key: 'hike', icon: 'H', label: 'Hike' },
            { key: 'race', icon: 'R', label: 'Race' },
            { key: 'concert', icon: 'C', label: 'Concert' },
            { key: 'festival', icon: 'F', label: 'Festival' },
            { key: 'program', icon: 'P', label: 'Program' },
            { key: 'volunteer', icon: 'V', label: 'Volunteer' },
            { key: 'arts', icon: 'A', label: 'Arts' },
            { key: 'community', icon: 'M', label: 'Community' },
            { key: 'alert', icon: '!', label: 'Alert' },
          ].map(f => (
            <div
              key={f.key}
              className={`type-filter-chip ${f.key} ${typeFilters[f.key] ? 'active' : 'inactive'}`}
              onClick={() => setTypeFilters(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
            >
              <span className="type-filter-icon">{f.icon}</span>
              {f.label}
            </div>
          ))}
        </div>
        <div className="results-count">
          Showing {filteredEvents.length} of {sourceEvents.length} events
        </div>
      </div>

      <div className="news-events-layout">
        <div className="news-events-content">
          {filteredEvents.length === 0 ? (
            <p className="no-content">
              {sourceEvents.length > 0
                ? 'No events match the current filters. Try adjusting the type filters above or the map view.'
                : activeSubTab === 'future' ? 'No upcoming events found.' : 'No past events found.'}
            </p>
          ) : (
          <div className="park-events-list">
            {filteredEvents.map(item => (
          <div key={item.id} className={`park-event-item ${item.event_type || 'program'}`}>
            <div className="park-event-header">
              <EventTypeIcon type={item.event_type} />
              <div className="park-event-title-section">
                <span className="park-event-title">{item.title}</span>
                <button
                  className="park-event-poi-link"
                  onClick={() => onSelectPoi && onSelectPoi(item.poi_id)}
                  title={`View ${item.poi_name}`}
                >
                  {item.poi_name}
                </button>
              </div>
            </div>

            <div className="park-event-date">
              {formatDateWithWeekday(item.start_date)}
              {item.end_date && item.end_date !== item.start_date && (
                <> - {formatDateWithWeekday(item.end_date)}</>
              )}
            </div>

            {item.description && <p className="park-event-description">{item.description}</p>}

            {item.location_details && (
              <div className="park-event-location">
                <strong>Location:</strong> {item.location_details}
              </div>
            )}

            <div className="park-event-actions">
              <div className="calendar-buttons">
                <a
                  href={generateCalendarUrl(item)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="add-calendar-btn google"
                  title="Add to Google Calendar"
                >
                  + Google Calendar
                </a>
                <button
                  onClick={() => downloadIcs(item)}
                  className="add-calendar-btn ics"
                  title="Download .ics file for Apple/Outlook"
                >
                  + Download .ics
                </button>
              </div>
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
        {/* Map thumbnail sidebar */}
        {mapState && (
          <div className="map-thumbnail-sidebar">
            <MapThumbnail
              bounds={thumbnailBounds}
              aspectRatio={mapState.aspectRatio || 1.5}
              visibleDestinations={filteredDestinations}
              onClick={onMapClick}
              poiCount={visiblePoiCount}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default ParkEvents;
