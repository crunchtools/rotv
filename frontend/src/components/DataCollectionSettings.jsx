import React, { useState, useEffect, useCallback } from 'react';
import PoiSearchSelect from './PoiSearchSelect';
import FilterList, { FilterChip, FILTER_COLORS } from './FilterList';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MASKED_SECRET = '••••••••••••••••••••••••';
const SECRET_KEYS = ['openrouter_api_key', 'serper_api_key', 'usft_sharing_token', 'github_api_token'];

const KNOWN_ROUTES = [
  { value: '/', label: '/ (Home / All Results)' },
  { value: '/mtb-trail-status', label: '/mtb-trail-status (MTB Trails)' },
  { value: '/organizations', label: '/organizations (Organizations)' }
];

async function putSetting(key, value) {
  const response = await fetch(`/api/admin/settings/${key}`, {
    method: 'PUT', headers: JSON_HEADERS, credentials: 'include',
    body: JSON.stringify({ value })
  });
  if (!response.ok) {
    const failure = await response.json();
    throw new Error(failure.error || `Failed to save ${key}`);
  }
}

const positiveIntOr = (raw, fallback, min = 1) => {
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

const stringsOnly = (list) => (Array.isArray(list) ? list.filter(entry => typeof entry === 'string') : []);

// Result messages clear themselves after five seconds.
function useTransientResult() {
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(timer);
  }, [result]);
  return [result, setResult];
}

/**
 * One API-key panel: status dot, save-new-key input and a Test button.
 *
 * @param {object} props
 * @param {string} props.title - Panel heading.
 * @param {string} props.settingKey - Admin setting the key is saved under.
 * @param {string} props.testUrl - POST endpoint returning `{ success, ... }`.
 * @param {string} [props.testErrorField='message'] - Response field shown when success is false.
 * @param {string} [props.testPassedMessage] - Banner text when the test passes.
 * @param {string} props.noun - Name used in the "cannot be empty" message.
 * @param {string} props.placeholder - Input placeholder.
 * @param {boolean} props.isSet - Whether a key is already stored (drives the status dot).
 * @param {(settingKey: string) => void} props.onSaved - Called after a successful save,
 *   so the parent can refresh which keys are set.
 * @param {object} [props.sectionStyle] - Inline style for the panel wrapper.
 * @param {import('react').ReactNode} [props.children] - Extra content under the input.
 * Save and test outcomes show in the panel's own auto-dismissing result badge.
 */
