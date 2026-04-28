import React, { useState, useEffect, useCallback } from 'react';

// Data collection configuration: AI providers, credentials, moderation, infrastructure, sub-tabs.
// Job triggering, progress, and history are in the Jobs tab (JobsDashboard.jsx).
function DataCollectionSettings() {
  const [result, setResult] = useState(null);
  const [geminiResult, setGeminiResult] = useState(null);
  const [serperResult, setSerperResult] = useState(null);
  const [apifyResult, setApifyResult] = useState(null);

  const [aiConfigLoading, setAiConfigLoading] = useState(false);

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

  // API Keys state
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiApiKeySet, setGeminiApiKeySet] = useState(false);
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [geminiTesting, setGeminiTesting] = useState(false);

  const [apifyToken, setApifyToken] = useState('');
  const [apifyTokenSet, setApifyTokenSet] = useState(false);
  const [apifySaving, setApifySaving] = useState(false);
  const [apifyTesting, setApifyTesting] = useState(false);

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
    enabled: true, autoApproveEnabled: true, newsDateThreshold: 4, photoConfidenceThreshold: 0.9, photoSubmissionsEnabled: false
  });
  const [moderationConfigLoading, setModerationConfigLoading] = useState(true);
  const [moderationConfigSaving, setModerationConfigSaving] = useState(false);

  // Domain lists state
  const [domainLists, setDomainLists] = useState({ trusted: [], competitor: [] });
  const [domainListsLoading, setDomainListsLoading] = useState(true);
  const [domainListsSaving, setDomainListsSaving] = useState(false);
  const [newTrustedDomain, setNewTrustedDomain] = useState('');
  const [newCompetitorDomain, setNewCompetitorDomain] = useState('');

  // Excluded POIs state
  const [excludedPois, setExcludedPois] = useState([]); // [{id, name}]
  const [excludedPoisLoading, setExcludedPoisLoading] = useState(true);
  const [excludedPoisSaving, setExcludedPoisSaving] = useState(false);
  const [allPois, setAllPois] = useState([]);
  const [selectedPoiId, setSelectedPoiId] = useState('');

  // Max concurrency state
  const [maxConcurrency, setMaxConcurrency] = useState(10);
  const [maxConcurrencyLoading, setMaxConcurrencyLoading] = useState(true);
  const [maxConcurrencySaving, setMaxConcurrencySaving] = useState(false);

  // Max Serper URLs state
  const [maxSearchUrls, setMaxSearchUrls] = useState(10);
  const [maxSearchUrlsLoading, setMaxSearchUrlsLoading] = useState(true);
  const [maxSearchUrlsSaving, setMaxSearchUrlsSaving] = useState(false);

  // Page pipeline settings state
  const [pageConcurrency, setPageConcurrency] = useState(3);
  const [pageConcurrencyLoading, setPageConcurrencyLoading] = useState(true);
  const [pageConcurrencySaving, setPageConcurrencySaving] = useState(false);
  const [pageDelayMs, setPageDelayMs] = useState(2000);
  const [pageDelayMsLoading, setPageDelayMsLoading] = useState(true);
  const [pageDelayMsSaving, setPageDelayMsSaving] = useState(false);

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
    fetchTwitterCredentials();
    fetchTwitterAuthStatus();
    fetchGeminiStatus();
    fetchApifyStatus();
    fetchSerperStatus();
    fetchPlaywrightStatus();
    fetchModerationConfig();
    fetchDomainLists();
    fetchExcludedPois();
    fetchMaxConcurrency();
    fetchMaxSearchUrls();
    fetchPageConcurrency();
    fetchPageDelayMs();
    fetchSubtabs();
  }, []);

  // Auto-dismiss result notifications after 5 seconds
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(timer);
  }, [result]);

  useEffect(() => {
    if (!geminiResult) return;
    const timer = setTimeout(() => setGeminiResult(null), 5000);
    return () => clearTimeout(timer);
  }, [geminiResult]);

  useEffect(() => {
    if (!serperResult) return;
    const timer = setTimeout(() => setSerperResult(null), 5000);
    return () => clearTimeout(timer);
  }, [serperResult]);

  useEffect(() => {
    if (!apifyResult) return;
    const timer = setTimeout(() => setApifyResult(null), 5000);
    return () => clearTimeout(timer);
  }, [apifyResult]);

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

  const fetchGeminiStatus = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) { const settings = await response.json(); setGeminiApiKeySet(settings.gemini_api_key?.isSet || false); }
    } catch (err) { console.error('Error fetching Gemini status:', err); }
  };

  const fetchApifyStatus = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) { const settings = await response.json(); setApifyTokenSet(settings.apify_api_token?.isSet || false); }
    } catch (err) { console.error('Error fetching Apify status:', err); }
  };

  const handleSaveGeminiApiKey = async () => {
    if (!geminiApiKey.trim()) { setGeminiResult({ type: 'error', message: 'API key cannot be empty' }); return; }
    setGeminiSaving(true); setGeminiResult(null);
    try {
      const response = await fetch('/api/admin/settings/gemini_api_key', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ value: geminiApiKey })
      });
      if (response.ok) {
        setGeminiResult({ type: 'success', message: 'Saved successfully' });
        setGeminiApiKey('');
        setGeminiApiKeySet(true);
        await fetchGeminiStatus();
      } else { const error = await response.json(); throw new Error(error.error || 'Failed to save key'); }
    } catch (err) { setGeminiResult({ type: 'error', message: `Save failed: ${err.message}` }); }
    finally { setGeminiSaving(false); }
  };

  const handleTestGeminiApiKey = async () => {
    setGeminiTesting(true); setGeminiResult(null);
    try {
      const response = await fetch('/api/admin/ai/test-key', { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (data.success) {
        setGeminiResult({ type: 'success', message: 'Test passed ✓' });
      } else {
        setGeminiResult({ type: 'error', message: data.error || 'Test failed' });
      }
    } catch (err) { setGeminiResult({ type: 'error', message: `Test failed: ${err.message}` }); }
    finally { setGeminiTesting(false); }
  };

  const handleSaveApifyToken = async () => {
    if (!apifyToken.trim()) { setApifyResult({ type: 'error', message: 'API token cannot be empty' }); return; }
    setApifySaving(true); setApifyResult(null);
    try {
      const response = await fetch('/api/admin/settings/apify_api_token', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ value: apifyToken })
      });
      if (response.ok) {
        setApifyResult({ type: 'success', message: 'Saved successfully' });
        setApifyToken('');
        setApifyTokenSet(true);
        await fetchApifyStatus();
      } else { const error = await response.json(); throw new Error(error.error || 'Failed to save token'); }
    } catch (err) { setApifyResult({ type: 'error', message: `Save failed: ${err.message}` }); }
    finally { setApifySaving(false); }
  };

  const handleTestApifyToken = async () => {
    setApifyTesting(true); setApifyResult(null);
    try {
      const response = await fetch('/api/admin/settings/apify-api-token/test', {
        method: 'POST', credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setApifyResult({ type: 'success', message: 'Test passed ✓' });
      } else {
        setApifyResult({ type: 'error', message: data.message || 'Test failed' });
      }
    } catch (err) { setApifyResult({ type: 'error', message: `Test failed: ${err.message}` }); }
    finally { setApifyTesting(false); }
  };

  const fetchSerperStatus = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) { const settings = await response.json(); setSerperApiKeySet(settings.serper_api_key?.isSet || false); }
    } catch (err) { console.error('Error fetching Serper status:', err); }
  };

  const handleSaveSerperApiKey = async () => {
    if (!serperApiKey.trim()) { setSerperResult({ type: 'error', message: 'API key cannot be empty' }); return; }
    setSerperSaving(true); setSerperResult(null);
    try {
      const response = await fetch('/api/admin/settings/serper_api_key', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ value: serperApiKey })
      });
      if (response.ok) {
        setSerperResult({ type: 'success', message: 'Saved successfully' });
        setSerperApiKey('');
        setSerperApiKeySet(true);
        await fetchSerperStatus();
      } else { const error = await response.json(); throw new Error(error.error || 'Failed to save key'); }
    } catch (err) { setSerperResult({ type: 'error', message: `Save failed: ${err.message}` }); }
    finally { setSerperSaving(false); }
  };

  const handleTestSerperApiKey = async () => {
    setSerperTesting(true); setSerperResult(null);
    try {
      const response = await fetch('/api/admin/settings/serper-api-key/test', {
        method: 'POST', credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setSerperResult({ type: 'success', message: 'Test passed ✓' });
      } else {
        setSerperResult({ type: 'error', message: data.message || 'Test failed' });
      }
    } catch (err) { setSerperResult({ type: 'error', message: `Test failed: ${err.message}` }); }
    finally { setSerperTesting(false); }
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
          newsDateThreshold: parseInt(settings.moderation_news_date_threshold?.value) || 4,
          photoConfidenceThreshold: parseFloat(settings.moderation_auto_approve_threshold?.value) || 0.9,
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
        { key: 'moderation_news_date_threshold', value: String(moderationConfig.newsDateThreshold) },
        { key: 'moderation_auto_approve_threshold', value: String(moderationConfig.photoConfidenceThreshold) },
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
        const blocklist = settings.blocklist_urls?.value || '[]';
        try {
          const parsedTrusted = JSON.parse(trusted);
          const parsedBlocklist = JSON.parse(blocklist);
          setDomainLists({
            trusted: Array.isArray(parsedTrusted) ? parsedTrusted.filter(d => typeof d === 'string') : [],
            competitor: Array.isArray(parsedBlocklist) ? parsedBlocklist.filter(d => typeof d === 'string') : []
          });
          if (!Array.isArray(parsedTrusted) || !Array.isArray(parsedBlocklist)) {
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
        { key: 'blocklist_urls', value: JSON.stringify(domainLists.competitor) }
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

  const fetchExcludedPois = async () => {
    setExcludedPoisLoading(true);
    try {
      const [settingsRes, poisRes] = await Promise.all([
        fetch('/api/admin/settings', { credentials: 'include' }),
        fetch('/api/pois', { credentials: 'include' })
      ]);
      if (settingsRes.ok && poisRes.ok) {
        const settings = await settingsRes.json();
        const pois = await poisRes.json();
        setAllPois(pois.filter(p => !p.deleted).sort((a, b) => a.name.localeCompare(b.name)));
        let excludedIds = [];
        try {
          const parsed = JSON.parse(settings.news_collection_excluded_pois?.value || '[]');
          excludedIds = Array.isArray(parsed) ? parsed.filter(id => Number.isInteger(id)) : [];
        } catch (e) {
          console.error('Failed to parse excluded POIs:', e);
        }
        setExcludedPois(
          excludedIds
            .map(id => pois.find(p => p.id === id))
            .filter(Boolean)
            .map(p => ({ id: p.id, name: p.name }))
        );
      }
    } catch (err) { console.error('Error fetching excluded POIs:', err); }
    finally { setExcludedPoisLoading(false); }
  };

  const handleSaveExcludedPois = async () => {
    setExcludedPoisSaving(true); setResult(null);
    try {
      const response = await fetch('/api/admin/settings/news_collection_excluded_pois', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ value: JSON.stringify(excludedPois.map(p => p.id)) })
      });
      if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Failed to save'); }
      setResult({ type: 'success', message: 'Excluded POIs saved' });
    } catch (err) { setResult({ type: 'error', message: `Failed to save excluded POIs: ${err.message}` }); }
    finally { setExcludedPoisSaving(false); }
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

  const fetchMaxConcurrency = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) {
        const settings = await response.json();
        const val = parseInt(settings.max_concurrency?.value, 10);
        setMaxConcurrency(Number.isFinite(val) && val >= 1 ? val : 10);
      }
    } catch (err) { console.error('Error fetching max concurrency:', err); }
    finally { setMaxConcurrencyLoading(false); }
  };

  const handleSaveMaxConcurrency = async () => {
    setMaxConcurrencySaving(true); setResult(null);
    try {
      const response = await fetch('/api/admin/settings/max_concurrency', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ value: String(maxConcurrency) })
      });
      if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Failed to save'); }
      setResult({ type: 'success', message: 'Max concurrency saved' });
    } catch (err) { setResult({ type: 'error', message: `Failed to save max concurrency: ${err.message}` }); }
    finally { setMaxConcurrencySaving(false); }
  };

  const fetchMaxSearchUrls = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) {
        const settings = await response.json();
        const val = parseInt(settings.max_search_urls?.value, 10);
        setMaxSearchUrls(Number.isFinite(val) && val >= 1 ? val : 10);
      }
    } catch (err) { console.error('Error fetching max Serper URLs:', err); }
    finally { setMaxSearchUrlsLoading(false); }
  };

  const handleSaveMaxSearchUrls = async () => {
    setMaxSearchUrlsSaving(true); setResult(null);
    try {
      const response = await fetch('/api/admin/settings/max_search_urls', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ value: String(maxSearchUrls) })
      });
      if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Failed to save'); }
      setResult({ type: 'success', message: 'Max Serper URLs saved' });
    } catch (err) { setResult({ type: 'error', message: `Failed to save max Serper URLs: ${err.message}` }); }
    finally { setMaxSearchUrlsSaving(false); }
  };

  const fetchPageConcurrency = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) {
        const settings = await response.json();
        const val = parseInt(settings.page_concurrency?.value, 10);
        setPageConcurrency(Number.isFinite(val) && val >= 1 ? val : 3);
      }
    } catch (err) { console.error('Error fetching page concurrency:', err); }
    finally { setPageConcurrencyLoading(false); }
  };

  const handleSavePageConcurrency = async () => {
    setPageConcurrencySaving(true); setResult(null);
    try {
      const response = await fetch('/api/admin/settings/page_concurrency', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ value: String(pageConcurrency) })
      });
      if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Failed to save'); }
      setResult({ type: 'success', message: 'Page concurrency saved' });
    } catch (err) { setResult({ type: 'error', message: `Failed to save page concurrency: ${err.message}` }); }
    finally { setPageConcurrencySaving(false); }
  };

  const fetchPageDelayMs = async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) {
        const settings = await response.json();
        const val = parseInt(settings.page_delay_ms?.value, 10);
        setPageDelayMs(Number.isFinite(val) && val >= 0 ? val : 2000);
      }
    } catch (err) { console.error('Error fetching page delay:', err); }
    finally { setPageDelayMsLoading(false); }
  };

  const handleSavePageDelayMs = async () => {
    setPageDelayMsSaving(true); setResult(null);
    try {
      const response = await fetch('/api/admin/settings/page_delay_ms', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ value: String(pageDelayMs) })
      });
      if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Failed to save'); }
      setResult({ type: 'success', message: 'Page delay saved' });
    } catch (err) { setResult({ type: 'error', message: `Failed to save page delay: ${err.message}` }); }
    finally { setPageDelayMsSaving(false); }
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

      {/* API Keys Section */}
      <div className="ai-config-section">
        <h4>API Keys</h4>
        <p className="settings-description">Configure external API keys for data collection services.</p>

        {/* Google Gemini API Key */}
        <div style={{ marginTop: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e0e0e0' }}>
          <h5 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Google Gemini</h5>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
            <span className={`status-indicator ${geminiApiKeySet ? 'configured' : 'not-configured'}`}></span>
            <span style={{ fontSize: '0.9rem' }}>{geminiApiKeySet ? 'Configured' : 'Not configured'}</span>
            {geminiResult && (
              <span
                style={{
                  marginLeft: '12px',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  backgroundColor: geminiResult.type === 'success' ? '#d4edda' : '#f8d7da',
                  color: geminiResult.type === 'success' ? '#155724' : '#721c24',
                  cursor: 'pointer'
                }}
                onClick={() => setGeminiResult(null)}
                title="Click to dismiss"
              >
                {geminiResult.message}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', marginBottom: '0.5rem' }}>
            <input
              type="password"
              value={geminiApiKey || (geminiApiKeySet ? '••••••••••••••••••••••••' : '')}
              onChange={e => setGeminiApiKey(e.target.value)}
              placeholder="Enter API key..."
              disabled={geminiSaving}
              style={{ flex: 1, padding: '8px', fontSize: '0.9rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: 0 }}
            />
            <button className="action-btn primary" onClick={handleSaveGeminiApiKey} disabled={geminiSaving || !geminiApiKey.trim()}
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {geminiSaving ? 'Saving...' : 'Save'}
            </button>
            <button className="action-btn secondary" onClick={handleTestGeminiApiKey} disabled={geminiTesting || !geminiApiKeySet}
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {geminiTesting ? 'Testing...' : 'Test'}
            </button>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
            AI-powered content generation. Get key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>
          </p>
        </div>

        {/* Serper API Key */}
        <div style={{ marginTop: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #e0e0e0' }}>
          <h5 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Serper</h5>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
            <span className={`status-indicator ${serperApiKeySet ? 'configured' : 'not-configured'}`}></span>
            <span style={{ fontSize: '0.9rem' }}>{serperApiKeySet ? 'Configured' : 'Not configured'}</span>
            {serperResult && (
              <span
                style={{
                  marginLeft: '12px',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  backgroundColor: serperResult.type === 'success' ? '#d4edda' : '#f8d7da',
                  color: serperResult.type === 'success' ? '#155724' : '#721c24',
                  cursor: 'pointer'
                }}
                onClick={() => setSerperResult(null)}
                title="Click to dismiss"
              >
                {serperResult.message}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', marginBottom: '0.5rem' }}>
            <input
              type="password"
              value={serperApiKey || (serperApiKeySet ? '••••••••••••••••••••••••' : '')}
              onChange={e => setSerperApiKey(e.target.value)}
              placeholder="Enter API key..."
              disabled={serperSaving}
              style={{ flex: 1, padding: '8px', fontSize: '0.9rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: 0 }}
            />
            <button className="action-btn primary" onClick={handleSaveSerperApiKey} disabled={serperSaving || !serperApiKey.trim()}
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {serperSaving ? 'Saving...' : 'Save'}
            </button>
            <button className="action-btn secondary" onClick={handleTestSerperApiKey} disabled={serperTesting || !serperApiKeySet}
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {serperTesting ? 'Testing...' : 'Test'}
            </button>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
            External news search with geographic grounding. Get key from <a href="https://serper.dev/api-key" target="_blank" rel="noopener noreferrer">Serper Dashboard</a>
          </p>
        </div>

        {/* Apify API Token */}
        <div style={{ marginTop: '1.5rem' }}>
          <h5 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Apify</h5>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
            <span className={`status-indicator ${apifyTokenSet ? 'configured' : 'not-configured'}`}></span>
            <span style={{ fontSize: '0.9rem' }}>{apifyTokenSet ? 'Configured' : 'Not configured'}</span>
            {apifyResult && (
              <span
                style={{
                  marginLeft: '12px',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  backgroundColor: apifyResult.type === 'success' ? '#d4edda' : '#f8d7da',
                  color: apifyResult.type === 'success' ? '#155724' : '#721c24',
                  cursor: 'pointer'
                }}
                onClick={() => setApifyResult(null)}
                title="Click to dismiss"
              >
                {apifyResult.message}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', marginBottom: '0.5rem' }}>
            <input
              type="password"
              value={apifyToken || (apifyTokenSet ? '••••••••••••••••••••••••' : '')}
              onChange={e => setApifyToken(e.target.value)}
              placeholder="Enter API token..."
              disabled={apifySaving}
              style={{ flex: 1, padding: '8px', fontSize: '0.9rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: 0 }}
            />
            <button className="action-btn primary" onClick={handleSaveApifyToken} disabled={apifySaving || !apifyToken.trim()}
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {apifySaving ? 'Saving...' : 'Save'}
            </button>
            <button className="action-btn secondary" onClick={handleTestApifyToken} disabled={apifyTesting || !apifyTokenSet}
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {apifyTesting ? 'Testing...' : 'Test'}
            </button>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
            Twitter/X and Facebook scraping. Get token from <a href="https://console.apify.com/account/integrations" target="_blank" rel="noopener noreferrer">Apify Console</a>
          </p>
        </div>
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
              <label>Minimum News & Events Date Consensus Score:</label>
              <input type="number" value={moderationConfig.newsDateThreshold} onChange={e => setModerationConfig({...moderationConfig, newsDateThreshold: parseInt(e.target.value) || 0})}
                min="0" max="8" step="1" disabled={moderationConfigSaving || !moderationConfig.enabled || !moderationConfig.autoApproveEnabled} style={{ width: '80px' }} />
              <span className="config-hint">Score 0-8 (recommended: 4)</span>
            </div>
            <div className="config-row">
              <label>Gemini Photo Confidence:</label>
              <input type="number" value={moderationConfig.photoConfidenceThreshold} onChange={e => setModerationConfig({...moderationConfig, photoConfidenceThreshold: parseFloat(e.target.value) || 0})}
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
        <p className="settings-description">Manage trusted domains and blocklist URLs for quality filtering in moderation and phase 2 collection.</p>
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
              <h5 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: '#dc3545' }}>Blocklist URLs</h5>
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

      {/* Excluded POIs from News Collection */}
      <div className="ai-config-section">
        <h4>Excluded POIs from News Collection</h4>
        <p className="settings-description">POIs in this list are skipped entirely during automated news collection. Use for broad geographic entities (e.g. Cuyahoga County, Cleveland) whose news feeds pull in irrelevant content.</p>
        {excludedPoisLoading ? <p>Loading...</p> : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {excludedPois.length === 0 && (
                <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>No POIs excluded.</p>
              )}
              {excludedPois.map(poi => (
                <span key={poi.id} style={{
                  padding: '0.25rem 0.5rem',
                  backgroundColor: '#fff3cd',
                  color: '#856404',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  {poi.name}
                  <button onClick={() => handleRemoveExcludedPoi(poi.id)}
                    style={{ background: 'none', border: 'none', color: '#856404', cursor: 'pointer', padding: '0', fontSize: '1rem', lineHeight: '1' }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <select
                value={selectedPoiId}
                onChange={e => setSelectedPoiId(e.target.value)}
                style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}
                disabled={excludedPoisSaving}
              >
                <option value="">— Select a POI to exclude —</option>
                {allPois
                  .filter(p => !excludedPois.some(e => e.id === p.id))
                  .map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                }
              </select>
              <button className="action-btn secondary" onClick={handleAddExcludedPoi} disabled={excludedPoisSaving || !selectedPoiId}>Add</button>
            </div>
            <button className="action-btn primary" onClick={handleSaveExcludedPois} disabled={excludedPoisSaving}>
              {excludedPoisSaving ? 'Saving...' : 'Save Excluded POIs'}
            </button>
          </>
        )}
      </div>

      {/* Collection Concurrency */}
      <div className="ai-config-section">
        <h4>MAX_CONCURRENCY — Collection Concurrency</h4>
        <p className="settings-description">How many POIs run concurrently during a collection job (news, events, or both). Each slot opens a browser context — higher values finish faster but use more memory. Range: 1–50, default: 10.</p>
        {maxConcurrencyLoading ? <p>Loading...</p> : (
          <>
            <div className="config-row">
              <label>MAX_CONCURRENCY</label>
              <input
                type="number"
                min="1"
                max="50"
                value={maxConcurrency}
                onChange={e => setMaxConcurrency(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))}
                style={{ width: '80px', padding: '0.4rem', fontSize: '0.95rem' }}
                disabled={maxConcurrencySaving}
              />
              <span className="config-hint">Range: 1–50 (default: 10)</span>
            </div>
            <button className="action-btn primary" onClick={handleSaveMaxConcurrency} disabled={maxConcurrencySaving}>
              {maxConcurrencySaving ? 'Saving...' : 'Save'}
            </button>
          </>
        )}
      </div>

      {/* Max Serper URLs */}
      <div className="ai-config-section">
        <h4>MAX_SEARCH_URLS — Phase II URL Crawl Limit</h4>
        <p className="settings-description">How many Serper search result URLs are crawled per POI during Phase II (runs for all collection types). Serper returns up to 10 results; raise this only if you have a paid Serper plan. Range: 1–20, default: 10.</p>
        {maxSearchUrlsLoading ? <p>Loading...</p> : (
          <>
            <div className="config-row">
              <label>MAX_SEARCH_URLS</label>
              <input
                type="number"
                min="1"
                max="20"
                value={maxSearchUrls}
                onChange={e => setMaxSearchUrls(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))}
                style={{ width: '80px', padding: '0.4rem', fontSize: '0.95rem' }}
                disabled={maxSearchUrlsSaving}
              />
              <span className="config-hint">Range: 1–20 (default: 10)</span>
            </div>
            <button className="action-btn primary" onClick={handleSaveMaxSearchUrls} disabled={maxSearchUrlsSaving}>
              {maxSearchUrlsSaving ? 'Saving...' : 'Save'}
            </button>
          </>
        )}
      </div>

      {/* Page Concurrency */}
      <div className="ai-config-section">
        <h4>PAGE_CONCURRENCY — Per-POI Page Processing</h4>
        <p className="settings-description">How many detail pages are processed concurrently within a single POI crawl (dates + summarize). Lower values reduce browser memory pressure. Range: 1–20, default: 3.</p>
        {pageConcurrencyLoading ? <p>Loading...</p> : (
          <>
            <div className="config-row">
              <label>PAGE_CONCURRENCY</label>
              <input
                type="number"
                min="1"
                max="20"
                value={pageConcurrency}
                onChange={e => setPageConcurrency(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))}
                style={{ width: '80px', padding: '0.4rem', fontSize: '0.95rem' }}
                disabled={pageConcurrencySaving}
              />
              <span className="config-hint">Range: 1–20 (default: 3)</span>
            </div>
            <button className="action-btn primary" onClick={handleSavePageConcurrency} disabled={pageConcurrencySaving}>
              {pageConcurrencySaving ? 'Saving...' : 'Save'}
            </button>
          </>
        )}
      </div>

      {/* Page Delay */}
      <div className="ai-config-section">
        <h4>PAGE_DELAY_MS — Stagger Between Pages</h4>
        <p className="settings-description">Milliseconds to wait between dispatching each page for processing. Prevents rate-limiting from external sites and reduces browser contention. Range: 0–10000, default: 2000.</p>
        {pageDelayMsLoading ? <p>Loading...</p> : (
          <>
            <div className="config-row">
              <label>PAGE_DELAY_MS</label>
              <input
                type="number"
                min="0"
                max="10000"
                step="100"
                value={pageDelayMs}
                onChange={e => setPageDelayMs(Math.max(0, Math.min(10000, parseInt(e.target.value, 10) || 0)))}
                style={{ width: '80px', padding: '0.4rem', fontSize: '0.95rem' }}
                disabled={pageDelayMsSaving}
              />
              <span className="config-hint">Range: 0–10000ms (default: 2000)</span>
            </div>
            <button className="action-btn primary" onClick={handleSavePageDelayMs} disabled={pageDelayMsSaving}>
              {pageDelayMsSaving ? 'Saving...' : 'Save'}
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

    </div>
  );
}

export default DataCollectionSettings;
