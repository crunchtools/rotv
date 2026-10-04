import React from 'react';
import { useNavigate } from 'react-router-dom';
import BackButton from '../BackButton';
import { useAuth } from '../../hooks/useAuth';

/** Page frame shared by /signup, /login and /welcome. */
export function AuthShell({ title, children, footer }) {
  const navigate = useNavigate();
  return (
    <div className="privacy-policy-page auth-page">
      <div className="privacy-policy-content auth-card">
        <BackButton onClick={() => navigate('/')} />
        <h1>{title}</h1>
        {children}
        {footer && <p className="auth-footer">{footer}</p>}
      </div>
    </div>
  );
}

/** The two first choices on /signup and /login: Google or email. */
export function ProviderChoice({ onEmail, emailLabel }) {
  const { providers, loginWithGoogle } = useAuth();
  return (
    <div className="auth-choices">
      {providers.google && (
        <button type="button" className="auth-choice google-choice" onClick={loginWithGoogle}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>
      )}
      <button type="button" className="auth-choice email-choice" onClick={onEmail}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
        </svg>
        {emailLabel}
      </button>
    </div>
  );
}

/** Internal link that navigates without a full page load. */
export function AuthLink({ to, children }) {
  const navigate = useNavigate();
  return (
    <a href={to} onClick={(e) => { e.preventDefault(); navigate(to); }}>{children}</a>
  );
}
