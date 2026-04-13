import React, { useState, useEffect } from 'react';

const PHASE_CONFIG = {
  initializing: {
    icon: '🔍',
    label: 'Initializing',
    color: '#2196F3',
    progress: 5
  },
  rendering_events: {
    icon: '🌐',
    label: 'JavaScript-heavy Events Page',
    color: '#9C27B0',
    progress: 20
  },
  rendering_news: {
    icon: '🌐',
    label: 'JavaScript-heavy News Page',
    color: '#9C27B0',
    progress: 20
  },
  ai_search: {
    icon: '🤖',
    label: 'AI Search',
    color: '#FF9800',
    progress: 50
  },
  processing_results: {
    icon: '📊',
    label: 'Processing Results',
    color: '#4CAF50',
    progress: 70
  },
  matching_links: {
    icon: '🔗',
    label: 'Matching Deep Links',
    color: '#00BCD4',
    progress: 80
  },
  google_news: {
    icon: '📰',
    label: 'Google News Search',
    color: '#FF5722',
    progress: 90
  },
  complete: {
    icon: '✓',
    label: 'Complete',
    color: '#4CAF50',
    progress: 100
  },
  error: {
    icon: '✗',
    label: 'Error',
    color: '#F44336',
    progress: 0
  }
};

function CollectionStatus({ poiId, isCollecting, onComplete, onClose, onCancel, _type }) {
  const [progress, setProgress] = useState(null);
  const [finalStats, setFinalStats] = useState(null);
  const startTimeRef = React.useRef(Date.now());
  const [frozenElapsedTime, setFrozenElapsedTime] = React.useState(null);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  // Calculate elapsed time on each render (unless frozen)
  const elapsed = frozenElapsedTime !== null ? frozenElapsedTime : (Date.now() - startTimeRef.current);

  useEffect(() => {
    if (!poiId) {
      return;
    }

    // Don't reset timer here - it's set once on component mount via the ref initialization
    // Component gets a fresh instance (with fresh timer) when key changes

    const fetchProgress = async () => {
      try {
        const response = await fetch(`/api/admin/pois/${poiId}/collection-progress`, {
          credentials: 'include'
        });

        if (response.ok) {
          const data = await response.json();

          // Only update if we have meaningful progress
          if (data.phase !== 'idle') {
            // Sync our start time with backend's start time on first fetch
            if (data.startTime && startTimeRef.current > data.startTime) {
              startTimeRef.current = data.startTime;
            }

            setProgress(data);

            // If completed, stop polling but keep showing status
            if (data.completed && onComplete) {
              onComplete(data);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching progress:', err);
      }
    };

    // Poll for progress updates only when collecting
    let progressInterval;
    let finalFetchTimeout;

    if (isCollecting) {
      progressInterval = setInterval(fetchProgress, 500);
      fetchProgress(); // Initial fetch
    } else if (progress?.completed) {
      // When collection just completed, fetch one final time to ensure we have complete data
      finalFetchTimeout = setTimeout(fetchProgress, 500);
    }

    // Always update timer display
    const timerInterval = setInterval(() => {
      forceUpdate();
    }, 100);

    return () => {
      if (progressInterval) clearInterval(progressInterval);
      if (finalFetchTimeout) clearTimeout(finalFetchTimeout);
      clearInterval(timerInterval);
    };
  }, [isCollecting, poiId, onComplete, progress?.completed]);

  // Accept external final stats from API response
  useEffect(() => {
    // Capture progress when it completes (even if still collecting)
    if (progress?.completed && !finalStats) {
      const completionTime = Date.now() - startTimeRef.current;
      setFinalStats(progress);
      setFrozenElapsedTime(completionTime); // Freeze the timer at completion
    }
  }, [progress, finalStats]);

  // Show if currently collecting OR if we have completed progress to display
  // Prioritize finalStats over progress to keep completed state visible
  const displayProgress = finalStats || progress;

  // Don't hide if we have finalStats, even if current progress is 'idle'
  if (!displayProgress || (displayProgress.phase === 'idle' && !finalStats)) {
    return null;
  }

  // Hide old completed progress when a new collection is starting
  // (isCollecting=true means user just clicked refresh, but we might have fetched old completed progress)
  if (isCollecting && displayProgress.completed && !finalStats) {
    return null;
  }


  const phaseConfig = PHASE_CONFIG[displayProgress.phase] || PHASE_CONFIG.initializing;
  const elapsedSeconds = (elapsed / 1000).toFixed(1);
  const isComplete = displayProgress.completed;

  // Determine which phases to show based on collection type (excluding initializing)
  const collectionType = displayProgress.collectionType || 'both';
  let allPhases = [];

  if (collectionType === 'news') {
    allPhases = ['rendering_news', 'ai_search', 'matching_links', 'google_news'];
  } else if (collectionType === 'events') {
    allPhases = ['rendering_events', 'ai_search', 'matching_links'];
  } else {
    allPhases = ['rendering_events', 'rendering_news', 'ai_search', 'matching_links', 'google_news'];
  }

  // Get completed phases from backend
  const completedPhasesList = displayProgress.phaseHistory || [];
  const currentPhase = displayProgress.phase;

  return (
    <div className="collection-status">
      <div className="status-header">
        <div className="status-phase">
          <span className={`phase-icon ${!isComplete ? 'pulse' : ''}`}>{phaseConfig.icon}</span>
          <span className="phase-label">{phaseConfig.label}</span>
        </div>
        <div className="status-header-right">
          <div className="status-timer">{elapsedSeconds}s</div>
          {onCancel && !isComplete && (
            <button className="status-cancel-btn" onClick={onCancel} title="Cancel job">Cancel</button>
          )}
          {onClose && isComplete && (
            <button className="status-close-btn" onClick={onClose} title="Close status">×</button>
          )}
        </div>
      </div>

      {!isComplete && (
        <div className="status-message">{displayProgress.message}</div>
      )}

      {/* Gemini usage */}
      {displayProgress.aiStats?.usage?.gemini > 0 && (
        <div className="ai-stats-table">
          <div className="ai-stats-row gemini active">
            <span className="ai-col-provider">Gemini</span>
            <span className="ai-col-requests">{displayProgress.aiStats.usage.gemini} requests</span>
          </div>
        </div>
      )}

      {displayProgress.phase !== 'error' && (
        <div className="status-progress-bar">
          <div
            className="status-progress-fill"
            style={{
              backgroundColor: phaseConfig.color,
              width: `${phaseConfig.progress || 5}%`
            }}
          />
        </div>
      )}

      <div className="status-phases">
        {allPhases.map((phase) => {
          const config = PHASE_CONFIG[phase];
          if (!config) return null;

          const isCompleted = completedPhasesList.includes(phase);
          const isCurrent = phase === currentPhase;

          return (
            <div key={phase} className={`phase-badge ${isCompleted ? 'completed' : isCurrent ? 'current' : 'pending'}`}>
              <span className="phase-badge-icon">{config.icon}</span>
              <span className="phase-badge-label">{config.label}</span>
              {isCompleted && <span className="phase-badge-check">✓</span>}
              {isCurrent && !isCompleted && <span className="phase-badge-spinner">⏳</span>}
            </div>
          );
        })}
      </div>

      {isComplete && (displayProgress.newsSaved !== undefined || displayProgress.eventsSaved !== undefined) && (
        <div className="status-summary-badges">
          <div className="summary-badge found">
            <span className="summary-badge-label">Found</span>
            <span className="summary-badge-value">
              {displayProgress.newsFound || displayProgress.eventsFound || 0}
            </span>
          </div>
          <div className="summary-badge saved">
            <span className="summary-badge-label">Saved</span>
            <span className="summary-badge-value">
              {displayProgress.newsSaved || displayProgress.eventsSaved || 0}
            </span>
          </div>
          <div className="summary-badge skipped">
            <span className="summary-badge-label">Skipped</span>
            <span className="summary-badge-value">
              {displayProgress.newsDuplicate || displayProgress.eventsDuplicate || 0}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default CollectionStatus;
