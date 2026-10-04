import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser';
import { useAuth } from '../../hooks/useAuth';
import { AuthShell, ProviderChoice, AuthLink } from './AuthShell';
import EmailSignIn from '../EmailSignIn';

/**
 * /login (spec 046): choose Google or email first. Email offers a password,
 * a passkey (also offered in the email field's autofill), or a one-time
 * code by email, which doubles as "forgot password".
 */
function LoginPage() {
  const navigate = useNavigate();
  const { providers, loginWithPassword, loginWithPasskey } = useAuth();
  const [mode, setMode] = useState('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const passkeysSupported = browserSupportsWebAuthn();

  // Offer saved passkeys in the email field's autofill while the form is open.
  useEffect(() => {
    if (mode !== 'password') return undefined;
    let active = true;
    browserSupportsWebAuthnAutofill()
      .then((supported) => supported && active && loginWithPasskey({ autofill: true }))
      .then((signedIn) => { if (signedIn !== false && active) navigate('/'); })
      .catch((err) => {
        // Cancelled or superseded by the explicit button: nothing to report.
        if (err?.name !== 'AbortError') console.warn('Passkey autofill sign-in failed:', err);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const run = (action) => async (e) => {
    e?.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await action();
      navigate('/');
    } catch (err) {
      if (err?.name !== 'NotAllowedError') setFormError(err.message);
      setBusy(false);
    }
  };

  const handlePassword = run(() => loginWithPassword(email, password));
  const handlePasskey = run(() => loginWithPasskey());

  return (
    <AuthShell
      title="Sign in"
      footer={<>New here? <AuthLink to="/signup">Create an account</AuthLink></>}
    >
      {mode === 'choose' && (
        <ProviderChoice onEmail={() => setMode('password')} emailLabel="Continue with email" />
      )}

      {mode === 'password' && (
        <form className="auth-form" onSubmit={handlePassword}>
          <fieldset className="auth-fieldset">
            <label className="auth-label" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="auth-input"
              type="email"
              autoComplete="username webauthn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label className="auth-label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="auth-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </fieldset>
          <button className="signin-confirm-btn auth-submit" type="submit" disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {passkeysSupported && (
            <button type="button" className="auth-choice passkey-choice" onClick={handlePasskey} disabled={busy}>
              Sign in with a passkey
            </button>
          )}
          {formError && <p className="auth-error" role="alert">{formError}</p>}
          {providers.email && (
            <p className="auth-alt-links">
              <button type="button" className="auth-link-btn" onClick={() => setMode('code')}>Forgot password?</button>
              <span aria-hidden="true"> · </span>
              <button type="button" className="auth-link-btn" onClick={() => setMode('code')}>Email me a sign-in code</button>
            </p>
          )}
          <button type="button" className="auth-link-btn" onClick={() => setMode('choose')}>Other ways to sign in</button>
        </form>
      )}

      {mode === 'code' && (
        <div className="auth-form">
          <p className="auth-hint">
            We&apos;ll email you a link and a code. If you forgot your password, sign in this way, then set a new one in Settings.
          </p>
          <EmailSignIn onSignedIn={(result) => navigate(result?.needsSignupCompletion ? '/welcome' : '/')} />
          <button type="button" className="auth-link-btn" onClick={() => setMode('password')}>Back to password sign-in</button>
        </div>
      )}
    </AuthShell>
  );
}

export default LoginPage;
