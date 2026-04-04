import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';

const VALID_ROLES = ['viewer', 'poi_admin', 'media_admin', 'admin'];

const ROLE_LABELS = {
  viewer: 'Viewer',
  poi_admin: 'POI Admin',
  media_admin: 'Media Admin',
  admin: 'Admin'
};

function UsersSettings() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [result, setResult] = useState(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (result) {
      const timer = setTimeout(() => setResult(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [result]);

  const handleRoleChange = async (userId, newRole) => {
    setSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: newRole })
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole, isAdmin: newRole === 'admin' } : u));
        setResult({ type: 'success', message: `Role updated to ${ROLE_LABELS[newRole]}` });
      } else {
        const err = await res.json();
        setResult({ type: 'error', message: err.error || 'Failed to update role' });
      }
    } catch (err) {
      setResult({ type: 'error', message: 'Failed to update role: ' + err.message });
    } finally {
      setSavingId(null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  };

  if (loading) {
    return <div className="data-collection-settings"><p>Loading users...</p></div>;
  }

  return (
    <div className="data-collection-settings">
      <h3>User Management</h3>
      <p className="settings-description" style={{ marginBottom: '16px' }}>
        Manage user roles. Roles control access levels but currently use the existing admin middleware.
      </p>

      {result && (
        <div style={{
          padding: '8px 12px', marginBottom: '12px', borderRadius: '4px',
          backgroundColor: result.type === 'success' ? '#e8f5e9' : '#ffebee',
          color: result.type === 'success' ? '#2e7d32' : '#c62828',
          fontSize: '0.9rem'
        }}>
          {result.message}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px' }}>User</th>
              <th style={{ padding: '8px 12px' }}>Provider</th>
              <th style={{ padding: '8px 12px' }}>Role</th>
              <th style={{ padding: '8px 12px' }}>Last Login</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const isSelf = u.id === user?.id;
              return (
                <tr key={u.id} style={{ borderBottom: '1px solid #e0e0e0' }}>
                  <td style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {u.pictureUrl && (
                      <img
                        src={u.pictureUrl}
                        alt=""
                        style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div>
                      <div style={{ fontWeight: 500 }}>{u.name || 'Unknown'}{isSelf ? ' (you)' : ''}</div>
                      <div style={{ fontSize: '0.8rem', color: '#666' }}>{u.email}</div>
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px', textTransform: 'capitalize' }}>{u.oauthProvider}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      disabled={isSelf || savingId === u.id}
                      style={{
                        padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc',
                        opacity: isSelf ? 0.6 : 1, cursor: isSelf ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {VALID_ROLES.map(r => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                    {savingId === u.id && <span style={{ marginLeft: '6px', fontSize: '0.8rem' }}>Saving...</span>}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#666' }}>{formatDate(u.lastLoginAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {users.length === 0 && <p style={{ color: '#666', fontStyle: 'italic' }}>No users found.</p>}
    </div>
  );
}

export default UsersSettings;
