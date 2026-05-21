import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { safeHttpUrl } from '../utils/url';

const POLL_MS = 60000;
const LAST_SEEN_KEY = 'rotv-notifications-last-seen';

function readLastSeen() {
  try {
    return localStorage.getItem(LAST_SEEN_KEY) || new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function writeLastSeen(iso) {
  try {
    localStorage.setItem(LAST_SEEN_KEY, iso);
  } catch {
    /* ignore */
  }
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function normalize(feed) {
  const news = (feed.news || []).map(n => ({
    key: `news-${n.id}`,
    type: 'news',
    title: n.title,
    poiName: n.poi_name,
    url: n.source_url,
    activityTime: n.collection_date || n.publication_date
  }));
  const events = (feed.events || []).map(e => ({
    key: `event-${e.id}`,
    type: 'event',
    title: e.title,
    poiName: e.poi_name,
    url: e.source_url,
    activityTime: e.collection_date || e.start_date
  }));
  return [...news, ...events].sort(
    (a, b) => new Date(b.activityTime) - new Date(a.activityTime)
  );
}

export default function NotificationBell() {
  const { isAuthenticated, favorites } = useAuth();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(readLastSeen);
  const [anchorBottom, setAnchorBottom] = useState(null);
  const [anchorRight, setAnchorRight] = useState(null);
  const containerRef = useRef(null);

  const loadFeed = useCallback(async () => {
    if (!isAuthenticated && favorites.length === 0) {
      setItems([]);
      setUnread(0);
      return;
    }
    try {
      const url = isAuthenticated
        ? '/api/notifications/feed'
        : `/api/notifications/feed?pois=${favorites.join(',')}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;
      const normalized = normalize(await res.json());
      setItems(normalized);
      const seen = readLastSeen();
      setUnread(normalized.filter(i => new Date(i.activityTime) > new Date(seen)).length);
    } catch (err) {
      /* keep last known state on transient failure */
    }
  }, [isAuthenticated, favorites]);

  useEffect(() => {
    loadFeed();
    const id = setInterval(loadFeed, POLL_MS);
    return () => clearInterval(id);
  }, [loadFeed]);

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
      const now = new Date().toISOString();
      writeLastSeen(now);
      setLastSeen(now);
      setUnread(0);
    }
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
                  className={`notification-item ${new Date(item.activityTime) > new Date(lastSeen) ? 'unread' : ''}`}
                >
                  <span className="notification-icon">{item.type === 'event' ? '📅' : '📰'}</span>
                  <div className="notification-body">
                    <div className="notification-title">
                      {safeHttpUrl(item.url) ? (
                        <a href={safeHttpUrl(item.url)} target="_blank" rel="noopener noreferrer">{item.title}</a>
                      ) : item.title}
                    </div>
                    <div className="notification-meta">
                      {item.poiName} · {timeAgo(item.activityTime)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
