import React, { useState, useEffect, useCallback } from 'react';

function ImmichSettings() {
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [albumId, setAlbumId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setServerUrl(data.immich_server_url?.value || '');
        setApiKey(data.immich_api_key?.value || '');
        setAlbumId(data.immich_album_id?.value || '');
        setError(null);
      } else if (response.status === 401 || response.status === 403) {
        setError('Admin access required');
      }
    } catch {
      setError('Failed to fetch settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const updates = [
        { key: 'immich_server_url', value: serverUrl },
        { key: 'immich_api_key', value: apiKey },
        { key: 'immich_album_id', value: albumId }
      ];

      for (const update of updates) {
        const response = await fetch(`/api/admin/settings/${update.key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ value: update.value })
        });

        if (!response.ok) {
          throw new Error(`Failed to save ${update.key}`);
        }
      }

      setMessage('Immich settings saved successfully. Reload the app to apply changes.');
      setTimeout(() => setMessage(null), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const response = await fetch('/api/admin/test-immich', {
        method: 'POST',
        credentials: 'include'
      });

      const result = await response.json();
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="immich-settings"><p>Loading Immich settings...</p></div>;
  }

  return (
    <div className="immich-settings">
      <h3>Immich Asset Management</h3>
      <p className="settings-description">
        Configure connection to Immich server for theme video storage.
      </p>

      {error && <div className="sync-error">{error}</div>}
      {message && <div className="sync-success">{message}</div>}

      <div className="config-row">
        <label>Server URL</label>
        <input
          type="text"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="https://images.rootsofthevalley.org"
        />
      </div>

      <div className="config-row">
        <label>API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Enter Immich API key"
        />
      </div>

      <div className="config-row">
        <label>Album ID</label>
        <input
          type="text"
          value={albumId}
          onChange={(e) => setAlbumId(e.target.value)}
          placeholder="Album ID containing theme videos"
        />
        <small>Find this in Immich album URL: /albums/[ALBUM_ID]</small>
      </div>

      <div className="button-group">
        <button
          className="sync-btn"
          onClick={handleTest}
          disabled={testing || !serverUrl || !apiKey}
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>

        <button
          className="sync-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {testResult && (
        <div className={testResult.success ? 'sync-success' : 'sync-error'}>
          {testResult.success ? '✓ Connection successful' : `✗ ${testResult.error}`}
        </div>
      )}

      <div className="immich-info">
        <h4>How It Works</h4>
        <ul>
          <li>Videos are fetched from Immich server on demand</li>
          <li>URLs are cached for 1 hour to minimize API calls</li>
          <li>Falls back to embedded videos if Immich unavailable</li>
          <li>All environments (dev/test/prod) use the same Immich instance</li>
        </ul>
      </div>
    </div>
  );
}

export default ImmichSettings;
