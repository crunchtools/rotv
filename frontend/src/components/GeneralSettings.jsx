import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AccountProfile from './auth/AccountProfile';
import SignInMethods from './auth/SignInMethods';
import ContactDetails from './ContactDetails';

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (EST/EDT)', icon: '🗽' },
  { value: 'America/Chicago', label: 'Central Time (CST/CDT)', icon: '🌆' },
  { value: 'America/Denver', label: 'Mountain Time (MST/MDT)', icon: '⛰️' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PST/PDT)', icon: '🌉' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKST/AKDT)', icon: '❄️' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)', icon: '🌺' },
  { value: 'UTC', label: 'UTC (Universal Time)', icon: '🌍' }
];

// Self-service account deletion (#700). Two-step inline confirm rather than a
// browser dialog. Admins don't see it; the backend refuses them as well.
function DeleteAccount() {
  const navigate = useNavigate();
  const { deleteAccount } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      navigate('/');
    } catch (err) {
      setDeleteError(err.message);
      setDeleting(false);
    }
  };

  return (
    <div className="danger-zone">
      <h4>Delete my account</h4>
      <p className="danger-warning">
        Permanently deletes your account, favorites, visited places, saved trips and preferences,
        and signs you out everywhere. This cannot be undone.
      </p>
      {confirming ? (
        <>
          <button className="sync-btn danger-btn" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Yes, delete everything'}
          </button>{' '}
          <button className="sync-btn" onClick={() => setConfirming(false)} disabled={deleting}>
            Cancel
          </button>
        </>
      ) : (
        <button className="sync-btn danger-btn" onClick={() => setConfirming(true)}>
          Delete my account
        </button>
      )}
      {deleteError && <p className="auth-error" role="alert">{deleteError}</p>}
      <p className="danger-hint">
        <a href="/data-deletion" onClick={(e) => { e.preventDefault(); navigate('/data-deletion'); }}>
          What gets deleted and what stays
        </a>
      </p>
    </div>
  );
}

// Settings › Your Account (#700, spec 046): profile, email confirmation,
// sign-in methods, and account deletion.
function AccountSection() {
  const { user, isAdmin } = useAuth();
  if (!user) return null;

  return (
    <>
      <div className="settings-divider"></div>
      <div className="settings-section">
        <h3>Your Account</h3>
        <AccountProfile />
        <SignInMethods />
        {!isAdmin && <DeleteAccount />}
      </div>
    </>
  );
}

function GeneralSettings() {
  const navigate = useNavigate();
  const [timezone, setTimezone] = useState('America/New_York');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  useEffect(() => {
    const savedTimezone = localStorage.getItem('app-timezone');
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);

    try {
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

      <div className="settings-divider"></div>

      <ContactDetails />

      <div className="settings-divider"></div>

      <div className="settings-section">
        <h3>Legal</h3>
        <a
          href="/privacy"
          className="settings-link"
          onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}
        >
          Privacy Policy
        </a>
        <br />
        <a
          href="/data-deletion"
          className="settings-link"
          onClick={(e) => { e.preventDefault(); navigate('/data-deletion'); }}
        >
          Deleting Your Data
        </a>
      </div>

      <AccountSection />
    </div>
  );
}

export default GeneralSettings;
