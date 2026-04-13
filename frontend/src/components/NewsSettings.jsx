import React, { useState, useEffect } from 'react';
import { formatDateTime } from './NewsEventsShared';

function NewsSettings() {
  const [jobStatus, setJobStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [result, setResult] = useState(null);
  const [liveProgress, setLiveProgress] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);
  const [aiStats, setAiStats] = useState(null);

  const [aiConfigLoading, setAiConfigLoading] = useState(false);

  useEffect(() => {
    fetchJobStatus();
    checkForRunningJob();
  }, []);

  // Poll for active job status and AI stats
  useEffect(() => {
    if (!activeJobId) return;

    const pollInterval = setInterval(async () => {
      try {
        // Fetch job status
        const response = await fetch(`/api/admin/news/job/${activeJobId}`, {
          credentials: 'include'
        });
        if (response.ok) {
          const status = await response.json();
          setLiveProgress(status);

          // Fetch AI stats while job is running
          try {
            const statsResponse = await fetch('/api/admin/news/ai-stats', {
              credentials: 'include'
            });
            if (statsResponse.ok) {
              const stats = await statsResponse.json();
              setAiStats(stats);
            }
          } catch (statsErr) {
            console.error('Error fetching AI stats:', statsErr);
          }

          if (status.status === 'completed') {
            clearInterval(pollInterval);
            setCollecting(false);
            setActiveJobId(null);
            setResult({
              type: 'success',
              message: `Completed! Found ${status.news_found} news and ${status.events_found} events from ${status.pois_processed} POIs`
            });
            setLiveProgress(null);
            fetchJobStatus();
          } else if (status.status === 'failed') {
            clearInterval(pollInterval);
            setCollecting(false);
            setActiveJobId(null);
            setResult({
              type: 'error',
              message: status.error_message || 'Job failed'
            });
            setLiveProgress(null);
            fetchJobStatus();
          } else if (status.status === 'cancelled') {
            clearInterval(pollInterval);
            setCollecting(false);
            setActiveJobId(null);
            // Keep liveProgress visible with cancelled status
            setLiveProgress({
              ...status,
              cancelledMessage: `Job cancelled at ${status.pois_processed}/${status.total_pois} POIs`
            });
            fetchJobStatus();
          }
        }
      } catch (err) {
        console.error('Error polling job status:', err);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [activeJobId]);

  const handleCancelJob = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/admin/news/job/${activeJobId}/cancel`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (err) {
      console.error('Error cancelling job:', err);
    }
  };

  const fetchJobStatus = async () => {
    try {
      const response = await fetch('/api/admin/news/status', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setJobStatus(data);
      }
    } catch (err) {
      console.error('Error fetching job status:', err);
    } finally {
      setLoading(false);
    }
  };

  const checkForRunningJob = async () => {
    try {
      const response = await fetch('/api/admin/news/status', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'running') {
          setActiveJobId(data.id);
          setCollecting(true);
          setLiveProgress(data);
        }
      }
    } catch (err) {
      console.error('Error checking for running job:', err);
    }
  };

  const handleCollectNews = async () => {
    setCollecting(true);
    setResult(null);
    setLiveProgress({ status: 'starting', pois_processed: 0, news_found: 0, events_found: 0 });

    try {
      const response = await fetch('/api/admin/news/collect', {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setActiveJobId(data.jobId);
        setLiveProgress({
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
        setCollecting(false);
        setLiveProgress(null);
      }
    } catch (err) {
      setResult({
        type: 'error',
        message: err.message
      });
      setCollecting(false);
      setLiveProgress(null);
    }
  };

  const handleCleanup = async () => {
    if (!confirm('Delete old news (>90 days) and past events (>30 days)?')) {
      return;
    }

    setCleaningUp(true);
    setResult(null);

    try {
      const response = await fetch('/api/admin/news/cleanup', {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setResult({
          type: 'success',
          message: `Cleaned up ${data.newsDeleted} old news items and ${data.eventsDeleted} past events`
        });
      } else {
        const error = await response.json();
        setResult({
          type: 'error',
          message: error.error || 'Cleanup failed'
        });
      }
    } catch (err) {
      setResult({
        type: 'error',
        message: err.message
      });
    } finally {
      setCleaningUp(false);
    }
  };

  return (
    <div className="news-settings-revamped">
      <h3>News & Events Collection</h3>
      <p className="settings-description">
        News and events are collected automatically each day at 6 AM Eastern time using AI-powered web search.
        You can also trigger collection manually below.
      </p>

      {/* Live Progress - Purple gradient styling */}
      {liveProgress && (
        <div className="collection-progress-card">
          <div className="progress-card-header">
            <div className="progress-phase">
              <span className={`phase-icon ${liveProgress.status !== 'completed' && liveProgress.status !== 'cancelled' ? 'pulse' : ''}`}>
                {liveProgress.status === 'completed' ? '✓' :
                 liveProgress.status === 'cancelled' ? '✗' : '🔍'}
              </span>
              <span className="phase-label">
                {liveProgress.status === 'completed' ? 'Complete' :
                 liveProgress.status === 'cancelled' ? 'Cancelled' : 'Collecting News & Events'}
              </span>
            </div>
            <div className="progress-header-actions">
              {collecting && liveProgress.status !== 'completed' && liveProgress.status !== 'cancelled' && (
                <button className="status-cancel-btn" onClick={handleCancelJob} title="Cancel job">
                  Cancel
                </button>
              )}
              {(liveProgress.status === 'completed' || liveProgress.status === 'cancelled') && (
                <button className="status-close-btn" onClick={() => setLiveProgress(null)} title="Close">
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Cancelled message badge */}
          {liveProgress.cancelledMessage && (
            <div className="cancelled-badge">
              {liveProgress.cancelledMessage}
            </div>
          )}

          <div className="progress-bar-wrapper">
            <div
              className="progress-bar-fill"
              style={{
                width: liveProgress.total_pois > 0
                  ? `${(liveProgress.pois_processed / liveProgress.total_pois) * 100}%`
                  : '0%',
                background: liveProgress.status === 'completed'
                  ? 'linear-gradient(90deg, #4caf50, #8bc34a)'
                  : 'linear-gradient(90deg, #fff, rgba(255,255,255,0.7))'
              }}
            />
          </div>

          <div className="progress-counts">
            <div className="count-badge">
              <span className="count-icon">📍</span>
              <div className="count-details">
                <span className="count-value">{liveProgress.pois_processed || 0}</span>
                <span className="count-label">
                  {liveProgress.total_pois > 0 ? ` / ${liveProgress.total_pois}` : ''} POIs
                </span>
              </div>
            </div>
            <div className="count-badge">
              <span className="count-icon">📰</span>
              <div className="count-details">
                <span className="count-value">{liveProgress.news_found || 0}</span>
                <span className="count-label">News</span>
              </div>
            </div>
            <div className="count-badge">
              <span className="count-icon">📅</span>
              <div className="count-details">
                <span className="count-value">{liveProgress.events_found || 0}</span>
                <span className="count-label">Events</span>
              </div>
            </div>
          </div>

          {/* Gemini usage */}
          {aiStats?.usage?.gemini > 0 && (
            <div className="ai-stats-table">
              <div className="ai-stats-row gemini active">
                <span className="ai-col-provider">Gemini</span>
                <span className="ai-col-requests">{aiStats.usage.gemini} requests</span>
              </div>
            </div>
          )}

          <p className="progress-hint-text">
            Processing {liveProgress.total_pois > 0 ? liveProgress.total_pois : 'all'} POIs in parallel (1 new job/second)...
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="news-actions-section">
        <h4>Actions</h4>

        <div className="action-card">
          <div className="action-info">
            <strong>Collect News & Events</strong>
            <p>Search for recent news and upcoming events for all POIs using AI-powered web search.</p>
          </div>
          <button
            className="action-btn primary"
            onClick={handleCollectNews}
            disabled={collecting || cleaningUp}
          >
            {collecting ? 'Collecting...' : 'Start Collection'}
          </button>
        </div>

        <div className="action-card">
          <div className="action-info">
            <strong>Cleanup Old Data</strong>
            <p>Remove news older than 90 days and events that have already passed (more than 30 days ago).</p>
          </div>
          <button
            className="action-btn secondary"
            onClick={handleCleanup}
            disabled={collecting || cleaningUp}
          >
            {cleaningUp ? 'Cleaning...' : 'Run Cleanup'}
          </button>
        </div>
      </div>

      {/* Result message */}
      {result && (
        <div className={`news-result ${result.type}`}>
          {result.message}
        </div>
      )}

      {/* Last Job Status */}
      <div className="news-status-section">
        <h4>Last Collection Job</h4>
        {loading ? (
          <p>Loading status...</p>
        ) : jobStatus ? (
          <div className="job-status-card">
            <div className="status-row">
              <span className="status-label">Status:</span>
              <span className={`status-value status-${jobStatus.status}`}>
                {jobStatus.status}
              </span>
            </div>
            <div className="status-row">
              <span className="status-label">Type:</span>
              <span className="status-value">{jobStatus.job_type || 'manual'}</span>
            </div>
            <div className="status-row">
              <span className="status-label">Started:</span>
              <span className="status-value">{formatDateTime(jobStatus.started_at)}</span>
            </div>
            {jobStatus.completed_at && (
              <div className="status-row">
                <span className="status-label">Completed:</span>
                <span className="status-value">{formatDateTime(jobStatus.completed_at)}</span>
              </div>
            )}
            <div className="status-row">
              <span className="status-label">POIs Processed:</span>
              <span className="status-value">
                {jobStatus.pois_processed || 0}
                {jobStatus.total_pois > 0 && ` / ${jobStatus.total_pois}`}
              </span>
            </div>
            <div className="status-row">
              <span className="status-label">News Found:</span>
              <span className="status-value">{jobStatus.news_found || 0}</span>
            </div>
            <div className="status-row">
              <span className="status-label">Events Found:</span>
              <span className="status-value">{jobStatus.events_found || 0}</span>
            </div>
            {jobStatus.error_message && (
              <div className="status-row error">
                <span className="status-label">Error:</span>
                <span className="status-value">{jobStatus.error_message}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="no-status">No collection jobs have run yet.</p>
        )}
      </div>

      {/* Schedule Info */}
      <div className="news-schedule-section">
        <h4>Automatic Schedule</h4>
        <p>
          News collection runs automatically every day at <strong>6:00 AM Eastern Time</strong>.
          Jobs are dispatched in parallel (1 new POI per second) for faster processing.
        </p>
      </div>
    </div>
  );
}

export default NewsSettings;
