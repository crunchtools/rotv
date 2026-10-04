import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { useAuth } from '../../hooks/useAuth';

const PASSWORD_MIN = 12;

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'never';
}

/**
 * Settings › Your Account › Sign-in methods (spec 046): passkeys and the
 * password. Changes need a recent sign-in; when the server says the session
 * is too old, the section offers to sign in again.
 */
function SignInMethods() {
  const navigate = useNavigate();
  const { signInMethods, setPassword, removePassword, registerPasskey, renamePasskey, removePasskey, logout } = useAuth();
  const [methods, setMethods] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [editingPassword, setEditingPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const passkeysSupported = browserSupportsWebAuthn();

  const load = useCallback(() => {
    signInMethods()
      .then(setMethods)
      .catch((err) => setStatus({ type: 'error', text: `Could not load sign-in methods: ${err.message}` }));
  }, [signInMethods]);

  useEffect(() => { load(); }, [load]);

  const run = (action, success) => async () => {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus({ type: 'success', text: success });
      load();
      return true;
    } catch (err) {
      if (err.reauth) setNeedsReauth(true);
      if (err.name !== 'NotAllowedError') setStatus({ type: 'error', text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    const saved = await run(() => setPassword(newPassword), methods?.hasPassword ? 'Password changed.' : 'Password set.')();
    if (saved) {
      setNewPassword('');
      setEditingPassword(false);
    }
  };

  const rename = (passkey) => {
    const name = window.prompt('Name this passkey', passkey.name);
    if (name && name.trim() && name.trim() !== passkey.name) {
      run(() => renamePasskey(passkey.id, name), 'Passkey renamed.')();
    }
  };

  const signInAgain = async () => {
    await logout();
    navigate('/login');
  };

  if (!methods) {
    return status ? <p className={`auth-status ${status.type}`} role="status">{status.text}</p> : null;
  }

  return (
    <div className="signin-methods">
      <h4>Sign-in methods</h4>

      <div className="signin-method">
        <div className="signin-method-head">
          <strong>Passkeys</strong>
          {passkeysSupported && (
            <button className="sync-btn" onClick={run(() => registerPasskey(), 'Passkey added.')} disabled={busy}>
              Add a passkey
            </button>
          )}
        </div>
        {methods.passkeys.length === 0 ? (
          <p className="auth-hint">Sign in with your fingerprint, face, or screen lock instead of a password.</p>
        ) : (
          <ul className="passkey-list">
            {methods.passkeys.map((passkey) => (
              <li key={passkey.id}>
                <span className="passkey-name">{passkey.name}</span>
                <span className="passkey-meta">Added {formatDate(passkey.createdAt)} · last used {formatDate(passkey.lastUsedAt)}</span>
                <span className="passkey-actions">
                  <button className="auth-link-btn" onClick={() => rename(passkey)} disabled={busy} aria-label={`Rename ${passkey.name}`}>Rename</button>
                  <button
                    className="auth-link-btn danger-link"
                    onClick={run(() => removePasskey(passkey.id), 'Passkey removed.')}
                    disabled={busy}
                    aria-label={`Remove ${passkey.name}`}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {methods.passwordAllowed && (
        <div className="signin-method">
          <div className="signin-method-head">
            <strong>Password</strong>
            {!editingPassword && (
              <span>
                <button className="sync-btn" onClick={() => setEditingPassword(true)} disabled={busy}>
                  {methods.hasPassword ? 'Change password' : 'Set a password'}
                </button>{' '}
                {methods.hasPassword && (
                  <button className="sync-btn" onClick={run(removePassword, 'Password removed.')} disabled={busy}>
                    Remove
                  </button>
                )}
              </span>
            )}
          </div>
          {editingPassword && (
            <form onSubmit={savePassword} className="signin-password-form">
              <label className="auth-label" htmlFor="settings-new-password">New password</label>
              <input
                id="settings-new-password"
                className="auth-input"
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN}
                maxLength={128}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <p className="auth-hint">At least {PASSWORD_MIN} characters.</p>
              <button className="sync-btn" type="submit" disabled={busy || newPassword.length < PASSWORD_MIN}>Save password</button>{' '}
              <button className="sync-btn" type="button" onClick={() => { setEditingPassword(false); setNewPassword(''); }}>Cancel</button>
            </form>
          )}
          {!methods.hasPassword && !editingPassword && (
            <p className="auth-hint">No password set. You can always sign in with a code sent to your email.</p>
          )}
        </div>
      )}

      {status && <p className={`auth-status ${status.type}`} role="status">{status.text}</p>}
      {needsReauth && (
        <button className="sync-btn" onClick={signInAgain}>Sign in again</button>
      )}
    </div>
  );
}

export default SignInMethods;
