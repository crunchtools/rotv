import React, { useState, useEffect } from 'react';

function TrailStatusSettings() {
  const [jobStatus, setJobStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [result, setResult] = useState(null);
  const [liveProgress, setLiveProgress] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);
  const [aiStats, setAiStats] = useState(null);

  useEffect(() => {
    fetchJobStatus();
    checkForRunningJob();
  }, []);

  // Poll for active job status and AI stats
  useEffect(() => {
    if (!activeJobId) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/admin/trail-status/job-status/${activeJobId}`, {
          credentials: 'include'
        });
        if (response.ok) {
          const status = await response.json();
          setLiveProgress(status);

          // Fetch AI stats while job is running
          try {
            const statsResponse = await fetch('/api/admin/trail-status/ai-stats', {
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
              message: `Completed! Found ${status.status_found || 0} status updates from ${status.trails_processed || 0} trails`
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
            setLiveProgress({
              ...status,
              cancelledMessage: `Job cancelled at ${status.trails_processed}/${status.total_trails} trails`
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

  const fetchJobStatus = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/trail-status/job-status/latest', {
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
      const response = await fetch('/api/admin/trail-status/job-status/latest', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        if (data && (data.status === 'running' || data.status === 'queued')) {
          setActiveJobId(data.jobId);
          setCollecting(true);
          setLiveProgress(data);
        }
      }
    } catch (err) {
      console.error('Error checking for running job:', err);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJobId) return;
    try {
      const response = await fetch(`/api/admin/trail-status/batch-collect/${activeJobId}/cancel`, {
        method: 'PUT',
        credentials: 'include'
      });

      if (response.ok) {
        setResult({
          type: 'info',
          message: 'Cancellation requested. Job will stop after current trail...'
        });
      }
    } catch (err) {
      console.error('Error cancelling job:', err);
    }
  };

  const handleCollectStatus = async () => {
    setCollecting(true);
    setResult(null);
    setLiveProgress({ status: 'starting', trails_processed: 0, status_found: 0 });

    try {
      const response = await fetch('/api/admin/trail-status/collect-batch', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      if (response.ok) {
        const data = await response.json();
        setActiveJobId(data.jobId);
        setLiveProgress({
          status: 'running',
          total_trails: data.totalTrails || 0,
          trails_processed: 0,
          status_found: 0
        });
      } else {
        const error = await response.json();
        setResult({
          type: 'error',
          message: error.error || 'Failed to start trail status collection'
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

  return (
    <div className="news-settings-revamped">
      <h3>Trail Status Collection</h3>
      <p className="settings-description">
        Trail status is collected automatically every 2 hours using AI-powered web search.
        You can also trigger collection manually below.
      </p>

      {/* Live Progress */}
      {liveProgress && (
        <div className="collection-progress-card">
          <div className="progress-card-header">
            <div className="progress-phase">
              <span className={`phase-icon ${liveProgress.status !== 'completed' && liveProgress.status !== 'cancelled' ? 'pulse' : ''}`}>
                {liveProgress.status === 'completed' ? '✓' :
                 liveProgress.status === 'cancelled' ? '✗' : '🔍'}
              </span>
              <span className="phase-label">
                {liveProgress.status === 'completed' ? 'Completed' :
                 liveProgress.status === 'cancelled' ? 'Cancelled' :
                 liveProgress.status === 'starting' ? 'Starting...' :
                 'Collecting trail status...'}
              </span>
            </div>
            {liveProgress.status === 'running' && (
              <button
                onClick={handleCancelJob}
                className="cancel-job-btn"
              >
                Cancel
              </button>
            )}
          </div>

          <div className="progress-stats-grid">
            <div className="progress-stat">
              <div className="stat-value">{liveProgress.trails_processed || 0}/{liveProgress.total_trails || 0}</div>
              <div className="stat-label">Trails Processed</div>
            </div>
            <div className="progress-stat">
              <div className="stat-value">{liveProgress.status_found || 0}</div>
              <div className="stat-label">Status Updates Found</div>
            </div>
          </div>

          {liveProgress.cancelledMessage && (
            <div className="cancellation-notice">
              {liveProgress.cancelledMessage}
            </div>
          )}

          {aiStats && (
            <div className="ai-usage-stats">
              <div className="ai-stat-label">AI Provider Usage</div>
              <div className="ai-stats-row">
                <span>Gemini: {aiStats.gemini || 0}</span>
                {aiStats.rateLimitHits > 0 && (
                  <span className="rate-limit-warning">Rate limits hit: {aiStats.rateLimitHits}</span>
                )}
              </div>
            </div>
          )}

          {liveProgress.status === 'running' && (
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                style={{
                  width: `${(liveProgress.trails_processed || 0) / (liveProgress.total_trails || 1) * 100}%`
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Result Message */}
      {result && (
        <div className={`result-message ${result.type}`}>
          {result.message}
        </div>
      )}

      {/* Collection Button */}
      <div className="collection-actions">
        <button
          onClick={handleCollectStatus}
          disabled={collecting}
          className="collect-btn"
        >
          {collecting ? 'Collecting...' : 'Collect Trail Status Now'}
        </button>
      </div>

      {/* Last Job Status */}
      {!loading && jobStatus && (
        <div className="last-job-section">
          <h4>Last Collection Job</h4>
          <div className="job-details">
            <div className="job-detail-row">
              <span className="detail-label">Status:</span>
              <span className={`detail-value status-${jobStatus.status}`}>
                {jobStatus.status}
              </span>
            </div>
            {jobStatus.started_at && (
              <div className="job-detail-row">
                <span className="detail-label">Started:</span>
                <span className="detail-value">
                  {new Date(jobStatus.started_at).toLocaleString()}
                </span>
              </div>
            )}
            {jobStatus.completed_at && (
              <div className="job-detail-row">
                <span className="detail-label">Completed:</span>
                <span className="detail-value">
                  {new Date(jobStatus.completed_at).toLocaleString()}
                </span>
              </div>
            )}
            <div className="job-detail-row">
              <span className="detail-label">Trails Processed:</span>
              <span className="detail-value">
                {jobStatus.trails_processed || 0} / {jobStatus.total_trails || 0}
              </span>
            </div>
            <div className="job-detail-row">
              <span className="detail-label">Status Found:</span>
              <span className="detail-value">
                {jobStatus.status_found || 0}
              </span>
            </div>
            {jobStatus.error_message && (
              <div className="job-detail-row">
                <span className="detail-label">Error:</span>
                <span className="detail-value error">
                  {jobStatus.error_message}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TrailStatusSettings;
