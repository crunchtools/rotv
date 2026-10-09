import React from 'react';
import ParkNews from './ParkNews';
import ParkEvents from './ParkEvents';
import { handleRovingKeyDown } from '../utils/a11yUtils';

const VIEWS = [
  { id: 'news', label: 'News' },
  { id: 'events', label: 'Events' }
];

/**
 * The Happening tab (spec 048): news and events share one tab, switched by a
 * two-way toggle. Each view keeps its own search and filters.
 *
 * @param {object} props
 * @param {'news'|'events'} props.view Which side of the toggle is showing
 * @param {(view: 'news'|'events') => void} props.onViewChange
 * @param {{isAdmin: boolean, editMode: boolean, refreshTrigger: number,
 *   onSelectPoi: (poiId: number) => void,
 *   onEditNewsItem: (id: number, title?: string) => void}} props.newsProps Passed through to ParkNews
 * @param {{isAdmin: boolean, editMode: boolean, refreshTrigger: number,
 *   onSelectPoi: (poiId: number) => void,
 *   onEditEventItem: (id: number, title?: string) => void}} props.eventsProps Passed through to ParkEvents
 * @returns {JSX.Element}
 */
export default function HappeningTab({ view, onViewChange, newsProps, eventsProps }) {
  return (
    <div className="happening-tab">
      <div
        className="happening-toggle"
        role="group"
        aria-label="News or events"
        onKeyDown={(e) => handleRovingKeyDown(e, '.happening-toggle-btn')}
      >
        {VIEWS.map(v => (
          <button
            key={v.id}
            type="button"
            className={`happening-toggle-btn ${view === v.id ? 'active' : ''}`}
            data-view={v.id}
            aria-pressed={view === v.id}
            tabIndex={view === v.id ? 0 : -1}
            onClick={() => onViewChange(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === 'events' ? <ParkEvents {...eventsProps} /> : <ParkNews {...newsProps} />}
    </div>
  );
}
