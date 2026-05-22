import { useState, useEffect } from 'react';
import { formatDateTime } from '../NewsEventsShared';

function TrailStatus({ poiId, _poiName, isAdmin, editMode, _selectedFromMtbList, _onBackToMtbList }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);

  const fetchStatus = async () => {
    if (!poiId) {
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/pois/${poiId}/status`);
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      } else {
        console.error(`[fetchStatus] Request failed: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error('[fetchStatus] Error fetching trail status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiId]); // fetchStatus intentionally excluded to avoid re-fetching on function reference changes

  const handleCollect = async () => {
    if (!poiId) return;
    setCollecting(true);

    try {
      const response = await fetch(`/api/admin/pois/${poiId}/status/collect`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        await response.json(); // Result not used

        await fetchStatus();
      } else {
        const error = await response.json();
        alert('Collection failed: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('[handleCollect] Error:', err);
      alert('Collection error: ' + err.message);
    } finally {
      setCollecting(false);
    }
  };

  if (loading) {
    return <div className="sidebar-tab-loading">Loading trail status...</div>;
  }

  const statusBadgeClass = status?.status ? `status-${status.status}` : 'status-unknown';

  return (
    <div className="trail-status-tab">
      {isAdmin && editMode && (
        <button
          className="admin-button"
          onClick={handleCollect}
          disabled={collecting}
          style={{ marginBottom: '1rem' }}
        >
          {collecting ? 'Collecting...' : 'Collect Status'}
        </button>
      )}

      {status && status.status !== 'unknown' ? (
        <div className={`trail-status ${statusBadgeClass}`}>
          <div className="status-badges-row">
            <div className="status-badge">{(status.status || 'unknown').toUpperCase()}</div>
            {status.source_url && (
              <a
                href={status.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="source-badge"
              >
                SOURCE
              </a>
            )}
          </div>

          {status.conditions && (
            <div className="status-conditions">
              <strong>Conditions:</strong> {status.conditions}
            </div>
          )}

          {status.weather_impact && (
            <div className="status-weather">
              <strong>Weather:</strong> {status.weather_impact}
            </div>
          )}

          {status.last_updated && (
            <div className="status-updated">
              Last updated: {formatDateTime(status.last_updated)}
            </div>
          )}

          {status.seasonal_closure && (
            <div className="status-seasonal">
              ⚠️ Seasonal Closure in Effect
            </div>
          )}
        </div>
      ) : (
        <div className="sidebar-tab-empty">
          No trail status information available.
          {isAdmin && editMode && (
            <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>
              Use the &quot;Collect Status&quot; button above to gather current trail conditions.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default TrailStatus;
