import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import ProfileFields from './ProfileFields';

/**
 * Settings › Your Account (spec 046): profile fields and whether the email
 * address is confirmed, with a resend button when it isn't.
 */
function AccountProfile() {
  const { user, updateProfile, resendConfirmation } = useAuth();
  const [profile, setProfile] = useState({
    name: user.fullName || '',
    username: user.username || '',
    displayPreference: user.displayPreference || 'name'
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const act = async (action) => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ type: 'success', text: await action() });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    act(async () => {
      await updateProfile(profile);
      return 'Profile saved.';
    });
  };

  return (
    <div className="account-profile">
      <p className="account-email">
        {user.email}{' '}
        {user.emailVerified ? (
          <span className="email-badge confirmed">Confirmed</span>
        ) : (
          <>
            <span className="email-badge unconfirmed">Not confirmed</span>{' '}
            <button className="auth-link-btn" onClick={() => act(resendConfirmation)} disabled={busy}>
              Resend confirmation email
            </button>
          </>
        )}
      </p>
      <form onSubmit={handleSave}>
        <ProfileFields value={profile} onChange={setProfile} idPrefix="settings" />
        <button className="sync-btn" type="submit" disabled={busy || !profile.name.trim()}>Save profile</button>
      </form>
      {status && <p className={`auth-status ${status.type}`} role="status">{status.text}</p>}
    </div>
  );
}

export default AccountProfile;
