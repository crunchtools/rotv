// Authentication middleware

/**
 * Test bypass helper - injects a mock user in test environment
 * @param {Object} req - Express request object
 * @param {string} role - Role to assign to test user ('admin', 'media_admin', 'poi_admin')
 * @returns {boolean} - True if bypass was applied, false otherwise
 */
function testBypass(req, role = 'admin') {
  if (process.env.NODE_ENV === 'test' && process.env.BYPASS_AUTH === 'true') {
    req.user = {
      id: 999,
      email: 'test-admin@rotv.local',
      is_admin: role === 'admin',
      role: role
    };
    return true;
  }
  return false;
}

// Require user to be logged in
export function isAuthenticated(req, res, next) {
  if (testBypass(req)) {
    return next();
  }
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

// Require user to be an admin (legacy - checks is_admin flag)
export function isAdmin(req, res, next) {
  if (testBypass(req, 'admin')) {
    return next();
  }
  if (req.isAuthenticated() && req.user.is_admin) {
    return next();
  }
  res.status(403).json({ error: 'Admin access required' });
}

// Require user to be media_admin or admin
export function isMediaAdmin(req, res, next) {
  if (testBypass(req, 'media_admin')) {
    return next();
  }
  if (req.isAuthenticated() && (req.user.role === 'media_admin' || req.user.role === 'admin')) {
    return next();
  }
  res.status(403).json({ error: 'Media admin access required' });
}

// Require user to be poi_admin or admin
export function isPoiAdmin(req, res, next) {
  if (testBypass(req, 'poi_admin')) {
    return next();
  }
  if (req.isAuthenticated() && (req.user.role === 'poi_admin' || req.user.role === 'admin')) {
    return next();
  }
  res.status(403).json({ error: 'POI admin access required' });
}

// Optional authentication - doesn't fail if not logged in
export function optionalAuth(req, res, next) {
  // Apply test bypass if enabled
  testBypass(req);
  // Just continue - passport already attached user if authenticated
  next();
}
