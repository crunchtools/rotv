import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AccountProfile from './auth/AccountProfile';
import SignInMethods from './auth/SignInMethods';
import ContactDetails from './ContactDetails';

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (EST/EDT)' },
  { value: 'America/Chicago', label: 'Central Time (CST/CDT)' },
  { value: 'America/Denver', label: 'Mountain Time (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PST/PDT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKST/AKDT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
  { value: 'UTC', label: 'UTC (Universal Time)' }
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
    <section className="settings-card danger-zone">
      <h3>Delete my account</h3>
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
    </section>
  );
}

const LEGAL_PAGES = [
  { path: '/privacy', label: 'Privacy Policy' },
  { path: '/data-deletion', label: 'Deleting Your Data' },
  { path: '/terms', label: 'Terms of Service' }
];

// Settings › General: who you are first, then how you sign in, then
// preferences; deleting the account and the legal pages close the page.
function GeneralSettings() {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [timezone, setTimezone] = useState('America/New_York');
  const [timezoneSaved, setTimezoneSaved] = useState(false);

  useEffect(() => {
    const savedTimezone = localStorage.getItem('app-timezone');
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, []);

  // Saved as soon as it is picked: there is nothing else on the form to confirm.
  const pickTimezone = (value) => {
    setTimezone(value);
    try {
      localStorage.setItem('app-timezone', value);
      setTimezoneSaved(true);
    } catch (err) {
      console.warn('Could not save the timezone on this device:', err);
      setTimezoneSaved(false);
    }
  };

  return (
    <div className="general-settings">
      {user ? (
        <>
          <section className="settings-card">
            <h3>Your Account</h3>
            <AccountProfile />
          </section>
          <section className="settings-card">
            <SignInMethods />
          </section>
        </>
      ) : (
        <ContactDetails />
      )}

      <section className="settings-card">
        <h3>Preferences</h3>
        <div className="settings-field">
          <label htmlFor="timezone-select">Timezone</label>
          <select
            id="timezone-select"
            value={timezone}
            onChange={(e) => pickTimezone(e.target.value)}
            className="timezone-select"
          >
            {TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
          <p className="field-hint" role="status">
            {timezoneSaved ? 'Saved. ' : ''}News and event dates are shown in this timezone.
          </p>
        </div>
      </section>

      {user && !isAdmin && <DeleteAccount />}

      <nav className="settings-legal" aria-label="Legal">
        {LEGAL_PAGES.map(page => (
          <a
            key={page.path}
            href={page.path}
            className="settings-link"
            onClick={(e) => { e.preventDefault(); navigate(page.path); }}
          >
            {page.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

export default GeneralSettings;
