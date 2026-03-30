import React, { useState, useEffect, useCallback } from 'react';

function SyncSettings({ onDataRefresh }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [backupsList, setBackupsList] = useState(null);
  const [showRestoreList, setShowRestoreList] = useState(false);

  // Editable Drive ID states
  const [driveIdEdits, setDriveIdEdits] = useState({
    icons: '',
    images: '',
    geospatial: '',
    database: ''
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
        geospatial: syncStatus.drive?.folders?.geospatial?.id || '',
        database: syncStatus.drive?.folders?.database?.id || ''
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
        geospatial: 'geospatial_folder_id',
        database: 'backups_folder_id'
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

  const handleShowRestore = async () => {
    if (showRestoreList) {
      setShowRestoreList(false);
      return;
    }

    setMessage(null);
    setError(null);

    try {
      const response = await fetch('/api/admin/backup/list', {
        credentials: 'include'
      });
      if (response.ok) {
        const backups = await response.json();
        setBackupsList(backups);
        setShowRestoreList(true);
      } else {
        setError('Failed to list backups');
      }
    } catch {
      setError('Failed to list backups');
    }
  };

  const handleRestore = async (fileId, filename) => {
    if (!confirm(`Restore database from "${filename}"?\n\nThis will overwrite current data.`)) {
      return;
    }

    setRestoring(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch('/api/admin/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fileId })
      });

      const result = await response.json();
      if (response.ok) {
        setMessage('Database restored successfully');
        setShowRestoreList(false);
        if (onDataRefresh) await onDataRefresh();
      } else {
        setError(result.error || 'Restore failed');
      }
    } catch {
      setError('Failed to restore database');
    } finally {
      setRestoring(false);
    }
  };

  const handleWipeDatabase = async () => {
    if (!confirm('WARNING: This will permanently delete ALL POIs from the local database.\n\nThis action cannot be undone!')) return;
    if (!confirm('FINAL WARNING: Click OK to confirm you want to wipe the database.')) return;

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
        if (onDataRefresh) await onDataRefresh();
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
    return new Date(isoString).toLocaleString();
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    const mb = parseInt(bytes) / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(parseInt(bytes) / 1024).toFixed(0)} KB`;
  };

  if (loading) {
    return (
      <div className="sync-settings">
        <h3>Google Drive</h3>
        <p>Loading status...</p>
      </div>
    );
  }

  const driveIdRow = (key, label, icon, folderData) => (
    <div className="drive-id-row">
      <div className="drive-id-label">
        <span className="folder-icon">{icon}</span>
        <span>{label}</span>
        {folderData?.file_count !== undefined && (
          <span className="file-count">({folderData.file_count})</span>
        )}
      </div>
      <input
        type="text"
        className="drive-id-input"
        value={driveIdEdits[key]}
        onChange={(e) => handleDriveIdChange(key, e.target.value)}
        placeholder="Enter folder ID"
      />
      <button
        className="drive-id-save-btn"
        onClick={() => handleSaveDriveId(key)}
        disabled={savingDriveId === key || driveIdEdits[key] === (folderData?.id || '')}
      >
        {savingDriveId === key ? '...' : 'Save'}
      </button>
      {folderData?.url ? (
        <a href={folderData.url} target="_blank" rel="noopener noreferrer" className="drive-id-link" title="Open folder in Drive">&#8599;</a>
      ) : <span className="drive-id-link-placeholder" />}
    </div>
  );

  return (
    <div className="sync-settings">
      <h3>Google Drive</h3>

      {error && <div className="sync-error">{error}</div>}
      {message && <div className="sync-success">{message}</div>}

      {/* Google Drive — folders + backup/restore */}
      {syncStatus?.drive?.configured && (
        <div className="sync-drive-info">
          <div className="sync-tile-header">
            <h4>Folders</h4>
            <button
              className={`refresh-btn${refreshing ? ' spinning' : ''}`}
              onClick={handleManualRefresh}
              disabled={loading || refreshing}
              title="Refresh status"
            >
              &#8635;
            </button>
          </div>
          <p className="drive-info-description">
            Edit folder IDs to connect to existing Drive folders.
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
            {driveIdRow('icons', 'Icons', '\u{1F3A8}', syncStatus.drive.folders.icons)}
            {driveIdRow('images', 'Images', '\u{1F5BC}\uFE0F', syncStatus.drive.folders.images)}
            {driveIdRow('geospatial', 'Geospatial', '\u{1F5FA}\uFE0F', syncStatus.drive.folders.geospatial)}
            {driveIdRow('database', 'Database', '\u{1F4BE}', syncStatus.drive.folders.database)}
          </div>

          {/* Backup & Restore controls */}
          {syncStatus.drive_access_verified && (
            <div className="backup-controls">
              <div className="sync-status-row">
                <div className="sync-status-item">
                  <label>Last Backup</label>
                  <span>{formatDate(syncStatus.last_backup)}</span>
                </div>
              </div>

              <div className="sync-buttons-grid">
                <div className="sync-button-card">
                  <button
                    className="sync-btn push-btn"
                    onClick={handleBackup}
                    disabled={backingUp || restoring}
                  >
                    {backingUp ? 'Backing up...' : 'Backup'}
                  </button>
                  <p className="button-description">pg_dump to Database folder</p>
                </div>
                <div className="sync-button-card">
                  <button
                    className="sync-btn pull-btn"
                    onClick={handleShowRestore}
                    disabled={restoring || backingUp}
                  >
                    {restoring ? 'Restoring...' : 'Restore'}
                  </button>
                  <p className="button-description">Restore from a backup file</p>
                </div>
              </div>

              {showRestoreList && backupsList && (
                <div className="restore-list">
                  {backupsList.length === 0 ? (
                    <p className="restore-empty">No backups found in Database folder.</p>
                  ) : (
                    backupsList.map(backup => (
                      <div key={backup.id} className="restore-item">
                        <span className="restore-name">{backup.name}</span>
                        <span className="restore-size">{formatSize(backup.size)}</span>
                        <span className="restore-date">{formatDate(backup.createdTime)}</span>
                        <button
                          className="sync-btn-small"
                          onClick={() => handleRestore(backup.id, backup.name)}
                          disabled={restoring}
                        >
                          Restore
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
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
      </div>
    </div>
  );
}

export default SyncSettings;
