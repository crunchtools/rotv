import React, { createContext, useState, useEffect, useCallback } from 'react';
import {
  syncAnonSettings,
  readFavorites,
  addFavorite as addAnonFavorite,
  removeFavorite as removeAnonFavorite,
  readVisited,
  addVisited as addAnonVisited,
  removeVisited as removeAnonVisited,
  clearAnonSettings
} from '../utils/anonSettings';
import { track } from '../utils/analytics';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

// A default label for a new passkey, so the list in Settings is readable.
function defaultPasskeyName() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad/.test(ua)) return 'iPhone or iPad';
  if (/Android/.test(ua)) return 'Android device';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'Passkey';
}

export const AuthContext = createContext(null);

// Module-level so its identity is stable for effects that depend on it.
async function checkUsername(username) {
  const res = await fetch(`/auth/username-available?username=${encodeURIComponent(username)}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Could not check that username.');
  return res.json();
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [favorites, setFavorites] = useState(() => readFavorites());
  const [visited, setVisited] = useState(() => readVisited());
  // Google is the long-standing default; Facebook only appears once the
  // backend confirms it is configured, so no one clicks into a 501.
  const [providers, setProviders] = useState({ google: true, facebook: false, email: false, password: true, passkey: true });

  useEffect(() => {
    fetch('/auth/providers')
      .then(res => (res.ok ? res.json() : null))
      .then(configured => { if (configured) setProviders(configured); })
      .catch(err => console.warn('Failed to load sign-in providers:', err));
  }, []);

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch('/auth/user', {
        credentials: 'include'
      });
      if (response.ok) {
        const userData = await response.json();
        if (userData) {
          // `name` is what the header shows (username or name, per the
          // person's choice); `fullName` is the name they entered.
          setUser({
            ...userData,
            fullName: userData.name || '',
            name: userData.displayName || userData.name || userData.email?.split('@')[0] || null
          });
          setFavorites(userData.favorites || []);
          setVisited(userData.visited || []);
        } else {
          setUser(null);
          setFavorites(readFavorites());
          setVisited(readVisited());
        }
      } else {
        setUser(null);
        setFavorites(readFavorites());
        setVisited(readVisited());
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
      setError(err.message);
      setUser(null);
      setFavorites(readFavorites());
      setVisited(readVisited());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get('auth');
    if (authStatus === 'success') {
      fetchUser().then(() => syncAnonSettings()).then(() => fetchUser());
      window.history.replaceState({}, '', window.location.pathname);
    } else if (authStatus === 'failed') {
      setError('Authentication failed. Please try again.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchUser]);

  const logout = async () => {
    try {
      const response = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      if (response.ok) {
        setUser(null);
        setFavorites(readFavorites());
        setVisited(readVisited());
      }
    } catch (err) {
      console.error('Logout failed:', err);
      setError(err.message);
    }
  };

  const deleteAccount = async () => {
    const response = await fetch('/auth/account', {
      method: 'DELETE',
      credentials: 'include'
    });
    const body = await response.json().catch((parseErr) => {
      console.warn('Account deletion returned a non-JSON response:', parseErr);
      return {};
    });
    if (!response.ok) {
      throw new Error(body.error || 'Account deletion failed');
    }
    track('account_deleted');
    clearAnonSettings();
    setUser(null);
    setFavorites([]);
    setVisited([]);
  };

  // Shared by the account calls: send JSON, throw the server's message on failure.
  const sendAuthJson = async (method, url, payload) => {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    const body = await response.json().catch((parseErr) => {
      console.warn(`${url} returned a non-JSON response:`, parseErr);
      return {};
    });
    if (!response.ok) {
      const err = new Error(body.error || 'Something went wrong. Please try again.');
      err.reauth = Boolean(body.reauth);
      throw err;
    }
    return body;
  };
  const postAuthJson = (url, payload) => sendAuthJson('POST', url, payload);

  // After any successful sign-in: load the account, then merge favorites and
  // visits saved while signed out.
  const finishSignIn = async () => {
    await fetchUser();
    await syncAnonSettings();
    await fetchUser();
  };

  const startEmailLogin = async (email) => {
    const body = await postAuthJson('/auth/email/start', { email });
    track('login', { provider: 'email' });
    return body.message;
  };

  // Accepts { token } from the emailed link or { email, code } from the code box.
  // Resolves to { confirmed, needsSignupCompletion }.
  const verifyEmailLogin = async (credentials) => {
    const body = await postAuthJson('/auth/email/verify', credentials);
    await finishSignIn();
    return body;
  };

  const registerPasskey = async (name = defaultPasskeyName()) => {
    const optionsJSON = await postAuthJson('/auth/passkey/register/options');
    const response = await startRegistration({ optionsJSON });
    const body = await postAuthJson('/auth/passkey/register/verify', { response, name });
    track('passkey_added');
    return body.passkey;
  };

  // form: { name, username, displayPreference, email, method, password,
  // ageConfirmed, termsAccepted, newsletter }. A passkey sign-up creates the
  // account first, then the passkey. If the passkey step is cancelled the
  // person is still signed in and can add one in Settings, so that resolves
  // with passkeySaved: false (and the banner says so) rather than throwing.
  const signUp = async (form) => {
    await postAuthJson('/auth/signup', form);
    track('sign_up', { method: form.method });
    const passkeySaved = form.method !== 'passkey' || await registerPasskey().then(() => true, (err) => {
      console.warn('Passkey setup after sign-up did not finish:', err);
      return false;
    });
    await finishSignIn();
    return { passkeySaved };
  };

  const loginWithPassword = async (email, password) => {
    await postAuthJson('/auth/password/login', { email, password });
    track('login', { provider: 'password' });
    await finishSignIn();
  };

  // autofill: offer saved passkeys in the email field's autofill list
  // (conditional UI) instead of opening the passkey dialog right away.
  const loginWithPasskey = async ({ autofill = false } = {}) => {
    const optionsJSON = await postAuthJson('/auth/passkey/login/options');
    const response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill });
    await postAuthJson('/auth/passkey/login/verify', { response });
    track('login', { provider: 'passkey' });
    await finishSignIn();
  };

  const signInMethods = () => sendAuthJson('GET', '/auth/methods');
  const setPassword = (password) => sendAuthJson('PUT', '/auth/password', { password });
  const removePassword = () => sendAuthJson('DELETE', '/auth/password');
  const renamePasskey = (id, name) => sendAuthJson('PATCH', `/auth/passkeys/${id}`, { name });
  const removePasskey = (id) => sendAuthJson('DELETE', `/auth/passkeys/${id}`);
  const resendConfirmation = async () => (await postAuthJson('/auth/confirm-email/resend')).message;

  const updateProfile = async (profile) => {
    await sendAuthJson('PUT', '/auth/profile', profile);
    await fetchUser();
  };

  const completeSignup = async (details) => {
    await postAuthJson('/auth/complete-signup', details);
    await fetchUser();
  };

  const loginWithGoogle = () => {
    track('login', { provider: 'google' });
    window.location.href = '/auth/google';
  };

  const loginWithFacebook = () => {
    track('login', { provider: 'facebook' });
    window.location.href = '/auth/facebook';
  };

  const isFavorited = useCallback(
    (poiId) => favorites.includes(poiId),
    [favorites]
  );

  const toggleFavorite = useCallback(async (poiId) => {
    const wasFavorited = favorites.includes(poiId);
    const next = wasFavorited
      ? favorites.filter(id => id !== poiId)
      : [...favorites, poiId];
    setFavorites(next);

    if (user) {
      try {
        const res = await fetch(`/api/favorites/${poiId}`, {
          method: wasFavorited ? 'DELETE' : 'POST',
          credentials: 'include'
        });
        if (!res.ok) throw new Error('Request failed');
      } catch (err) {
        setFavorites(favorites);
      }
    } else if (wasFavorited) {
      removeAnonFavorite(poiId);
    } else {
      addAnonFavorite(poiId);
    }
    return !wasFavorited;
  }, [favorites, user]);

  const isVisited = useCallback(
    (poiId) => visited.includes(poiId),
    [visited]
  );

  const toggleVisited = useCallback(async (poiId) => {
    const wasVisited = visited.includes(poiId);
    const next = wasVisited
      ? visited.filter(id => id !== poiId)
      : [...visited, poiId];
    setVisited(next);

    if (user) {
      try {
        const res = await fetch(`/api/visited/${poiId}`, {
          method: wasVisited ? 'DELETE' : 'POST',
          credentials: 'include'
        });
        if (!res.ok) throw new Error('Request failed');
      } catch (err) {
        setVisited(visited);
      }
    } else if (wasVisited) {
      removeAnonVisited(poiId);
    } else {
      addAnonVisited(poiId);
    }
    return !wasVisited;
  }, [visited, user]);

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    isAdmin: user?.isAdmin || false,
    role: user?.role || 'viewer',
    favorites,
    isFavorited,
    toggleFavorite,
    visited,
    isVisited,
    toggleVisited,
    logout,
    loginWithGoogle,
    loginWithFacebook,
    providers,
    startEmailLogin,
    verifyEmailLogin,
    signUp,
    loginWithPassword,
    loginWithPasskey,
    registerPasskey,
    signInMethods,
    setPassword,
    removePassword,
    renamePasskey,
    removePasskey,
    resendConfirmation,
    updateProfile,
    completeSignup,
    checkUsername,
    deleteAccount,
    refreshUser: fetchUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
