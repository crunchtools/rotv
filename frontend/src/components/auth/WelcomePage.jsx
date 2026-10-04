import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { AuthShell } from './AuthShell';
import ProfileFields from './ProfileFields';
import ConsentFields from './ConsentFields';

/**
 * /welcome (spec 046): the one-time "finish creating your account" step for
 * accounts made outside the sign-up form, such as a first Google sign-in or a
 * first emailed code. Collects the same profile and consents as /signup.
 */
function WelcomePage() {
  const navigate = useNavigate();
  const { user, loading, completeSignup } = useAuth();
  const [profile, setProfile] = useState({ name: '', username: '', displayPreference: 'name' });
  const [consents, setConsents] = useState({ ageConfirmed: false, termsAccepted: false, newsletter: true });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate('/login', { replace: true });
    else if (!user.needsSignupCompletion) navigate('/', { replace: true });
    else setProfile((current) => ({ ...current, name: current.name || user.fullName || '' }));
  }, [loading, user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await completeSignup({ ...profile, ...consents });
      navigate('/');
    } catch (err) {
      setFormError(err.message);
      setBusy(false);
    }
  };

  const ready = profile.name.trim() && consents.ageConfirmed && consents.termsAccepted;

  return (
    <AuthShell title="Finish creating your account">
      <p className="auth-hint">You&apos;re signed in{user?.email ? ` as ${user.email}` : ''}. Tell us how to show you on the site.</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <ProfileFields value={profile} onChange={setProfile} idPrefix="welcome" />
        <ConsentFields value={consents} onChange={setConsents} />
        <button className="signin-confirm-btn auth-submit" type="submit" disabled={busy || !ready}>
          {busy ? 'Saving…' : 'Finish'}
        </button>
        {formError && <p className="auth-error" role="alert">{formError}</p>}
      </form>
    </AuthShell>
  );
}

export default WelcomePage;
