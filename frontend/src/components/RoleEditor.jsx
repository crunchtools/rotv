import React from 'react';

const VALID_ROLES = [
  { id: 'point', label: 'Point', description: 'A location on the map' },
  { id: 'trail', label: 'Trail', description: 'A hiking/biking trail' },
  { id: 'boundary', label: 'Boundary', description: 'A geographic boundary' },
  { id: 'river', label: 'River', description: 'A river or waterway' },
  { id: 'organization', label: 'Organization', description: 'A virtual/organizational POI' },
  { id: 'mtb_trail', label: 'MTB Trail', description: 'An MTB trailhead with status tracking' }
];

function RoleEditor({ roles = [], onChange }) {
  const roleSet = new Set(roles);

  const toggleRole = (roleId) => {
    const updated = new Set(roleSet);
    if (updated.has(roleId)) {
      if (updated.size <= 1) return;
      updated.delete(roleId);
    } else {
      updated.add(roleId);
    }
    onChange(Array.from(updated));
  };

  return (
    <div className="role-editor">
      <label>Roles</label>
      <div className="role-chips">
        {VALID_ROLES.map(role => (
          <button
            key={role.id}
            type="button"
            className={`role-chip ${roleSet.has(role.id) ? 'active' : ''}`}
            onClick={() => toggleRole(role.id)}
            title={role.description}
          >
            {role.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default RoleEditor;
