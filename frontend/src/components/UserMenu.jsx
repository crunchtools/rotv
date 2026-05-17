import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

function UserMenu() {
  const { user, isAdmin, logout } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const [imageError, setImageError] = useState(false);

  if (!user) return null;

  const showPlaceholder = !user.pictureUrl || imageError;

  return (
    <div className="user-menu-container">
      <button
        className="user-menu-btn"
        onClick={() => setShowDropdown(!showDropdown)}
      >
        {!showPlaceholder ? (
          <img
            src={user.pictureUrl}
            alt={user.name}
            className="user-avatar"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="user-avatar-placeholder">
            {user.name?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        <span className="user-name">{user.name}</span>
        {isAdmin && <span className="admin-badge">Admin</span>}
      </button>
      {showDropdown && (
        <div className="user-dropdown">
          <div className="user-info">
            <span className="user-email">{user.email}</span>
          </div>
          {isAdmin && (
            <p className="dropdown-hint">Admin tools available in map legend</p>
          )}
          <button
            className="dropdown-item logout-item"
            onClick={() => {
              setShowDropdown(false);
              logout();
            }}
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
