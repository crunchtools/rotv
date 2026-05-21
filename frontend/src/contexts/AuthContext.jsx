import React, { createContext, useState, useEffect, useCallback } from 'react';
import {
  syncAnonSettings,
  readFavorites,
  addFavorite as addAnonFavorite,
  removeFavorite as removeAnonFavorite
} from '../utils/anonSettings';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [favorites, setFavorites] = useState(() => readFavorites());

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch('/auth/user', {
        credentials: 'include'
      });
      if (response.ok) {
        const userData = await response.json();
        if (userData) {
          setUser(userData);
          setFavorites(userData.favorites || []);
        } else {
          setUser(null);
          setFavorites(readFavorites());
        }
      } else {
        setUser(null);
        setFavorites(readFavorites());
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
      setError(err.message);
      setUser(null);
      setFavorites(readFavorites());
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
      }
    } catch (err) {
      console.error('Logout failed:', err);
      setError(err.message);
    }
  };

  const loginWithGoogle = () => {
    window.location.href = '/auth/google';
  };

  const loginWithFacebook = () => {
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
    logout,
    loginWithGoogle,
    loginWithFacebook,
    refreshUser: fetchUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
