import React, { useState, useEffect, useCallback } from 'react';

// Data collection configuration: AI providers, credentials, moderation, infrastructure, sub-tabs.
// Job triggering, progress, and history are in the Jobs tab (JobsDashboard.jsx).
function DataCollectionSettings() {
  const [result, setResult] = useState(null);

  // AI provider configuration state
  const [aiConfig, setAiConfig] = useState({ primary: 'perplexity', fallback: 'none', primaryLimit: 0 });
  const [aiConfigLoading, setAiConfigLoading] = useState(true);
  const [aiConfigSaving, setAiConfigSaving] = useState(false);

  // Twitter credentials state
  const [twitterCredentials, setTwitterCredentials] = useState({ username: '', password: '' });
  const [twitterLoading, setTwitterLoading] = useState(true);
  const [twitterSaving, setTwitterSaving] = useState(false);

  // Twitter authentication state
  const [twitterAuthStatus, setTwitterAuthStatus] = useState(null);
  const [twitterAuthLoading, setTwitterAuthLoading] = useState(false);
  const [twitterAuthTesting, setTwitterAuthTesting] = useState(false);
  const [twitterCookiesJson, setTwitterCookiesJson] = useState('');
  const [showCookieInput, setShowCookieInput] = useState(false);

  // Apify API token state
  const [apifyToken, setApifyToken] = useState('');
  const [apifyTokenSet, setApifyTokenSet] = useState(false);
  const [apifySaving, setApifySaving] = useState(false);

  // Serper API key state
  const [serperApiKey, setSerperApiKey] = useState('');
  const [serperApiKeySet, setSerperApiKeySet] = useState(false);
  const [serperSaving, setSerperSaving] = useState(false);
  const [serperTesting, setSerperTesting] = useState(false);

  // Playwright status state
  const [playwrightStatus, setPlaywrightStatus] = useState(null);
  const [playwrightLoading, setPlaywrightLoading] = useState(true);
  const [playwrightTesting, setPlaywrightTesting] = useState(false);

  // Moderation configuration state
  const [moderationConfig, setModerationConfig] = useState({
    enabled: true, autoApproveEnabled: true, autoApproveThreshold: 0.9, photoSubmissionsEnabled: false
  });
  const [moderationConfigLoading, setModerationConfigLoading] = useState(true);
  const [moderationConfigSaving, setModerationConfigSaving] = useState(false);

  // Domain lists state
  const [domainLists, setDomainLists] = useState({ trusted: [], competitor: [] });
  const [domainListsLoading, setDomainListsLoading] = useState(true);
  const [domainListsSaving, setDomainListsSaving] = useState(false);
  const [newTrustedDomain, setNewTrustedDomain] = useState('');
  const [newCompetitorDomain, setNewCompetitorDomain] = useState('');

  // Results Sub-tabs state
  const [subtabs, setSubtabs] = useState([]);
  const [subtabsLoading, setSubtabsLoading] = useState(true);
  const [subtabsSaving, setSubtabsSaving] = useState(false);
  const [editingSubtab, setEditingSubtab] = useState(null);
  const [addingSubtab, setAddingSubtab] = useState(false);
  const [subtabForm, setSubtabForm] = useState({ id: '', label: '', shortLabel: '', route: '/', filterTypes: [] });

  const KNOWN_ROUTES = [
    { value: '/', label: '/ (Home / All Results)' },
    { value: '/mtb-trail-status', label: '/mtb-trail-status (MTB Trails)' },
    { value: '/organizations', label: '/organizations (Organizations)' }
  ];

  const fetchSubtabs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/results-subtabs', { credentials: 'include' });
      if (res.ok) { const data = await res.json(); setSubtabs(data.subtabs || []); }
    } catch (err) { console.error('Failed to fetch subtabs:', err); }
    finally { setSubtabsLoading(false); }
  }, []);

  const handleSaveSubtabs = async () => {
    setSubtabsSaving(true);
    try {
      const res = await fetch('/api/admin/results-subtabs', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ subtabs })
      });
      if (res.ok) { setResult({ type: 'success', message: 'Results sub-tabs saved successfully' }); await fetchSubtabs(); }
      else { const err = await res.json(); setResult({ type: 'error', message: err.error || 'Failed to save sub-tabs' }); }
    } catch (err) { setResult({ type: 'error', message: 'Failed to save sub-tabs: ' + err.message }); }
    finally { setSubtabsSaving(false); }
  };

  useEffect(() => {
    fetchAiConfig();
    fetchTwitterCredentials();
    fetchTwitterAuthStatus();
    fetchApifyStatus();
    fetchSerperStatus();
    fetchPlaywrightStatus();
    fetchModerationConfig();
    fetchDomainLists();
    fetchSubtabs();
  }, []);

  // Auto-dismiss result notifications after 5 seconds
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(timer);
  }, [result]);

  const fetchAiConfig = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) {
        const settings = await response.json();
        setAiConfig({
          primary: settings.ai_search_primary?.value || 'perplexity',
          fallback: settings.ai_search_fallback?.value || 'none',
          primaryLimit: parseInt(settings.ai_search_primary_limit?.value) || 0
        });
      }
    } catch (err) { console.error('Error fetching AI config:', err); }
    finally { setAiConfigLoading(false); }
  };

  const fetchTwitterCredentials = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) {
        const settings = await response.json();
        setTwitterCredentials({ username: settings.twitter_username?.value || '', password: settings.twitter_password?.value || '' });
      }
    } catch (err) { console.error('Error fetching Twitter credentials:', err); }
    finally { setTwitterLoading(false); }
  };

  const fetchApifyStatus = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) { const settings = await response.json(); setApifyTokenSet(settings.apify_api_token?.isSet || false); }
    } catch (err) { console.error('Error fetching Apify status:', err); }
  };

  const handleSaveApifyToken = async () => {
    if (!apifyToken.trim()) { setResult({ type: 'error', message: 'API token cannot be empty' }); return; }
    setApifySaving(true); setResult(null);
    try {
      const response = await fetch('/api/admin/settings/apify_api_token', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ value: apifyToken })
      });
      if (response.ok) { setResult({ type: 'success', message: 'Apify API token saved successfully' }); setApifyToken(''); setApifyTokenSet(true); }
      else { const error = await response.json(); throw new Error(error.error || 'Failed to save token'); }
    } catch (err) { setResult({ type: 'error', message: `Failed to save Apify token: ${err.message}` }); }
    finally { setApifySaving(false); }
  };

  const fetchSerperStatus = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) { const settings = await response.json(); setSerperApiKeySet(settings.serper_api_key?.isSet || false); }
    } catch (err) { console.error('Error fetching Serper status:', err); }
  };

  const handleSaveSerperApiKey = async () => {
    if (!serperApiKey.trim()) { setResult({ type: 'error', message: 'API key cannot be empty' }); return; }
    setSerperSaving(true); setResult(null);
    try {
      const response = await fetch('/api/admin/settings/serper_api_key', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ value: serperApiKey })
      });
      if (response.ok) { setResult({ type: 'success', message: 'Serper API key saved successfully' }); setSerperApiKey(''); setSerperApiKeySet(true); }
      else { const error = await response.json(); throw new Error(error.error || 'Failed to save key'); }
    } catch (err) { setResult({ type: 'error', message: `Failed to save Serper API key: ${err.message}` }); }
    finally { setSerperSaving(false); }
  };

  const handleTestSerperApiKey = async () => {
    setSerperTesting(true); setResult(null);
    try {
      const response = await fetch('/api/admin/settings/serper-api-key/test', {
        method: 'POST', credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setResult({ type: 'success', message: 'Serper API key is valid and working!' });
      } else {
        setResult({ type: 'error', message: data.message || 'Serper API key test failed' });
      }
    } catch (err) { setResult({ type: 'error', message: `Test failed: ${err.message}` }); }
    finally { setSerperTesting(false); }
  };

  const handleSaveAiConfig = async () => {
    setAiConfigSaving(true); setResult(null);
    try {
      const settings = [
        { key: 'ai_search_primary', value: aiConfig.primary },
        { key: 'ai_search_fallback', value: aiConfig.fallback },
        { key: 'ai_search_primary_limit', value: String(aiConfig.primaryLimit) }
      ];
      for (const setting of settings) {
        const response = await fetch(`/api/admin/settings/${setting.key}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ value: setting.value })
        });
        if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Failed to save setting'); }
      }
      setResult({ type: 'success', message: 'AI provider configuration saved successfully' });
    } catch (err) { setResult({ type: 'error', message: `Failed to save AI config: ${err.message}` }); }
    finally { setAiConfigSaving(false); }
  };

  const handleSaveTwitterCredentials = async () => {
    setTwitterSaving(true); setResult(null);
    try {
      const settings = [
        { key: 'twitter_username', value: twitterCredentials.username },
        { key: 'twitter_password', value: twitterCredentials.password }
      ];
      for (const setting of settings) {
        const response = await fetch(`/api/admin/settings/${setting.key}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ value: setting.value })
        });
        if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Failed to save setting'); }
      }
      setResult({ type: 'success', message: 'Twitter credentials saved successfully' });
    } catch (err) { setResult({ type: 'error', message: `Failed to save Twitter credentials: ${err.message}` }); }
    finally { setTwitterSaving(false); }
  };

  const fetchTwitterAuthStatus = async () => {
    try {
      const response = await fetch('/api/admin/twitter/auth-status', { credentials: 'include' });
      if (response.ok) setTwitterAuthStatus(await response.json());
    } catch (err) { console.error('Error fetching Twitter auth status:', err); }
  };

  const fetchPlaywrightStatus = async () => {
    setPlaywrightLoading(true);
    try {
      const response = await fetch('/api/admin/playwright/status', { credentials: 'include' });
      if (response.ok) setPlaywrightStatus(await response.json());
      else setPlaywrightStatus({ status: 'error', message: 'Failed to check Playwright status' });
    } catch (err) { setPlaywrightStatus({ status: 'error', message: err.message }); }
    finally { setPlaywrightLoading(false); }
  };

  const fetchModerationConfig = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) {
        const settings = await response.json();
        setModerationConfig({
          enabled: settings.moderation_enabled?.value !== 'false',
          autoApproveEnabled: settings.moderation_auto_approve_enabled?.value !== 'false',
          autoApproveThreshold: parseFloat(settings.moderation_auto_approve_threshold?.value) || 0.9,
          photoSubmissionsEnabled: settings.photo_submissions_enabled?.value === 'true'
        });
      }
    } catch (err) { console.error('Error fetching moderation config:', err); }
    finally { setModerationConfigLoading(false); }
  };

  const handleSaveModerationConfig = async () => {
    setModerationConfigSaving(true); setResult(null);
    try {
      const settings = [
        { key: 'moderation_enabled', value: String(moderationConfig.enabled) },
        { key: 'moderation_auto_approve_enabled', value: String(moderationConfig.autoApproveEnabled) },
        { key: 'moderation_auto_approve_threshold', value: String(moderationConfig.autoApproveThreshold) },
        { key: 'photo_submissions_enabled', value: String(moderationConfig.photoSubmissionsEnabled) }
      ];
      for (const setting of settings) {
        const response = await fetch(`/api/admin/settings/${setting.key}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ value: setting.value })
        });
        if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Failed to save setting'); }
      }
      setResult({ type: 'success', message: 'Moderation configuration saved' });
    } catch (err) { setResult({ type: 'error', message: `Failed to save moderation config: ${err.message}` }); }
    finally { setModerationConfigSaving(false); }
  };

  const fetchDomainLists = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) {
        const settings = await response.json();
        const trusted = settings.moderation_trusted_domains?.value || '[]';
        const competitor = settings.moderation_competitor_domains?.value || '[]';
        try {
          const parsedTrusted = JSON.parse(trusted);
          const parsedCompetitor = JSON.parse(competitor);
          setDomainLists({
            trusted: Array.isArray(parsedTrusted) ? parsedTrusted.filter(d => typeof d === 'string') : [],
            competitor: Array.isArray(parsedCompetitor) ? parsedCompetitor.filter(d => typeof d === 'string') : []
          });
          if (!Array.isArray(parsedTrusted) || !Array.isArray(parsedCompetitor)) {
            setResult({ type: 'error', message: 'Domain lists configuration error - invalid format' });
          }
        } catch (e) {
          console.error('Failed to parse domain lists:', e);
          setResult({ type: 'error', message: 'Failed to load domain lists - invalid JSON' });
        }
      }
    } catch (err) { console.error('Error fetching domain lists:', err); }
    finally { setDomainListsLoading(false); }
  };

  const handleSaveDomainLists = async () => {
    setDomainListsSaving(true); setResult(null);
    try {
      const settings = [
        { key: 'moderation_trusted_domains', value: JSON.stringify(domainLists.trusted) },
        { key: 'moderation_competitor_domains', value: JSON.stringify(domainLists.competitor) }
      ];
      // Note: N+1 pattern - acceptable for 2 settings, batch endpoint would be better for scale
      for (const setting of settings) {
        const response = await fetch(`/api/admin/settings/${setting.key}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ value: setting.value })
        });
        if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Failed to save setting'); }
      }
      setResult({ type: 'success', message: 'Domain lists saved' });
    } catch (err) { setResult({ type: 'error', message: `Failed to save domain lists: ${err.message}` }); }
    finally { setDomainListsSaving(false); }
  };

  const handleAddTrustedDomain = () => {
    const domain = newTrustedDomain.trim().toLowerCase();
    // Basic domain validation: alphanumeric + dots + hyphens
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
    if (!domain) return;
    if (!domainRegex.test(domain)) {
      setResult({ type: 'error', message: 'Invalid domain format (e.g., example.com)' });
      return;
    }
    if (!domainLists.trusted.includes(domain)) {
      setDomainLists({ ...domainLists, trusted: [...domainLists.trusted, domain] });
      setNewTrustedDomain('');
    }
  };

  const handleRemoveTrustedDomain = (domain) => {
    setDomainLists({ ...domainLists, trusted: domainLists.trusted.filter(d => d !== domain) });
  };

  const handleAddCompetitorDomain = () => {
    const domain = newCompetitorDomain.trim().toLowerCase();
    // Basic domain validation: alphanumeric + dots + hyphens
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
    if (!domain) return;
    if (!domainRegex.test(domain)) {
      setResult({ type: 'error', message: 'Invalid domain format (e.g., example.com)' });
      return;
    }
    if (!domainLists.competitor.includes(domain)) {
      setDomainLists({ ...domainLists, competitor: [...domainLists.competitor, domain] });
      setNewCompetitorDomain('');
    }
  };

  const handleRemoveCompetitorDomain = (domain) => {
    setDomainLists({ ...domainLists, competitor: domainLists.competitor.filter(d => d !== domain) });
  };

  const handleTestPlaywright = async () => {
    setPlaywrightTesting(true); setResult(null);
    try {
      const response = await fetch('/api/admin/playwright/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ url: 'https://example.com' })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setResult({ type: 'success', message: `Playwright test passed! Rendered "${data.title}" (${data.text_length} chars, ${data.links_found} links) in ${data.elapsed_ms}ms` });
      } else {
        setResult({ type: 'error', message: `Playwright test failed: ${data.message}` });
      }
      await fetchPlaywrightStatus();
    } catch (err) { setResult({ type: 'error', message: `Playwright test error: ${err.message}` }); }
    finally { setPlaywrightTesting(false); }
  };

  const handleTwitterLogin = () => {
    window.open('https://x.com/login', '_blank');
    setShowCookieInput(true);
    setResult({ type: 'info', message: 'Twitter login opened in new tab. After logging in, use a browser extension like "Cookie-Editor" to export cookies from x.com as JSON, then paste below.' });
  };

  const handleSaveCookies = async () => {
    setTwitterAuthLoading(true); setResult(null);
    try {
      if (!twitterCookiesJson.trim()) { setResult({ type: 'error', message: 'Please paste cookies JSON' }); setTwitterAuthLoading(false); return; }
      const response = await fetch('/api/admin/twitter/save-cookies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ cookies: twitterCookiesJson })
      });
      const data = await response.json();
      if (data.success) {
        setResult({ type: 'success', message: `Twitter cookies saved! Expires: ${new Date(data.expires).toLocaleDateString()}` });
        setTwitterCookiesJson(''); setShowCookieInput(false); await fetchTwitterAuthStatus();
      } else { setResult({ type: 'error', message: data.error || 'Failed to save cookies' }); }
    } catch (err) { setResult({ type: 'error', message: `Save error: ${err.message}` }); }
    finally { setTwitterAuthLoading(false); }
  };

  const handleTestTwitterAuth = async () => {
    setTwitterAuthTesting(true); setResult(null);
    try {
      const response = await fetch('/api/admin/twitter/test-cookies', { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (data.success && data.logged_in) { setResult({ type: 'success', message: 'Twitter authentication is working! Cookies are valid.' }); }
      else { setResult({ type: 'error', message: data.message || 'Twitter cookies have expired. Please log in again.' }); }
      await fetchTwitterAuthStatus();
    } catch (err) { setResult({ type: 'error', message: `Test failed: ${err.message}` }); }
    finally { setTwitterAuthTesting(false); }
  };

  return (
    <div className="data-collection-settings">
      <h3>Data Collection Configuration</h3>
      <p className="settings-description" style={{ marginBottom: '16px' }}>
        Configure AI providers, credentials, and infrastructure for data collection jobs.
        To trigger and monitor jobs, use the <strong>Jobs</strong> tab.
      </p>

      {/* AI Provider Configuration */}
      <div className="ai-config-section">
        <h4>AI Search Provider</h4>
        <p className="settings-description">Configure which AI provider to use for news/events web search.</p>
        {aiConfigLoading ? <p>Loading configuration...</p> : (
          <>
            <div className="config-row">
              <label>Primary Provider:</label>
              <select value={aiConfig.primary} onChange={e => setAiConfig({...aiConfig, primary: e.target.value})} disabled={aiConfigSaving}>
                <option value="gemini">Google Gemini (with Google Search)</option>
                <option value="perplexity">Perplexity Sonar (with web search)</option>
              </select>
            </div>
            <div className="config-row">
              <label>Fallback Provider:</label>
              <select value={aiConfig.fallback} onChange={e => setAiConfig({...aiConfig, fallback: e.target.value})} disabled={aiConfigSaving}>
                <option value="none">None (no fallback)</option>
                <option value="gemini">Google Gemini</option>
                <option value="perplexity">Perplexity Sonar</option>
              </select>
              <span className="config-hint">Used if primary provider fails or hits its limit</span>
            </div>
            <div className="config-row">
              <label>Primary Limit (0 = unlimited):</label>
              <input type="number" value={aiConfig.primaryLimit === 0 ? '' : aiConfig.primaryLimit}
                onChange={e => setAiConfig({...aiConfig, primaryLimit: e.target.value === '' ? 0 : parseInt(e.target.value) || 0})}
                onBlur={e => { if (e.target.value === '') setAiConfig({...aiConfig, primaryLimit: 0}); }}
                placeholder="0" min="0" step="100" disabled={aiConfigSaving} />
              <span className="config-hint">Switch to fallback after this many requests per job</span>
            </div>
            <button className="action-btn primary" onClick={handleSaveAiConfig} disabled={aiConfigSaving}>
              {aiConfigSaving ? 'Saving...' : 'Save AI Configuration'}
            </button>
          </>
        )}
      </div>

      {/* Twitter Credentials Configuration */}
      <div className="ai-config-section">
        <h4>Twitter/X Credentials</h4>
        <p className="settings-description">Login credentials for scraping Twitter content (used for Trail Status).</p>
        {twitterLoading ? <p>Loading credentials...</p> : (
          <>
            <div style={{ marginTop: '0.5rem' }}>
              <h5 style={{ marginBottom: '0.5rem' }}>Authentication Status</h5>
              <p className="settings-description" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                Twitter authentication uses browser cookies. Log in to Twitter in your browser, then export cookies below. Cookies last 30-90 days.
              </p>
              {twitterAuthStatus && (
                <div className="config-row" style={{ marginBottom: '1rem' }}>
                  <label>Status:</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {twitterAuthStatus.authenticated ? (
                      <>
                        <span style={{ color: '#4caf50', fontWeight: 'bold' }}>Authenticated</span>
                        <span style={{ fontSize: '0.85rem', color: '#666' }}>Expires: {new Date(twitterAuthStatus.expires).toLocaleDateString()}</span>
                      </>
                    ) : (
                      <span style={{ color: '#f44336', fontWeight: 'bold' }}>Not Authenticated</span>
                    )}
                  </div>
                </div>
              )}
              {twitterAuthStatus && twitterAuthStatus.cookies_possibly_stale && (
                <div style={{ padding: '0.75rem', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                  <strong>Cookies may be stale.</strong> Trail status collection has failed {twitterAuthStatus.consecutive_failures} times in a row.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '0.5rem' }}>
              <button className="action-btn primary" onClick={handleTwitterLogin} disabled={twitterAuthLoading}>Login to Twitter</button>
              {twitterAuthStatus && twitterAuthStatus.authenticated && (
                <button className="action-btn secondary" onClick={handleTestTwitterAuth} disabled={twitterAuthTesting}>
                  {twitterAuthTesting ? 'Testing...' : 'Test Authentication'}
                </button>
              )}
            </div>
            {showCookieInput && (
              <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                <h5 style={{ marginBottom: '0.5rem', fontSize: '0.95rem' }}>Export Cookies from Browser</h5>
                <ol style={{ fontSize: '0.85rem', marginBottom: '1rem', paddingLeft: '1.5rem' }}>
                  <li>Install browser extension: <a href="https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm" target="_blank" rel="noopener noreferrer">Cookie-Editor for Chrome</a> or <a href="https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/" target="_blank" rel="noopener noreferrer">Firefox</a></li>
                  <li>Log in to Twitter in the opened tab</li>
                  <li>Click the Cookie-Editor extension icon</li>
                  <li>Click &quot;Export&quot; &gt; &quot;JSON&quot; format</li>
                  <li>Paste the JSON below</li>
                </ol>
                <textarea value={twitterCookiesJson} onChange={e => setTwitterCookiesJson(e.target.value)}
                  placeholder='Paste cookies JSON here...' rows="6"
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem', padding: '0.75rem', border: '1px solid #ccc', borderRadius: '4px', marginBottom: '1rem' }} />
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="action-btn primary" onClick={handleSaveCookies} disabled={twitterAuthLoading || !twitterCookiesJson.trim()}>
                    {twitterAuthLoading ? 'Saving...' : 'Save Cookies'}
                  </button>
                  <button className="action-btn secondary" onClick={() => { setShowCookieInput(false); setTwitterCookiesJson(''); }}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Apify API Token */}
      <div className="ai-config-section">
        <h4>Apify API Token</h4>
        <p className="settings-description">Required for scraping Twitter/X and Facebook trail status pages.</p>
        <div className="config-row">
          <label>Status:</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className={`status-indicator ${apifyTokenSet ? 'configured' : 'not-configured'}`}></span>
            <span>{apifyTokenSet ? 'API token configured' : 'API token not configured'}</span>
          </div>
        </div>
        <div className="config-row">
          <label>API Token:</label>
          <input type="password" value={apifyToken} onChange={e => setApifyToken(e.target.value)} placeholder="Enter Apify API token..." disabled={apifySaving} />
        </div>
        <button className="action-btn primary" onClick={handleSaveApifyToken} disabled={apifySaving || !apifyToken.trim()}>
          {apifySaving ? 'Saving...' : 'Save Token'}
        </button>
        <p className="settings-description" style={{ fontSize: '0.85rem', marginTop: '0.75rem' }}>
          Get your token from <a href="https://console.apify.com/account/integrations" target="_blank" rel="noopener noreferrer">Apify Console</a>
        </p>
      </div>

      {/* Serper API Key */}
      <div className="ai-config-section">
        <h4>Serper API Key</h4>
        <p className="settings-description">Required for external news search with geographic grounding (Layer 2 news collection).</p>
        <div className="config-row">
          <label>Status:</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className={`status-indicator ${serperApiKeySet ? 'configured' : 'not-configured'}`}></span>
            <span>{serperApiKeySet ? 'API key configured' : 'API key not configured'}</span>
          </div>
        </div>
        <div className="config-row">
          <label>API Key:</label>
          <input type="password" value={serperApiKey} onChange={e => setSerperApiKey(e.target.value)} placeholder="Enter Serper API key..." disabled={serperSaving} />
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="action-btn primary" onClick={handleSaveSerperApiKey} disabled={serperSaving || !serperApiKey.trim()}>
            {serperSaving ? 'Saving...' : 'Save API Key'}
          </button>
          {serperApiKeySet && (
            <button className="action-btn secondary" onClick={handleTestSerperApiKey} disabled={serperTesting}>
              {serperTesting ? 'Testing...' : 'Test API Key'}
            </button>
          )}
        </div>
        <p className="settings-description" style={{ fontSize: '0.85rem', marginTop: '0.75rem' }}>
          Get your API key from <a href="https://serper.dev/api-key" target="_blank" rel="noopener noreferrer">Serper.dev Dashboard</a>. Cost: ~$0.03/month for 100 POIs.
        </p>
      </div>

      {/* Moderation Configuration */}
      <div className="ai-config-section">
        <h4>Content Moderation</h4>
        <p className="settings-description">Configure AI-powered moderation for news, events, and photo submissions.</p>
        {moderationConfigLoading ? <p>Loading configuration...</p> : (
          <>
            <div className="config-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={moderationConfig.enabled} onChange={e => setModerationConfig({...moderationConfig, enabled: e.target.checked})} disabled={moderationConfigSaving} />
                Enable Moderation
              </label>
              <span className="config-hint">When disabled, new content auto-publishes without review</span>
            </div>
            <div className="config-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={moderationConfig.autoApproveEnabled} onChange={e => setModerationConfig({...moderationConfig, autoApproveEnabled: e.target.checked})} disabled={moderationConfigSaving || !moderationConfig.enabled} />
                Auto-Approve High Confidence
              </label>
              <span className="config-hint">Automatically publish items scoring above the threshold</span>
            </div>
            <div className="config-row">
              <label>Auto-Approve Threshold:</label>
              <input type="number" value={moderationConfig.autoApproveThreshold} onChange={e => setModerationConfig({...moderationConfig, autoApproveThreshold: parseFloat(e.target.value) || 0})}
                min="0" max="1" step="0.05" disabled={moderationConfigSaving || !moderationConfig.enabled || !moderationConfig.autoApproveEnabled} style={{ width: '80px' }} />
              <span className="config-hint">Score 0.0-1.0 (recommended: 0.9)</span>
            </div>
            <div className="config-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={moderationConfig.photoSubmissionsEnabled} onChange={e => setModerationConfig({...moderationConfig, photoSubmissionsEnabled: e.target.checked})} disabled={moderationConfigSaving} />
                Allow Photo Submissions
              </label>
              <span className="config-hint">Let authenticated users submit photos for POIs</span>
            </div>
            <button className="action-btn primary" onClick={handleSaveModerationConfig} disabled={moderationConfigSaving}>
              {moderationConfigSaving ? 'Saving...' : 'Save Moderation Configuration'}
            </button>
          </>
        )}
      </div>

      {/* Quality Filter Domain Lists */}
      <div className="ai-config-section">
        <h4>Quality Filter Domain Lists</h4>
        <p className="settings-description">Manage trusted and competitor domains for quality filtering in moderation.</p>
        {domainListsLoading ? <p>Loading domain lists...</p> : (
          <>
            <div style={{ marginBottom: '1.5rem' }}>
              <h5 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: '#28a745' }}>Trusted Domains</h5>
              <p className="config-hint" style={{ marginBottom: '0.75rem' }}>These domains are considered reliable news sources and receive no penalty.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {domainLists.trusted.map(domain => (
                  <span key={domain} style={{
                    padding: '0.25rem 0.5rem',
                    backgroundColor: '#d4edda',
                    color: '#155724',
                    borderRadius: '4px',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    {domain}
                    <button onClick={() => handleRemoveTrustedDomain(domain)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#155724',
                        cursor: 'pointer',
                        padding: '0',
                        fontSize: '1rem',
                        lineHeight: '1'
                      }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={newTrustedDomain}
                  onChange={e => setNewTrustedDomain(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && handleAddTrustedDomain()}
                  placeholder="example.com"
                  style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}
                  disabled={domainListsSaving}
                />
                <button className="action-btn secondary" onClick={handleAddTrustedDomain} disabled={domainListsSaving || !newTrustedDomain.trim()}>Add</button>
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <h5 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: '#dc3545' }}>Competitor/Scam Domains</h5>
              <p className="config-hint" style={{ marginBottom: '0.75rem' }}>These domains receive a severe penalty (×0.3 confidence score).</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {domainLists.competitor.map(domain => (
                  <span key={domain} style={{
                    padding: '0.25rem 0.5rem',
                    backgroundColor: '#f8d7da',
                    color: '#721c24',
                    borderRadius: '4px',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    {domain}
                    <button onClick={() => handleRemoveCompetitorDomain(domain)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#721c24',
                        cursor: 'pointer',
                        padding: '0',
                        fontSize: '1rem',
                        lineHeight: '1'
                      }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={newCompetitorDomain}
                  onChange={e => setNewCompetitorDomain(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && handleAddCompetitorDomain()}
                  placeholder="scam-site.com"
                  style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}
                  disabled={domainListsSaving}
                />
                <button className="action-btn secondary" onClick={handleAddCompetitorDomain} disabled={domainListsSaving || !newCompetitorDomain.trim()}>Add</button>
              </div>
            </div>

            <button className="action-btn primary" onClick={handleSaveDomainLists} disabled={domainListsSaving}>
              {domainListsSaving ? 'Saving...' : 'Save Domain Lists'}
            </button>
          </>
        )}
      </div>

      {/* Playwright Status */}
      <div className="playwright-status-section" style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h4 style={{ margin: 0, fontSize: '1rem' }}>Browser Rendering (Playwright)</h4>
          <button className="action-btn secondary" onClick={handleTestPlaywright} disabled={playwrightLoading || playwrightTesting}
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}>
            {playwrightTesting ? 'Testing...' : 'Test'}
          </button>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.75rem' }}>Required for Twitter/X status pages and JavaScript-heavy websites.</p>
        {playwrightLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="pulse" style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ffc107' }}></span>
            <span style={{ fontSize: '0.9rem' }}>Checking Playwright status...</span>
          </div>
        ) : playwrightStatus ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {playwrightStatus.status === 'working' ? (
              <>
                <span style={{ color: '#28a745', fontWeight: 'bold', fontSize: '0.95rem' }}>Working</span>
                <span style={{ fontSize: '0.85rem', color: '#666' }}>Chromium {playwrightStatus.browser_version} - Launch: {playwrightStatus.launch_time_ms}ms</span>
              </>
            ) : (
              <>
                <span style={{ color: '#dc3545', fontWeight: 'bold', fontSize: '0.95rem' }}>Not Working</span>
                <span style={{ fontSize: '0.85rem', color: '#666' }}>{playwrightStatus.message}</span>
                {playwrightStatus.suggestion && (
                  <div style={{ width: '100%', marginTop: '0.5rem', padding: '0.5rem', backgroundColor: '#fff3cd', borderRadius: '4px', fontSize: '0.85rem' }}>
                    <strong>Fix:</strong> {playwrightStatus.suggestion}
                  </div>
                )}
              </>
            )}
          </div>
        ) : <span style={{ color: '#6c757d', fontSize: '0.9rem' }}>Status unknown</span>}
      </div>

      {/* Results Sub-tabs Configuration */}
      <div className="ai-config-section">
        <h4>Results Sub-tabs</h4>
        <p className="settings-description">Configure which sub-tabs appear in the public Results tab.</p>
        {subtabsLoading ? <p>Loading sub-tabs...</p> : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              {subtabs.map(tab => (
                <div key={tab.id} style={{
                  border: '1px solid #ddd', borderRadius: '6px', padding: '10px 14px',
                  backgroundColor: editingSubtab === tab.id ? '#fff8e1' : '#fafafa',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px'
                }}>
                  {editingSubtab === tab.id ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <input type="text" value={subtabForm.label} onChange={(e) => setSubtabForm(prev => ({ ...prev, label: e.target.value }))}
                          placeholder="Label" style={{ flex: 1, minWidth: '120px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }} />
                        <input type="text" value={subtabForm.shortLabel} onChange={(e) => setSubtabForm(prev => ({ ...prev, shortLabel: e.target.value }))}
                          placeholder="Short label" style={{ width: '120px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }} />
                        <select value={subtabForm.route} onChange={(e) => setSubtabForm(prev => ({ ...prev, route: e.target.value }))}
                          style={{ width: '220px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                          {KNOWN_ROUTES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="sync-btn-small" onClick={() => {
                          setSubtabs(prev => prev.map(t => t.id === editingSubtab ? { ...t, label: subtabForm.label, shortLabel: subtabForm.shortLabel || subtabForm.label, route: subtabForm.route } : t));
                          setEditingSubtab(null); setSubtabForm({ id: '', label: '', shortLabel: '', route: '/', filterTypes: [] });
                        }}>Save</button>
                        <button className="sync-btn-small" onClick={() => { setEditingSubtab(null); setSubtabForm({ id: '', label: '', shortLabel: '', route: '/', filterTypes: [] }); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                        <span style={{ fontWeight: 500 }}>{tab.label}</span>
                        <code style={{ fontSize: '0.75rem', color: '#888' }}>{tab.route}</code>
                        {tab.shortLabel && tab.shortLabel !== tab.label && <span style={{ fontSize: '0.75rem', color: '#aaa' }}>({tab.shortLabel})</span>}
                        {tab.protected && <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '3px', backgroundColor: '#e3f2fd', color: '#1565c0' }}>Protected</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {!tab.protected ? (
                          <>
                            <button className="sync-btn-small" onClick={() => { setEditingSubtab(tab.id); setSubtabForm({ id: tab.id, label: tab.label, shortLabel: tab.shortLabel || '', route: tab.route, filterTypes: tab.filterTypes || [] }); }}>Edit</button>
                            <button className="sync-btn-small" onClick={() => setSubtabs(prev => prev.filter(t => t.id !== tab.id))} style={{ color: '#c62828' }}>Delete</button>
                          </>
                        ) : <span style={{ fontSize: '0.75rem', color: '#999', fontStyle: 'italic' }}>Locked</span>}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {addingSubtab ? (
              <div style={{ border: '1px dashed #aaa', borderRadius: '6px', padding: '12px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <input type="text" value={subtabForm.id} onChange={(e) => setSubtabForm(prev => ({ ...prev, id: e.target.value.replace(/\s+/g, '-').toLowerCase() }))}
                    placeholder="ID (e.g. my-tab)" style={{ width: '120px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }} />
                  <input type="text" value={subtabForm.label} onChange={(e) => setSubtabForm(prev => ({ ...prev, label: e.target.value }))}
                    placeholder="Label" style={{ flex: 1, minWidth: '120px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }} />
                  <input type="text" value={subtabForm.shortLabel} onChange={(e) => setSubtabForm(prev => ({ ...prev, shortLabel: e.target.value }))}
                    placeholder="Short label" style={{ width: '120px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }} />
                  <select value={subtabForm.route} onChange={(e) => setSubtabForm(prev => ({ ...prev, route: e.target.value }))}
                    style={{ width: '220px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                    {KNOWN_ROUTES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="sync-btn-small" onClick={() => {
                    if (!subtabForm.id || !subtabForm.label) return;
                    setSubtabs(prev => [...prev, { id: subtabForm.id, label: subtabForm.label, shortLabel: subtabForm.shortLabel || subtabForm.label, route: subtabForm.route, filterTypes: subtabForm.filterTypes.length > 0 ? subtabForm.filterTypes : null, protected: false }]);
                    setSubtabForm({ id: '', label: '', shortLabel: '', route: '/', filterTypes: [] }); setAddingSubtab(false);
                  }}>Add</button>
                  <button className="sync-btn-small" onClick={() => { setAddingSubtab(false); setSubtabForm({ id: '', label: '', shortLabel: '', route: '/', filterTypes: [] }); }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="sync-btn-small" onClick={() => setAddingSubtab(true)}>+ Add Sub-tab</button>
            )}

            <div style={{ marginTop: '12px' }}>
              <button className="action-btn primary" onClick={handleSaveSubtabs} disabled={subtabsSaving}>
                {subtabsSaving ? 'Saving...' : 'Save Sub-tab Configuration'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Result message */}
      {result && <div className={`result-message ${result.type}`}>{result.message}</div>}
    </div>
  );
}

export default DataCollectionSettings;
