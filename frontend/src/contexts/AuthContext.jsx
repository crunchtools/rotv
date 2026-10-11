import React, { createContext, useState, useEffect, useCallback } from 'react';
import {
  syncAnonSettings,
  readFavorites,
  addFavorite as addAnonFavorite,
  removeFavorite as removeAnonFavorite,
  readVisited,
  addVisited as addAnonVisited,
  removeVisited as removeAnonVisited,
  readListCheckins,
  putListCheckin as putAnonListCheckin,
  removeListCheckin as removeAnonListCheckin,
  readListSort,
  writeListSort,
  clearAnonSettings,
  remapMergedPoiIds
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
  const [listCheckins, setListCheckins] = useState(() => readListCheckins());
  const [listSort, setListSortState] = useState(() => readListSort() || 'trail');
  // Google is the long-standing default; Facebook only appears once the
  // backend confirms it is configured, so no one clicks into a 501.
  const [providers, setProviders] = useState({ google: true, facebook: false, password: true, passkey: true, passwordReset: false });

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
          setListCheckins(userData.listCheckins || []);
          if (userData.preferences?.listSort) setListSortState(userData.preferences.listSort);
        } else {
          setUser(null);
          setFavorites(readFavorites());
          setVisited(readVisited());
          setListCheckins(readListCheckins());
        }
      } else {
        setUser(null);
        setFavorites(readFavorites());
        setVisited(readVisited());
        setListCheckins(readListCheckins());
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
      setError(err.message);
      setUser(null);
      setFavorites(readFavorites());
      setVisited(readVisited());
      setListCheckins(readListCheckins());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Ids held on this device may name a place since merged into another.
  useEffect(() => {
    remapMergedPoiIds().then(changed => { if (changed) fetchUser(); });
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
        setListCheckins(readListCheckins());
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
    setListCheckins([]);
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

  // The link in a sign-up's confirmation email: confirms the address only
  // (never signs in), then refreshes the account if this device is signed in.
  const confirmEmail = async (token) => {
    await postAuthJson('/auth/email/verify', { token });
    await fetchUser();
  };

  // "Forgot password?": resolves to the message to show (the same whether or
  // not the address has an account).
  const requestPasswordReset = async (email) => (await postAuthJson('/auth/password/forgot', { email })).message;

  // The page behind a reset link: sets the new password and signs in.
  const resetPassword = async (token, password) => {
    const body = await postAuthJson('/auth/password/reset', { token, password });
    track('login', { provider: 'password_reset' });
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

  const sameCheckin = (a, b) => a.list_id === b.list_id && (a.item_id ?? null) === (b.item_id ?? null);

  // Log, or re-date, one check-in on a curated list (spec 050). `itemId` null
  // is the list's free choice, and `poiId` then the trail chosen. Resolves to
  // an error message, or null when it was saved. Updates build on the latest
  // state, so two hikes marked in quick succession both stay.
  // Fix: a refused or failed change reloads the account's check-ins rather than restoring a
  // snapshot, which overlapping changes to one hike could leave stale (PR #768 review)
  const saveListCheckin = useCallback(async (listId, itemId, poiId, doneOn) => {
    const checkin = { list_id: listId, item_id: itemId ?? null, poi_id: poiId ?? null, done_on: doneOn };
    setListCheckins(current => [...current.filter(c => !sameCheckin(c, checkin)), checkin]);

    if (!user) {
      putAnonListCheckin(checkin);
      return null;
    }
    try {
      const res = await fetch(`/api/lists/${listId}/checkins`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(checkin)
      });
      if (res.ok) return null;
      const problem = await res.json();
      await fetchUser();
      return problem.error || 'Could not save that. Please try again.';
    } catch (err) {
      console.warn('Could not save the check-in:', err);
      await fetchUser();
      return 'Could not save that. Please try again.';
    }
  }, [user, fetchUser]);

  const removeListCheckin = useCallback(async (listId, itemId) => {
    const gone = { list_id: listId, item_id: itemId ?? null };
    setListCheckins(current => current.filter(c => !sameCheckin(c, gone)));

    if (!user) {
      removeAnonListCheckin(listId, itemId ?? null);
      return;
    }
    try {
      const res = await fetch(`/api/lists/${listId}/checkins/${itemId ?? 'choice'}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    } catch (err) {
      console.warn('Could not remove the check-in:', err);
      await fetchUser();
    }
  }, [user, fetchUser]);

  // How curated lists are sorted (spec 050): remembered on the device, and on
  // the account when signed in. Resolves false when the account could not be
  // told; the device has it either way.
  const setListSort = useCallback(async (sort) => {
    setListSortState(sort);
    writeListSort(sort);
    if (!user) return true;
    try {
      const res = await fetch('/api/user/settings/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ listSort: sort })
      });
      return res.ok;
    } catch (err) {
      console.warn('Could not save the list sort to the account; it is kept on this device:', err);
      return false;
    }
  }, [user]);

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
    listCheckins,
    saveListCheckin,
    removeListCheckin,
    listSort,
    setListSort,
    logout,
    loginWithGoogle,
    loginWithFacebook,
    providers,
    confirmEmail,
    requestPasswordReset,
    resetPassword,
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
