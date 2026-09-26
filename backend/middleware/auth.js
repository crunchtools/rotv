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

function requireUser(allows, status, error) {
  return (req, res, next) => {
    if (testBypass(req, 'admin') || (req.isAuthenticated() && allows(req.user))) {
      return next();
    }
    res.status(status).json({ error });
  };
}

export const isAuthenticated = requireUser(() => true, 401, 'Authentication required');

export const isAdmin = requireUser(user => user.is_admin, 403, 'Admin access required');

export function optionalAuth(req, res, next) {
  testBypass(req);
  next();
}
