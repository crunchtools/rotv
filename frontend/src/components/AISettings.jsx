import React, { useState, useEffect, useCallback } from 'react';

function AISettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  // Form state
  const [apiKey, setApiKey] = useState('');

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/settings', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setError(null);
      } else if (response.status === 401 || response.status === 403) {
        setError('Please log in as admin to view AI settings');
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

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setError('API key cannot be empty');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/settings/gemini_api_key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value: apiKey })
      });

      if (response.ok) {
        setMessage('API key saved successfully');
        setApiKey('');
        fetchSettings();
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to save API key');
      }
    } catch {
      setError('Failed to save API key');
    } finally {
      setSaving(false);
    }
  };

  const handleTestApiKey = async () => {
    setTesting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/ai/test-key', {
        method: 'POST',
        credentials: 'include'
      });

      const result = await response.json();
      if (result.success) {
        setMessage('API key is valid and working!');
      } else {
        setError(result.error || 'API key test failed');
      }
    } catch {
      setError('Failed to test API key');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="ai-settings">
        <h3>AI Integration (Google Gemini)</h3>
        <p>Loading AI settings...</p>
      </div>
    );
  }

  return (
    <div className="ai-settings">
      <h3>AI Integration (Google Gemini)</h3>
      <p className="ai-description">
        Configure AI-powered content generation for destination descriptions.
      </p>

      {error && <div className="sync-error">{error}</div>}
      {message && <div className="sync-success">{message}</div>}

      {/* API Key Section */}
      <div className="ai-section">
        <h4>API Key</h4>
        <div className="api-key-status">
          <span className={`status-indicator ${settings?.gemini_api_key?.isSet ? 'configured' : 'not-configured'}`}></span>
          <span>{settings?.gemini_api_key?.isSet ? 'API key configured' : 'API key not configured'}</span>
        </div>

        <div className="api-key-form">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter new Gemini API key..."
            className="api-key-input"
          />
          <button
            className="sync-btn create-btn"
            onClick={handleSaveApiKey}
            disabled={saving || !apiKey.trim()}
          >
            {saving ? 'Saving...' : 'Save Key'}
          </button>
          {settings?.gemini_api_key?.isSet && (
            <button
              className="sync-btn process-btn"
              onClick={handleTestApiKey}
              disabled={testing}
            >
              {testing ? 'Testing...' : 'Test Key'}
            </button>
          )}
        </div>
        <p className="field-hint">
          Get your API key from{' '}
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">
            Google AI Studio
          </a>
        </p>
      </div>

    </div>
  );
}

export default AISettings;
