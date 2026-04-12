import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL || '';

const STATUS_COLORS = {
  completed: '#4caf50',
  running: '#2196f3',
  failed: '#f44336',
  cancelled: '#ff9800',
  stale: '#795548',
  queued: '#9e9e9e',
  pending: '#9e9e9e'
};

const CANCEL_ENDPOINTS = {
  news: { url: '/api/admin/news/job/:id/cancel', method: 'POST' },
  trail_status: { url: '/api/admin/trail-status/batch-collect/:id/cancel', method: 'PUT' }
};

const STATUS_ENDPOINTS = {
  news: '/api/admin/news/status',
  trail_status: '/api/admin/trail-status/job-status/latest'
};

const SLOTS_ENDPOINTS = {
  news: '/api/admin/news/job/:id',
  trail_status: '/api/admin/trail-status/job-status/:id'
};

const AI_STATS_ENDPOINTS = {
  news: '/api/admin/news/ai-stats',
  trail_status: '/api/admin/trail-status/ai-stats'
};

function formatDuration(startedAt, completedAt) {
  if (!startedAt) return '--';
  const start = new Date(startedAt);
  const end = completedAt ? new Date(completedAt) : new Date();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSecs}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTime(isoString) {
  if (!isoString) return '--';
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatCronHuman(cron) {
  if (!cron) return 'Event-driven';
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom] = parts;

  if (cron === '0 6 * * *') return 'Daily at 6:00 AM';
  if (cron === '0 2 * * *') return 'Daily at 2:00 AM';
  if (cron === '0 3 * * *') return 'Daily at 3:00 AM';
  if (cron.startsWith('*/')) return `Every ${min.slice(2)} minutes`;
  if (hour !== '*' && min !== '*' && dom === '*') return `Daily at ${hour}:${min.padStart(2, '0')}`;
  return cron;
}

