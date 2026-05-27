import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { generateSlug } from './sidebar/helpers';

const POLL_MS = 60000;
const READ_KEY = 'rotv-notifications-read';

function readReadSet() {
  try {
    const arr = JSON.parse(localStorage.getItem(READ_KEY) || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeReadSet(set) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  // Future-dated items (upcoming events) read forward: "in 3d".
  if (diff < 0) {
    const mins = Math.floor(-diff / 60000);
    if (mins < 60) return 'soon';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `in ${hrs}h`;
    return `in ${Math.floor(hrs / 24)}d`;
  }
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function normalize(feed) {
  // activityTime drives both ordering and the "time ago" label. Prefer the
  // content's own date (publication for news, start for events) over the
  // collection date, so the feed reads newest-published-first rather than in
  // scrape order.
  const news = (feed.news || []).map(n => ({
    key: `news-${n.id}`,
    type: 'news',
    title: n.title,
    poiName: n.poi_name,
    activityTime: n.publication_date || n.collection_date
  }));
  const events = (feed.events || []).map(e => ({
    key: `event-${e.id}`,
    type: 'event',
    title: e.title,
    poiName: e.poi_name,
    activityTime: e.start_date || e.collection_date
  }));
  // Sort newest-first. Coerce missing/invalid dates to 0 so they sort to the
  // bottom rather than producing NaN comparisons (unstable order).
  return [...news, ...events].sort((a, b) =>
    (new Date(b.activityTime).getTime() || 0) - (new Date(a.activityTime).getTime() || 0)
  );
}

export default function NotificationBell() {
  const { isAuthenticated, favorites } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [readSet, setReadSet] = useState(readReadSet);
  const [open, setOpen] = useState(false);
  const [anchorBottom, setAnchorBottom] = useState(null);
  const [anchorRight, setAnchorRight] = useState(null);
  const containerRef = useRef(null);

  // Facebook-style: an item stays unread (tinted, counted) until the user clicks
  // it. Opening the dropdown does not mark anything read.
  const isUnread = useCallback((item) => !readSet.has(item.key), [readSet]);

  const unread = items.filter(isUnread).length;

  const loadFeed = useCallback(async () => {
    if (!isAuthenticated && favorites.length === 0) {
      setItems([]);
      return;
    }
    try {
      const url = isAuthenticated
        ? '/api/notifications/feed'
        : `/api/notifications/feed?pois=${favorites.join(',')}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;
      setItems(normalize(await res.json()));
    } catch (err) {
      /* keep last known state on transient failure */
    }
  }, [isAuthenticated, favorites]);

  useEffect(() => {
    loadFeed();
    const id = setInterval(loadFeed, POLL_MS);
    return () => clearInterval(id);
  }, [loadFeed]);

  // Keep the read set bounded: drop keys no longer present in the feed.
  useEffect(() => {
    if (items.length === 0) return;
    const liveKeys = new Set(items.map(i => i.key));
    setReadSet(prev => {
      const pruned = [...prev].filter(k => liveKeys.has(k));
      if (pruned.length === prev.size) return prev;
      const next = new Set(pruned);
      writeReadSet(next);
      return next;
    });
  }, [items]);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      const container = containerRef.current;
      const bar = container?.closest('.header-tabs') || container;
      if (bar && container) {
        const barRect = bar.getBoundingClientRect();
        setAnchorBottom(barRect.bottom);
        setAnchorRight(container.getBoundingClientRect().right - barRect.right);
      }
    }
  };

  const handleItemClick = (item) => {
    setReadSet(prev => {
      if (prev.has(item.key)) return prev;
      const next = new Set(prev);
      next.add(item.key);
      writeReadSet(next);
      return next;
    });
    const poiSlug = generateSlug(item.poiName);
    const titleSlug = generateSlug(item.title);
    if (poiSlug && titleSlug) {
      navigate(`/${poiSlug}/${item.type === 'event' ? 'events' : 'news'}/${titleSlug}`);
    }
    setOpen(false);
  };

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        className="notification-bell-btn"
        onClick={handleToggle}
        title="Notifications"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
        </svg>
        {unread > 0 && (
          <span className="notification-badge">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div
          className="notification-dropdown"
          style={{
            ...(anchorBottom != null ? { '--bell-bottom': `${anchorBottom}px` } : {}),
            ...(anchorRight != null ? { '--panel-right': `${anchorRight}px` } : {})
          }}
        >
          <div className="notification-dropdown-header">Notifications</div>
          {items.length === 0 ? (
            <div className="notification-empty">
              No updates yet. Follow places (★) to get news and events about them here.
            </div>
          ) : (
            <ul className="notification-list">
              {items.map(item => (
                <li
                  key={item.key}
                  className={`notification-item ${isUnread(item) ? 'unread' : ''}`}
                >
                  <button
                    type="button"
                    className="notification-item-btn"
                    onClick={() => handleItemClick(item)}
                  >
                    <span className="notification-icon">{item.type === 'event' ? '📅' : '📰'}</span>
                    <div className="notification-body">
                      <div className="notification-title">{item.title}</div>
                      <div className="notification-meta">
                        {item.poiName} · {timeAgo(item.activityTime)}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
