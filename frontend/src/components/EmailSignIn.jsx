import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

/**
 * Passwordless email sign-in (spec 045): ask for an address, then accept the
 * 6-digit code from the email. The link in the same email works too and lands
 * on /signin; the code covers reading mail on another device.
 */
function EmailSignIn({ onSignedIn }) {
  const { startEmailLogin, verifyEmailLogin } = useAuth();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [formError, setFormError] = useState(null);

  // Runs one step of the flow with shared busy/error handling.
  const runStep = (action) => async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await action();
    } catch (err) {
      setFormError(err.message);
    }
    setBusy(false);
  };

  const handleStart = runStep(async () => {
    setMessage(await startEmailLogin(email));
    setStep('code');
  });

  const handleVerify = runStep(async () => {
    const result = await verifyEmailLogin({ email, code });
    onSignedIn?.(result);
  });

  const restart = () => {
    setStep('email');
    setCode('');
    setMessage(null);
    setFormError(null);
  };

  return (
    <div className="email-signin">
      {step === 'email' ? (
        <form onSubmit={handleStart}>
          <label className="email-signin-label" htmlFor="email-signin-address">Sign in with email</label>
          <input
            id="email-signin-address"
            className="email-signin-input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button className="oauth-btn-inline email-btn" type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify}>
          <p className="email-signin-sent">{message}</p>
          <label className="email-signin-label" htmlFor="email-signin-code">Enter the 6-digit code</label>
          <input
            id="email-signin-code"
            className="email-signin-input email-signin-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
          />
          <button className="oauth-btn-inline email-btn" type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button type="button" className="email-signin-restart" onClick={restart}>
            Use a different email
          </button>
        </form>
      )}
      {formError && <p className="auth-error" role="alert">{formError}</p>}
    </div>
  );
}

export default EmailSignIn;
