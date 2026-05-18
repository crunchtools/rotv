import React, { createContext, useState, useEffect, useCallback } from 'react';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch('/auth/user', {
        credentials: 'include'
      });
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
      setError(err.message);
      setUser(null);
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
      fetchUser();
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

  const updateFavorites = (favorites) => {
    if (user) {
      setUser({ ...user, favorites });
    }
  };

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    isAdmin: user?.isAdmin || false,
    role: user?.role || 'viewer',
    logout,
    loginWithGoogle,
    loginWithFacebook,
    updateFavorites,
    refreshUser: fetchUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