export default function JobsDashboard({ expandTarget, onExpandTargetConsumed }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlJobId = searchParams.get('job');
  const urlJobType = searchParams.get('type');
  const urlPoiId = searchParams.get('poi');

  const [scheduledJobs, setScheduledJobs] = useState([]);
  const [scheduledLoading, setScheduledLoading] = useState(true);
  const [expandedScheduled, setExpandedScheduled] = useState(null);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [scheduleInput, setScheduleInput] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [triggeringJob, setTriggeringJob] = useState(null);

  const [editingPrompt, setEditingPrompt] = useState(null);
  const [promptInput, setPromptInput] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);

  const [jobHistory, setJobHistory] = useState({});
  const [jobHistoryLoading, setJobHistoryLoading] = useState({});

  const [expandedRun, setExpandedRun] = useState(null);
  const [runLogs, setRunLogs] = useState([]);
  const [logLevelFilter, setLogLevelFilter] = useState('all');
  const [logDetailsExpanded, setLogDetailsExpanded] = useState(new Set());

  const [runningJobs, setRunningJobs] = useState({});
  const [activeSlots, setActiveSlots] = useState({});
  const [aiStats, setAiStats] = useState({});
  const [cancellingJob, setCancellingJob] = useState(null);

  // Track recently-completed jobs for dismiss UX
  const [completedJobs, setCompletedJobs] = useState({});

  const [loading, setLoading] = useState(true);

  // Track when to auto-expand the newest run after clicking "Run Now"
  const [autoExpandNewestRun, setAutoExpandNewestRun] = useState(null);

  const fetchScheduledJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/jobs/scheduled`, { credentials: 'include' });
      if (res.ok) setScheduledJobs(await res.json());
    } catch (err) {
      console.error('Failed to fetch scheduled jobs:', err);
    } finally {
      setScheduledLoading(false);
    }
  }, []);

  const fetchJobHistory = useCallback(async (jobId, historyTypes) => {
    if (!historyTypes || historyTypes.length === 0) return;
    setJobHistoryLoading(prev => ({ ...prev, [jobId]: true }));
    try {
      const allRuns = [];
      for (const type of historyTypes) {
        const params = new URLSearchParams({ limit: '10', offset: '0', type });
        const res = await fetch(`${API_BASE}/api/admin/jobs/history?${params}`, { credentials: 'include' });
        if (res.ok) allRuns.push(...(await res.json()));
      }
      allRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setJobHistory(prev => ({ ...prev, [jobId]: allRuns.slice(0, 10) }));
    } catch (err) {
      console.error('Failed to fetch job history:', err);
    } finally {
      setJobHistoryLoading(prev => ({ ...prev, [jobId]: false }));
    }
  }, []);

  const fetchRunLogs = useCallback(async (jobType, runId, poiId) => {
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (logLevelFilter !== 'all') params.set('level', logLevelFilter);
      const res = await fetch(`${API_BASE}/api/admin/jobs/${jobType}/${runId}/logs?${params}`, { credentials: 'include' });
      if (res.ok) {
        const newLogs = await res.json();
        setRunLogs(prev => {
          // Initial load or filter change — replace
          if (prev.length === 0) return newLogs;
          // No new entries — keep same reference (no re-render)
          if (newLogs.length === prev.length) return prev;
          // New entries arrived — append only the new ones
          const existingIds = new Set(prev.map(l => l.id));
          const added = newLogs.filter(l => !existingIds.has(l.id));
          if (added.length === 0) return prev;
          return [...prev, ...added];
        });
      }
    } catch (err) {
      console.error('Failed to fetch run logs:', err);
    }
  }, [logLevelFilter]);

  const checkRunningJobs = useCallback(async () => {
    const running = {};
    const slots = {};
    const stats = {};

    for (const [registryId, endpoint] of Object.entries(STATUS_ENDPOINTS)) {
      try {
        const res = await fetch(`${API_BASE}${endpoint}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const isActive = data && (data.status === 'running' || data.status === 'queued');
          if (isActive) {
            const runId = data.id || data.jobId;
            running[registryId] = { ...data, runId };

            // Fetch active slots
            const slotsEndpoint = SLOTS_ENDPOINTS[registryId];
            if (slotsEndpoint && runId) {
              try {
                const slotsUrl = slotsEndpoint.replace(':id', runId);
                const slotsRes = await fetch(`${API_BASE}${slotsUrl}`, { credentials: 'include' });
                if (slotsRes.ok) {
                  const slotsData = await slotsRes.json();
                  if (slotsData.displaySlots) slots[registryId] = slotsData.displaySlots;
                }
              } catch { /* ignore */ }
            }

            // Fetch AI stats
            const statsEndpoint = AI_STATS_ENDPOINTS[registryId];
            if (statsEndpoint) {
              try {
                const statsRes = await fetch(`${API_BASE}${statsEndpoint}`, { credentials: 'include' });
                if (statsRes.ok) stats[registryId] = await statsRes.json();
              } catch { /* ignore */ }
            }
          }
        }
      } catch { /* ignore */ }
    }

    // Detect jobs that just completed (were running, now aren't)
    setRunningJobs(prev => {
      for (const id of Object.keys(prev)) {
        if (!running[id]) {
          // Job just finished — mark as completed for dismiss UX
          setCompletedJobs(c => ({ ...c, [id]: prev[id] }));
          // Refresh history for this job
          const job = scheduledJobs.find(j => j.id === id);
          if (job) {
            setJobHistory(h => ({ ...h, [id]: undefined }));
            fetchJobHistory(id, job.historyTypes);
          }
        }
      }
      return running;
    });

    setActiveSlots(slots);
    setAiStats(stats);
  }, [scheduledJobs, fetchJobHistory]);

  useEffect(() => {
    Promise.all([fetchScheduledJobs(), checkRunningJobs()]).then(() => setLoading(false));
  }, [fetchScheduledJobs, checkRunningJobs]);

  // Auto-expand a specific job card when navigated from another tab
  useEffect(() => {
    if (expandTarget && !scheduledLoading) {
      setExpandedScheduled(expandTarget);
      setJobHistory(prev => { const next = { ...prev }; delete next[expandTarget]; return next; });
      if (onExpandTargetConsumed) onExpandTargetConsumed();
    }
  }, [expandTarget, scheduledLoading, onExpandTargetConsumed]);

  // Poll faster when jobs are running
  useEffect(() => {
    const hasRunning = Object.keys(runningJobs).length > 0;
    const interval = setInterval(() => {
      if (hasRunning) checkRunningJobs();
      else fetchScheduledJobs();
    }, hasRunning ? 2000 : 15000);
    return () => clearInterval(interval);
  }, [fetchScheduledJobs, checkRunningJobs, runningJobs]);

  // Also refresh scheduled jobs periodically even when polling running jobs
  useEffect(() => {
    if (Object.keys(runningJobs).length === 0) return;
    const interval = setInterval(fetchScheduledJobs, 15000);
    return () => clearInterval(interval);
  }, [fetchScheduledJobs, runningJobs]);

  useEffect(() => {
    if (expandedScheduled) {
      const job = scheduledJobs.find(j => j.id === expandedScheduled);
      if (job && !jobHistory[job.id]) fetchJobHistory(job.id, job.historyTypes);
    }
  }, [expandedScheduled, scheduledJobs, fetchJobHistory, jobHistory]);

  useEffect(() => {
    if (expandedRun) fetchRunLogs(expandedRun.jobType, expandedRun.runId, expandedRun.poiId);
  }, [expandedRun, logLevelFilter, fetchRunLogs]);

  // Poll logs when a run is expanded and its job is running
  useEffect(() => {
    if (!expandedRun) return;

    // Single-POI polling is handled by a separate effect below (to avoid dependency churn)
    if (expandedRun.jobType === 'news_single' || expandedRun.jobType === 'events_single') return;

    // For batch jobs, find the job and check if running
    const job = scheduledJobs.find(j =>
      j.historyTypes && j.historyTypes.includes(expandedRun.jobType)
    );

    if (!job) return;

    // Check if this job is currently running
    const isRunning = !!runningJobs[job.id];

    if (!isRunning) return;

    // Poll logs every 2 seconds while running
    const interval = setInterval(() => {
      fetchRunLogs(expandedRun.jobType, expandedRun.runId, expandedRun.poiId);
    }, 2000);

    return () => clearInterval(interval);
  }, [expandedRun, runningJobs, scheduledJobs, fetchRunLogs]);

  // Separate polling effect for single-POI jobs — minimal dependencies to avoid teardown
  // Only polls logs (append-only). Refreshes history once on completion.
  useEffect(() => {
    if (!expandedRun) return;
    if (expandedRun.jobType !== 'news_single' && expandedRun.jobType !== 'events_single') return;

    let pollCount = 0;
    let completed = false;
    const interval = setInterval(async () => {
      await fetchRunLogs(expandedRun.jobType, expandedRun.runId, expandedRun.poiId);
      pollCount++;
      // Stop after 2 minutes (60 polls at 2s)
      if (pollCount >= 60) clearInterval(interval);
    }, 2000);

    // Check for completion by watching runLogs changes (separate from polling)
    // This is handled by the effect below

    return () => clearInterval(interval);
  }, [expandedRun, fetchRunLogs]);

  // Refresh history once when single-POI job completes (detected from logs)
  useEffect(() => {
    if (!expandedRun) return;
    if (expandedRun.jobType !== 'news_single' && expandedRun.jobType !== 'events_single') return;
    const hasCompleted = runLogs.some(l => l.details?.completed === true);
    if (hasCompleted) {
      setJobHistory(prev => { const next = { ...prev }; delete next['news']; return next; });
    }
  }, [expandedRun, runLogs]);

  // Auto-expand newest run after clicking "Run Now"
  useEffect(() => {
    if (autoExpandNewestRun && jobHistory[autoExpandNewestRun]) {
      const runs = jobHistory[autoExpandNewestRun];
      if (runs && runs.length > 0) {
        const newestRun = runs[0]; // Assuming sorted by created_at DESC
        setExpandedRun({ jobType: newestRun.job_type, runId: newestRun.id });
        setAutoExpandNewestRun(null);
      }
    }
  }, [jobHistory, autoExpandNewestRun]);

  // Auto-expand job from URL parameters (for single-POI and batch redirects)
  // Clears URL params after consuming to prevent re-firing on every jobHistory change
  useEffect(() => {
    if (urlJobId && urlJobType && !scheduledLoading) {
      // For single-POI jobs, expand the News & Events card and the specific run
      if (urlJobType === 'news_single' || urlJobType === 'events_single') {
        setExpandedScheduled('news');
        setExpandedRun({ jobType: urlJobType, runId: urlJobId, poiId: urlPoiId || urlJobId });

        // Clear URL params so this effect doesn't re-fire
        setSearchParams({}, { replace: true });

        setTimeout(() => {
          const element = document.querySelector('.job-logs-panel');
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 500);
      } else {
        // For batch jobs, find the matching run in history
        const runs = Object.values(jobHistory).flat();
        const targetRun = runs.find(r =>
          String(r.id) === urlJobId && r.job_type === urlJobType
        );

        if (targetRun) {
          setExpandedRun({ jobType: targetRun.job_type, runId: targetRun.id });
          setSearchParams({}, { replace: true });

          setTimeout(() => {
            const element = document.getElementById(`job-${targetRun.job_type}-${targetRun.id}`);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 100);
        }
      }
    }
  }, [urlJobId, urlJobType, scheduledLoading, jobHistory, setSearchParams]);

  const handleExpandRun = (jobType, run) => {
    const key = `${jobType}-${String(run.id)}`;
    if (expandedRun && `${expandedRun.jobType}-${String(expandedRun.runId)}` === key) {
      setExpandedRun(null); setRunLogs([]); setLogLevelFilter('all');
    } else {
      // For single-POI jobs, the run's id in history is the runId (timestamp), but logs are queried by poi_id
      // The history query returns poi_id count as items_total, so we can't get poi_id from there
      // Instead, query logs by job_id (which is the runId) using the batch endpoint
      setExpandedRun({ jobType, runId: run.id }); setLogLevelFilter('all'); setLogDetailsExpanded(new Set());
    }
  };

  const toggleLogDetails = (logId) => {
    setLogDetailsExpanded(prev => { const next = new Set(prev); if (next.has(logId)) next.delete(logId); else next.add(logId); return next; });
  };

  const handleSaveSchedule = async (jobName) => {
    setScheduleSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/jobs/${jobName}/schedule`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ cronExpression: scheduleInput })
      });
      if (res.ok) { setEditingSchedule(null); await fetchScheduledJobs(); }
      else { const err = await res.json(); alert(err.error || 'Failed to save schedule'); }
    } catch (err) { alert('Failed to save schedule: ' + err.message); }
    finally { setScheduleSaving(false); }
  };

  const handleRunNow = async (job) => {
    if (!job.triggerEndpoint) return;
    setTriggeringJob(job.id);
    try {
      const res = await fetch(`${API_BASE}${job.triggerEndpoint}`, {
        method: job.manualTriggerMethod || 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({})
      });
      if (res.ok) {
        // Auto-expand the card so user sees progress
        setExpandedScheduled(job.id);
        await fetchScheduledJobs();
        await checkRunningJobs();
        setJobHistory(prev => ({ ...prev, [job.id]: undefined }));
        // Mark this job for auto-expanding its newest run
        setAutoExpandNewestRun(job.id);
      } else { const err = await res.json(); alert(err.error || 'Failed to trigger job'); }
    } catch (err) { alert('Failed to trigger job: ' + err.message); }
    finally { setTriggeringJob(null); }
  };

  const handleCancelJob = async (registryId) => {
    const cancelInfo = CANCEL_ENDPOINTS[registryId];
    const runInfo = runningJobs[registryId];
    if (!cancelInfo || !runInfo) return;
    const runId = runInfo.runId || runInfo.id || runInfo.jobId;
    if (!runId) return;

    setCancellingJob(registryId);
    try {
      const url = cancelInfo.url.replace(':id', runId);
      await fetch(`${API_BASE}${url}`, { method: cancelInfo.method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' });
      await checkRunningJobs();
    } catch (err) { console.error('Failed to cancel job:', err); }
    finally { setCancellingJob(null); }
  };

  const handleSavePrompt = async (key) => {
    setPromptSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/prompts/${key}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ value: promptInput })
      });
      if (res.ok) { setEditingPrompt(null); await fetchScheduledJobs(); }
    } catch (err) { console.error('Failed to save prompt:', err); }
    finally { setPromptSaving(false); }
  };

  const handleResetPrompt = async (key) => {
    setPromptSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/prompts/${key}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ reset: true })
      });
      if (res.ok) { setEditingPrompt(null); await fetchScheduledJobs(); }
    } catch (err) { console.error('Failed to reset prompt:', err); }
    finally { setPromptSaving(false); }
  };

  const renderLogDetails = (entry) => {
    if (!entry.details) return null;
    const details = entry.details;
    const hasAiResponse = details.ai_response && details.ai_response.length > 0;
    const hasRenderedContent = details.rendered_content && details.rendered_content.length > 0;
    const summaryDetails = { ...details };
    delete summaryDetails.ai_response; delete summaryDetails.rendered_content; delete summaryDetails.error_stack;

    return (
      <div className="log-details-structured">
        {Object.keys(summaryDetails).length > 0 && (
          <div className="log-detail-section"><div className="log-detail-pairs">
            {Object.entries(summaryDetails).map(([key, value]) => (
              <span key={key} className="log-detail-pair">
                <span className="log-detail-key">{key.replace(/_/g, ' ')}:</span>
                <span className="log-detail-value">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
              </span>
            ))}
          </div></div>
        )}
        {details.error_stack && (<div className="log-detail-section"><div className="log-detail-label">Error Stack</div><pre className="log-detail-pre error">{details.error_stack}</pre></div>)}
        {hasAiResponse && (<CollapsibleSection title={`AI Response (${details.ai_response.length} chars)`}><pre className="log-detail-pre">{details.ai_response}</pre></CollapsibleSection>)}
        {hasRenderedContent && (<CollapsibleSection title={`Rendered Content (${details.rendered_content.length} chars)`}><pre className="log-detail-pre">{details.rendered_content}</pre></CollapsibleSection>)}
      </div>
    );
  };

  // Render the running job progress section (progress bar, counts, AI stats, slots, cancel)
  const renderRunningSection = (job) => {
    const runInfo = runningJobs[job.id];
    const completed = completedJobs[job.id];
    const info = runInfo || completed;
    if (!info) return null;

    const isStillRunning = !!runInfo;
    const canCancel = isStillRunning && !!CANCEL_ENDPOINTS[job.id];
    const slots = activeSlots[job.id];
    const stats = aiStats[job.id];

    // Progress values
    const isNews = job.id === 'news';
    const processed = isNews ? (info.pois_processed || 0) : (info.trails_processed || 0);
    const total = isNews ? (info.total_pois || 0) : (info.total_trails || 0);
    const pct = total > 0 ? (processed / total) * 100 : 0;

    const geminiUsage = stats?.usage?.gemini || 0;
    const perplexityUsage = stats?.usage?.perplexity || 0;
    const total429 = (stats?.errors?.gemini429 || 0) + (stats?.errors?.perplexity429 || 0);

    return (
      <div className="running-job-section">
        <div className="running-job-header">
          <span className={`running-indicator ${isStillRunning ? 'pulse' : ''}`}
            style={{ background: isStillRunning ? '#2196f3' : (info.status === 'cancelled' ? '#ff9800' : '#4caf50') }}
          ></span>
          <span>{isStillRunning ? 'Job in progress' : info.status === 'cancelled' ? 'Job cancelled' : 'Job completed'}</span>
          {canCancel && (
            <button className="status-cancel-btn" onClick={(e) => { e.stopPropagation(); handleCancelJob(job.id); }} disabled={cancellingJob === job.id}>
              {cancellingJob === job.id ? 'Cancelling...' : 'Cancel'}
            </button>
          )}
          {!isStillRunning && (
            <button className="status-close-btn" onClick={(e) => { e.stopPropagation(); setCompletedJobs(prev => { const next = { ...prev }; delete next[job.id]; return next; }); }} title="Dismiss">
              &times;
            </button>
          )}
        </div>

        {/* Progress bar */}
        {total > 0 && (
          <div className="progress-bar-wrapper" style={{ marginTop: '8px' }}>
            <div className="progress-bar-fill" style={{
              width: `${pct}%`,
              background: !isStillRunning
                ? 'linear-gradient(90deg, #4caf50, #8bc34a)'
                : 'linear-gradient(90deg, #2196f3, #64b5f6)'
            }} />
          </div>
        )}

        {/* Count badges */}
        <div className="progress-counts" style={{ marginTop: '6px' }}>
          <div className="count-badge">
            <span className="count-icon">{isNews ? '\u{1F4CD}' : '\u{1F6B5}'}</span>
            <div className="count-details">
              <span className="count-value">{processed}</span>
              <span className="count-label">{total > 0 ? ` / ${total}` : ''} {isNews ? 'POIs' : 'Trails'}</span>
            </div>
          </div>
          {isNews && (
            <>
              <div className="count-badge">
                <span className="count-icon">{'\u{1F4F0}'}</span>
                <div className="count-details">
                  <span className="count-value">{info.news_found || 0}</span>
                  <span className="count-label">News</span>
                </div>
              </div>
              <div className="count-badge">
                <span className="count-icon">{'\u{1F4C5}'}</span>
                <div className="count-details">
                  <span className="count-value">{info.events_found || 0}</span>
                  <span className="count-label">Events</span>
                </div>
              </div>
            </>
          )}
          {!isNews && (
            <div className="count-badge">
              <span className="count-icon">{'\u{1F4CA}'}</span>
              <div className="count-details">
                <span className="count-value">{info.status_found || 0}</span>
                <span className="count-label">Status Updates</span>
              </div>
            </div>
          )}
        </div>

        {/* Active Slots */}
        {slots && (
          <div className="active-slots-table" style={{ marginTop: '8px' }}>
            {slots.some(s => s !== null) && (
              <>
                <div className="slots-header">
                  <div>{isNews ? 'POI' : 'Trail'}</div>
                  <div>Status</div>
                </div>
                {slots.map((slot, idx) => {
                  if (!slot || !slot.poiName) return (
                    <div key={idx} className="slots-row empty-slot"><div>Waiting</div><div>--</div></div>
                  );

                  // Map internal phases to user-friendly labels
                  let statusLabel = '--';
                  if (slot.status === 'completed') {
                    statusLabel = '✓ Done';
                  } else if (slot.phase === 'error') {
                    statusLabel = '✗ Error';
                  } else if (slot.phase === 'initializing') {
                    statusLabel = '🚀 Starting';
                  } else if (slot.phase === 'classifying_events' || slot.phase === 'classifying_news') {
                    statusLabel = '🕷️ Crawling site';
                  } else if (slot.phase === 'rendering_events' || slot.phase === 'rendering_news' || slot.phase === 'rendering') {
                    statusLabel = '📄 Reading page';
                  } else if (slot.phase === 'ai_search') {
                    statusLabel = '🤖 AI extraction';
                  } else if (slot.phase === 'processing_results') {
                    statusLabel = '⚙️ Processing';
                  } else if (slot.phase === 'matching_links') {
                    statusLabel = '🔗 Linking articles';
                  } else if (slot.phase === 'deep_crawling') {
                    statusLabel = '🔎 Verifying URLs';
                  } else if (slot.phase === 'serper_search') {
                    statusLabel = '🌐 Finding coverage';
                  } else if (slot.phase === 'extracting_external_news') {
                    statusLabel = '📰 Reading articles';
                  } else if (slot.phase === 'complete') {
                    statusLabel = '✓ Complete';
                  } else if (slot.phase) {
                    statusLabel = slot.phase;
                  }

                  return (
                    <div key={idx} className={`slots-row ${slot.status === 'active' ? 'active' : ''}`}>
                      <div className="slot-poi">{slot.poiName}</div>
                      <div className="slot-status">{statusLabel}</div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div className="jobs-dashboard"><p>Loading job data...</p></div>;

  return (
    <div className="jobs-dashboard">
      <h3>Scheduled Jobs</h3>
      {scheduledLoading ? (
        <p style={{ color: '#999' }}>Loading scheduled jobs...</p>
      ) : (
        <div className="scheduled-jobs-grid">
          {scheduledJobs.map(job => {
            const isRunning = !!runningJobs[job.id];
            const isCompleted = !!completedJobs[job.id];
            const showProgress = isRunning || isCompleted;
            const runs = jobHistory[job.id] || [];
            const historyLoading = jobHistoryLoading[job.id];

            return (
              <div key={job.id} className={`scheduled-job-card ${isRunning ? 'running' : ''}`}>
                <div className="scheduled-job-header"
                  onClick={() => {
                    const newId = expandedScheduled === job.id ? null : job.id;
                    setExpandedScheduled(newId);
                    setExpandedRun(null);
                    setRunLogs([]);
                    if (newId) setJobHistory(prev => { const next = { ...prev }; delete next[newId]; return next; });
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="scheduled-job-info">
                    <span className="scheduled-job-icon">{job.icon}</span>
                    <div>
                      <div className="scheduled-job-label">{job.label}</div>
                      <div className="scheduled-job-desc">{job.description}</div>
                    </div>
                  </div>
                  <div className="scheduled-job-badges">
                    {isRunning && <span className="queue-badge queue-badge-running"
                      style={{ backgroundColor: STATUS_COLORS[runningJobs[job.id]?.status] || '#2196f3' }}>
                      {runningJobs[job.id]?.status || 'running'}
                    </span>}
                    {job.currentSchedule && <span className="schedule-badge" title={job.currentSchedule}>{formatCronHuman(job.currentSchedule)}</span>}
                    {!isRunning && job.queueSize > 0 ? <span className="queue-badge queue-badge-active">{job.queueSize} queued</span>
                      : !isRunning ? <span className="queue-badge queue-badge-idle">idle</span> : null}
                  </div>
                </div>

                {expandedScheduled === job.id && (
                  <div className="scheduled-job-detail">
                    {/* Running/Completed progress */}
                    {showProgress && renderRunningSection(job)}

                    {/* Schedule Editor */}
                    {job.currentSchedule && (
                      <div className="schedule-editor">
                        {editingSchedule === job.scheduleJobName ? (
                          <div className="schedule-edit-row">
                            <input type="text" value={scheduleInput} onChange={(e) => setScheduleInput(e.target.value)} placeholder="e.g. */30 * * * *" className="schedule-input" />
                            <button className="sync-btn-small" onClick={() => handleSaveSchedule(job.scheduleJobName)} disabled={scheduleSaving}>{scheduleSaving ? 'Saving...' : 'Save'}</button>
                            <button className="sync-btn-small" onClick={() => setEditingSchedule(null)}>Cancel</button>
                          </div>
                        ) : (
                          <div className="schedule-display-row">
                            <code className="schedule-cron">{job.currentSchedule}</code>
                            {job.currentSchedule !== job.defaultSchedule && <span className="schedule-custom-badge">custom</span>}
                            <button className="sync-btn-small" onClick={() => { setEditingSchedule(job.scheduleJobName); setScheduleInput(job.currentSchedule); }}>Edit</button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Run Now */}
                    {job.triggerEndpoint && !isRunning && (
                      <button className="action-btn primary" onClick={() => handleRunNow(job)} disabled={triggeringJob === job.id}
                        style={{ marginTop: '8px', padding: '4px 12px', fontSize: '0.85rem' }}>
                        {triggeringJob === job.id ? 'Starting...' : 'Run Now'}
                      </button>
                    )}

                    {/* Prompt Template Editor */}
                    {job.hasPrompt && job.prompts && job.prompts.length > 0 && (
                      <div className="prompt-section">
                        {job.prompts.map(p => (
                          <div key={p.key} className="prompt-editor">
                            <div className="prompt-header">
                              <label>
                                {p.label}
                                <span style={{ marginLeft: '8px', fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px',
                                  backgroundColor: p.isCustomized ? '#fff3e0' : '#e8f5e9', color: p.isCustomized ? '#e65100' : '#2e7d32' }}>
                                  {p.isCustomized ? 'Customized' : 'Using default'}
                                </span>
                              </label>
                              <div className="prompt-actions">
                                {editingPrompt === p.key ? (
                                  <>
                                    <button className="sync-btn-small" onClick={() => handleSavePrompt(p.key)} disabled={promptSaving}>Save</button>
                                    <button className="sync-btn-small" onClick={() => setEditingPrompt(null)}>Cancel</button>
                                    {p.isCustomized && <button className="sync-btn-small" onClick={() => handleResetPrompt(p.key)} disabled={promptSaving}>Reset to Default</button>}
                                  </>
                                ) : (
                                  <>
                                    <button className="sync-btn-small" onClick={() => { setEditingPrompt(p.key); setPromptInput(p.currentValue); }}>Edit</button>
                                    {p.isCustomized && <button className="sync-btn-small" onClick={() => handleResetPrompt(p.key)} disabled={promptSaving}>Reset to Default</button>}
                                  </>
                                )}
                              </div>
                            </div>
                            <textarea value={editingPrompt === p.key ? promptInput : p.currentValue} onChange={(e) => setPromptInput(e.target.value)}
                              disabled={editingPrompt !== p.key} rows={8} className="prompt-textarea" />
                            {p.placeholders && p.placeholders.length > 0 && (
                              <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {p.placeholders.map(ph => <code key={ph} style={{ fontSize: '0.75rem', padding: '2px 6px', backgroundColor: '#f5f5f5', borderRadius: '3px', color: '#555' }}>{ph}</code>)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Recent Runs */}
                    <div className="job-runs-section">
                      <div className="job-runs-header">Recent Runs</div>
                      {historyLoading ? (
                        <p style={{ color: '#999', fontSize: '0.85rem', margin: '4px 0' }}>Loading...</p>
                      ) : runs.length === 0 ? (
                        <p style={{ color: '#999', fontSize: '0.85rem', margin: '4px 0' }}>No recent runs.</p>
                      ) : (
                        <div className="job-runs-list">
                          {runs.map(run => {
                            const isExpanded = expandedRun && expandedRun.jobType === run.job_type && String(expandedRun.runId) === String(run.id);
                            return (
                              <div
                                key={`${run.job_type}-${run.id}`}
                                id={`job-${run.job_type}-${run.id}`}
                                className="job-run-item">
                                <div className={`job-run-row ${isExpanded ? 'expanded' : ''}`}
                                  onClick={(e) => { e.stopPropagation(); handleExpandRun(run.job_type, run); }}>
                                  <span className="status-badge" style={{ backgroundColor: STATUS_COLORS[run.status] || '#9e9e9e' }}>{run.status}</span>
                                  <span className="run-items">{run.items_processed != null ? `${run.items_processed}/${run.items_total}` : '--'}</span>
                                  <span className="run-time">{formatTime(run.started_at || run.created_at)}</span>
                                  <span className="run-duration">
                                    {run.status === 'running' || run.status === 'pending'
                                      ? <LiveDuration startedAt={run.started_at || run.created_at} />
                                      : formatDuration(run.started_at, run.completed_at)
                                    }
                                  </span>
                                </div>

                                {isExpanded && (
                                  <div className="job-logs-panel">
                                    <div className="log-level-filters">
                                      {['all', 'error', 'warn'].map(level => (
                                        <button key={level} className={`log-filter-btn ${logLevelFilter === level ? 'active' : ''}`}
                                          onClick={(e) => { e.stopPropagation(); setLogLevelFilter(level); }}>
                                          {level === 'all' ? 'All' : level === 'error' ? 'Errors' : 'Warnings'}
                                        </button>
                                      ))}
                                    </div>
                                    {run.error_message && <div className="job-error-banner">{run.error_message}</div>}
                                    {runLogs.length === 0 ? (
                                      <p style={{ color: '#999', padding: '8px 0', margin: 0, fontSize: '0.82rem' }}>
                                        No log entries{logLevelFilter !== 'all' ? ` with level "${logLevelFilter}"` : ''}.
                                      </p>
                                    ) : (
                                      <pre className="job-logs-text">{runLogs.map(entry => {
                                        const time = entry.created_at ? new Date(entry.created_at).toLocaleTimeString() : '--';
                                        const level = entry.level === 'error' ? 'ERR' : entry.level === 'warn' ? 'WRN' : 'INF';
                                        const poi = entry.poi_name || '--';
                                        let line = `${time}  ${level}  ${poi}  ${entry.message}`;
                                        if (entry.details) {
                                          const detailParts = Object.entries(entry.details)
                                            .filter(([k]) => k !== 'ai_response' && k !== 'rendered_content' && k !== 'error_stack')
                                            .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`);
                                          if (detailParts.length > 0) line += `  (${detailParts.join(', ')})`;
                                          if (entry.details.error_stack) line += `\n  ${entry.details.error_stack}`;
                                        }
                                        return line;
                                      }).join('\n')}</pre>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LiveDuration({ startedAt }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);
  return formatDuration(startedAt, null);
}

function CollapsibleSection({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="log-detail-section collapsible">
      <div className="log-detail-label clickable" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block', marginRight: '6px' }}>&#9654;</span>
        {title}
      </div>
      {open && children}
    </div>
  );
}
