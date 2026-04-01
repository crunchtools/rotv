import React, { useState, useEffect, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const JOB_TYPE_LABELS = {
  news: 'News',
  trail_status: 'Trail Status',
  moderation: 'Moderation',
  newsletter: 'Newsletter',
  backup: 'Backup',
  news_single: 'News (Single)',
  events_single: 'Events (Single)'
};

const JOB_TYPE_ICONS = {
  news: '\u{1F4F0}',
  trail_status: '\u{1F6B5}',
  moderation: '\u{1F50D}',
  newsletter: '\u{1F4E7}',
  backup: '\u{1F4BE}',
  news_single: '\u{1F4F0}',
  events_single: '\u{1F4C5}'
};

const STATUS_COLORS = {
  completed: '#4caf50',
  running: '#2196f3',
  failed: '#f44336',
  cancelled: '#ff9800',
  queued: '#9e9e9e',
  pending: '#9e9e9e'
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

export default function JobsDashboard() {
  const [queues, setQueues] = useState([]);
  const [history, setHistory] = useState([]);
  const [expandedJob, setExpandedJob] = useState(null);
  const [jobLogs, setJobLogs] = useState([]);
  const [logLevelFilter, setLogLevelFilter] = useState('all');
  const [logDetailsExpanded, setLogDetailsExpanded] = useState(new Set());
  const [historyFilter, setHistoryFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchQueues = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/jobs/queues`, { credentials: 'include' });
      if (res.ok) setQueues(await res.json());
    } catch (err) {
      console.error('Failed to fetch queues:', err);
    }
  }, []);

  const fetchHistory = useCallback(async (offset = 0, append = false) => {
    try {
      const params = new URLSearchParams({ limit: '20', offset: String(offset) });
      if (historyFilter) params.set('type', historyFilter);
      const res = await fetch(`${API_BASE}/api/admin/jobs/history?${params}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (append) {
          setHistory(prev => [...prev, ...data]);
        } else {
          setHistory(data);
        }
        setHasMore(data.length === 20);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  }, [historyFilter]);

  const fetchJobLogs = useCallback(async (jobType, jobId) => {
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (logLevelFilter !== 'all') params.set('level', logLevelFilter);
      const res = await fetch(`${API_BASE}/api/admin/jobs/${jobType}/${jobId}/logs?${params}`, { credentials: 'include' });
      if (res.ok) setJobLogs(await res.json());
    } catch (err) {
      console.error('Failed to fetch job logs:', err);
    }
  }, [logLevelFilter]);

  // Initial load
  useEffect(() => {
    Promise.all([fetchQueues(), fetchHistory()]).then(() => setLoading(false));
  }, [fetchQueues, fetchHistory]);

  // Auto-refresh queues
  useEffect(() => {
    const interval = setInterval(fetchQueues, 10000);
    return () => clearInterval(interval);
  }, [fetchQueues]);

  // Reload history when filter changes
  useEffect(() => {
    setHistoryOffset(0);
    fetchHistory(0);
  }, [historyFilter, fetchHistory]);

  // Reload logs when filter or expanded job changes
  useEffect(() => {
    if (expandedJob) {
      fetchJobLogs(expandedJob.job_type, expandedJob.id);
    }
  }, [expandedJob, logLevelFilter, fetchJobLogs]);

  const handleExpandJob = (job) => {
    if (expandedJob?.id === job.id && expandedJob?.job_type === job.job_type) {
      setExpandedJob(null);
      setJobLogs([]);
      setLogLevelFilter('all');
    } else {
      setExpandedJob(job);
      setLogLevelFilter('all');
      setLogDetailsExpanded(new Set());
    }
  };

  const handleLoadMore = () => {
    const newOffset = historyOffset + 20;
    setHistoryOffset(newOffset);
    fetchHistory(newOffset, true);
  };

  const toggleLogDetails = (logId) => {
    setLogDetailsExpanded(prev => {
      const next = new Set(prev);
      if (next.has(logId)) next.delete(logId);
      else next.add(logId);
      return next;
    });
  };

  if (loading) {
    return <div className="jobs-dashboard"><p>Loading job data...</p></div>;
  }

  return (
    <div className="jobs-dashboard">
      {/* Queue Status */}
      <h3>Queue Status</h3>
      <div className="queue-status-grid">
        {queues.map(q => (
          <div key={q.name} className="queue-card">
            <div className="queue-card-label">{q.label}</div>
            <div className="queue-card-count">
              {q.size > 0 ? (
                <span className="queue-badge queue-badge-active">{q.size} queued</span>
              ) : (
                <span className="queue-badge queue-badge-idle">idle</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Job History */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '24px' }}>
        <h3 style={{ margin: 0 }}>Job History</h3>
        <select
          value={historyFilter}
          onChange={(e) => setHistoryFilter(e.target.value)}
          className="job-filter-select"
        >
          <option value="">All Types</option>
          <option value="news">News</option>
          <option value="trail_status">Trail Status</option>
          <option value="moderation">Moderation</option>
          <option value="newsletter">Newsletter</option>
          <option value="backup">Backup</option>
        </select>
      </div>

      {history.length === 0 ? (
        <p style={{ color: '#999', padding: '16px 0' }}>No jobs found.</p>
      ) : (
        <table className="job-history-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Status</th>
              <th>Items</th>
              <th>Started</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {history.map(job => (
              <React.Fragment key={`${job.job_type}-${job.id}`}>
                <tr
                  className={`job-row expandable ${expandedJob?.id === job.id && expandedJob?.job_type === job.job_type ? 'expanded' : ''}`}
                  onClick={() => handleExpandJob(job)}
                >
                  <td>
                    <span className="job-type-icon">{JOB_TYPE_ICONS[job.job_type] || '\u{2699}'}</span>
                    {JOB_TYPE_LABELS[job.job_type] || job.job_type}
                  </td>
                  <td>
                    <span
                      className="status-badge"
                      style={{ backgroundColor: STATUS_COLORS[job.status] || '#9e9e9e' }}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td>
                    {job.items_processed != null ? `${job.items_processed}/${job.items_total}` : '--'}
                  </td>
                  <td>{formatTime(job.started_at || job.created_at)}</td>
                  <td>{formatDuration(job.started_at, job.completed_at)}</td>
                </tr>

                {expandedJob?.id === job.id && expandedJob?.job_type === job.job_type && (
                  <tr className="job-logs-row">
                    <td colSpan={5}>
                      <div className="job-logs-panel">
                        <div className="log-level-filters">
                          {['all', 'error', 'warn'].map(level => (
                            <button
                              key={level}
                              className={`log-filter-btn ${logLevelFilter === level ? 'active' : ''}`}
                              onClick={(e) => { e.stopPropagation(); setLogLevelFilter(level); }}
                            >
                              {level === 'all' ? 'All' : level === 'error' ? 'Errors' : 'Warnings'}
                            </button>
                          ))}
                        </div>

                        {job.error_message && (
                          <div className="job-error-banner">
                            {job.error_message}
                          </div>
                        )}

                        {jobLogs.length === 0 ? (
                          <p style={{ color: '#999', padding: '8px 0', margin: 0 }}>
                            No log entries{logLevelFilter !== 'all' ? ` with level "${logLevelFilter}"` : ''}.
                          </p>
                        ) : (
                          <div className="job-logs-scroll">
                            {jobLogs.map(entry => (
                              <div
                                key={entry.id}
                                className={`job-log-entry ${entry.level}`}
                                onClick={(e) => { e.stopPropagation(); if (entry.details) toggleLogDetails(entry.id); }}
                                style={{ cursor: entry.details ? 'pointer' : 'default' }}
                              >
                                <span className={`log-level-dot ${entry.level}`}></span>
                                <span className="log-poi">{entry.poi_name || '--'}</span>
                                <span className="log-message">{entry.message}</span>
                                <span className="log-time">{formatTime(entry.created_at)}</span>
                                {logDetailsExpanded.has(entry.id) && entry.details && (
                                  <pre className="log-details">{JSON.stringify(entry.details, null, 2)}</pre>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}

      {hasMore && history.length > 0 && (
        <button className="load-more-btn" onClick={handleLoadMore}>
          Load More
        </button>
      )}
    </div>
  );
}
