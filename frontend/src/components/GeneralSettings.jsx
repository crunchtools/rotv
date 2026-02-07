import React, { useState, useEffect } from 'react';

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (EST/EDT)', icon: '🗽' },
  { value: 'America/Chicago', label: 'Central Time (CST/CDT)', icon: '🌆' },
  { value: 'America/Denver', label: 'Mountain Time (MST/MDT)', icon: '⛰️' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PST/PDT)', icon: '🌉' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKST/AKDT)', icon: '❄️' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)', icon: '🌺' },
  { value: 'UTC', label: 'UTC (Universal Time)', icon: '🌍' }
];

function GeneralSettings() {
  const [timezone, setTimezone] = useState('America/New_York');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  useEffect(() => {
    // Load timezone from localStorage
    const savedTimezone = localStorage.getItem('app-timezone');
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);

    try {
      // Save to localStorage
      localStorage.setItem('app-timezone', timezone);

      setSaveMessage({ type: 'success', text: 'Timezone saved successfully!' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch {
      setSaveMessage({ type: 'error', text: 'Failed to save timezone' });
    } finally {
      setSaving(false);
    }
  };

  const selectedTz = TIMEZONES.find(tz => tz.value === timezone);

  return (
    <div className="general-settings">
      <div className="settings-section">
        <h3>🕐 Timezone</h3>
        <p className="settings-description">
          Select your local timezone. This ensures dates from news articles and events are interpreted correctly.
        </p>

        <div className="settings-field">
          <label htmlFor="timezone-select">Your Timezone</label>
          <select
            id="timezone-select"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="timezone-select"
          >
            {TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value}>
                {tz.icon} {tz.label}
              </option>
            ))}
          </select>
          <p className="field-hint">
            All news and event dates will be interpreted in {selectedTz?.label || 'your selected timezone'}
          </p>
        </div>

        <div className="settings-actions">
          <button
            onClick={handleSave}
            disabled={saving}
            className="save-settings-btn"
          >
            {saving ? '💾 Saving...' : '💾 Save Settings'}
          </button>

          {saveMessage && (
            <div className={`save-message ${saveMessage.type}`}>
              {saveMessage.type === 'success' ? '✓' : '✗'} {saveMessage.text}
            </div>
          )}
        </div>
      </div>

      <div className="settings-divider"></div>

      <div className="settings-info-box">
        <div className="info-box-header">
          <span className="info-icon">ℹ️</span>
          <strong>How Timezone Works</strong>
        </div>
        <ul className="info-list">
          <li>When you refresh News or Events, the AI uses your timezone setting</li>
          <li>Dates are extracted in ISO 8601 format (YYYY-MM-DD)</li>
          <li>All dates match exactly what appears on the source websites</li>
        </ul>
      </div>
    </div>
  );
}

export default GeneralSettings;
