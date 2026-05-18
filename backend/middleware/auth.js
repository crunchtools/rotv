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

export function isAuthenticated(req, res, next) {
  if (testBypass(req)) {
    return next();
  }
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

export function isAdmin(req, res, next) {
  if (testBypass(req, 'admin')) {
    return next();
  }
  if (req.isAuthenticated() && req.user.is_admin) {
    return next();
  }
  res.status(403).json({ error: 'Admin access required' });
}

export function isMediaAdmin(req, res, next) {
  if (testBypass(req, 'media_admin')) {
    return next();
  }
  if (req.isAuthenticated() && (req.user.role === 'media_admin' || req.user.role === 'admin')) {
    return next();
  }
  res.status(403).json({ error: 'Media admin access required' });
}

export function isPoiAdmin(req, res, next) {
  if (testBypass(req, 'poi_admin')) {
    return next();
  }
  if (req.isAuthenticated() && (req.user.role === 'poi_admin' || req.user.role === 'admin')) {
    return next();
  }
  res.status(403).json({ error: 'POI admin access required' });
}

export function optionalAuth(req, res, next) {
  testBypass(req);
  next();
}
