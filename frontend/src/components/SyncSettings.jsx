import React, { useState, useEffect, useCallback } from 'react';

function SyncSettings({ onDataRefresh, onNavigateToJobs }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [actionJobLinks, setActionJobLinks] = useState({}); // keyed by action: 'db_backup', 'db_restore', 'img_backup', 'img_restore'
  const [refreshing, setRefreshing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backingUpImages, setBackingUpImages] = useState(false);
  const [restoringImages, setRestoringImages] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [backupsList, setBackupsList] = useState(null);
  const [showRestoreList, setShowRestoreList] = useState(false);

  const [driveIdEdits, setDriveIdEdits] = useState({
    images: '',
    database: ''
  });
  const [savingDriveId, setSavingDriveId] = useState(null);

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

  useEffect(() => {
    if (syncStatus) {
      setDriveIdEdits({
        images: syncStatus.drive?.folders?.images?.id || '',
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
        images: 'images_folder_id',
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
        setMessage(`Updated ${key} folder ID`);
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

  /**
   * Runs one admin backup/restore request, reporting the outcome in message/error.
   *
   * @param {object} action
   * @param {(busy: boolean) => void} action.setBusy - Spinner state for the button.
   * @param {string} action.url - POST endpoint.
   * @param {RequestInit} [action.options] - Extra fetch options (headers, body).
   * @param {string} action.failureMessage - Shown when the server replies non-2xx without `error`.
   * @param {string} action.errorMessage - Shown (and logged) when the request or JSON parse throws.
   * @param {(result: object) => Promise<void>|void} action.onSuccess - Receives the parsed JSON
   *   body of a 2xx reply; sets the success message and refreshes status.
   * @returns {Promise<void>} Never rejects.
   */
  const runAction = async ({ setBusy, url, options, failureMessage, errorMessage, onSuccess }) => {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(url, { method: 'POST', credentials: 'include', ...options });
      const result = await response.json();
      if (response.ok) {
        await onSuccess(result);
      } else {
        setError(result.error || failureMessage);
      }
    } catch (err) {
      console.error(`${errorMessage}:`, err);
      setError(errorMessage);
    } finally {
      setBusy(false);
    }
  };

  const handleBackup = () => runAction({
    setBusy: setBackingUp,
    url: '/api/admin/backup/trigger',
    failureMessage: 'Database backup failed',
    errorMessage: 'Failed to create database backup',
    onSuccess: (result) => {
      setMessage(`Database backup created: ${result.filename}`);
      setActionJobLinks(prev => ({ ...prev, db_backup: 'database_backup' }));
      fetchStatus();
    }
  });

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

  const handleRestore = (fileId, filename) => {
    if (!confirm(`Restore database from "${filename}"?\n\nThis will overwrite current data.`)) {
      return;
    }

    return runAction({
      setBusy: setRestoring,
      url: '/api/admin/backup/restore',
      options: {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId })
      },
      failureMessage: 'Restore failed',
      errorMessage: 'Failed to restore database',
      onSuccess: async () => {
        setMessage('Database restored successfully');
        setActionJobLinks(prev => ({ ...prev, db_restore: 'database_backup' }));
        setShowRestoreList(false);
        if (onDataRefresh) await onDataRefresh();
      }
    });
  };

  const handleImageBackup = () => runAction({
    setBusy: setBackingUpImages,
    url: '/api/admin/backup/images/trigger',
    failureMessage: 'Image backup failed',
    errorMessage: 'Failed to backup images',
    onSuccess: (result) => {
      setMessage(`Image backup: ${result.uploaded} uploaded, ${result.skipped} already backed up`);
      setActionJobLinks(prev => ({ ...prev, img_backup: 'image_backup' }));
      fetchStatus();
    }
  });

  const handleImageRestore = () => {
    if (!confirm('Restore images from Drive?\n\nThis will download images from Drive and upload them to the image server.')) {
      return;
    }

    return runAction({
      setBusy: setRestoringImages,
      url: '/api/admin/backup/images/restore',
      failureMessage: 'Image restore failed',
      errorMessage: 'Failed to restore images',
      onSuccess: (result) => {
        setMessage(`Image restore: ${result.restored} restored, ${result.skipped} skipped`);
        fetchStatus();
      }
    });
  };

  const handleWipeDatabase = () => {
    if (!confirm('WARNING: This will permanently delete ALL POIs from the local database.\n\nThis action cannot be undone!')) return;
    if (!confirm('FINAL WARNING: Click OK to confirm you want to wipe the database.')) return;

    return runAction({
      setBusy: setWiping,
      url: '/api/admin/sync/wipe-database',
      options: { method: 'DELETE' },
      failureMessage: 'Failed to wipe database',
      errorMessage: 'Failed to wipe database',
      onSuccess: async (result) => {
        setMessage(result.message);
        fetchStatus();
        if (onDataRefresh) await onDataRefresh();
      }
    });
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

  const driveIdRow = (key, label, icon, folderData) => (
    <div className="drive-id-row">
      <div className="drive-id-label">
        <span className="folder-icon">{icon}</span>
        <span>{label}</span>
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

  const imageBackup = syncStatus?.image_backup;
  const anyBusy = backingUp || restoring || backingUpImages || restoringImages;

  return (
    <div className="sync-settings">
      <h3>Google Drive</h3>

      {error && <div className="sync-error">{error}</div>}
      {message && <div className="sync-success">{message}</div>}

      {/* Drive access prompt - shown when admin lacks Drive credentials */}
      {syncStatus && !syncStatus.drive_access_verified && (
        <div className="drive-access-prompt">
          <p>⚠️ Drive access required for backup/restore operations.</p>
          <a href="/auth/google/upgrade" className="sync-btn">Grant Drive Access</a>
        </div>
      )}

      <div className="sync-drive-info">
        <div className="sync-tile-header">
          <h4>Backup & Restore</h4>
          <button
            className={`refresh-btn${(refreshing || (loading && !syncStatus)) ? ' spinning' : ''}`}
            onClick={handleManualRefresh}
            disabled={loading || refreshing}
            title="Refresh status"
          >
            &#8635;
          </button>
        </div>

        <div className="drive-root-header">
          {syncStatus?.drive?.folders?.root ? (
            <a
              href={syncStatus.drive.folders.root.url}
              target="_blank"
              rel="noopener noreferrer"
              className="folder-link root-link"
            >
              <span className="folder-icon">&#128193;</span>
              <span className="folder-name">{syncStatus.drive.folders.root.name}</span>
            </a>
          ) : (
            <span className="folder-link root-link">
              <span className="folder-icon">&#128193;</span>
              <span className="folder-name" style={{ color: '#999' }}>...</span>
            </span>
          )}
        </div>

        {/* Database Section */}
        <div className="backup-section">
          <div className="backup-section-header">
            {driveIdRow('database', 'Database', '\u{1F4BE}', syncStatus?.drive?.folders?.database)}
          </div>

          <div className="sync-status-row">
            <div className="sync-status-item">
              <label>Last Backup</label>
              <span>
                {backingUp || restoring ? (
                  <a href="#" className="job-link-active" onClick={(e) => { e.preventDefault(); if (onNavigateToJobs) onNavigateToJobs('database_backup'); }}>Active</a>
                ) : syncStatus?.last_backup ? (
                  <a href="#" className="job-link-inline" onClick={(e) => { e.preventDefault(); if (onNavigateToJobs) onNavigateToJobs('database_backup'); }}>{formatDate(syncStatus.last_backup)}</a>
                ) : syncStatus ? 'Never' : '...'}
              </span>
            </div>
          </div>

          <div className="sync-buttons-grid">
            <div className="sync-button-card">
              <button
                className="sync-btn push-btn"
                onClick={handleBackup}
                disabled={anyBusy || !syncStatus?.drive_access_verified}
              >
                {backingUp ? 'Backing up...' : 'Backup'}
              </button>
              <p className="button-description">pg_dump to Database folder</p>
              {actionJobLinks.db_backup && onNavigateToJobs && (
                <a href="#" className="job-link-inline" onClick={(e) => { e.preventDefault(); onNavigateToJobs(actionJobLinks.db_backup); }}>
                  View in Jobs &rarr;
                </a>
              )}
            </div>
            <div className="sync-button-card">
              <button
                className="sync-btn pull-btn"
                onClick={handleShowRestore}
                disabled={anyBusy || !syncStatus?.drive_access_verified}
              >
                {restoring ? 'Restoring...' : 'Restore'}
              </button>
              <p className="button-description">Restore from a backup file</p>
              {actionJobLinks.db_restore && onNavigateToJobs && (
                <a href="#" className="job-link-inline" onClick={(e) => { e.preventDefault(); onNavigateToJobs(actionJobLinks.db_restore); }}>
                  View in Jobs &rarr;
                </a>
              )}
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

        {/* Images Section */}
        <div className="backup-section">
          <div className="backup-section-header">
            {driveIdRow('images', 'Images', '\u{1F5BC}\uFE0F', syncStatus?.drive?.folders?.images)}
          </div>

          <div className="sync-status-row">
            <div className="sync-status-item">
              <label>Media Files</label>
              <span>{imageBackup?.mediaFileCount ?? '...'} files</span>
            </div>
            <div className="sync-status-item">
              <label>Drive Media</label>
              <span>{imageBackup?.driveMediaCount ?? '...'} files</span>
            </div>
            <div className="sync-status-item">
              <label>DB Dumps</label>
              <span>{imageBackup?.driveDbDumpCount ?? '...'}</span>
            </div>
            <div className="sync-status-item">
              <label>Last Backup</label>
              <span>
                {backingUpImages || restoringImages ? (
                  <a href="#" className="job-link-active" onClick={(e) => { e.preventDefault(); if (onNavigateToJobs) onNavigateToJobs('image_backup'); }}>Active</a>
                ) : imageBackup?.lastBackup ? (
                  <a href="#" className="job-link-inline" onClick={(e) => { e.preventDefault(); if (onNavigateToJobs) onNavigateToJobs('image_backup'); }}>{formatDate(imageBackup.lastBackup)}</a>
                ) : 'Never'}
              </span>
            </div>
          </div>

          <div className="sync-buttons-grid">
            <div className="sync-button-card">
              <button
                className="sync-btn push-btn"
                onClick={handleImageBackup}
                disabled={anyBusy || !syncStatus?.drive_access_verified}
              >
                {backingUpImages ? 'Backing up...' : 'Backup'}
              </button>
              <p className="button-description">Sync DB + media files to Drive</p>
              {actionJobLinks.img_backup && onNavigateToJobs && (
                <a href="#" className="job-link-inline" onClick={(e) => { e.preventDefault(); onNavigateToJobs(actionJobLinks.img_backup); }}>
                  View in Jobs &rarr;
                </a>
              )}
            </div>
            <div className="sync-button-card">
              <button
                className="sync-btn pull-btn"
                onClick={handleImageRestore}
                disabled={anyBusy || !syncStatus?.drive_access_verified}
              >
                {restoringImages ? 'Restoring...' : 'Restore'}
              </button>
              <p className="button-description">Pull images from Drive to image server</p>
              {actionJobLinks.img_restore && onNavigateToJobs && (
                <a href="#" className="job-link-inline" onClick={(e) => { e.preventDefault(); onNavigateToJobs(actionJobLinks.img_restore); }}>
                  View in Jobs &rarr;
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

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
