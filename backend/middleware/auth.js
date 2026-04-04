// Authentication middleware

// Require user to be logged in
export function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

// Require user to be an admin (legacy - checks is_admin flag)
export function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.is_admin) {
    return next();
  }
  res.status(403).json({ error: 'Admin access required' });
}

// Require user to have 'admin' role
export function hasAdminRole(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Admin access required' });
}

// Require user to be media_admin or admin
export function isMediaAdmin(req, res, next) {
  if (req.isAuthenticated() && (req.user.role === 'media_admin' || req.user.role === 'admin')) {
    return next();
  }
  res.status(403).json({ error: 'Media admin access required' });
}

// Require user to be poi_admin or admin
export function isPoiAdmin(req, res, next) {
  if (req.isAuthenticated() && (req.user.role === 'poi_admin' || req.user.role === 'admin')) {
    return next();
  }
  res.status(403).json({ error: 'POI admin access required' });
}

// Optional authentication - doesn't fail if not logged in
export function optionalAuth(req, res, next) {
  // Just continue - passport already attached user if authenticated
  next();
}
