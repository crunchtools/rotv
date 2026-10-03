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

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [favorites, setFavorites] = useState(() => readFavorites());
  const [visited, setVisited] = useState(() => readVisited());
  // Google is the long-standing default; Facebook only appears once the
  // backend confirms it is configured, so no one clicks into a 501.
  const [providers, setProviders] = useState({ google: true, facebook: false, email: false });

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
          // Email sign-ins arrive without a name; show the address's local part.
          setUser({ ...userData, name: userData.name || userData.email?.split('@')[0] || null });
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

  // Shared by both email sign-in calls: POST JSON, throw the server's message on failure.
  const postAuthJson = async (url, payload) => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch((parseErr) => {
      console.warn(`${url} returned a non-JSON response:`, parseErr);
      return {};
    });
    if (!response.ok) {
      throw new Error(body.error || 'Something went wrong. Please try again.');
    }
    return body;
  };

  const startEmailLogin = async (email) => {
    const body = await postAuthJson('/auth/email/start', { email });
    track('login', { provider: 'email' });
    return body.message;
  };

  // Accepts { token } from the emailed link or { email, code } from the code box.
  const verifyEmailLogin = async (credentials) => {
    await postAuthJson('/auth/email/verify', credentials);
    await fetchUser();
    await syncAnonSettings();
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
    deleteAccount,
    refreshUser: fetchUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
