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

  const [sources, setSources] = useState([]);
  const [pois, setPois] = useState([]);
  const [sourceEdits, setSourceEdits] = useState({});
  const [sourceMsg, setSourceMsg] = useState(null);
  const [showBlocked, setShowBlocked] = useState(false);
  const [subscribers, setSubscribers] = useState(null);
  const [loadingSubscribers, setLoadingSubscribers] = useState(false);
  const [expandedEmails, setExpandedEmails] = useState({});
  const [sourceEmails, setSourceEmails] = useState({});
  const [orphans, setOrphans] = useState(null);
  const [loadingOrphans, setLoadingOrphans] = useState(false);

  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
    loadAdminSettings();
    loadStats();
    loadSources();
    loadPois();
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

  const loadSources = async () => {
    try {
      const res = await fetch('/api/newsletter/sources', { credentials: 'include' });
      if (res.ok) setSources(await res.json());
    } catch (err) {
      console.error('Failed to load newsletter sources:', err);
    }
  };

  const loadPois = async () => {
    try {
      const res = await fetch('/api/pois', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPois((data || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      }
    } catch (err) {
      console.error('Failed to load POIs:', err);
    }
  };

  const toggleSubscribers = async () => {
    if (subscribers) {
      setSubscribers(null);
      return;
    }
    setLoadingSubscribers(true);
    try {
      const res = await fetch('/api/admin/newsletter/subscribers', { credentials: 'include' });
      if (res.ok) setSubscribers(await res.json());
    } catch (err) {
      console.error('Failed to load subscribers:', err);
    } finally {
      setLoadingSubscribers(false);
    }
  };

  const toggleEmails = async (pattern) => {
    if (expandedEmails[pattern]) {
      setExpandedEmails((prev) => { const next = { ...prev }; delete next[pattern]; return next; });
      return;
    }
    try {
      const res = await fetch(`/api/newsletter/sources/${encodeURIComponent(pattern)}/emails`, { credentials: 'include' });
      if (res.ok) {
        const emails = await res.json();
        setSourceEmails((prev) => ({ ...prev, [pattern]: emails }));
        setExpandedEmails((prev) => ({ ...prev, [pattern]: true }));
      }
    } catch (err) {
      console.error('Failed to load emails for source:', err);
    }
  };

  const toggleDiscover = async () => {
    if (orphans) {
      setOrphans(null);
      return;
    }
    setLoadingOrphans(true);
    try {
      const res = await fetch('/api/newsletter/sources/discover', { credentials: 'include' });
      if (res.ok) setOrphans(await res.json());
    } catch (err) {
      console.error('Failed to discover sources:', err);
    } finally {
      setLoadingOrphans(false);
    }
  };

  const addSource = async (fromAddress) => {
    setSourceMsg(null);
    try {
      const res = await fetch('/api/newsletter/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_pattern: fromAddress, status: 'new' }),
        credentials: 'include'
      });
      const data = await res.json();
      setSourceMsg(res.ok ? { type: 'success', text: data.message } : { type: 'error', text: data.error });
      if (res.ok) {
        setOrphans((prev) => prev ? prev.filter(o => o.from_address !== fromAddress) : null);
        loadSources();
      }
    } catch (err) {
      setSourceMsg({ type: 'error', text: 'Failed to add source' });
    }
  };

  const updateSource = async (pattern, body) => {
    setSourceMsg(null);
    try {
      const res = await fetch(`/api/newsletter/sources/${encodeURIComponent(pattern)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include'
      });
      const data = await res.json();
      setSourceMsg(res.ok ? { type: 'success', text: data.message } : { type: 'error', text: data.error });
      if (res.ok) {
        setSourceEdits((prev) => { const next = { ...prev }; delete next[pattern]; return next; });
        loadSources();
      }
    } catch (err) {
      setSourceMsg({ type: 'error', text: 'Update failed' });
    }
  };

  const deleteSource = async (pattern) => {
    if (!window.confirm(`Delete source "${pattern}" and all its emails?`)) return;
    setSourceMsg(null);
    try {
      const res = await fetch(`/api/newsletter/sources/${encodeURIComponent(pattern)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json();
      setSourceMsg(res.ok ? { type: 'success', text: data.message } : { type: 'error', text: data.error });
      if (res.ok) loadSources();
    } catch (err) {
      setSourceMsg({ type: 'error', text: 'Delete failed' });
    }
  };

  const handleAccept = (pattern) => {
    const edit = sourceEdits[pattern] || {};
    if (!edit.poiId) {
      setSourceMsg({ type: 'error', text: 'Select a POI first' });
      return;
    }
    updateSource(pattern, {
      poi_id: parseInt(edit.poiId, 10),
      status: 'accepted',
      display_name: edit.displayName || undefined
    });
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
        loadStats();
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
          text: `API key is valid! You have ${data.subscriberCount} subscriber${data.subscriberCount !== 1 ? 's' : ''}.`
        });
      } else {
        setTestMessage({
          type: 'error',
          text: data.error || 'API key test failed'
        });
      }

      setTimeout(() => setTestMessage(null), 5000);
    } catch (err) {
      setTestMessage({
        type: 'error',
        text: 'Failed to test API key. Please try again.'
      });
      setTimeout(() => setTestMessage(null), 5000);
    } finally {
      setTesting(false);
    }
  };

  const newSources = sources.filter(s => s.status === 'new');
  const acceptedSources = sources.filter(s => s.status === 'accepted');
  const blockedSources = sources.filter(s => s.status === 'blocked');

  const cardStyle = (bg) => ({
    border: '1px solid #ddd',
    borderRadius: '6px',
    padding: '12px',
    backgroundColor: bg
  });

  const renderSourceCard = (src, actions) => {
    const edit = sourceEdits[src.from_pattern] || {};
    const isExpanded = expandedEmails[src.from_pattern];
    const emails = sourceEmails[src.from_pattern] || [];
    return (
      <div key={src.from_pattern} style={cardStyle(src.status === 'new' ? '#fff8e1' : src.status === 'blocked' ? '#f5f5f5' : '#fff')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>
              {src.display_name || src.from_pattern}
            </div>
            {src.display_name && (
              <div style={{ fontSize: '0.85rem', color: '#666' }}>{src.from_pattern}</div>
            )}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#999', textAlign: 'right', whiteSpace: 'nowrap' }}>
            <span
              style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
              onClick={() => toggleEmails(src.from_pattern)}
              title="Click to show individual emails"
            >
              {src.email_count} email{src.email_count !== 1 ? 's' : ''}
            </span>
            {src.last_received && (
              <div>{new Date(src.last_received).toLocaleDateString()}</div>
            )}
          </div>
        </div>

        {src.status === 'accepted' && (
          <div style={{ fontSize: '0.85rem', marginTop: '4px' }}>
            POI: <strong>{src.poi_name}</strong> · {src.total_news} news, {src.total_events} events
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {actions === 'new' && (
            <>
              <select
                value={edit.poiId || ''}
                onChange={(ev) => setSourceEdits({ ...sourceEdits, [src.from_pattern]: { ...edit, poiId: ev.target.value } })}
              >
                <option value="">Select POI...</option>
                {pois.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="save-settings-btn" onClick={() => handleAccept(src.from_pattern)}>Accept</button>
              <button className="save-settings-btn" onClick={() => updateSource(src.from_pattern, { status: 'blocked' })}>Block</button>
              <button className="save-settings-btn" onClick={() => deleteSource(src.from_pattern)}>Delete</button>
            </>
          )}
          {actions === 'accepted' && (
            <>
              <button className="save-settings-btn" onClick={() => updateSource(src.from_pattern, { status: 'blocked' })}>Block</button>
              <button className="save-settings-btn" onClick={() => deleteSource(src.from_pattern)}>Delete</button>
            </>
          )}
          {actions === 'blocked' && (
            <>
              <select
                value={edit.poiId || ''}
                onChange={(ev) => setSourceEdits({ ...sourceEdits, [src.from_pattern]: { ...edit, poiId: ev.target.value } })}
              >
                <option value="">Select POI...</option>
                {pois.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="save-settings-btn" onClick={() => handleAccept(src.from_pattern)}>Accept</button>
              <button className="save-settings-btn" onClick={() => deleteSource(src.from_pattern)}>Delete</button>
            </>
          )}
          <button className="save-settings-btn" onClick={() => toggleEmails(src.from_pattern)}>
            {isExpanded ? 'Hide Emails' : 'Emails'}
          </button>
        </div>

        {isExpanded && (
          <div style={{ marginTop: '10px', borderTop: '1px solid #e0e0e0', paddingTop: '8px', maxHeight: '250px', overflowY: 'auto' }}>
            {emails.length === 0 ? (
              <p style={{ color: '#666', margin: 0, fontSize: '0.85rem' }}>No emails found for this source.</p>
            ) : (
              <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e0e0e0', textAlign: 'left' }}>
                    <th style={{ padding: '4px 6px' }}>Subject</th>
                    <th style={{ padding: '4px 6px' }}>Date</th>
                    <th style={{ padding: '4px 6px' }}>Status</th>
                    <th style={{ padding: '4px 6px' }}>Extracted</th>
                    <th style={{ padding: '4px 6px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {emails.map((em) => (
                    <tr key={em.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '4px 6px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {em.subject || '(no subject)'}
                      </td>
                      <td style={{ padding: '4px 6px', whiteSpace: 'nowrap', color: '#666' }}>
                        {em.received_at ? new Date(em.received_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        {em.processed ? (
                          <span style={{ color: '#2c5f2d' }}>Processed</span>
                        ) : em.error_message ? (
                          <span style={{ color: '#b8860b' }} title={em.error_message}>Pending</span>
                        ) : (
                          <span style={{ color: '#666' }}>Queued</span>
                        )}
                      </td>
                      <td style={{ padding: '4px 6px', color: '#666' }}>
                        {em.news_extracted ?? 0}N / {em.events_extracted ?? 0}E
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <a href={`/api/newsletter/emails/${em.id}/view`} target="_blank" rel="noopener noreferrer"
                           style={{ fontSize: '0.8rem' }}>View</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="newsletter-settings">
      {/* User Section - Subscribe to Newsletter */}
      <div className="settings-section">
        <h3>Newsletter Subscription</h3>
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
              {status === 'loading' ? 'Subscribing...' : 'Subscribe to Weekly Digest'}
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
              {message}
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
              {message}
            </div>
          )}
        </form>
      </div>

      <div className="settings-divider"></div>

      {/* Admin Section - Configuration */}
      <div className="settings-section">
        <h3>Admin Configuration</h3>
        <p className="settings-description">
          Configure Buttondown API integration and newsletter settings.
        </p>

        {/* Subscriber Stats */}
        {stats && (
          <div className="settings-info-box" style={{ marginBottom: '24px' }}>
            <div className="info-box-header">
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
            <div style={{ marginTop: '12px' }}>
              <button className="save-settings-btn" onClick={toggleSubscribers} disabled={loadingSubscribers}>
                {loadingSubscribers ? 'Loading...' : subscribers ? 'Hide Subscribers' : 'Subscribers'}
              </button>
            </div>
            {subscribers && (
              <div style={{ marginTop: '10px', maxHeight: '250px', overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: '4px', padding: '8px' }}>
                {subscribers.length === 0 ? (
                  <p style={{ color: '#666', margin: 0 }}>No subscribers found.</p>
                ) : (
                  <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <th style={{ textAlign: 'left', padding: '4px 8px' }}>Email</th>
                        <th style={{ textAlign: 'left', padding: '4px 8px' }}>Subscribed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subscribers.map((sub, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '4px 8px' }}>{sub.email}</td>
                          <td style={{ padding: '4px 8px', color: '#666' }}>
                            {sub.created ? new Date(sub.created).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
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
            Get your API key from <a href="https://buttondown.com/settings/api" target="_blank" rel="noopener noreferrer">Buttondown Settings &rarr; API</a>
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
            {adminSaving ? 'Saving...' : 'Save Admin Settings'}
          </button>

          <button
            onClick={handleTestApiKey}
            disabled={testing}
            className="save-settings-btn"
            style={{ marginLeft: '12px' }}
          >
            {testing ? 'Testing...' : 'Test API Key'}
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

      {/* Admin Section - Newsletter Sources */}
      <div className="settings-section">
        <h3>Newsletter Sources</h3>
        <p className="settings-description">
          Organizations that send newsletters to news@rootsofthevalley.org. Accept a source to
          map it to a POI and process its content. Block or delete unwanted senders.
        </p>

        <div style={{ marginBottom: '12px' }}>
          <button className="save-settings-btn" onClick={toggleDiscover} disabled={loadingOrphans}>
            {loadingOrphans ? 'Loading...' : orphans ? 'Hide Discovered' : 'Discover Sources'}
          </button>
        </div>

        {orphans && (
          <div style={{ marginBottom: '16px', border: '1px solid #e0e0e0', borderRadius: '6px', padding: '10px' }}>
            {orphans.length === 0 ? (
              <p style={{ color: '#666', margin: 0, fontSize: '0.85rem' }}>No unmapped senders found. All emails have a source.</p>
            ) : (
              <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e0e0e0', textAlign: 'left' }}>
                      <th style={{ padding: '4px 8px' }}>Sender</th>
                      <th style={{ padding: '4px 8px' }}>Emails</th>
                      <th style={{ padding: '4px 8px' }}>Last Received</th>
                      <th style={{ padding: '4px 8px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orphans.map((o) => (
                      <tr key={o.from_address} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '4px 8px', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {o.from_address}
                        </td>
                        <td style={{ padding: '4px 8px', color: '#666' }}>{o.email_count}</td>
                        <td style={{ padding: '4px 8px', color: '#666', whiteSpace: 'nowrap' }}>
                          {o.last_received ? new Date(o.last_received).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '4px 8px' }}>
                          <button className="save-settings-btn" onClick={() => addSource(o.from_address)}>Add</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {sourceMsg && (
          <div className={`save-message ${sourceMsg.type}`} style={{ marginBottom: '12px' }}>
            {sourceMsg.type === 'success' ? '✓' : '✗'} {sourceMsg.text}
          </div>
        )}

        {sources.length === 0 && !orphans ? (
          <p style={{ color: '#666' }}>No newsletter sources yet. Click "Discover Sources" to find senders from existing emails.</p>
        ) : (
          <>
            {newSources.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem', color: '#b8860b' }}>
                  New ({newSources.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {newSources.map(s => renderSourceCard(s, 'new'))}
                </div>
              </div>
            )}

            {acceptedSources.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem', color: '#2c5f2d' }}>
                  Accepted ({acceptedSources.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {acceptedSources.map(s => renderSourceCard(s, 'accepted'))}
                </div>
              </div>
            )}

            {blockedSources.length > 0 && (
              <div>
                <h4
                  style={{ margin: '0 0 8px', fontSize: '0.9rem', color: '#999', cursor: 'pointer' }}
                  onClick={() => setShowBlocked(!showBlocked)}
                >
                  Blocked ({blockedSources.length}) {showBlocked ? '▾' : '▸'}
                </h4>
                {showBlocked && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {blockedSources.map(s => renderSourceCard(s, 'blocked'))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="settings-divider"></div>

      {/* Info Section */}
      <div className="settings-info-box">
        <div className="info-box-header">
          <strong>Newsletter Configuration Guide</strong>
        </div>
        <ul className="info-list">
          <li><strong>Buttondown Setup:</strong> Sign up at <a href="https://buttondown.com" target="_blank" rel="noopener noreferrer">buttondown.com</a> (free for up to 100 subscribers)</li>
          <li><strong>Verify Email:</strong> Verify your sender email in Buttondown before sending</li>
          <li><strong>Get API Key:</strong> Generate an API key from Buttondown Settings &rarr; API</li>
          <li><strong>Schedule:</strong> Digest sends automatically every Friday at 8 AM EST</li>
          <li><strong>Content:</strong> Includes events (Fri-Sun) and recent news (last 7 days)</li>
          <li><strong>Testing:</strong> Use Settings &rarr; Jobs &rarr; Newsletter Digest &rarr; "Run Now" to test</li>
        </ul>
      </div>

      <div className="settings-divider"></div>

      <div className="settings-info-box">
        <div className="info-box-header">
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
