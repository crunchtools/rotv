import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const CONTINUE_DELAY_MS = 2000;

/**
 * Landing page for the link in a sign-up's confirmation email (spec 046).
 * Confirms as soon as it opens. The link never signs anyone in: a device that
 * is already signed in continues to the map, any other is offered Sign in.
 */
function SignInConfirm() {
  const navigate = useNavigate();
  const { confirmEmail, isAuthenticated } = useAuth();
  // The token arrives in the fragment (never sent to the server). Read it once,
  // then drop it from the address bar so it doesn't linger in history.
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (value) window.history.replaceState(null, '', window.location.pathname);
    return value;
  });
  const [status, setStatus] = useState(token ? 'working' : 'failed');
  const [failure, setFailure] = useState(token ? null : 'This link is incomplete.');
  // React's development double-run of effects must not spend the link twice.
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    confirmEmail(token)
      .then(() => setStatus('done'))
      .catch((err) => {
        setFailure(err.message);
        setStatus('failed');
      });
  }, [token, confirmEmail]);

  // Signed-in devices go back to the map; others are offered sign-in.
  const next = isAuthenticated ? '/' : '/login';

  useEffect(() => {
    if (status !== 'done') return undefined;
    const timer = setTimeout(() => navigate(next), CONTINUE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, next, navigate]);

  return (
    <div className="privacy-policy-page">
      <div className="privacy-policy-content signin-confirm">
        {status === 'working' && <h1>Confirming your email…</h1>}
        {status === 'done' && (
          <>
            <h1>Your email is confirmed</h1>
            <button className="signin-confirm-btn" onClick={() => navigate(next)}>
              {next === '/login' ? 'Sign in' : 'Go to the map'}
            </button>
          </>
        )}
        {status === 'failed' && (
          <>
            <h1>Confirm your email</h1>
            <p className="auth-error" role="alert">{failure}</p>
            <button className="signin-confirm-btn secondary" onClick={() => navigate('/settings')}>
              Send a new confirmation email
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default SignInConfirm;
