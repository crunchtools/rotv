import React, { useState, useEffect, useCallback } from 'react';
import GeneralSettings from './GeneralSettings';
import { useAuth } from '../hooks/useAuth';
import { readEmail, writeEmail, writeSubscribed } from '../utils/anonSettings';
import { safeHttpUrl } from '../utils/url';

function UserSettings({ user, initialTab }) {
  const { toggleFavorite } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab || 'general');

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);
  const [email, setEmail] = useState(() => user?.email || readEmail());
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const [favorites, setFavorites] = useState([]);
  const [feed, setFeed] = useState({ news: [], events: [] });
  const [favLoading, setFavLoading] = useState(false);

  const loadFavorites = useCallback(async () => {
    if (!user) return;
    setFavLoading(true);
    try {
      const [favRes, feedRes] = await Promise.all([
        fetch('/api/favorites', { credentials: 'include' }),
        fetch('/api/notifications/feed', { credentials: 'include' })
      ]);
      if (favRes.ok) setFavorites(await favRes.json());
      if (feedRes.ok) setFeed(await feedRes.json());
    } catch (err) {
      setFavorites([]);
    } finally {
      setFavLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === 'favorites') loadFavorites();
  }, [activeTab, loadFavorites]);

  const handleUnfavorite = async (poiId) => {
    setFavorites(prev => prev.filter(p => p.id !== poiId));
    await toggleFavorite(poiId);
  };

  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
  }, [user]);

  const handleEmailChange = (e) => {
    const value = e.target.value;
    setEmail(value);
    if (!user?.email) {
      writeEmail(value);
    }
  };

  const handleSubscribe = async (e) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');

    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        credentials: 'include'
      });

      const data = await res.json();

      if (res.ok) {
        setStatus('success');
        setMessage(data.message);
        if (!user?.email) {
          writeSubscribed(true);
        }
      } else {
        setStatus('error');
        setMessage(data.error || 'Subscription failed');
      }
    } catch (err) {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  };

  return (
    <>
      <nav className="settings-tabs">
        <button
          className={`settings-tab-btn ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          General
        </button>
        {user && (
          <button
            className={`settings-tab-btn ${activeTab === 'favorites' ? 'active' : ''}`}
            onClick={() => setActiveTab('favorites')}
          >
            Favorites
          </button>
        )}
        <button
          className={`settings-tab-btn ${activeTab === 'newsletter' ? 'active' : ''}`}
          onClick={() => setActiveTab('newsletter')}
        >
          Newsletter
        </button>
      </nav>

      <div className="settings-tab-content">
        {activeTab === 'general' && (
          <>
            {user ? (
              <div className="settings-section">
                <h3>👤 Profile</h3>
                <p className="settings-description">
                  Manage your account preferences.
                </p>
                <div className="settings-field">
                  <label>Email</label>
                  <input
                    type="email"
                    value={user.email || ''}
                    disabled
                    style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
                  />
                  <p className="field-hint">
                    Your email is managed through your authentication provider
                  </p>
                </div>
              </div>
            ) : (
              <div className="settings-section">
                <p className="settings-description">
                  Your timezone and newsletter preferences are saved to this
                  browser and will follow you onto your account when you sign in.
                </p>
              </div>
            )}
            <GeneralSettings />
          </>
        )}

        {activeTab === 'favorites' && (
          <div className="settings-section">
            <h3>⭐ Favorites</h3>
            <p className="settings-description">
              Places you follow. Get a notification and a personalized weekly
              email when there's new news or an event at one of them.
            </p>

            {favLoading && favorites.length === 0 ? (
              <p className="field-hint">Loading…</p>
            ) : favorites.length === 0 ? (
              <div className="settings-info-box">
                <div className="info-box-header">
                  <span className="info-icon">⭐</span>
                  <strong>No favorites yet</strong>
                </div>
                <p className="settings-description">
                  Open a place on the map and tap “Follow” to start tracking its
                  news and events here.
                </p>
              </div>
            ) : (
              <ul className="favorites-list">
                {favorites.map(poi => (
                  <li key={poi.id} className="favorites-list-item">
                    <span className="favorites-poi-name">{poi.name}</span>
                    <button
                      className="favorites-remove-btn"
                      onClick={() => handleUnfavorite(poi.id)}
                      title={`Unfollow ${poi.name}`}
                    >
                      Unfollow
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {(feed.events.length > 0 || feed.news.length > 0) && (
              <>
                <div className="settings-divider"></div>
                {feed.events.length > 0 && (
                  <>
                    <h4>📅 Upcoming events</h4>
                    <ul className="favorites-feed">
                      {feed.events.map(e => (
                        <li key={`e-${e.id}`}>
                          {safeHttpUrl(e.source_url) ? (
                            <a href={safeHttpUrl(e.source_url)} target="_blank" rel="noopener noreferrer">{e.title}</a>
                          ) : e.title}
                          <span className="favorites-feed-poi"> · {e.poi_name}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {feed.news.length > 0 && (
                  <>
                    <h4>📰 Recent news</h4>
                    <ul className="favorites-feed">
                      {feed.news.map(n => (
                        <li key={`n-${n.id}`}>
                          {safeHttpUrl(n.source_url) ? (
                            <a href={safeHttpUrl(n.source_url)} target="_blank" rel="noopener noreferrer">{n.title}</a>
                          ) : n.title}
                          <span className="favorites-feed-poi"> · {n.poi_name}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'newsletter' && (
          <div className="settings-section">
            <h3>📧 Newsletter</h3>
            <p className="settings-description">
              Get a weekly digest of valley events and news every Friday morning.
            </p>

            <form onSubmit={handleSubscribe} className="newsletter-form">
              <div className="settings-field">
                <label htmlFor="email">Email Address</label>
                <input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={handleEmailChange}
                  disabled={status === 'loading'}
                  required
                />
                <p className="field-hint">
                  You'll receive a confirmation email from Buttondown to complete your subscription
                </p>
              </div>

              <div className="settings-actions">
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="save-settings-btn"
                >
                  {status === 'loading' ? '📨 Subscribing...' : '📨 Subscribe to Weekly Digest'}
                </button>
              </div>

              {status === 'success' && (
                <div style={{
                  marginTop: '12px',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  backgroundColor: '#d4edda',
                  color: '#155724',
                  border: '1px solid #c3e6cb',
                  fontSize: '0.9rem',
                  maxWidth: '600px'
                }}>
                  ✓ {message}
                </div>
              )}
              {status === 'error' && (
                <div style={{
                  marginTop: '12px',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  backgroundColor: '#f8d7da',
                  color: '#721c24',
                  border: '1px solid #f5c6cb',
                  fontSize: '0.9rem',
                  maxWidth: '600px'
                }}>
                  ✗ {message}
                </div>
              )}
            </form>

            <div className="settings-divider"></div>

            <div className="settings-info-box">
              <div className="info-box-header">
                <span className="info-icon">ℹ️</span>
                <strong>What's in the Newsletter?</strong>
              </div>
              <ul className="info-list">
                <li>Events happening this weekend (Friday-Sunday)</li>
                <li>Recent news from the past week</li>
                <li>Trail status updates (when available)</li>
                <li>Sent every Friday at 8 AM EST</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default UserSettings;
