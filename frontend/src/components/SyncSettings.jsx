import React, { useState, useEffect, useCallback } from 'react';

function SyncSettings({ onDataRefresh }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [wiping, setWiping] = useState(false);

  // Editable Drive ID states
  const [driveIdEdits, setDriveIdEdits] = useState({
    icons: '',
    images: '',
    geospatial: ''
  });
  const [savingDriveId, setSavingDriveId] = useState(null);

  // Fetch sync status
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/sync/status', {
        credentials: 'include'
      });
      if (response.ok) {
        const status = await response.json();
        setSyncStatus(status);
        setError(null);
      } else if (response.status === 401 || response.status === 403) {
        setError('Please log in as admin to view sync status');
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to fetch sync status');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    const handleFocus = () => fetchStatus();
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchStatus]);

  // Initialize editable Drive IDs when syncStatus loads
  useEffect(() => {
    if (syncStatus) {
      setDriveIdEdits({
        icons: syncStatus.drive?.folders?.icons?.id || '',
        images: syncStatus.drive?.folders?.images?.id || '',
        geospatial: syncStatus.drive?.folders?.geospatial?.id || ''
      });
    }
  }, [syncStatus]);

  const handleDriveIdChange = (key, value) => {
    setDriveIdEdits(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveDriveId = async (key) => {
    const value = driveIdEdits[key];
    setSavingDriveId(key);
    setMessage(null);
    setError(null);

    try {
      const keyMap = {
        icons: 'icons_folder_id',
        images: 'images_folder_id',
        geospatial: 'geospatial_folder_id'
      };
      const response = await fetch(`/api/admin/drive/settings/${keyMap[key]}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value })
      });

      const result = await response.json();
      if (response.ok) {
        setMessage(`Updated ${key} ID`);
        fetchStatus();
      } else {
        setError(result.error || `Failed to update ${key} ID`);
      }
    } catch {
      setError(`Failed to update ${key} ID`);
    } finally {
      setSavingDriveId(null);
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await fetchStatus();
    setTimeout(() => setRefreshing(false), 800);
  };

  const handleBackup = async () => {
    setBackingUp(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch('/api/admin/backup/trigger', {
        method: 'POST',
        credentials: 'include'
      });

      const result = await response.json();
      if (response.ok) {
        setMessage(`Backup created: ${result.filename}`);
        fetchStatus();
      } else {
        setError(result.error || 'Backup failed');
      }
    } catch {
      setError('Failed to create backup');
    } finally {
      setBackingUp(false);
    }
  };

  const handleWipeDatabase = async () => {
    const firstConfirm = confirm(
      'WARNING: This will permanently delete ALL destinations from the local database.\n\n' +
      'This action cannot be undone!\n\n' +
      'Are you sure you want to continue?'
    );
    if (!firstConfirm) return;

    const secondConfirm = confirm(
      'FINAL WARNING: You are about to delete all local data.\n\n' +
      'Click OK to confirm you want to wipe the database.'
    );
    if (!secondConfirm) return;

    setWiping(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch('/api/admin/sync/wipe-database', {
        method: 'DELETE',
        credentials: 'include'
      });

      const result = await response.json();
      if (response.ok) {
        setMessage(result.message);
        fetchStatus();
        if (onDataRefresh) {
          await onDataRefresh();
        }
      } else {
        setError(result.error || 'Failed to wipe database');
      }
    } catch {
      setError('Failed to wipe database');
    } finally {
      setWiping(false);
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  if (loading) {
    return (
      <div className="sync-settings">
        <h3>Google Drive Integration</h3>
        <p>Loading status...</p>
      </div>
    );
  }

  return (
    <div className="sync-settings">
      <h3>Google Drive Integration</h3>
      <p className="sync-description">
        Drive folders store icons, images, geospatial data, and database backups.
      </p>

      {error && <div className="sync-error">{error}</div>}
      {message && <div className="sync-success">{message}</div>}

      {/* Backup Tile */}
      {syncStatus?.drive_access_verified && (
        <div className="sync-unified-tile">
          <div className="sync-tile-header">
            <h4>Database Backup</h4>
            <button
              className={`refresh-btn${refreshing ? ' spinning' : ''}`}
              onClick={handleManualRefresh}
              disabled={loading || refreshing}
              title="Refresh status"
            >
              &#8635;
            </button>
          </div>

          <div className="sync-status-row">
            <div className="sync-status-item">
              <label>Last Backup</label>
              <span>{formatDate(syncStatus.last_backup)}</span>
            </div>
          </div>

          <div className="sync-buttons-grid">
            <div className="sync-button-card">
              <button
                className="sync-btn sync-now-btn"
                onClick={handleBackup}
                disabled={backingUp}
              >
                {backingUp ? 'Backing up...' : 'Backup Now'}
              </button>
              <p className="button-description">Run pg_dump and upload to Drive Backups folder</p>
            </div>
          </div>
        </div>
      )}

      {/* Google Drive Storage */}
      {syncStatus?.drive?.configured && (
        <div className="sync-drive-info">
          <h4>Google Drive Storage</h4>
          <p className="drive-info-description">
            Edit Drive IDs to connect to existing folders.
          </p>

          {syncStatus.drive.folders.root && (
            <div className="drive-root-header">
              <a
                href={syncStatus.drive.folders.root.url}
                target="_blank"
                rel="noopener noreferrer"
                className="folder-link root-link"
              >
                <span className="folder-icon">&#128193;</span>
                <span className="folder-name">{syncStatus.drive.folders.root.name}</span>
              </a>
            </div>
          )}

          <div className="drive-id-list">
            {/* Icons folder */}
            <div className="drive-id-row">
              <div className="drive-id-label">
                <span className="folder-icon">&#127912;</span>
                <span>Icons</span>
                {syncStatus.drive.folders.icons?.file_count !== undefined && (
                  <span className="file-count">({syncStatus.drive.folders.icons.file_count})</span>
                )}
              </div>
              <input
                type="text"
                className="drive-id-input"
                value={driveIdEdits.icons}
                onChange={(e) => handleDriveIdChange('icons', e.target.value)}
                placeholder="Enter folder ID"
              />
              <button
                className="drive-id-save-btn"
                onClick={() => handleSaveDriveId('icons')}
                disabled={savingDriveId === 'icons' || driveIdEdits.icons === (syncStatus.drive.folders.icons?.id || '')}
              >
                {savingDriveId === 'icons' ? '...' : 'Save'}
              </button>
              {syncStatus.drive.folders.icons?.url ? (
                <a href={syncStatus.drive.folders.icons.url} target="_blank" rel="noopener noreferrer" className="drive-id-link" title="Open folder in Drive">&#8599;</a>
              ) : <span className="drive-id-link-placeholder" />}
            </div>

            {/* Images folder */}
            <div className="drive-id-row">
              <div className="drive-id-label">
                <span className="folder-icon">&#128444;&#65039;</span>
                <span>Images</span>
                {syncStatus.drive.folders.images?.file_count !== undefined && (
                  <span className="file-count">({syncStatus.drive.folders.images.file_count})</span>
                )}
              </div>
              <input
                type="text"
                className="drive-id-input"
                value={driveIdEdits.images}
                onChange={(e) => handleDriveIdChange('images', e.target.value)}
                placeholder="Enter folder ID"
              />
              <button
                className="drive-id-save-btn"
                onClick={() => handleSaveDriveId('images')}
                disabled={savingDriveId === 'images' || driveIdEdits.images === (syncStatus.drive.folders.images?.id || '')}
              >
                {savingDriveId === 'images' ? '...' : 'Save'}
              </button>
              {syncStatus.drive.folders.images?.url ? (
                <a href={syncStatus.drive.folders.images.url} target="_blank" rel="noopener noreferrer" className="drive-id-link" title="Open folder in Drive">&#8599;</a>
              ) : <span className="drive-id-link-placeholder" />}
            </div>

            {/* Geospatial folder */}
            <div className="drive-id-row">
              <div className="drive-id-label">
                <span className="folder-icon">&#128506;&#65039;</span>
                <span>Geospatial</span>
                {syncStatus.drive.folders.geospatial?.file_count !== undefined && (
                  <span className="file-count">({syncStatus.drive.folders.geospatial.file_count})</span>
                )}
              </div>
              <input
                type="text"
                className="drive-id-input"
                value={driveIdEdits.geospatial}
                onChange={(e) => handleDriveIdChange('geospatial', e.target.value)}
                placeholder="Enter folder ID"
              />
              <button
                className="drive-id-save-btn"
                onClick={() => handleSaveDriveId('geospatial')}
                disabled={savingDriveId === 'geospatial' || driveIdEdits.geospatial === (syncStatus.drive.folders.geospatial?.id || '')}
              >
                {savingDriveId === 'geospatial' ? '...' : 'Save'}
              </button>
              {syncStatus.drive.folders.geospatial?.url ? (
                <a href={syncStatus.drive.folders.geospatial.url} target="_blank" rel="noopener noreferrer" className="drive-id-link" title="Open folder in Drive">&#8599;</a>
              ) : <span className="drive-id-link-placeholder" />}
            </div>

            {/* Backups folder (read-only display) */}
            {syncStatus.drive.folders.backups && (
              <div className="drive-id-row">
                <div className="drive-id-label">
                  <span className="folder-icon">&#128190;</span>
                  <span>Backups</span>
                </div>
                <input
                  type="text"
                  className="drive-id-input"
                  value={syncStatus.drive.folders.backups.id}
                  disabled
                />
                <button className="drive-id-save-btn" disabled>-</button>
                <a href={syncStatus.drive.folders.backups.url} target="_blank" rel="noopener noreferrer" className="drive-id-link" title="Open folder in Drive">&#8599;</a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Danger Zone */}
      <div className="danger-zone">
        <h4>Danger Zone</h4>
        <p className="danger-warning">
          Destructive actions that cannot be undone.
        </p>
        <button
          className="sync-btn danger-btn"
          onClick={handleWipeDatabase}
          disabled={wiping}
        >
          {wiping ? 'Wiping...' : 'Wipe Local Database'}
        </button>
        <p className="danger-hint">
          Creates a backup before wiping if Drive is connected.
        </p>
      </div>
    </div>
  );
}

export default SyncSettings;
