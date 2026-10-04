import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

const DISMISS_KEY = 'rotv-account-banner-dismissed';

function readDismissed() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch (err) {
    console.warn('sessionStorage unavailable:', err);
    return false;
  }
}

// Read once on load and drop from the address bar: ?welcome=1 after sign-up,
// ?welcome=nopasskey when the passkey step was cancelled.
function takeWelcomeParam() {
  const params = new URLSearchParams(window.location.search);
  const welcome = params.get('welcome');
  if (welcome) {
    params.delete('welcome');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }
  return welcome;
}

/**
 * The account message strip above the map (spec 046): a welcome after
 * sign-up, a reminder to confirm the email, or the one-time notice that
 * sign-in methods added before confirmation were removed.
 */
function AccountBanner() {
  const { user, resendConfirmation } = useAuth();
  const [welcome] = useState(takeWelcomeParam);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [sendStatus, setSendStatus] = useState(null);

  if (!user || dismissed) return null;

  const messages = [];
  if (welcome) {
    messages.push(welcome === 'nopasskey'
      ? 'Welcome! Your account is ready, but the passkey wasn’t saved. You can add one in Settings.'
      : 'Welcome to Roots of the Valley! Your account is ready.');
  }
  if (user.notice === 'credentials_reset') {
    messages.push('We removed a password or passkey that was added to this account before its email was confirmed. Set a new one in Settings if you like.');
  }
  const unconfirmed = !user.emailVerified;
  if (unconfirmed) {
    messages.push(`Confirm your email (${user.email}) so we can send you updates. Check your inbox for our message.`);
  }
  if (!messages.length) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch (err) {
      console.warn('sessionStorage unavailable:', err);
    }
  };

  const resend = async () => {
    try {
      setSendStatus(await resendConfirmation());
    } catch (err) {
      setSendStatus(err.message);
    }
  };

  return (
    <div className="account-banner" role="status">
      <div className="account-banner-text">
        {messages.map((text) => <p key={text}>{text}</p>)}
        {sendStatus && <p>{sendStatus}</p>}
      </div>
      {unconfirmed && !sendStatus && (
        <button className="auth-link-btn" onClick={resend}>Resend</button>
      )}
      <button className="account-banner-close" onClick={dismiss} aria-label="Dismiss">×</button>
    </div>
  );
}

export default AccountBanner;
