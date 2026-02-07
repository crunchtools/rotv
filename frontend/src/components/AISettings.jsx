import React, { useState, useEffect, useCallback } from 'react';

const DEFAULT_PROMPTS = {
  gemini_prompt_brief: `Generate a concise 2-3 sentence overview for a historical location in Cuyahoga Valley National Park.
Location: {{name}}
Era: {{era}}
Owner: {{property_owner}}
Activities: {{primary_activities}}

Focus on what makes this place special for visitors today.`,

  gemini_prompt_historical: `Write a detailed historical description (2-3 paragraphs) for a destination in the Cuyahoga Valley, written in the style of Arcadia Publishing's "Images of America" series.
Location: {{name}}
Era: {{era}}
Owner: {{property_owner}}

Use a warm, narrative tone typical of local history books. Focus on human stories and community significance. Reference the Ohio & Erie Canal era when relevant.`
};

function AISettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  // Form state
  const [apiKey, setApiKey] = useState('');
  const [prompts, setPrompts] = useState({
    gemini_prompt_brief: '',
    gemini_prompt_historical: ''
  });
  const [editingPrompt, setEditingPrompt] = useState(null);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/settings', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setSettings(data);

        // Initialize prompts from settings or defaults
        setPrompts({
          gemini_prompt_brief: data.gemini_prompt_brief?.value || DEFAULT_PROMPTS.gemini_prompt_brief,
          gemini_prompt_historical: data.gemini_prompt_historical?.value || DEFAULT_PROMPTS.gemini_prompt_historical
        });
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

  const handleSavePrompt = async (key) => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value: prompts[key] })
      });

      if (response.ok) {
        setMessage('Prompt saved successfully');
        setEditingPrompt(null);
        fetchSettings();
      } else {
        setError('Failed to save prompt');
      }
    } catch {
      setError('Failed to save prompt');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPrompt = (key) => {
    setPrompts(prev => ({
      ...prev,
      [key]: DEFAULT_PROMPTS[key]
    }));
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

      {/* Prompt Templates Section */}
      <div className="ai-section">
        <h4>Prompt Templates</h4>
        <p className="section-description">
          Customize the prompts used for AI generation. Use placeholders like{' '}
          <code>{'{{name}}'}</code>, <code>{'{{era}}'}</code>,{' '}
          <code>{'{{property_owner}}'}</code>, <code>{'{{primary_activities}}'}</code>.
        </p>

        {/* Brief Description Prompt */}
        <div className="prompt-editor">
          <div className="prompt-header">
            <label>Brief Description Prompt</label>
            <div className="prompt-actions">
              {editingPrompt === 'gemini_prompt_brief' ? (
                <>
                  <button
                    className="sync-btn-small"
                    onClick={() => handleSavePrompt('gemini_prompt_brief')}
                    disabled={saving}
                  >
                    Save
                  </button>
                  <button
                    className="sync-btn-small"
                    onClick={() => {
                      setEditingPrompt(null);
                      setPrompts(prev => ({
                        ...prev,
                        gemini_prompt_brief: settings?.gemini_prompt_brief?.value || DEFAULT_PROMPTS.gemini_prompt_brief
                      }));
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="sync-btn-small"
                    onClick={() => handleResetPrompt('gemini_prompt_brief')}
                  >
                    Reset to Default
                  </button>
                </>
              ) : (
                <button
                  className="sync-btn-small"
                  onClick={() => setEditingPrompt('gemini_prompt_brief')}
                >
                  Edit
                </button>
              )}
            </div>
          </div>
          <textarea
            value={prompts.gemini_prompt_brief}
            onChange={(e) => setPrompts(prev => ({ ...prev, gemini_prompt_brief: e.target.value }))}
            disabled={editingPrompt !== 'gemini_prompt_brief'}
            rows={6}
            className="prompt-textarea"
          />
        </div>

        {/* Historical Description Prompt */}
        <div className="prompt-editor">
          <div className="prompt-header">
            <label>Historical Description Prompt</label>
            <div className="prompt-actions">
              {editingPrompt === 'gemini_prompt_historical' ? (
                <>
                  <button
                    className="sync-btn-small"
                    onClick={() => handleSavePrompt('gemini_prompt_historical')}
                    disabled={saving}
                  >
                    Save
                  </button>
                  <button
                    className="sync-btn-small"
                    onClick={() => {
                      setEditingPrompt(null);
                      setPrompts(prev => ({
                        ...prev,
                        gemini_prompt_historical: settings?.gemini_prompt_historical?.value || DEFAULT_PROMPTS.gemini_prompt_historical
                      }));
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="sync-btn-small"
                    onClick={() => handleResetPrompt('gemini_prompt_historical')}
                  >
                    Reset to Default
                  </button>
                </>
              ) : (
                <button
                  className="sync-btn-small"
                  onClick={() => setEditingPrompt('gemini_prompt_historical')}
                >
                  Edit
                </button>
              )}
            </div>
          </div>
          <textarea
            value={prompts.gemini_prompt_historical}
            onChange={(e) => setPrompts(prev => ({ ...prev, gemini_prompt_historical: e.target.value }))}
            disabled={editingPrompt !== 'gemini_prompt_historical'}
            rows={8}
            className="prompt-textarea"
          />
        </div>
      </div>
    </div>
  );
}

export default AISettings;
