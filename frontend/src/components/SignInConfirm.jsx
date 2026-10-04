import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Landing page for the link in a sign-in email (spec 045) or a sign-up's
 * confirmation email (spec 046, `&confirm=1`). Signing in takes a click rather
 * than happening on page load, because mail scanners prefetch links and would
 * otherwise use up the one-time token.
 */
function SignInConfirm() {
  const navigate = useNavigate();
  const { verifyEmailLogin } = useAuth();
  // The token arrives in the fragment (never sent to the server). Read it once,
  // then drop it from the address bar so it doesn't linger in history.
  const [{ token, confirming }] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const value = params.get('token');
    if (value) window.history.replaceState(null, '', window.location.pathname);
    return { token: value, confirming: params.get('confirm') === '1' };
  });
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState(token ? null : 'This link is incomplete.');

  const handleConfirm = async () => {
    setBusy(true);
    setConfirmError(null);
    try {
      const result = await verifyEmailLogin({ token });
      navigate(result?.needsSignupCompletion ? '/welcome' : '/');
    } catch (err) {
      setConfirmError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="privacy-policy-page">
      <div className="privacy-policy-content signin-confirm">
        <h1>{confirming ? 'Confirm your email' : 'Sign in to Roots of the Valley'}</h1>
        {token && !confirmError && (
          <>
            <p className="signin-confirm-hint">
              Tap the button to {confirming ? 'confirm your email address' : 'finish signing in'}. This extra step
              stops email security scanners from using your one-time link before you do.
            </p>
            <button className="signin-confirm-btn" onClick={handleConfirm} disabled={busy}>
              {busy ? 'One moment…' : confirming ? 'Confirm my email' : 'Finish signing in'}
            </button>
          </>
        )}
        {confirmError && (
          <>
            <p className="auth-error" role="alert">{confirmError}</p>
            <button className="signin-confirm-btn secondary" onClick={() => navigate(confirming ? '/settings' : '/login')}>
              {confirming ? 'Send a new confirmation email' : 'Request a new sign-in link'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default SignInConfirm;
