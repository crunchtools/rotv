import React, { useState, useEffect } from 'react';

function UserSettings({ user }) {
  const [activeTab, setActiveTab] = useState('general');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
  }, [user]);

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
        <button
          className={`settings-tab-btn ${activeTab === 'newsletter' ? 'active' : ''}`}
          onClick={() => setActiveTab('newsletter')}
        >
          Newsletter
        </button>
      </nav>

      <div className="settings-tab-content">
        {activeTab === 'general' && (
          <div className="settings-section">
            <h3>👤 Profile</h3>
            <p className="settings-description">
              Manage your account preferences.
            </p>
            <div className="settings-field">
              <label>Email</label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
              />
              <p className="field-hint">
                Your email is managed through your authentication provider
              </p>
            </div>
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
              onChange={(e) => setEmail(e.target.value)}
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
