import React, { useState, useEffect, useCallback } from 'react';

function ThemesSettings() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [testingTheme, setTestingTheme] = useState(null);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data.seasonal_themes?.value) {
          setConfig(JSON.parse(data.seasonal_themes.value));
        }
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

  // Cleanup preview mode when component unmounts
  useEffect(() => {
    return () => {
      // If user navigates away while testing, stop the preview
      if (sessionStorage.getItem('theme-preview')) {
        sessionStorage.removeItem('theme-preview');
        window.dispatchEvent(new CustomEvent('theme-preview-change'));
      }
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/settings/seasonal_themes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value: JSON.stringify(config) })
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Theme settings saved successfully!' });
        setTimeout(() => setMessage(null), 3000);

        // Stop any active preview and notify hook to reload config
        stopTesting();
        window.dispatchEvent(new CustomEvent('theme-config-updated'));
      } else {
        setError('Failed to save settings');
      }
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateTheme = (index, field, value) => {
    const newConfig = { ...config };
    newConfig.themes[index][field] = value;
    setConfig(newConfig);
  };

  const testTheme = (themeId) => {
    setTestingTheme(themeId);
    // Store in sessionStorage so useSeasonalTheme hook can pick it up
    sessionStorage.setItem('theme-preview', themeId);
    // Dispatch custom event to notify the hook
    window.dispatchEvent(new CustomEvent('theme-preview-change'));
  };

  const stopTesting = () => {
    setTestingTheme(null);
    sessionStorage.removeItem('theme-preview');
    window.dispatchEvent(new CustomEvent('theme-preview-change'));
  };

  if (loading) {
    return <div className="theme-settings"><p>Loading theme settings...</p></div>;
  }

  return (
    <div className="theme-settings">
      <div className="settings-section">
        <h3>🎨 Seasonal Themes</h3>
        <p className="settings-description">
          Configure seasonal and holiday theme decorations for the navigation bar.
          Use the Test button to preview each theme.
        </p>

        {error && <div className="save-message error">✗ {error}</div>}

        <div className="theme-table-container">
          <table className="theme-table">
            <thead>
              <tr>
                <th>Enabled</th>
                <th>Theme</th>
                <th>START</th>
                <th>END</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {config?.themes.map((theme, index) => (
                <tr key={theme.id} className={testingTheme === theme.id ? 'testing' : ''}>
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={theme.enabled}
                      onChange={(e) => updateTheme(index, 'enabled', e.target.checked)}
                      aria-label={`Enable ${theme.name}`}
                    />
                  </td>
                  <td className="theme-name">{theme.name}</td>
                  <td>
                    <input
                      type="text"
                      value={theme.startDate}
                      onChange={(e) => updateTheme(index, 'startDate', e.target.value)}
                      placeholder="MM/DD"
                      maxLength="5"
                      pattern="\d{2}/\d{2}"
                      className="date-input-table"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={theme.endDate}
                      onChange={(e) => updateTheme(index, 'endDate', e.target.value)}
                      placeholder="MM/DD"
                      maxLength="5"
                      pattern="\d{2}/\d{2}"
                      className="date-input-table"
                    />
                  </td>
                  <td>
                    <button
                      onClick={() => testingTheme === theme.id ? stopTesting() : testTheme(theme.id)}
                      className={`test-btn ${testingTheme === theme.id ? 'active' : ''}`}
                    >
                      {testingTheme === theme.id ? 'Stop' : 'Test'}
                    </button>
                  </td>
                </tr>
              ))}
              {/* Night Mode Row */}
              <tr className={testingTheme === 'night' ? 'testing' : ''}>
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={config?.nightMode.enabled}
                    onChange={(e) => setConfig({
                      ...config,
                      nightMode: { ...config.nightMode, enabled: e.target.checked }
                    })}
                    aria-label="Enable Night Mode"
                  />
                </td>
                <td className="theme-name">Night Mode</td>
                <td>
                  <input
                    type="number"
                    value={config?.nightMode.startHour}
                    onChange={(e) => setConfig({
                      ...config,
                      nightMode: { ...config.nightMode, startHour: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="23"
                    placeholder="Hour"
                    className="date-input-table"
                    title="Start Hour (0-23)"
                  />
                  <span style={{ fontSize: '0.75rem', color: '#666', marginLeft: '0.25rem' }}>hr</span>
                </td>
                <td>
                  <input
                    type="number"
                    value={config?.nightMode.endHour}
                    onChange={(e) => setConfig({
                      ...config,
                      nightMode: { ...config.nightMode, endHour: parseInt(e.target.value) }
                    })}
                    min="0"
                    max="23"
                    placeholder="Hour"
                    className="date-input-table"
                    title="End Hour (0-23)"
                  />
                  <span style={{ fontSize: '0.75rem', color: '#666', marginLeft: '0.25rem' }}>hr</span>
                </td>
                <td>
                  <button
                    onClick={() => testingTheme === 'night' ? stopTesting() : testTheme('night')}
                    className={`test-btn ${testingTheme === 'night' ? 'active' : ''}`}
                  >
                    {testingTheme === 'night' ? 'Stop' : 'Test'}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="settings-actions">
          <button
            className="save-settings-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '💾 Saving...' : '💾 Save Theme Settings'}
          </button>

          {message && (
            <div className={`save-message ${message.type}`}>
              {message.type === 'success' ? '✓' : '✗'} {message.text}
            </div>
          )}
        </div>
      </div>

      <div className="settings-divider"></div>

      <div className="settings-info-box">
        <div className="info-box-header">
          <span className="info-icon">ℹ️</span>
          <strong>How Themes Work</strong>
        </div>
        <ul className="info-list">
          <li>Themes are applied based on current date and time</li>
          <li>Higher priority (lower number) themes override lower priority ones</li>
          <li>Use Test buttons to preview themes before saving</li>
          <li>Theme videos load on-demand for better performance</li>
        </ul>
      </div>
    </div>
  );
}

export default ThemesSettings;
