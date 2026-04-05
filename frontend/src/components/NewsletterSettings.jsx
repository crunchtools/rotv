import React, { useState, useEffect } from 'react';

function NewsletterSettings({ user }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const [apiKey, setApiKey] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminMessage, setAdminMessage] = useState(null);
  const [stats, setStats] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState(null);

  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
    loadAdminSettings();
    loadStats();
  }, [user]);

  const loadAdminSettings = async () => {
    try {
      const res = await fetch('/api/admin/settings', {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();

        setApiKey('');

        if (data.buttondown_from_email?.value) {
          setFromEmail(data.buttondown_from_email.value);
        } else {
          setFromEmail('newsletter@rootsofthevalley.org');
        }
      }
    } catch (err) {
      console.error('Failed to load newsletter settings:', err);
    }
  };

  const loadStats = async () => {
    try {
      const res = await fetch('/api/admin/newsletter/stats', {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load newsletter stats:', err);
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
        loadStats(); // Refresh stats
      } else {
        setStatus('error');
        setMessage(data.error || 'Subscription failed');
      }
    } catch (err) {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  };

  const handleSaveAdminSettings = async () => {
    setAdminSaving(true);
    setAdminMessage(null);

    try {
      const apiKeyRes = await fetch('/api/admin/settings/buttondown_api_key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: apiKey }),
        credentials: 'include'
      });

      if (!apiKeyRes.ok) {
        const data = await apiKeyRes.json();
        throw new Error(data.error || 'Failed to save API key');
      }

      const emailRes = await fetch('/api/admin/settings/buttondown_from_email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: fromEmail }),
        credentials: 'include'
      });

      if (!emailRes.ok) {
        const data = await emailRes.json();
        throw new Error(data.error || 'Failed to save from email');
      }

      setAdminMessage({ type: 'success', text: 'Settings saved! Restart container to apply changes.' });
      setTimeout(() => setAdminMessage(null), 5000);
    } catch (err) {
      setAdminMessage({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setAdminSaving(false);
    }
  };

  const handleTestApiKey = async () => {
    setTesting(true);
    setTestMessage(null);

    try {
      const res = await fetch('/api/newsletter/test-api-key', {
        method: 'POST',
        credentials: 'include'
      });

      const data = await res.json();

      if (data.success) {
        setTestMessage({
          type: 'success',
          text: `✓ API key is valid! You have ${data.subscriberCount} subscriber${data.subscriberCount !== 1 ? 's' : ''}.`
        });
      } else {
        setTestMessage({
          type: 'error',
          text: `✗ ${data.error || 'API key test failed'}`
        });
      }

      setTimeout(() => setTestMessage(null), 5000);
    } catch (err) {
      setTestMessage({
        type: 'error',
        text: '✗ Failed to test API key. Please try again.'
      });
      setTimeout(() => setTestMessage(null), 5000);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="newsletter-settings">
      {/* User Section - Subscribe to Newsletter */}
      <div className="settings-section">
        <h3>📧 Newsletter Subscription</h3>
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
      </div>

      <div className="settings-divider"></div>

      {/* Admin Section - Configuration */}
      <div className="settings-section">
        <h3>⚙️ Admin Configuration</h3>
        <p className="settings-description">
          Configure Buttondown API integration and newsletter settings.
        </p>

        {/* Subscriber Stats */}
        {stats && (
          <div className="settings-info-box" style={{ marginBottom: '24px' }}>
            <div className="info-box-header">
              <span className="info-icon">📊</span>
              <strong>Subscriber Statistics</strong>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px' }}>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#2c5f2d' }}>
                  {stats.total_subscribers}
                </div>
                <div style={{ color: '#666', fontSize: '0.9rem' }}>Total Subscribers</div>
              </div>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#2c5f2d' }}>
                  {stats.new_this_week}
                </div>
                <div style={{ color: '#666', fontSize: '0.9rem' }}>New This Week</div>
              </div>
            </div>
            <p style={{ marginTop: '12px', fontSize: '0.85rem', color: '#666' }}>
              Source: {stats.source === 'buttondown' ? 'Buttondown API' : 'Local Database'}
            </p>
          </div>
        )}

        {/* API Key Configuration */}
        <div className="settings-field">
          <label htmlFor="buttondown-api-key">
            Buttondown API Key
            <span style={{ color: '#999', fontWeight: 'normal', marginLeft: '8px' }}>(required for email sending)</span>
          </label>
          <input
            id="buttondown-api-key"
            type="password"
            placeholder="Enter your Buttondown API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="field-hint">
            Get your API key from <a href="https://buttondown.com/settings/api" target="_blank" rel="noopener noreferrer">Buttondown Settings → API</a>
          </p>
        </div>

        <div className="settings-field">
          <label htmlFor="from-email">From Email Address</label>
          <input
            id="from-email"
            type="email"
            placeholder="newsletter@rootsofthevalley.org"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
          />
          <p className="field-hint">
            This email must be verified in your Buttondown account
          </p>
        </div>

        <div className="settings-actions">
          <button
            onClick={handleSaveAdminSettings}
            disabled={adminSaving}
            className="save-settings-btn"
          >
            {adminSaving ? '💾 Saving...' : '💾 Save Admin Settings'}
          </button>

          <button
            onClick={handleTestApiKey}
            disabled={testing}
            className="save-settings-btn"
            style={{ marginLeft: '12px' }}
          >
            {testing ? '🔍 Testing...' : '🔍 Test API Key'}
          </button>

          {adminMessage && (
            <div className={`save-message ${adminMessage.type}`}>
              {adminMessage.type === 'success' ? '✓' : '✗'} {adminMessage.text}
            </div>
          )}

          {testMessage && (
            <div className={`save-message ${testMessage.type}`}>
              {testMessage.text}
            </div>
          )}
        </div>
      </div>

      <div className="settings-divider"></div>

      {/* Info Section */}
      <div className="settings-info-box">
        <div className="info-box-header">
          <span className="info-icon">ℹ️</span>
          <strong>Newsletter Configuration Guide</strong>
        </div>
        <ul className="info-list">
          <li><strong>Buttondown Setup:</strong> Sign up at <a href="https://buttondown.com" target="_blank" rel="noopener noreferrer">buttondown.com</a> (free for up to 100 subscribers)</li>
          <li><strong>Verify Email:</strong> Verify your sender email in Buttondown before sending</li>
          <li><strong>Get API Key:</strong> Generate an API key from Buttondown Settings → API</li>
          <li><strong>Schedule:</strong> Digest sends automatically every Friday at 6 AM EST</li>
          <li><strong>Content:</strong> Includes events (Fri-Sun) and recent news (last 7 days)</li>
          <li><strong>Testing:</strong> Use Settings → Jobs → Newsletter Digest → "Run Now" to test</li>
        </ul>
      </div>

      <div className="settings-divider"></div>

      <div className="settings-info-box">
        <div className="info-box-header">
          <span className="info-icon">⚠️</span>
          <strong>Important Notes</strong>
        </div>
        <ul className="info-list">
          <li>Settings are stored in the database and require a container restart to take effect</li>
          <li>Without a valid API key, subscriptions are tracked locally but emails won't be sent</li>
          <li>The digest will skip sending if there are no events or news items</li>
          <li>Subscriber management (unsubscribe, etc.) is handled by Buttondown</li>
        </ul>
      </div>
    </div>
  );
}

export default NewsletterSettings;
