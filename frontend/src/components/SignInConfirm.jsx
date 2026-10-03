import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Landing page for the link in a sign-in email (spec 045). Signing in takes a
 * click rather than happening on page load, because mail scanners prefetch
 * links and would otherwise use up the one-time token.
 */
function SignInConfirm() {
  const navigate = useNavigate();
  const { verifyEmailLogin } = useAuth();
  // The token arrives in the fragment (never sent to the server). Read it once,
  // then drop it from the address bar so it doesn't linger in history.
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (value) window.history.replaceState(null, '', window.location.pathname);
    return value;
  });
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState(token ? null : 'This sign-in link is incomplete.');

  const handleConfirm = async () => {
    setBusy(true);
    setConfirmError(null);
    try {
      await verifyEmailLogin({ token });
      navigate('/');
    } catch (err) {
      setConfirmError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="privacy-policy-page">
      <div className="privacy-policy-content signin-confirm">
        <h1>Sign in to Roots of the Valley</h1>
        {token && !confirmError && (
          <>
            <p className="signin-confirm-hint">
              Tap the button to finish signing in. This extra step stops email security scanners from using your
              one-time link before you do.
            </p>
            <button className="signin-confirm-btn" onClick={handleConfirm} disabled={busy}>
              {busy ? 'Signing in…' : 'Finish signing in'}
            </button>
          </>
        )}
        {confirmError && (
          <>
            <p className="auth-error" role="alert">{confirmError}</p>
            <button className="signin-confirm-btn secondary" onClick={() => navigate('/')}>
              Back to the map to request a new link
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default SignInConfirm;
