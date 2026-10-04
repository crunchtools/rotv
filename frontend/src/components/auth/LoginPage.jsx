import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser';
import { useAuth } from '../../hooks/useAuth';
import { AuthShell, ProviderChoice, AuthLink } from './AuthShell';

/**
 * /login (spec 046): choose Google or email first. Email offers a password,
 * a passkey (also offered in the email field's autofill), and "Forgot
 * password?", which emails a link to choose a new password.
 */
function LoginPage() {
  const navigate = useNavigate();
  const { providers, loginWithPassword, loginWithPasskey, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [resetMessage, setResetMessage] = useState(null);
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

  // Runs a form action with shared busy/error handling, then `after` (by
  // default, back to the map).
  const run = (action, after = () => navigate('/')) => async (e) => {
    e?.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await action();
      after();
    } catch (err) {
      if (err?.name !== 'NotAllowedError') setFormError(err.message);
    }
    setBusy(false);
  };

  const handlePassword = run(() => loginWithPassword(email, password));
  const handleForgot = run(async () => setResetMessage(await requestPasswordReset(email)), () => {});
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
          {providers.passwordReset && (
            <button type="button" className="auth-link-btn" onClick={() => { setFormError(null); setMode('forgot'); }}>
              Forgot password?
            </button>
          )}
          <button type="button" className="auth-link-btn" onClick={() => setMode('choose')}>Other ways to sign in</button>
        </form>
      )}

      {mode === 'forgot' && (
        <form className="auth-form" onSubmit={handleForgot}>
          {resetMessage ? (
            <p className="auth-hint" role="status">{resetMessage}</p>
          ) : (
            <>
              <p className="auth-hint">Enter your email and we&apos;ll send you a link to choose a new password.</p>
              <fieldset className="auth-fieldset">
                <label className="auth-label" htmlFor="forgot-email">Email</label>
                <input
                  id="forgot-email"
                  className="auth-input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </fieldset>
              <button className="signin-confirm-btn auth-submit" type="submit" disabled={busy || !email}>
                {busy ? 'Sending…' : 'Email me a reset link'}
              </button>
            </>
          )}
          {formError && <p className="auth-error" role="alert">{formError}</p>}
          <button type="button" className="auth-link-btn" onClick={() => { setResetMessage(null); setMode('password'); }}>
            Back to sign in
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default LoginPage;
