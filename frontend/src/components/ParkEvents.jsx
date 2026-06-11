import React, { useState, useEffect, useRef } from 'react';
import MapThumbnail from './MapThumbnail';
import { EventCardBody } from './NewsEventsShared';
import { handleRovingKeyDown } from '../utils/a11yUtils';
import ContentFormModal from './ContentFormModal';
import useModeration from '../hooks/useModeration';
import ModerationExtras from './ModerationExtras';

const DEFAULT_PARK_BOUNDS = [
  [41.13, -81.85],
  [41.45, -81.50]
];

function formatDateForCalendar(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toISOString().replace(/-|:|\.\d{3}/g, '').slice(0, 15) + 'Z';
}

function ParkEvents({ isAdmin, editMode, onSelectPoi, onEditEventItem, filteredDestinations, filteredLinearFeatures, filteredVirtualPois, mapState, onMapClick, refreshTrigger, bypassViewportFilter, visiblePoiCount }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const stableBoundsRef = useRef(DEFAULT_PARK_BOUNDS);
  const [searchText, setSearchText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;
  const [activeSubTab, setActiveSubTab] = useState('today');
  const [pastEvents, setPastEvents] = useState([]);
  const [pastLoading, setPastLoading] = useState(false);
  // Today / This Weekend windows (#436): { count, events } keyed by range.
  const [windowData, setWindowData] = useState({ today: null, weekend: null });
  const [windowLoading, setWindowLoading] = useState(true);
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
  const [showNewForm, setShowNewForm] = useState(false);
  const [seriesEditData, setSeriesEditData] = useState(null);

  const mod = useModeration({
    onItemsChanged: () => { fetchEvents(); fetchPastEvents(); }
  });

  const SUBTABS = [
    { key: 'today', label: 'Today' },
    { key: 'weekend', label: 'This Weekend' },
    { key: 'future', label: 'Future' },
    { key: 'past', label: 'Past' }
  ];

  const appTz = () => localStorage.getItem('app-timezone')
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'America/New_York';

  useEffect(() => {
    fetchEvents();
  }, [refreshTrigger]);

  // Load the Today and This Weekend windows, then land on the most useful default:
  // Today when it has events, otherwise This Weekend (#436).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWindowLoading(true);
      try {
        const tz = encodeURIComponent(appTz());
        const [today, weekend] = await Promise.all([
          fetch(`/api/events/window?range=today&tz=${tz}`).then(r => r.ok ? r.json() : null),
          fetch(`/api/events/window?range=weekend&tz=${tz}`).then(r => r.ok ? r.json() : null)
        ]);
        if (cancelled) return;
        setWindowData({ today, weekend });
        if (today && today.count === 0 && weekend && weekend.count > 0) {
          setActiveSubTab(prev => (prev === 'today' ? 'weekend' : prev));
        }
      } catch (err) {
        console.error('Error fetching event windows:', err);
      } finally {
        if (!cancelled) setWindowLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshTrigger]);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const tz = localStorage.getItem('app-timezone')
        || Intl.DateTimeFormat().resolvedOptions().timeZone
        || 'America/New_York';
      const response = await fetch(`/api/events/upcoming?tz=${encodeURIComponent(tz)}`);
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

  // Refetch every events surface after a create/edit/delete (one-off or series).
  const reloadAll = async () => {
    fetchEvents();
    fetchPastEvents();
    try {
      const tz = encodeURIComponent(appTz());
      const [today, weekend] = await Promise.all([
        fetch(`/api/events/window?range=today&tz=${tz}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/events/window?range=weekend&tz=${tz}`).then(r => r.ok ? r.json() : null)
      ]);
      setWindowData({ today, weekend });
    } catch (err) {
      console.error('Error reloading event windows:', err);
    }
  };

  // Recurring (series-linked) events are managed as a series, not per occurrence.
  const openSeriesEdit = async (seriesId) => {
    try {
      const res = await fetch('/api/admin/event-series', { credentials: 'include' });
      if (!res.ok) return;
      const all = await res.json();
      const series = all.find(s => s.id === seriesId);
      if (series) setSeriesEditData(series);
    } catch (err) {
      console.error('Error loading series for edit:', err);
    }
  };

  const deleteSeries = async (seriesId) => {
    if (!window.confirm('Delete this recurring event? Future occurrences are removed; past ones are kept as history.')) return;
    try {
      const res = await fetch(`/api/admin/event-series/${seriesId}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) reloadAll();
    } catch (err) {
      console.error('Error deleting series:', err);
    }
  };

  let currentBounds;
  if (bypassViewportFilter) {
    currentBounds = DEFAULT_PARK_BOUNDS;
  } else {
    currentBounds = mapState?.bounds || DEFAULT_PARK_BOUNDS;
  }

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

  const sourceEvents =
    activeSubTab === 'past' ? pastEvents :
    activeSubTab === 'future' ? events :
    (windowData[activeSubTab]?.events || []);
  const filteredEvents = React.useMemo(() => {
    const hasDestinations = Array.isArray(filteredDestinations);
    const hasLinearFeatures = Array.isArray(filteredLinearFeatures);
    const hasVirtualPois = Array.isArray(filteredVirtualPois);

    let filtered = sourceEvents;

    if (hasDestinations && filteredDestinations.length === 0 &&
        hasLinearFeatures && filteredLinearFeatures.length === 0 &&
        hasVirtualPois && filteredVirtualPois.length === 0) {
      filtered = [];
    }

    if (searchText.trim()) {
      const search = searchText.toLowerCase();
      filtered = filtered.filter(item =>
        (item.title || '').toLowerCase().includes(search) ||
        (item.description || '').toLowerCase().includes(search) ||
        (item.poi_name || '').toLowerCase().includes(search) ||
        (item.location_details || '').toLowerCase().includes(search)
      );
    }

    filtered = filtered.filter(item => typeFilters[item.event_type || 'program'] !== false);

    return filtered;
  }, [sourceEvents, filteredDestinations, filteredLinearFeatures, filteredVirtualPois, searchText, typeFilters]);

  const totalPages = Math.ceil(filteredEvents.length / PAGE_SIZE);
  const paginatedEvents = filteredEvents.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const generateCalendarUrl = (event) => {
    const title = encodeURIComponent(event.title);
    const startDate = formatDateForCalendar(event.start_date);
    const endDate = event.end_date
      ? formatDateForCalendar(event.end_date)
      : formatDateForCalendar(new Date(new Date(event.start_date).getTime() + 2 * 60 * 60 * 1000));
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

  const isLoading =
    activeSubTab === 'future' ? loading :
    activeSubTab === 'past' ? pastLoading :
    windowLoading;
  const tabLabel = 'Events';

  const renderSubTabs = () => (
    <div className="results-subtabs" onKeyDown={(e) => handleRovingKeyDown(e, '.results-subtab')}>
      {SUBTABS.map(t => (
        <button
          key={t.key}
          className={`results-subtab ${activeSubTab === t.key ? 'active' : ''}`}
          onClick={() => { setActiveSubTab(t.key); setCurrentPage(1); }}
          tabIndex={activeSubTab === t.key ? 0 : -1}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (isLoading) {
    return (
      <div className="park-events-tab">
        <h2>{tabLabel}</h2>
        {renderSubTabs()}
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
      <div className="news-events-header tab-header-with-new">
        <div>
          <h2>{tabLabel}</h2>
          <p className="tab-subtitle">Events across Cuyahoga Valley National Park</p>
        </div>
        {editMode && isAdmin && (
          <button className="tab-new-btn" onClick={() => setShowNewForm(true)}>+ New</button>
        )}
      </div>

      {showNewForm && (
        <ContentFormModal
          mode="create"
          contentType="event"
          pois={mod.pois}
          onCreate={() => reloadAll()}
          onClose={() => setShowNewForm(false)}
        />
      )}

      {seriesEditData && (
        <ContentFormModal
          contentType="event"
          seriesEdit={seriesEditData}
          pois={mod.pois}
          onCreate={() => reloadAll()}
          onClose={() => setSeriesEditData(null)}
        />
      )}

      {renderSubTabs()}

      <div className="results-filters">
        <input
          type="text"
          className="results-search-input"
          placeholder="Search events by title, description, or location..."
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setCurrentPage(1); }}
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
              onClick={() => { setTypeFilters(prev => ({ ...prev, [f.key]: !prev[f.key] })); setCurrentPage(1); }}
            >
              <span className="type-filter-icon">{f.icon}</span>
              {f.label}
            </div>
          ))}
        </div>
        <div className="results-count">
          Showing {filteredEvents.length === 0 ? '0' : `${((currentPage - 1) * PAGE_SIZE) + 1}-${Math.min(currentPage * PAGE_SIZE, filteredEvents.length)}`} of {filteredEvents.length} events
        </div>
      </div>

      <div className="news-events-layout">
        <div className="news-events-content">
          {filteredEvents.length === 0 ? (
            <p className="no-content">
              {sourceEvents.length > 0
                ? 'No events match the current filters. Try adjusting the type filters above or the map view.'
                : activeSubTab === 'today' ? 'Nothing happening today.'
                : activeSubTab === 'weekend' ? 'Nothing happening this weekend.'
                : activeSubTab === 'future' ? 'No upcoming events found.' : 'No past events found.'}
            </p>
          ) : (
          <div className="park-events-list" onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              const items = Array.from(e.currentTarget.querySelectorAll('.park-event-item'));
              const idx = items.indexOf(e.target.closest('.park-event-item'));
              if (idx === -1) return;
              e.preventDefault();
              const next = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
              items[next].focus();
            }
          }}>
            {paginatedEvents.map(item => (
          <EventCardBody
            key={item.id}
            item={item}
            onSelectPoi={onSelectPoi}
            calendarButtons={
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
            }
          >
            {editMode && isAdmin && !item.is_recurring && (
              <ModerationExtras
                item={{ ...item, content_type: 'event' }}
                isPending={false}
                editingItem={mod.editingItem}
                editFields={mod.editFields}
                setEditFields={mod.setEditFields}
                itemUrls={mod.itemUrls}
                newUrlInput={mod.newUrlInput}
                setNewUrlInput={mod.setNewUrlInput}
                addingUrl={mod.addingUrl}
                iaDateItem={mod.iaDateItem}
                mergingItem={mod.mergingItem}
                mergeCandidates={mod.mergeCandidates}
                merging={mod.merging}
                confirmDelete={mod.confirmDelete}
                setConfirmDelete={mod.setConfirmDelete}
                pois={mod.pois}
                onApprove={mod.handleApprove}
                onReject={mod.handleReject}
                onRequeue={mod.handleRequeue}
                onDelete={mod.handleDelete}
                onSave={mod.handleSave}
                onIaDate={mod.handleIaDate}
                onStartEditing={mod.startEditing}
                onCancelEditing={mod.cancelEditing}
                onStartMerge={mod.startMerge}
                onMerge={mod.handleMerge}
                onCancelMerge={mod.cancelMerge}
                onAddUrl={mod.handleAddUrl}
                onRemoveUrl={mod.handleRemoveUrl}
              />
            )}
            {editMode && isAdmin && item.is_recurring && item.series_id && (
              <div className="recur-admin-controls">
                <button type="button" className="recur-edit-btn" onClick={() => openSeriesEdit(item.series_id)}>
                  Edit recurring event
                </button>
                <button type="button" className="recur-delete-btn" onClick={() => deleteSeries(item.series_id)}>
                  Delete
                </button>
              </div>
            )}
          </EventCardBody>
            ))}
          </div>
          )}
          {totalPages > 1 && (
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(p => p - 1)}
                disabled={currentPage === 1}
              >
                Back
              </button>
              <span className="pagination-info">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
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
      {editMode && isAdmin && mod.notification && (
        <div className={`result-message ${mod.notification.type}`} style={{ margin: '10px 1rem' }}>
          {mod.notification.message}
        </div>
      )}
    </div>
  );
}

export default ParkEvents;
