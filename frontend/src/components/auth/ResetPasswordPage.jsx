import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { AuthShell, AuthLink } from './AuthShell';

const PASSWORD_MIN = 12;

/**
 * /reset-password (spec 046): the page behind a "Reset my password" email.
 * The person must choose a new password; saving it signs them in.
 */
function ResetPasswordPage() {
  const navigate = useNavigate();
  const { resetPassword } = useAuth();
  // The token arrives in the fragment (never sent to the server). Read it once,
  // then drop it from the address bar so it doesn't linger in history.
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (value) window.history.replaceState(null, '', window.location.pathname);
    return value;
  });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(token ? null : 'This reset link is incomplete. Request a new one.');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const result = await resetPassword(token, password);
      navigate(result?.needsSignupCompletion ? '/welcome' : '/');
    } catch (err) {
      setFormError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password" footer={<AuthLink to="/login">Back to sign in</AuthLink>}>
      {token && (
        <form className="auth-form" onSubmit={handleSubmit}>
          <fieldset className="auth-fieldset">
            <label className="auth-label" htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              className="auth-input"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p className="auth-hint">At least {PASSWORD_MIN} characters.</p>
          </fieldset>
          <button className="signin-confirm-btn auth-submit" type="submit" disabled={busy || password.length < PASSWORD_MIN}>
            {busy ? 'Saving…' : 'Save and sign in'}
          </button>
        </form>
      )}
      {formError && <p className="auth-error" role="alert">{formError}</p>}
    </AuthShell>
  );
}

export default ResetPasswordPage;
