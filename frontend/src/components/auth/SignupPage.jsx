import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { useAuth } from '../../hooks/useAuth';
import { AuthShell, ProviderChoice, AuthLink } from './AuthShell';
import ProfileFields from './ProfileFields';
import ConsentFields from './ConsentFields';

const PASSWORD_MIN = 12;

/**
 * /signup (spec 046): choose Google or email first. Email sign-up asks for a
 * name, optional username, how to appear, the address, and a password or a
 * passkey. The account works right away; a confirmation email follows.
 */
function SignupPage() {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [useEmail, setUseEmail] = useState(false);
  const [profile, setProfile] = useState({ name: '', username: '', displayPreference: 'name' });
  const [email, setEmail] = useState('');
  const [method, setMethod] = useState('password');
  const [password, setPassword] = useState('');
  const [consents, setConsents] = useState({ ageConfirmed: false, termsAccepted: false, newsletter: true });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const passkeysSupported = browserSupportsWebAuthn();

  const ready = profile.name.trim() && email.trim() && consents.ageConfirmed && consents.termsAccepted &&
    (method === 'passkey' || password.length >= PASSWORD_MIN);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await signUp({
        ...profile,
        email,
        method,
        password: method === 'password' ? password : undefined,
        ...consents
      });
      navigate('/');
    } catch (err) {
      setFormError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      footer={<>Already have an account? <AuthLink to="/login">Sign in</AuthLink></>}
    >
      {!useEmail ? (
        <ProviderChoice onEmail={() => setUseEmail(true)} emailLabel="Sign up with email" />
      ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <ProfileFields value={profile} onChange={setProfile} idPrefix="signup" />

          <fieldset className="auth-fieldset">
            <label className="auth-label" htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            {method === 'password' ? (
              <>
                <label className="auth-label" htmlFor="signup-password">Password</label>
                <input
                  id="signup-password"
                  className="auth-input"
                  type="password"
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p className="auth-hint">
                  At least {PASSWORD_MIN} characters
                  {passkeysSupported && (
                    <> or <button type="button" className="auth-inline-link" onClick={() => setMethod('passkey')}>use passkey instead</button></>
                  )}.
                </p>
              </>
            ) : (
              <p className="auth-passkey-note">
                You&apos;ll create a passkey with your fingerprint, face, or screen lock, or{' '}
                <button type="button" className="auth-inline-link" onClick={() => setMethod('password')}>use a password instead</button>.
              </p>
            )}
          </fieldset>

          <ConsentFields value={consents} onChange={setConsents} />

          <button className="signin-confirm-btn auth-submit" type="submit" disabled={busy || !ready}>
            {busy ? 'Creating your account…' : 'Create account'}
          </button>
          {formError && <p className="auth-error" role="alert">{formError}</p>}
          <button type="button" className="auth-link-btn" onClick={() => setUseEmail(false)}>
            Other ways to sign up
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default SignupPage;