function ApiKeySetting({ title, settingKey, testUrl, testErrorField = 'message', testPassedMessage = 'Test passed ✓', noun, placeholder, isSet, onSaved, sectionStyle, children }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useTransientResult();

  const handleSave = async () => {
    if (!value.trim()) { setResult({ type: 'error', message: `${noun} cannot be empty` }); return; }
    setSaving(true); setResult(null);
    try {
      await putSetting(settingKey, value);
      setResult({ type: 'success', message: 'Saved successfully' });
      setValue('');
      onSaved(settingKey);
    } catch (err) { setResult({ type: 'error', message: `Save failed: ${err.message}` }); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true); setResult(null);
    try {
      const response = await fetch(testUrl, { method: 'POST', credentials: 'include' });
      const outcome = await response.json();
      if (outcome.success) {
        setResult({ type: 'success', message: testPassedMessage });
      } else {
        setResult({ type: 'error', message: outcome[testErrorField] || 'Test failed' });
      }
    } catch (err) { setResult({ type: 'error', message: `Test failed: ${err.message}` }); }
    finally { setTesting(false); }
  };

  return (
    <div style={sectionStyle}>
      <h5 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>{title}</h5>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
        <span className={`status-indicator ${isSet ? 'configured' : 'not-configured'}`}></span>
        <span style={{ fontSize: '0.9rem' }}>{isSet ? 'Configured' : 'Not configured'}</span>
        {result && (
          <span
            style={{
              marginLeft: '12px',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '0.85rem',
              fontWeight: '500',
              backgroundColor: result.type === 'success' ? '#d4edda' : '#f8d7da',
              color: result.type === 'success' ? '#155724' : '#721c24',
              cursor: 'pointer'
            }}
            onClick={() => setResult(null)}
            title="Click to dismiss"
          >
            {result.message}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', marginBottom: '0.5rem' }}>
        <input
          type="password"
          value={value || (isSet ? MASKED_SECRET : '')}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={saving}
          style={{ flex: 1, padding: '8px', fontSize: '0.9rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: 0 }}
        />
        <button className="action-btn primary" onClick={handleSave} disabled={saving || !value.trim()}
          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className="action-btn secondary" onClick={handleTest} disabled={testing || !isSet}
          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          {testing ? 'Testing...' : 'Test'}
        </button>
      </div>
      <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
        {children}
      </p>
    </div>
  );
}

const BORDERED_SECTION = { marginTop: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e0e0e0' };

function DataCollectionSettings() {
  const [result, setResult] = useTransientResult();
  const [secretsSet, setSecretsSet] = useState({});

  const [settingsLoading, setSettingsLoading] = useState(true);

  const [twitterAuthStatus, setTwitterAuthStatus] = useState(null);
  const [twitterAuthLoading, setTwitterAuthLoading] = useState(false);
  const [twitterAuthTesting, setTwitterAuthTesting] = useState(false);
  const [twitterCookiesJson, setTwitterCookiesJson] = useState('');
  const [showCookieInput, setShowCookieInput] = useState(false);

  const [playwrightStatus, setPlaywrightStatus] = useState(null);
  const [playwrightLoading, setPlaywrightLoading] = useState(true);
  const [playwrightTesting, setPlaywrightTesting] = useState(false);

  const [moderationConfig, setModerationConfig] = useState({
    enabled: true, autoApproveEnabled: true, newsDateThreshold: 4, photoSubmissionsEnabled: false
  });
  const [moderationConfigSaving, setModerationConfigSaving] = useState(false);

  const [domainLists, setDomainLists] = useState({ competitor: [] });
  const [filtersSaving, setFiltersSaving] = useState(false);
  const [newCompetitorDomain, setNewCompetitorDomain] = useState('');
  const [contentBlocklist, setContentBlocklist] = useState([]);
  const [newContentPhrase, setNewContentPhrase] = useState('');
  const [newsTopicBlocklist, setNewsTopicBlocklist] = useState([]);
  const [newNewsTopic, setNewNewsTopic] = useState('');
  const [trustedEventPaths, setTrustedEventPaths] = useState([]);
  const [newTrustedEventPath, setNewTrustedEventPath] = useState('');

  const [excludedPois, setExcludedPois] = useState([]);
  const [excludedPoisLoading, setExcludedPoisLoading] = useState(true);
  const [allPois, setAllPois] = useState([]);
  const [selectedPoiId, setSelectedPoiId] = useState('');

  const [maxConcurrency, setMaxConcurrency] = useState(10);
  const [maxSearchUrls, setMaxSearchUrls] = useState(10);
  const [pageConcurrency, setPageConcurrency] = useState(3);
  const [pageDelayMs, setPageDelayMs] = useState(2000);
  const [contentCollectionSaving, setContentCollectionSaving] = useState(false);

  const [subtabs, setSubtabs] = useState([]);
  const [subtabsLoading, setSubtabsLoading] = useState(true);
  const [subtabsSaving, setSubtabsSaving] = useState(false);
  const [editingSubtab, setEditingSubtab] = useState(null);
  const [addingSubtab, setAddingSubtab] = useState(false);
  const [subtabForm, setSubtabForm] = useState({ id: '', label: '', shortLabel: '', route: '/', filterTypes: [] });

  const markSecretSet = useCallback((key) => setSecretsSet(prev => ({ ...prev, [key]: true })), []);

  const fetchSubtabs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/results-subtabs', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const subtabConfig = await res.json();
      setSubtabs(subtabConfig.subtabs || []);
    } catch (err) { setResult({ type: 'error', message: `Failed to load results sub-tabs: ${err.message}` }); }
    finally { setSubtabsLoading(false); }
  }, [setResult]);

  /**
   * Sends a request and reports its JSON outcome in the page-level result banner.
   *
   * @param {(busy: boolean) => void} setBusy - Spinner state for the triggering button.
   * @param {() => Promise<Response>} request - Performs the fetch.
   * @param {(outcome: object, response: Response) => {type: string, message: string}} describeOutcome
   *   Maps the parsed JSON body (and response, for .ok) to the banner result.
   * @param {string} failurePrefix - Banner prefix when the request or JSON parse throws.
   * @param {() => Promise<void>} [afterSend] - Runs after a request that did not throw, e.g. a refetch.
   * @returns {Promise<void>} Never rejects; failures go to the banner.
   */
  const sendAndReport = async (setBusy, request, describeOutcome, failurePrefix, afterSend) => {
    setBusy(true); setResult(null);
    try {
      const response = await request();
      setResult(describeOutcome(await response.json(), response));
      if (afterSend) await afterSend();
    } catch (err) { setResult({ type: 'error', message: `${failurePrefix}: ${err.message}` }); }
    finally { setBusy(false); }
  };

  const handleSaveSubtabs = () => sendAndReport(
    setSubtabsSaving,
    () => fetch('/api/admin/results-subtabs', {
      method: 'PUT', headers: JSON_HEADERS, credentials: 'include',
      body: JSON.stringify({ subtabs })
    }),
    (outcome, response) => (response.ok
      ? { type: 'success', message: 'Results sub-tabs saved successfully' }
      : { type: 'error', message: outcome.error || 'Failed to save sub-tabs' }),
    'Failed to save sub-tabs',
    fetchSubtabs
  );

  const applyDomainLists = (settings) => {
    try {
      const parsedBlocklist = JSON.parse(settings.blocklist_urls?.value || '[]');
      setContentBlocklist(stringsOnly(JSON.parse(settings.event_content_blocklist?.value || '[]')));
      setNewsTopicBlocklist(stringsOnly(JSON.parse(settings.news_topic_blocklist?.value || '[]')));
      setDomainLists({ competitor: stringsOnly(parsedBlocklist) });
      setTrustedEventPaths(stringsOnly(JSON.parse(settings.trusted_content_paths?.value || '[]')));
      if (!Array.isArray(parsedBlocklist)) {
        setResult({ type: 'error', message: 'Domain lists configuration error - invalid format' });
      }
    } catch (err) {
      console.error('Failed to parse domain lists:', err);
      setResult({ type: 'error', message: 'Failed to load domain lists - invalid JSON' });
    }
  };

  const loadExcludedPois = async (settings) => {
    try {
      const poisRes = await fetch('/api/pois', { credentials: 'include' });
      if (!poisRes.ok) throw new Error(`HTTP ${poisRes.status}`);
      const pois = await poisRes.json();
      setAllPois(pois.filter(p => !p.deleted).sort((a, b) => a.name.localeCompare(b.name)));
      let excludedIds = [];
      try {
        const parsed = JSON.parse(settings.news_collection_excluded_pois?.value || '[]');
        excludedIds = Array.isArray(parsed) ? parsed.filter(id => Number.isInteger(id)) : [];
      } catch (err) {
        setResult({ type: 'error', message: `Failed to parse excluded POIs: ${err.message}` });
      }
      setExcludedPois(
        excludedIds
          .map(id => pois.find(p => p.id === id))
          .filter(Boolean)
          .map(p => ({ id: p.id, name: p.name }))
      );
    } catch (err) { setResult({ type: 'error', message: `Failed to load POIs: ${err.message}` }); }
    finally { setExcludedPoisLoading(false); }
  };

  // One read of /api/admin/settings feeds every section on this page.
  const loadSettings = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const settings = await response.json();
      setSecretsSet(Object.fromEntries(SECRET_KEYS.map(key => [key, settings[key]?.isSet || false])));
      setModerationConfig({
        enabled: settings.moderation_enabled?.value !== 'false',
        autoApproveEnabled: settings.moderation_auto_approve_enabled?.value !== 'false',
        newsDateThreshold: parseInt(settings.moderation_news_date_threshold?.value) || 4,
        photoSubmissionsEnabled: settings.photo_submissions_enabled?.value === 'true'
      });
      applyDomainLists(settings);
      setMaxConcurrency(positiveIntOr(settings.max_concurrency?.value, 10));
      setMaxSearchUrls(positiveIntOr(settings.max_search_urls?.value, 10));
      setPageConcurrency(positiveIntOr(settings.page_concurrency?.value, 3));
      setPageDelayMs(positiveIntOr(settings.page_delay_ms?.value, 2000, 0));
      return settings;
    } catch (err) {
      setResult({ type: 'error', message: `Failed to load settings: ${err.message}` });
      return null;
    } finally {
      setSettingsLoading(false);
    }
  };

  const fetchTwitterAuthStatus = async () => {
    try {
      const response = await fetch('/api/admin/twitter/auth-status', { credentials: 'include' });
      if (response.ok) setTwitterAuthStatus(await response.json());
    } catch (err) { setResult({ type: 'error', message: `Failed to check Twitter auth status: ${err.message}` }); }
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

  useEffect(() => {
    const loadPage = async () => {
      const settings = await loadSettings();
      if (settings) await loadExcludedPois(settings);
      else setExcludedPoisLoading(false);
    };
    loadPage();
    fetchTwitterAuthStatus();
    fetchPlaywrightStatus();
    fetchSubtabs();
  }, []);

  /**
   * Saves several admin settings one after another and reports once in the banner.
   *
   * @param {(busy: boolean) => void} setBusy - Spinner state for the Save button.
   * @param {Array<[string, string]>} entries - [settingKey, value] pairs, saved in order.
   * @param {string} successMessage - Banner text when every save succeeds.
   * @param {string} failurePrefix - Banner prefix for the first failure.
   * @returns {Promise<void>} Never rejects. Stops at the first failed save, so earlier
   *   keys in `entries` stay saved (no rollback).
   */
  const saveSettingsGroup = async (setBusy, entries, successMessage, failurePrefix) => {
    setBusy(true); setResult(null);
    try {
      for (const [key, value] of entries) {
        await putSetting(key, value);
      }
      setResult({ type: 'success', message: successMessage });
    } catch (err) { setResult({ type: 'error', message: `${failurePrefix}: ${err.message}` }); }
    finally { setBusy(false); }
  };

  const handleSaveModerationConfig = () => saveSettingsGroup(setModerationConfigSaving, [
    ['moderation_enabled', String(moderationConfig.enabled)],
    ['moderation_auto_approve_enabled', String(moderationConfig.autoApproveEnabled)],
    ['moderation_news_date_threshold', String(moderationConfig.newsDateThreshold)],
    ['photo_submissions_enabled', String(moderationConfig.photoSubmissionsEnabled)]
  ], 'Moderation configuration saved', 'Failed to save moderation config');

  // Single save for the unified News & Events Filters section — persists all
  // allow/block lists in one click.
  const handleSaveAllFilters = () => saveSettingsGroup(setFiltersSaving, [
    ['blocklist_urls', JSON.stringify(domainLists.competitor)],
    ['trusted_content_paths', JSON.stringify(trustedEventPaths)],
    ['news_collection_excluded_pois', JSON.stringify(excludedPois.map(p => p.id))],
    ['event_content_blocklist', JSON.stringify(contentBlocklist)],
    ['news_topic_blocklist', JSON.stringify(newsTopicBlocklist)]
  ], 'Filters saved', 'Failed to save filters');

  const handleSaveContentCollection = () => saveSettingsGroup(setContentCollectionSaving, [
    ['max_concurrency', String(maxConcurrency)],
    ['max_search_urls', String(maxSearchUrls)],
    ['page_concurrency', String(pageConcurrency)],
    ['page_delay_ms', String(pageDelayMs)]
  ], 'Content collection settings saved', 'Failed to save content collection settings');

  const handleAddCompetitorDomain = () => {
    const domain = newCompetitorDomain.trim().toLowerCase().replace(/^https?:\/\//, '');
    const urlPrefixRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(\/[a-z0-9._~:@!$&'()*+,;=%-]*)*$/;
    if (!domain) return;
    if (!urlPrefixRegex.test(domain)) {
      setResult({ type: 'error', message: 'Invalid format (e.g., example.com or example.com/path)' });
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

  const handleAddContentPhrase = () => {
    const phrase = newContentPhrase.trim();
    if (!phrase) return;
    if (!contentBlocklist.some(p => p.toLowerCase() === phrase.toLowerCase())) {
      setContentBlocklist([...contentBlocklist, phrase]);
      setNewContentPhrase('');
    }
  };

  const handleRemoveContentPhrase = (phrase) => {
    setContentBlocklist(contentBlocklist.filter(p => p !== phrase));
  };

  const handleAddNewsTopic = () => {
    const term = newNewsTopic.trim();
    if (!term) return;
    if (!newsTopicBlocklist.some(t => t.toLowerCase() === term.toLowerCase())) {
      setNewsTopicBlocklist([...newsTopicBlocklist, term]);
      setNewNewsTopic('');
    }
  };

  const handleRemoveNewsTopic = (term) => {
    setNewsTopicBlocklist(newsTopicBlocklist.filter(t => t !== term));
  };

  const handleAddTrustedEventPath = () => {
    const path = newTrustedEventPath.trim().toLowerCase();
    if (!path) return;
    if (!trustedEventPaths.includes(path)) {
      setTrustedEventPaths([...trustedEventPaths, path]);
      setNewTrustedEventPath('');
    }
  };

  const handleRemoveTrustedEventPath = (path) => {
    setTrustedEventPaths(trustedEventPaths.filter(p => p !== path));
  };

  const handleAddExcludedPoi = () => {
    const id = parseInt(selectedPoiId);
    if (!id) return;
    if (excludedPois.some(p => p.id === id)) return;
    const poi = allPois.find(p => p.id === id);
    if (poi) {
      setExcludedPois([...excludedPois, { id: poi.id, name: poi.name }]);
      setSelectedPoiId('');
    }
  };

  const handleRemoveExcludedPoi = (id) => {
    setExcludedPois(excludedPois.filter(p => p.id !== id));
  };

  const handleTestPlaywright = () => sendAndReport(
    setPlaywrightTesting,
    () => fetch('/api/admin/playwright/test', {
      method: 'POST', headers: JSON_HEADERS, credentials: 'include',
      body: JSON.stringify({ url: 'https://example.com' })
    }),
    (outcome) => (outcome.status === 'success'
      ? { type: 'success', message: `Playwright test passed! Rendered "${outcome.title}" (${outcome.text_length} chars, ${outcome.links_found} links) in ${outcome.elapsed_ms}ms` }
      : { type: 'error', message: `Playwright test failed: ${outcome.message}` }),
    'Playwright test error',
    fetchPlaywrightStatus
  );

  const handleTwitterLogin = () => {
    window.open('https://x.com/login', '_blank');
    setShowCookieInput(true);
    setResult({ type: 'info', message: 'Twitter login opened in new tab. After logging in, use a browser extension like "Cookie-Editor" to export cookies from x.com as JSON, then paste below.' });
  };

  const handleSaveCookies = () => {
    if (!twitterCookiesJson.trim()) { setResult({ type: 'error', message: 'Please paste cookies JSON' }); return; }
    sendAndReport(
      setTwitterAuthLoading,
      () => fetch('/api/admin/twitter/save-cookies', {
        method: 'POST', headers: JSON_HEADERS, credentials: 'include',
        body: JSON.stringify({ cookies: twitterCookiesJson })
      }),
      (outcome) => {
        if (!outcome.success) return { type: 'error', message: outcome.error || 'Failed to save cookies' };
        setTwitterCookiesJson(''); setShowCookieInput(false);
        return { type: 'success', message: `Twitter cookies saved! Expires: ${new Date(outcome.expires).toLocaleDateString()}` };
      },
      'Save error',
      fetchTwitterAuthStatus
    );
  };

  const handleTestTwitterAuth = () => sendAndReport(
    setTwitterAuthTesting,
    () => fetch('/api/admin/twitter/test-cookies', { method: 'POST', credentials: 'include' }),
    (outcome) => (outcome.success && outcome.logged_in
      ? { type: 'success', message: 'Twitter authentication is working! Cookies are valid.' }
      : { type: 'error', message: outcome.message || 'Twitter cookies have expired. Please log in again.' }),
    'Test failed',
    fetchTwitterAuthStatus
  );

  return (
    <div className="data-collection-settings">
      <h3>Data Collection Configuration</h3>
      <p className="settings-description" style={{ marginBottom: '16px' }}>
        Configure AI providers, credentials, and infrastructure for data collection jobs.
        To trigger and monitor jobs, use the <strong>Jobs</strong> tab.
      </p>
      {result && (
        <div className={`sync-message ${result.type}`} style={{ position: 'sticky', top: 0, zIndex: 1 }} role="status">
          {result.message}
        </div>
      )}


      <div className="ai-config-section">
        <h4>API Keys</h4>
        <p className="settings-description">Configure external API keys for data collection services.</p>

        <ApiKeySetting
          title="GitHub"
          settingKey="github_api_token"
          testUrl="/api/admin/settings/github-api-token/test"
          testPassedMessage="Test passed"
          noun="Token"
          placeholder="Enter GitHub token..."
          isSet={secretsSet.github_api_token}
          onSaved={markSecretSet}
          sectionStyle={BORDERED_SECTION}
        >
          Feedback form creates GitHub Issues. Use a fine-grained PAT with <code>issues:write</code> scope for <code>crunchtools/rotv</code>.
        </ApiKeySetting>

        <ApiKeySetting
          title="OpenRouter"
          settingKey="openrouter_api_key"
          testUrl="/api/admin/ai/test-key"
          testErrorField="error"
          noun="API key"
          placeholder="Enter API key..."
          isSet={secretsSet.openrouter_api_key}
          onSaved={markSecretSet}
          sectionStyle={BORDERED_SECTION}
        >
          AI-powered content generation. Get key from <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">OpenRouter</a>
        </ApiKeySetting>

        <ApiKeySetting
          title="Serper"
          settingKey="serper_api_key"
          testUrl="/api/admin/settings/serper-api-key/test"
          noun="API key"
          placeholder="Enter API key..."
          isSet={secretsSet.serper_api_key}
          onSaved={markSecretSet}
          sectionStyle={BORDERED_SECTION}
        >
          External news search with geographic grounding. Get key from <a href="https://serper.dev/api-key" target="_blank" rel="noopener noreferrer">Serper Dashboard</a>
        </ApiKeySetting>

        <ApiKeySetting
          title="US Fleet Tracking"
          settingKey="usft_sharing_token"
          testUrl="/api/admin/settings/usft-sharing-token/test"
          noun="Token"
          placeholder="Enter sharing token..."
          isSet={secretsSet.usft_sharing_token}
          onSaved={markSecretSet}
          sectionStyle={{ marginTop: '1.5rem' }}
        >
          US Fleet Tracking (USFT) sharing token for the CVSR live train tracker. Falls back to the <code>USFT_SHARING_TOKEN</code> env var when unset.
        </ApiKeySetting>
      </div>


      <div className="playwright-status-section" style={{ padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
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


      <div className="ai-config-section">
        <h4>Content Collection</h4>
        <p className="settings-description">Tune how aggressively collection jobs crawl. These apply to every news and events run.</p>
        {settingsLoading ? <p>Loading...</p> : (
          <>
            <div className="config-row">
              <label>Places collected at once</label>
              <input type="number" min="1" max="50" value={maxConcurrency}
                onChange={e => setMaxConcurrency(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))}
                style={{ width: '80px', padding: '0.4rem', fontSize: '0.95rem' }} disabled={contentCollectionSaving} />
              <span className="config-hint">How many places are collected in parallel. Higher finishes faster but uses more memory. (1–50, default 10)</span>
            </div>
            <div className="config-row">
              <label>Search results per place</label>
              <input type="number" min="1" max="20" value={maxSearchUrls}
                onChange={e => setMaxSearchUrls(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))}
                style={{ width: '80px', padding: '0.4rem', fontSize: '0.95rem' }} disabled={contentCollectionSaving} />
              <span className="config-hint">How many web and news search results to gather and crawl per place when looking beyond its own pages. (1–20, default 10)</span>
            </div>
            <div className="config-row">
              <label>Pages processed at once</label>
              <input type="number" min="1" max="20" value={pageConcurrency}
                onChange={e => setPageConcurrency(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))}
                style={{ width: '80px', padding: '0.4rem', fontSize: '0.95rem' }} disabled={contentCollectionSaving} />
              <span className="config-hint">How many pages are processed in parallel within a single place. Lower eases memory pressure. (1–20, default 3)</span>
            </div>
            <div className="config-row">
              <label>Delay between pages (ms)</label>
              <input type="number" min="0" max="10000" step="100" value={pageDelayMs}
                onChange={e => setPageDelayMs(Math.max(0, Math.min(10000, parseInt(e.target.value, 10) || 0)))}
                style={{ width: '80px', padding: '0.4rem', fontSize: '0.95rem' }} disabled={contentCollectionSaving} />
              <span className="config-hint">Pause between dispatching each page, to avoid rate-limiting and browser contention. (0–10000, default 2000)</span>
            </div>
            <button className="action-btn primary" onClick={handleSaveContentCollection} disabled={contentCollectionSaving}>
              {contentCollectionSaving ? 'Saving...' : 'Save'}
            </button>
          </>
        )}
      </div>


      <div className="ai-config-section">
        <h4>Content Moderation</h4>
        <p className="settings-description">Configure AI-powered moderation for news, events, and photo submissions.</p>
        {settingsLoading ? <p>Loading configuration...</p> : (
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
              <label>Minimum News & Events Date Consensus Score:</label>
              <input type="number" value={moderationConfig.newsDateThreshold} onChange={e => setModerationConfig({...moderationConfig, newsDateThreshold: parseInt(e.target.value) || 0})}
                min="0" max="8" step="1" disabled={moderationConfigSaving || !moderationConfig.enabled || !moderationConfig.autoApproveEnabled} style={{ width: '80px' }} />
              <span className="config-hint">Score 0-8 (recommended: 4)</span>
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


      <div className="ai-config-section">
        <h4>News &amp; Events Filters</h4>
        <p className="settings-description">Allow lists (green) and deny lists (red) that govern what gets collected and what passes moderation. Add to each list independently, then Save Filters once to apply everything.</p>
        {(settingsLoading || excludedPoisLoading) ? <p>Loading filters...</p> : (
          <>
            <FilterList
              title="Content Path Allow List"
              type="allow"
              hint="URL path patterns the content crawler may follow beyond the listing page (e.g., /event, /events, iteminfo.html)."
              items={trustedEventPaths}
              value={newTrustedEventPath}
              onValueChange={setNewTrustedEventPath}
              onAdd={handleAddTrustedEventPath}
              onRemove={handleRemoveTrustedEventPath}
              placeholder="/event"
              disabled={filtersSaving}
            />
            <FilterList
              title="URL Deny List"
              type="deny"
              hint="Source domains or URLs that are rejected during moderation and skipped in phase 2 collection."
              items={domainLists.competitor}
              value={newCompetitorDomain}
              onValueChange={setNewCompetitorDomain}
              onAdd={handleAddCompetitorDomain}
              onRemove={handleRemoveCompetitorDomain}
              placeholder="scam-site.com"
              disabled={filtersSaving}
            />

            <div style={{ marginBottom: '1.5rem' }}>
              <h5 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: FILTER_COLORS.deny.heading }}>POI Deny List</h5>
              <p className="config-hint" style={{ marginBottom: '0.75rem' }}>POIs skipped during collection. Any news or events from them are rejected on every moderation run. Use for broad geographic entities (e.g. Cuyahoga County) whose feeds pull in irrelevant content.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {excludedPois.length === 0 && (
                  <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>No POIs denied.</p>
                )}
                {excludedPois.map(poi => (
                  <FilterChip key={poi.id} label={poi.name} type="deny" onRemove={() => handleRemoveExcludedPoi(poi.id)} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <PoiSearchSelect
                  pois={allPois.filter(p => !excludedPois.some(e => e.id === p.id))}
                  value={selectedPoiId}
                  onChange={(id) => setSelectedPoiId(id || '')}
                  placeholder="Search POIs to deny..."
                  disabled={filtersSaving}
                  style={{ flex: 1 }}
                />
                <button className="action-btn secondary" onClick={handleAddExcludedPoi} disabled={filtersSaving || !selectedPoiId}>Add</button>
              </div>
            </div>

            <FilterList
              title="Content Deny List"
              type="deny"
              hint="Reject any news or event whose title or description contains one of these phrases. Use for organizations that are not POIs (e.g., Cuyahoga Valley Art Center) whose events attach to the venue POI. Applied on every moderation run."
              items={contentBlocklist}
              value={newContentPhrase}
              onValueChange={setNewContentPhrase}
              onAdd={handleAddContentPhrase}
              onRemove={handleRemoveContentPhrase}
              placeholder="Cuyahoga Valley Art Center"
              disabled={filtersSaving}
            />

            <FilterList
              title="News Topic Deny List"
              type="deny"
              hint="Reject any news item whose title or summary contains one of these words or phrases (whole-word match). Catches crime/violence stories that trusted news domains auto-approve and attach to nearby park POIs. News only — events are never filtered by this list, so 'murder mystery' and 'vintage base ball' events are safe."
              items={newsTopicBlocklist}
              value={newNewsTopic}
              onValueChange={setNewNewsTopic}
              onAdd={handleAddNewsTopic}
              onRemove={handleRemoveNewsTopic}
              placeholder="manhunt"
              disabled={filtersSaving}
            />

            <button className="action-btn primary" onClick={handleSaveAllFilters} disabled={filtersSaving}>
              {filtersSaving ? 'Saving...' : 'Save Filters'}
            </button>
          </>
        )}
      </div>


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


      <div className="ai-config-section">
        <h4>Twitter/X Credentials</h4>
        <p className="settings-description">Login credentials for scraping Twitter content (used for Trail Status).</p>
        {settingsLoading ? <p>Loading credentials...</p> : (
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

    </div>
  );
}

export default DataCollectionSettings;
