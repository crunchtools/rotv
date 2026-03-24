import React, { useState, useEffect } from 'react';
import { formatDateTime } from './NewsEventsShared';

// Unified data collection settings for News/Events and Trail Status
function DataCollectionSettings() {
  // State for News & Events collection
  const [newsCollecting, setNewsCollecting] = useState(false);
  const [newsProgress, setNewsProgress] = useState(null);
  const [newsActiveJobId, setNewsActiveJobId] = useState(null);

  // State for Trail Status collection
  const [trailCollecting, setTrailCollecting] = useState(false);
  const [trailProgress, setTrailProgress] = useState(null);
  const [trailActiveJobId, setTrailActiveJobId] = useState(null);

  // Shared state
  const [jobHistory, setJobHistory] = useState([]);
  const [result, setResult] = useState(null);
  const [newsAiStats, setNewsAiStats] = useState(null);
  const [trailAiStats, setTrailAiStats] = useState(null);

  // Fixed slot arrays for job display (jobs never move between slots)
  const MAX_SLOTS = 10;
  const [newsJobSlots, setNewsJobSlots] = useState(Array(MAX_SLOTS).fill(null));
  const [trailJobSlots, setTrailJobSlots] = useState(Array(MAX_SLOTS).fill(null));

  // AI provider configuration state
  const [aiConfig, setAiConfig] = useState({
    primary: 'perplexity',
    fallback: 'none',
    primaryLimit: 0
  });
  const [aiConfigLoading, setAiConfigLoading] = useState(true);
  const [aiConfigSaving, setAiConfigSaving] = useState(false);

  // Twitter credentials state
  const [twitterCredentials, setTwitterCredentials] = useState({
    username: '',
    password: ''
  });
  const [twitterLoading, setTwitterLoading] = useState(true);
  const [twitterSaving, setTwitterSaving] = useState(false);

  // Twitter authentication state
  const [twitterAuthStatus, setTwitterAuthStatus] = useState(null);
  const [twitterAuthLoading, setTwitterAuthLoading] = useState(false);
  const [twitterAuthTesting, setTwitterAuthTesting] = useState(false);
  const [twitterCookiesJson, setTwitterCookiesJson] = useState('');
  const [showCookieInput, setShowCookieInput] = useState(false);

  // Playwright status state
  const [playwrightStatus, setPlaywrightStatus] = useState(null);
  const [playwrightLoading, setPlaywrightLoading] = useState(true);
  const [playwrightTesting, setPlaywrightTesting] = useState(false);

  // Moderation configuration state
  const [moderationConfig, setModerationConfig] = useState({
    enabled: true,
    autoApproveEnabled: true,
    autoApproveThreshold: 0.9,
    photoSubmissionsEnabled: false
  });
  const [moderationConfigLoading, setModerationConfigLoading] = useState(true);
  const [moderationConfigSaving, setModerationConfigSaving] = useState(false);

  useEffect(() => {
    checkForRunningJobs();
    fetchJobHistory();
    fetchAiConfig();
    fetchTwitterCredentials();
    fetchTwitterAuthStatus();
    fetchPlaywrightStatus();
    fetchModerationConfig();
  }, []);

  // Auto-dismiss result notifications after 5 seconds
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(timer);
  }, [result]);

  // Poll for active job status
  useEffect(() => {
    if (!newsActiveJobId && !trailActiveJobId) return;

    // Define polling functions inside effect to avoid exhaustive-deps warnings
    const pollNewsStatus = async () => {
      try {
        const response = await fetch(`/api/admin/news/job/${newsActiveJobId}`, {
          credentials: 'include'
        });
        if (response.ok) {
          const status = await response.json();

          // Fetch AI stats FIRST to prevent badge flicker
          if (status.status === 'running' || status.status === 'completed' || status.status === 'cancelled') {
            try {
              const statsResponse = await fetch('/api/admin/news/ai-stats', {
                credentials: 'include'
              });
              if (statsResponse.ok) {
                const stats = await statsResponse.json();
                setNewsAiStats(stats);
              }
            } catch (statsErr) {
              console.error('Error fetching news AI stats:', statsErr);
            }
          }

          // Update progress and slots AFTER stats are fetched
          setNewsProgress(status);

          // Backend-managed slots: Just use what the backend sends
          if (status.displaySlots) {
            setNewsJobSlots(status.displaySlots);
          }

          // Stop polling only when job is done AND all display slots have finished
          const isJobDone = status.status === 'completed' || status.status === 'cancelled';
          const noActiveSlots = !status.displaySlots || status.displaySlots.every(s => !s.poiId || s.status === 'completed');

          if (isJobDone && noActiveSlots) {
            setNewsCollecting(false);
            setNewsActiveJobId(null); // Clear job ID to stop polling
            fetchJobHistory();
          } else if (isJobDone && !noActiveSlots) {
            // Job is done but there are still active slots
          }
        }
      } catch (err) {
        console.error('Error polling news status:', err);
      }
    };

    const pollTrailStatus = async () => {
      try {
        const response = await fetch(`/api/admin/trail-status/job-status/${trailActiveJobId}`, {
          credentials: 'include'
        });
        if (response.ok) {
          const status = await response.json();

          // Fetch AI stats FIRST to prevent badge flicker
          if (status.status === 'running' || status.status === 'completed' || status.status === 'cancelled') {
            try {
              const statsResponse = await fetch('/api/admin/trail-status/ai-stats', {
                credentials: 'include'
              });
              if (statsResponse.ok) {
                const stats = await statsResponse.json();
                setTrailAiStats(stats);
              }
            } catch (statsErr) {
              console.error('Error fetching trail AI stats:', statsErr);
            }
          }

          // Update progress and slots AFTER stats are fetched
          setTrailProgress(status);

          // Backend-managed slots: Just use what the backend sends
          if (status.displaySlots) {
            setTrailJobSlots(status.displaySlots);
          }

          // Stop polling only when job is done AND all display slots have finished
          const isJobDone = status.status === 'completed' || status.status === 'cancelled';
          const noActiveSlots = !status.displaySlots || status.displaySlots.every(s => !s.poiId || s.status === 'completed');

          if (isJobDone && noActiveSlots) {
            setTrailCollecting(false);
            setTrailActiveJobId(null); // Clear job ID to stop polling
            fetchJobHistory();
          } else if (isJobDone && !noActiveSlots) {
            // Job is done but there are still active slots
          }
        }
      } catch (err) {
        console.error('Error polling trail status:', err);
      }
    };

    const pollInterval = setInterval(async () => {
      if (newsActiveJobId) {
        await pollNewsStatus();
      }
      if (trailActiveJobId) {
        await pollTrailStatus();
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [newsActiveJobId, trailActiveJobId]);

  const checkForRunningJobs = async () => {
    try {
      // Check for running news job
      const newsResponse = await fetch('/api/admin/news/status', {
        credentials: 'include'
      });
      if (newsResponse.ok) {
        const data = await newsResponse.json();
        if (data.status === 'running') {
          setNewsActiveJobId(data.id);
          setNewsCollecting(true);
          setNewsProgress(data);
          // Fetch AI stats for running job
          try {
            const statsResponse = await fetch('/api/admin/news/ai-stats', { credentials: 'include' });
            if (statsResponse.ok) {
              const stats = await statsResponse.json();
              setNewsAiStats(stats);
            }
          } catch (statsErr) {
            console.error('Error fetching news AI stats:', statsErr);
          }
        }
      }

      // Check for running trail status job
      const trailResponse = await fetch('/api/admin/trail-status/job-status/latest', {
        credentials: 'include'
      });
      if (trailResponse.ok) {
        const data = await trailResponse.json();
        if (data && data.status === 'running') {
          setTrailActiveJobId(data.jobId);
          setTrailCollecting(true);
          setTrailProgress(data);
          // Fetch AI stats for running job
          try {
            const statsResponse = await fetch('/api/admin/trail-status/ai-stats', { credentials: 'include' });
            if (statsResponse.ok) {
              const stats = await statsResponse.json();
              setTrailAiStats(stats);
            }
          } catch (statsErr) {
            console.error('Error fetching trail AI stats:', statsErr);
          }
        }
      }
    } catch (err) {
      console.error('Error checking for running jobs:', err);
    }
  };

  const fetchJobHistory = async () => {
    try {
      // Fetch last 10 jobs from both systems
      const newsResponse = await fetch('/api/admin/news/status', {
        credentials: 'include'
      });
      const trailResponse = await fetch('/api/admin/trail-status/job-status/latest', {
        credentials: 'include'
      });

      const jobs = [];

      if (newsResponse.ok) {
        const newsData = await newsResponse.json();
        if (newsData) {
          jobs.push({
            type: 'news',
            ...newsData,
            timestamp: newsData.completed_at || newsData.started_at || newsData.createdAt
          });
        }
      }

      if (trailResponse.ok) {
        const trailData = await trailResponse.json();
        if (trailData) {
          jobs.push({
            type: 'trails',
            ...trailData,
            timestamp: trailData.completed_at || trailData.started_at
          });
        }
      }

      // Sort by timestamp descending
      jobs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setJobHistory(jobs.slice(0, 10));
    } catch (err) {
      console.error('Error fetching job history:', err);
    }
  };

  const handleCollectNews = async () => {
    setNewsCollecting(true);
    setResult(null);
    setNewsProgress({ status: 'starting', pois_processed: 0, news_found: 0, events_found: 0 });
    setNewsAiStats({ usage: { gemini: 0, perplexity: 0 }, errors: { gemini429: 0, perplexity429: 0 }, activeProvider: null });
    setNewsJobSlots(Array(MAX_SLOTS).fill(null));  // Clear slots for new job

    try {
      const response = await fetch('/api/admin/news/collect', {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setNewsActiveJobId(data.jobId);
        setNewsProgress({
          status: 'running',
          total_pois: data.totalPois,
          pois_processed: 0,
          news_found: 0,
          events_found: 0
        });
      } else {
        const error = await response.json();
        setResult({
          type: 'error',
          message: error.error || 'Failed to start news collection'
        });
        setNewsCollecting(false);
        setNewsProgress(null);
      }
    } catch (err) {
      setResult({
        type: 'error',
        message: err.message
      });
      setNewsCollecting(false);
      setNewsProgress(null);
    }
  };

  const handleCollectTrailStatus = async () => {
    setTrailCollecting(true);
    setResult(null);
    setTrailProgress({ status: 'starting', trails_processed: 0, status_found: 0 });
    setTrailAiStats({ usage: { gemini: 0, perplexity: 0 }, errors: { gemini429: 0, perplexity429: 0 }, activeProvider: null });
    setTrailJobSlots(Array(MAX_SLOTS).fill(null));  // Clear slots for new job

    try {
      const response = await fetch('/api/admin/trail-status/collect-batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (response.ok) {
        const data = await response.json();
        setTrailActiveJobId(data.jobId);
        setTrailProgress({
          status: 'running',
          total_trails: data.totalTrails,
          trails_processed: 0,
          status_found: 0
        });
      } else {
        const error = await response.json();
        setResult({
          type: 'error',
          message: error.error || 'Failed to start trail status collection'
        });
        setTrailCollecting(false);
        setTrailProgress(null);
      }
    } catch (err) {
      setResult({
        type: 'error',
        message: err.message
      });
      setTrailCollecting(false);
      setTrailProgress(null);
    }
  };

  const handleCancelNewsJob = async () => {
    try {
      await fetch(`/api/admin/news/job/${newsActiveJobId}/cancel`, {
        method: 'POST',
        credentials: 'include'
      });

      // Immediately fetch AI stats after cancel to prevent badge flicker
      try {
        const statsResponse = await fetch('/api/admin/news/ai-stats', {
          credentials: 'include'
        });
        if (statsResponse.ok) {
          const stats = await statsResponse.json();
          setNewsAiStats(stats);
        }
      } catch (statsErr) {
        console.error('Error fetching news AI stats after cancel:', statsErr);
      }
    } catch (err) {
      console.error('Error cancelling news job:', err);
    }
  };

  const handleCancelTrailJob = async () => {
    try {
      await fetch(`/api/admin/trail-status/batch-collect/${trailActiveJobId}/cancel`, {
        method: 'PUT',
        credentials: 'include'
      });

      // Immediately fetch AI stats after cancel to prevent badge flicker
      try {
        const statsResponse = await fetch('/api/admin/trail-status/ai-stats', {
          credentials: 'include'
        });
        if (statsResponse.ok) {
          const stats = await statsResponse.json();
          setTrailAiStats(stats);
        }
      } catch (statsErr) {
        console.error('Error fetching trail AI stats after cancel:', statsErr);
      }
    } catch (err) {
      console.error('Error cancelling trail job:', err);
    }
  };

  const fetchAiConfig = async () => {
    try {
      const response = await fetch('/api/admin/settings', {
        credentials: 'include'
      });
      if (response.ok) {
        const settings = await response.json();
        setAiConfig({
          primary: settings.ai_search_primary?.value || 'perplexity',
          fallback: settings.ai_search_fallback?.value || 'none',
          primaryLimit: parseInt(settings.ai_search_primary_limit?.value) || 0
        });
      }
    } catch (err) {
      console.error('Error fetching AI config:', err);
    } finally {
      setAiConfigLoading(false);
    }
  };

  const fetchTwitterCredentials = async () => {
    try {
      const response = await fetch('/api/admin/settings', {
        credentials: 'include'
      });
      if (response.ok) {
        const settings = await response.json();
        setTwitterCredentials({
          username: settings.twitter_username?.value || '',
          password: settings.twitter_password?.value || ''
        });
      }
    } catch (err) {
      console.error('Error fetching Twitter credentials:', err);
    } finally {
      setTwitterLoading(false);
    }
  };

  const handleSaveAiConfig = async () => {
    setAiConfigSaving(true);
    setResult(null);

    try {
      const settings = [
        { key: 'ai_search_primary', value: aiConfig.primary },
        { key: 'ai_search_fallback', value: aiConfig.fallback },
        { key: 'ai_search_primary_limit', value: String(aiConfig.primaryLimit) }
      ];

      for (const setting of settings) {
        const response = await fetch(`/api/admin/settings/${setting.key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ value: setting.value })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save setting');
        }
      }

      setResult({
        type: 'success',
        message: 'AI provider configuration saved successfully'
      });
    } catch (err) {
      setResult({
        type: 'error',
        message: `Failed to save AI config: ${err.message}`
      });
    } finally {
      setAiConfigSaving(false);
    }
  };

  const handleSaveTwitterCredentials = async () => {
    setTwitterSaving(true);
    setResult(null);

    try {
      const settings = [
        { key: 'twitter_username', value: twitterCredentials.username },
        { key: 'twitter_password', value: twitterCredentials.password }
      ];

      for (const setting of settings) {
        const response = await fetch(`/api/admin/settings/${setting.key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ value: setting.value })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save setting');
        }
      }

      setResult({
        type: 'success',
        message: 'Twitter credentials saved successfully'
      });
    } catch (err) {
      setResult({
        type: 'error',
        message: `Failed to save Twitter credentials: ${err.message}`
      });
    } finally {
      setTwitterSaving(false);
    }
  };

  const fetchTwitterAuthStatus = async () => {
    try {
      const response = await fetch('/api/admin/twitter/auth-status', {
        credentials: 'include'
      });
      if (response.ok) {
        const status = await response.json();
        setTwitterAuthStatus(status);
      }
    } catch (err) {
      console.error('Error fetching Twitter auth status:', err);
    }
  };

  const fetchPlaywrightStatus = async () => {
    setPlaywrightLoading(true);
    try {
      const response = await fetch('/api/admin/playwright/status', {
        credentials: 'include'
      });
      if (response.ok) {
        const status = await response.json();
        setPlaywrightStatus(status);
      } else {
        setPlaywrightStatus({
          status: 'error',
          message: 'Failed to check Playwright status'
        });
      }
    } catch (err) {
      console.error('Error fetching Playwright status:', err);
      setPlaywrightStatus({
        status: 'error',
        message: err.message
      });
    } finally {
      setPlaywrightLoading(false);
    }
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
    } catch (err) {
      console.error('Error fetching moderation config:', err);
    } finally {
      setModerationConfigLoading(false);
    }
  };

  const handleSaveModerationConfig = async () => {
    setModerationConfigSaving(true);
    setResult(null);
    try {
      const settings = [
        { key: 'moderation_enabled', value: String(moderationConfig.enabled) },
        { key: 'moderation_auto_approve_enabled', value: String(moderationConfig.autoApproveEnabled) },
        { key: 'moderation_auto_approve_threshold', value: String(moderationConfig.autoApproveThreshold) },
        { key: 'photo_submissions_enabled', value: String(moderationConfig.photoSubmissionsEnabled) }
      ];
      for (const setting of settings) {
        const response = await fetch(`/api/admin/settings/${setting.key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ value: setting.value })
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save setting');
        }
      }
      setResult({ type: 'success', message: 'Moderation configuration saved' });
    } catch (err) {
      setResult({ type: 'error', message: `Failed to save moderation config: ${err.message}` });
    } finally {
      setModerationConfigSaving(false);
    }
  };

  const handleTestPlaywright = async () => {
    setPlaywrightTesting(true);
    setResult(null);
    try {
      const response = await fetch('/api/admin/playwright/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url: 'https://example.com' })
      });
      const data = await response.json();

      if (data.status === 'success') {
        setResult({
          type: 'success',
          message: `Playwright test passed! Rendered "${data.title}" (${data.text_length} chars, ${data.links_found} links) in ${data.elapsed_ms}ms`
        });
      } else {
        setResult({
          type: 'error',
          message: `Playwright test failed: ${data.message}`
        });
      }

      // Refresh status after test
      await fetchPlaywrightStatus();
    } catch (err) {
      setResult({
        type: 'error',
        message: `Playwright test error: ${err.message}`
      });
    } finally {
      setPlaywrightTesting(false);
    }
  };

  const handleTwitterLogin = () => {
    // Open Twitter login in a new tab
    window.open('https://x.com/login', '_blank');

    // Show cookie input section
    setShowCookieInput(true);

    setResult({
      type: 'info',
      message: 'Twitter login opened in new tab. After logging in, use a browser extension like "Cookie-Editor" to export cookies from x.com as JSON, then paste below.'
    });
  };

  const handleSaveCookies = async () => {
    setTwitterAuthLoading(true);
    setResult(null);

    try {
      if (!twitterCookiesJson.trim()) {
        setResult({
          type: 'error',
          message: 'Please paste cookies JSON'
        });
        setTwitterAuthLoading(false);
        return;
      }

      const response = await fetch('/api/admin/twitter/save-cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cookies: twitterCookiesJson })
      });

      const data = await response.json();

      if (data.success) {
        setResult({
          type: 'success',
          message: `Twitter cookies saved! Expires: ${new Date(data.expires).toLocaleDateString()}`
        });
        setTwitterCookiesJson('');
        setShowCookieInput(false);
        await fetchTwitterAuthStatus();
      } else {
        setResult({
          type: 'error',
          message: data.error || 'Failed to save cookies'
        });
      }
    } catch (err) {
      setResult({
        type: 'error',
        message: `Save error: ${err.message}`
      });
    } finally {
      setTwitterAuthLoading(false);
    }
  };

  const handleTestTwitterAuth = async () => {
    setTwitterAuthTesting(true);
    setResult(null);

    try {
      const response = await fetch('/api/admin/twitter/test-cookies', {
        method: 'POST',
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success && data.logged_in) {
        setResult({
          type: 'success',
          message: 'Twitter authentication is working! Cookies are valid.'
        });
      } else {
        setResult({
          type: 'error',
          message: data.message || 'Twitter cookies have expired. Please log in again.'
        });
      }

      await fetchTwitterAuthStatus();
    } catch (err) {
      setResult({
        type: 'error',
        message: `Test failed: ${err.message}`
      });
    } finally {
      setTwitterAuthTesting(false);
    }
  };

  const formatPhase = (phase) => {
    const phaseMap = {
      'starting': 'Starting...',
      'initializing': 'Initializing...',
      'rendering': 'Rendering JavaScript page...',
      'rendering_events': 'Rendering event links...',
      'rendering_news': 'Rendering news links...',
      'ai_search': 'Searching with AI...',
      'processing_results': 'Processing results...',
      'matching_links': 'Matching links...',
      'google_news': 'Searching Google News...',
      'saving': 'Saving results...',
      'complete': 'Complete',
      'error': 'Error',
      'cancelled': 'Cancelled'
    };
    return phaseMap[phase] || phase;
  };

  return (
    <div className="data-collection-settings">
      <h3>Data Collection</h3>

      {/* Collection Actions */}
      <div className="collection-actions-section">
        <h4>Start Collection</h4>
        <div className="collection-buttons">
          <button
            className="collection-btn news-btn"
            onClick={handleCollectNews}
            disabled={newsCollecting || trailCollecting}
          >
            <span className="btn-icon">📰</span>
            <span className="btn-text">
              {newsCollecting ? 'Collecting News & Events...' : 'Collect News & Events'}
            </span>
          </button>

          <button
            className="collection-btn trails-btn"
            onClick={handleCollectTrailStatus}
            disabled={newsCollecting || trailCollecting}
          >
            <span className="btn-icon">🚵</span>
            <span className="btn-text">
              {trailCollecting ? 'Collecting Trail Status...' : 'Collect MTB Trail Status'}
            </span>
          </button>
        </div>
      </div>

      {/* News & Events Progress Widget */}
      {newsProgress && (
        <div className="collection-progress-card">
          <div className="progress-card-header">
            <div className="progress-phase">
              <span className={`phase-icon ${newsProgress.status !== 'completed' && newsProgress.status !== 'cancelled' ? 'pulse' : ''}`}>
                {newsProgress.status === 'completed' ? '✓' :
                 newsProgress.status === 'cancelled' ? '✗' : '🔍'}
              </span>
              <div className="phase-text">
                <span className="phase-label">
                  {newsProgress.status === 'completed' ? 'News & Events Collection Complete' :
                   newsProgress.status === 'cancelled' ? 'News & Events Collection Cancelled' :
                   'Collecting News & Events'}
                </span>
                {newsProgress.phase && newsProgress.status !== 'completed' && newsProgress.status !== 'cancelled' && (
                  <span className="phase-detail">{formatPhase(newsProgress.phase)}</span>
                )}
              </div>
            </div>
            <div className="progress-header-actions">
              {newsCollecting && newsProgress.status === 'running' && (
                <button className="status-cancel-btn" onClick={handleCancelNewsJob} title="Cancel job">
                  Cancel
                </button>
              )}
              {(newsProgress.status === 'completed' ||
                (newsProgress.status === 'cancelled' && (!newsProgress.displaySlots || !newsProgress.displaySlots.some(s => s.poiId && s.status === 'active')))) && (
                <button className="status-close-btn" onClick={() => {
                  setNewsProgress(null);
                  setNewsActiveJobId(null);
                  setNewsJobSlots(Array(MAX_SLOTS).fill(null)); // Clear slots for next run
                }} title="Close">
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="progress-bar-wrapper">
            <div
              className="progress-bar-fill"
              style={{
                width: newsProgress.total_pois > 0
                  ? `${(newsProgress.pois_processed / newsProgress.total_pois) * 100}%`
                  : '0%',
                background: newsProgress.status === 'completed'
                  ? 'linear-gradient(90deg, #4caf50, #8bc34a)'
                  : 'linear-gradient(90deg, #fff, rgba(255,255,255,0.7))'
              }}
            />
          </div>

          <div className="progress-counts">
            <div className="count-badge">
              <span className="count-icon">📍</span>
              <div className="count-details">
                <span className="count-value">{newsProgress.pois_processed || 0}</span>
                <span className="count-label">
                  {newsProgress.total_pois > 0 ? ` / ${newsProgress.total_pois}` : ''} POIs
                </span>
              </div>
            </div>
            <div className="count-badge">
              <span className="count-icon">📰</span>
              <div className="count-details">
                <span className="count-value">{newsProgress.news_found || 0}</span>
                <span className="count-label">News</span>
              </div>
            </div>
            <div className="count-badge">
              <span className="count-icon">📅</span>
              <div className="count-details">
                <span className="count-value">{newsProgress.events_found || 0}</span>
                <span className="count-label">Events</span>
              </div>
            </div>
          </div>

          {/* Active Jobs Table - shows each concurrent POI being processed */}
          {(() => {
            const isJobRunning = newsProgress.status === 'running';

            // Use fixed slots (jobs never move between slots)
            const slots = newsJobSlots;

            // Calculate total 429 errors and usage stats
            const total429 = (newsAiStats?.errors?.gemini429 || 0) + (newsAiStats?.errors?.perplexity429 || 0);
            const geminiUsage = newsAiStats?.usage?.gemini || 0;
            const perplexityUsage = newsAiStats?.usage?.perplexity || 0;

            // Determine if we should show the table
            const hasJobs = slots.some(s => s !== null);
            const hasAiStats = geminiUsage > 0 || perplexityUsage > 0 || total429 > 0;

            // Show table if: job running, OR jobs in slots, OR AI stats exist
            // This ensures badges don't flicker when transitioning between states
            if (!isJobRunning && !hasJobs && !hasAiStats) return null;

            return (
              <div className="ai-stats-table">
                {/* Provider usage counters */}
                {(geminiUsage > 0 || perplexityUsage > 0 || total429 > 0) && (
                  <div className="ai-usage-counters">
                    {geminiUsage > 0 && <span className="usage-badge gemini">🔷 Gemini: {geminiUsage}</span>}
                    {perplexityUsage > 0 && <span className="usage-badge perplexity">🔮 Perplexity: {perplexityUsage}</span>}
                    {total429 > 0 && <span className="usage-badge error">⚠️ 429 Errors: {total429}</span>}
                  </div>
                )}
                <div className="ai-stats-header">
                  <div>POI</div>
                  <div>STATUS</div>
                  <div>PROVIDER</div>
                  <div></div>
                </div>
                {slots.map((job, idx) => {
                  // Job status is stored in the slot itself
                  const isThisJobActive = job && job.status === 'active';

                  return (
                    <div key={idx} className={`ai-stats-row ${isThisJobActive ? 'active' : ''} ${!job || !job.poiName ? 'empty-slot' : ''}`}>
                      <div className="ai-col-poi">{job && job.poiName ? job.poiName : (isJobRunning ? 'Waiting' : '—')}</div>
                      <div className="ai-col-status">
                        {!job || !job.poiName
                          ? (isJobRunning ? 'Waiting' : '—')
                          : job.status === 'completed'
                          ? '✓ Done'
                          : job.phase === 'error'
                          ? '❌ Error'
                          : job.phase === 'rendering_events' || job.phase === 'rendering_news' || job.phase === 'rendering'
                          ? '📄 Rendering'
                          : job.phase === 'ai_search'
                          ? '🔍 Searching'
                          : job.phase === 'matching_links'
                          ? '🔗 Matching'
                          : job.phase === 'google_news'
                          ? '📰 Google News'
                          : job.phase === 'initializing'
                          ? '⏳ Starting'
                          : job.phase || '—'}
                      </div>
                      <div className="ai-col-provider">
                        {!job || !job.poiName
                          ? '—'
                          : job.provider === 'gemini' ? '🔷 Gemini'
                          : job.provider === 'perplexity' ? '🔮 Perplexity'
                          : '—'}
                      </div>
                      <div className="ai-col-spacer"></div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Trail Status Progress Widget */}
      {trailProgress && (
        <div className="collection-progress-card">
          <div className="progress-card-header">
            <div className="progress-phase">
              <span className={`phase-icon ${trailProgress.status !== 'completed' && trailProgress.status !== 'cancelled' ? 'pulse' : ''}`}>
                {trailProgress.status === 'completed' ? '✓' :
                 trailProgress.status === 'cancelled' ? '✗' : '🔍'}
              </span>
              <div className="phase-text">
                <span className="phase-label">
                  {trailProgress.status === 'completed' ? 'MTB Trail Status Collection Complete' :
                   trailProgress.status === 'cancelled' ? 'MTB Trail Status Collection Cancelled' :
                   'Collecting MTB Trail Status'}
                </span>
                {trailProgress.phase && trailProgress.status !== 'completed' && trailProgress.status !== 'cancelled' && (
                  <span className="phase-detail">{formatPhase(trailProgress.phase)}</span>
                )}
              </div>
            </div>
            <div className="progress-header-actions">
              {trailCollecting && trailProgress.status === 'running' && (
                <button className="status-cancel-btn" onClick={handleCancelTrailJob} title="Cancel job">
                  Cancel
                </button>
              )}
              {(trailProgress.status === 'completed' ||
                (trailProgress.status === 'cancelled' && (!trailProgress.displaySlots || !trailProgress.displaySlots.some(s => s.poiId && s.status === 'active')))) && (
                <button className="status-close-btn" onClick={() => {
                  setTrailProgress(null);
                  setTrailActiveJobId(null);
                  setTrailJobSlots(Array(MAX_SLOTS).fill(null)); // Clear slots for next run
                }} title="Close">
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="progress-bar-wrapper">
            <div
              className="progress-bar-fill"
              style={{
                width: trailProgress.total_trails > 0
                  ? `${(trailProgress.trails_processed / trailProgress.total_trails) * 100}%`
                  : '0%',
                background: trailProgress.status === 'completed'
                  ? 'linear-gradient(90deg, #4caf50, #8bc34a)'
                  : 'linear-gradient(90deg, #fff, rgba(255,255,255,0.7))'
              }}
            />
          </div>

          <div className="progress-counts">
            <div className="count-badge">
              <span className="count-icon">🚵</span>
              <div className="count-details">
                <span className="count-value">{trailProgress.trails_processed || 0}</span>
                <span className="count-label">
                  {trailProgress.total_trails > 0 ? ` / ${trailProgress.total_trails}` : ''} Trails
                </span>
              </div>
            </div>
            <div className="count-badge">
              <span className="count-icon">📊</span>
              <div className="count-details">
                <span className="count-value">{trailProgress.status_found || 0}</span>
                <span className="count-label">Status Updates</span>
              </div>
            </div>
          </div>

          {/* Active Jobs Table - shows each concurrent trail being processed */}
          {(() => {
            const isJobRunning = trailProgress.status === 'running';

            // Use fixed slots (jobs never move between slots)
            const slots = trailJobSlots;

            // Calculate total 429 errors and usage stats
            const total429 = (trailAiStats?.errors?.gemini429 || 0) + (trailAiStats?.errors?.perplexity429 || 0);
            const geminiUsage = trailAiStats?.usage?.gemini || 0;
            const perplexityUsage = trailAiStats?.usage?.perplexity || 0;

            // Show table if job is running OR if we have any jobs in slots OR if there are AI stats to display
            const hasJobs = slots.some(s => s !== null);
            const hasAiStats = geminiUsage > 0 || perplexityUsage > 0 || total429 > 0;
            if (!isJobRunning && !hasJobs && !hasAiStats) return null;

            return (
              <div className="ai-stats-table">
                {/* Provider usage counters */}
                {(geminiUsage > 0 || perplexityUsage > 0 || total429 > 0) && (
                  <div className="ai-usage-counters">
                    {geminiUsage > 0 && <span className="usage-badge gemini">🔷 Gemini: {geminiUsage}</span>}
                    {perplexityUsage > 0 && <span className="usage-badge perplexity">🔮 Perplexity: {perplexityUsage}</span>}
                    {total429 > 0 && <span className="usage-badge error">⚠️ 429 Errors: {total429}</span>}
                  </div>
                )}
                <div className="ai-stats-header">
                  <div>TRAIL</div>
                  <div>STATUS</div>
                  <div>PROVIDER</div>
                  <div></div>
                </div>
                {slots.map((job, idx) => {
                  // Job status is stored in the slot itself
                  const isThisJobActive = job && job.status === 'active';

                  return (
                    <div key={idx} className={`ai-stats-row ${isThisJobActive ? 'active' : ''} ${!job || !job.poiName ? 'empty-slot' : ''}`}>
                      <div className="ai-col-poi">{job && job.poiName ? job.poiName : (isJobRunning ? 'Waiting' : '—')}</div>
                      <div className="ai-col-status">
                        {!job || !job.poiName
                          ? (isJobRunning ? 'Waiting' : '—')
                          : job.status === 'completed'
                          ? '✓ Done'
                          : job.phase === 'error'
                          ? '❌ Error'
                          : job.phase === 'rendering'
                          ? '📄 Rendering'
                          : job.phase === 'ai_search'
                          ? '🔍 Searching'
                          : job.phase === 'starting'
                          ? '⏳ Starting'
                          : job.phase || '—'}
                      </div>
                      <div className="ai-col-provider">
                        {!job || !job.poiName
                          ? '—'
                          : job.provider === 'gemini' ? '🔷 Gemini'
                          : job.provider === 'perplexity' ? '🔮 Perplexity'
                          : '—'}
                      </div>
                      <div className="ai-col-spacer"></div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Job History */}
      <div className="job-history-section">
        <h4>Recent Collection Jobs</h4>
        {jobHistory.length === 0 ? (
          <p className="no-history">No recent collection jobs</p>
        ) : (
          <div className="job-history-list">
            {jobHistory.map((job, idx) => (
              <div key={idx} className={`job-history-item ${job.type}`}>
                <div className="job-icon">
                  {job.type === 'news' ? '📰' : '🚵'}
                </div>
                <div className="job-details">
                  <div className="job-title">
                    {job.type === 'news' ? 'News & Events' : 'MTB Trail Status'}
                  </div>
                  <div className="job-meta">
                    {job.status === 'completed' && (
                      <span className="job-status completed">✓ Completed</span>
                    )}
                    {job.status === 'running' && (
                      <span className="job-status running">⏳ Running</span>
                    )}
                    {job.status === 'cancelled' && (
                      <span className="job-status cancelled">✗ Cancelled</span>
                    )}
                    {job.status === 'failed' && (
                      <span className="job-status failed">❌ Failed</span>
                    )}
                    <span className="job-time">
                      {formatDateTime(job.timestamp)}
                    </span>
                  </div>
                  <div className="job-stats">
                    {job.type === 'news' ? (
                      <>
                        {job.pois_processed || 0} POIs • {job.news_found || 0} News • {job.events_found || 0} Events
                      </>
                    ) : (
                      <>
                        {job.trails_processed || 0} Trails • {job.status_found || 0} Status Updates
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Provider Configuration */}
      <div className="ai-config-section">
        <h4>AI Search Provider</h4>
        <p className="settings-description">
          Configure which AI provider to use for news/events web search.
        </p>

        {aiConfigLoading ? (
          <p>Loading configuration...</p>
        ) : (
          <>
            <div className="config-row">
              <label>Primary Provider:</label>
              <select
                value={aiConfig.primary}
                onChange={e => setAiConfig({...aiConfig, primary: e.target.value})}
                disabled={aiConfigSaving}
              >
                <option value="gemini">Google Gemini (with Google Search)</option>
                <option value="perplexity">Perplexity Sonar (with web search)</option>
              </select>
            </div>

            <div className="config-row">
              <label>Fallback Provider:</label>
              <select
                value={aiConfig.fallback}
                onChange={e => setAiConfig({...aiConfig, fallback: e.target.value})}
                disabled={aiConfigSaving}
              >
                <option value="none">None (no fallback)</option>
                <option value="gemini">Google Gemini</option>
                <option value="perplexity">Perplexity Sonar</option>
              </select>
              <span className="config-hint">
                Used if primary provider fails or hits its limit
              </span>
            </div>

            <div className="config-row">
              <label>Primary Limit (0 = unlimited):</label>
              <input
                type="number"
                value={aiConfig.primaryLimit === 0 ? '' : aiConfig.primaryLimit}
                onChange={e => setAiConfig({...aiConfig, primaryLimit: e.target.value === '' ? 0 : parseInt(e.target.value) || 0})}
                onBlur={e => {
                  if (e.target.value === '') {
                    setAiConfig({...aiConfig, primaryLimit: 0});
                  }
                }}
                placeholder="0"
                min="0"
                step="100"
                disabled={aiConfigSaving}
              />
              <span className="config-hint">
                Switch to fallback after this many requests per job (helps stay under rate limits)
              </span>
            </div>

            <button
              className="action-btn primary"
              onClick={handleSaveAiConfig}
              disabled={aiConfigSaving || newsCollecting || trailCollecting}
            >
              {aiConfigSaving ? 'Saving...' : 'Save AI Configuration'}
            </button>
          </>
        )}
      </div>

      {/* Twitter Credentials Configuration */}
      <div className="ai-config-section">
        <h4>Twitter/X Credentials</h4>
        <p className="settings-description">
          Login credentials for scraping Twitter content (used for News, Events, and Trail Status).
        </p>

        {twitterLoading ? (
          <p>Loading credentials...</p>
        ) : (
          <>
            <div className="config-row">
              <label>Username:</label>
              <input
                type="text"
                value={twitterCredentials.username}
                onChange={e => setTwitterCredentials({...twitterCredentials, username: e.target.value})}
                disabled={twitterSaving || newsCollecting || trailCollecting}
                placeholder="Twitter username (legacy - not used)"
              />
            </div>

            <div className="config-row">
              <label>Password:</label>
              <input
                type="password"
                value={twitterCredentials.password}
                onChange={e => setTwitterCredentials({...twitterCredentials, password: e.target.value})}
                disabled={twitterSaving || newsCollecting || trailCollecting}
                placeholder="Twitter password (legacy - not used)"
              />
            </div>

            <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #ddd' }}>
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
                        <span style={{ color: '#4caf50', fontWeight: 'bold' }}>✓ Authenticated</span>
                        <span style={{ fontSize: '0.85rem', color: '#666' }}>
                          Expires: {new Date(twitterAuthStatus.expires).toLocaleDateString()}
                        </span>
                      </>
                    ) : (
                      <span style={{ color: '#f44336', fontWeight: 'bold' }}>✗ Not Authenticated</span>
                    )}
                  </div>
                </div>
              )}

              {twitterAuthStatus && twitterAuthStatus.auth_token_preview && (
                <div className="config-row">
                  <label>Auth Token:</label>
                  <input
                    type="text"
                    value={twitterAuthStatus.auth_token_preview}
                    disabled
                    style={{ backgroundColor: '#f5f5f5', color: '#666', fontSize: '0.85rem' }}
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '1.5rem' }}>
              <button
                className="action-btn primary"
                onClick={handleSaveTwitterCredentials}
                disabled={twitterSaving || newsCollecting || trailCollecting}
              >
                {twitterSaving ? 'Saving...' : 'Save Twitter Credentials'}
              </button>

              <button
                className="action-btn primary"
                onClick={handleTwitterLogin}
                disabled={twitterAuthLoading || newsCollecting || trailCollecting}
              >
                Login to Twitter
              </button>

              {twitterAuthStatus && twitterAuthStatus.authenticated && (
                <button
                  className="action-btn secondary"
                  onClick={handleTestTwitterAuth}
                  disabled={twitterAuthTesting || newsCollecting || trailCollecting}
                >
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
                  <li>Click &quot;Export&quot; button (bottom right)</li>
                  <li>Select &quot;JSON&quot; format</li>
                  <li>Copy the JSON and paste below</li>
                </ol>
                <textarea
                  value={twitterCookiesJson}
                  onChange={e => setTwitterCookiesJson(e.target.value)}
                  placeholder='Paste cookies JSON here... should look like: [{"name":"auth_token","value":"...","domain":".x.com",...}]'
                  rows="8"
                  style={{
                    width: '100%',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    padding: '0.75rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    marginBottom: '1rem'
                  }}
                />
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    className="action-btn primary"
                    onClick={handleSaveCookies}
                    disabled={twitterAuthLoading || !twitterCookiesJson.trim()}
                  >
                    {twitterAuthLoading ? 'Saving...' : 'Save Cookies'}
                  </button>
                  <button
                    className="action-btn secondary"
                    onClick={() => {
                      setShowCookieInput(false);
                      setTwitterCookiesJson('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Moderation Configuration */}
      <div className="ai-config-section">
        <h4>Content Moderation</h4>
        <p className="settings-description">
          Configure AI-powered moderation for news, events, and photo submissions.
          New content is reviewed by LLM before publishing.
        </p>

        {moderationConfigLoading ? (
          <p>Loading configuration...</p>
        ) : (
          <>
            <div className="config-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={moderationConfig.enabled}
                  onChange={e => setModerationConfig({...moderationConfig, enabled: e.target.checked})}
                  disabled={moderationConfigSaving}
                />
                Enable Moderation
              </label>
              <span className="config-hint">
                When disabled, new content auto-publishes without review
              </span>
            </div>

            <div className="config-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={moderationConfig.autoApproveEnabled}
                  onChange={e => setModerationConfig({...moderationConfig, autoApproveEnabled: e.target.checked})}
                  disabled={moderationConfigSaving || !moderationConfig.enabled}
                />
                Auto-Approve High Confidence
              </label>
              <span className="config-hint">
                Automatically publish items scoring above the threshold
              </span>
            </div>

            <div className="config-row">
              <label>Auto-Approve Threshold:</label>
              <input
                type="number"
                value={moderationConfig.autoApproveThreshold}
                onChange={e => setModerationConfig({...moderationConfig, autoApproveThreshold: parseFloat(e.target.value) || 0})}
                min="0"
                max="1"
                step="0.05"
                disabled={moderationConfigSaving || !moderationConfig.enabled || !moderationConfig.autoApproveEnabled}
                style={{ width: '80px' }}
              />
              <span className="config-hint">
                Score 0.0-1.0 (recommended: 0.9)
              </span>
            </div>

            <div className="config-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={moderationConfig.photoSubmissionsEnabled}
                  onChange={e => setModerationConfig({...moderationConfig, photoSubmissionsEnabled: e.target.checked})}
                  disabled={moderationConfigSaving}
                />
                Allow Photo Submissions
              </label>
              <span className="config-hint">
                Let authenticated users submit photos for POIs
              </span>
            </div>

            <button
              className="action-btn primary"
              onClick={handleSaveModerationConfig}
              disabled={moderationConfigSaving || newsCollecting || trailCollecting}
            >
              {moderationConfigSaving ? 'Saving...' : 'Save Moderation Configuration'}
            </button>
          </>
        )}
      </div>

      {/* Playwright Status - Infrastructure Check (at bottom) */}
      <div className="playwright-status-section" style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h4 style={{ margin: 0, fontSize: '1rem' }}>Browser Rendering (Playwright)</h4>
          <button
            className="action-btn secondary"
            onClick={handleTestPlaywright}
            disabled={playwrightLoading || playwrightTesting || newsCollecting || trailCollecting}
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}
          >
            {playwrightTesting ? 'Testing...' : 'Test'}
          </button>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.75rem' }}>
          Required for Twitter/X status pages and JavaScript-heavy websites.
        </p>

        {playwrightLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="pulse" style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ffc107' }}></span>
            <span style={{ fontSize: '0.9rem' }}>Checking Playwright status...</span>
          </div>
        ) : playwrightStatus ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {playwrightStatus.status === 'working' ? (
              <>
                <span style={{ color: '#28a745', fontWeight: 'bold', fontSize: '0.95rem' }}>✓ Working</span>
                <span style={{ fontSize: '0.85rem', color: '#666' }}>
                  Chromium {playwrightStatus.browser_version} • Launch: {playwrightStatus.launch_time_ms}ms
                </span>
              </>
            ) : (
              <>
                <span style={{ color: '#dc3545', fontWeight: 'bold', fontSize: '0.95rem' }}>✗ Not Working</span>
                <span style={{ fontSize: '0.85rem', color: '#666' }}>
                  {playwrightStatus.message}
                </span>
                {playwrightStatus.suggestion && (
                  <div style={{ width: '100%', marginTop: '0.5rem', padding: '0.5rem', backgroundColor: '#fff3cd', borderRadius: '4px', fontSize: '0.85rem' }}>
                    <strong>Fix:</strong> {playwrightStatus.suggestion}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <span style={{ color: '#6c757d', fontSize: '0.9rem' }}>Status unknown</span>
        )}
      </div>

      {/* Result message */}
      {result && (
        <div className={`result-message ${result.type}`}>
          {result.message}
        </div>
      )}
    </div>
  );
}

export default DataCollectionSettings;
