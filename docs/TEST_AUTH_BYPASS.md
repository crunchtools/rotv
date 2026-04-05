# Test Authentication Bypass

This document explains the environment-based authentication bypass used for testing admin functionality.

## Overview

The codebase implements a test-only authentication bypass that allows Playwright tests to access admin endpoints without requiring OAuth authentication. This bypass is **environment-scoped** and cannot be enabled in production.

## How It Works

### 1. Environment Variables

Two environment variables control the bypass:

- `NODE_ENV=test` - Identifies the test environment
- `BYPASS_AUTH=true` - Enables the auth bypass

Both must be set for the bypass to activate.

### 2. Middleware Implementation

The `backend/middleware/auth.js` file contains a `testBypass()` helper that:

1. Checks if `NODE_ENV === 'test'` AND `BYPASS_AUTH === 'true'`
2. If both are true, injects a mock user into the request:
   ```javascript
   req.user = {
     id: 999,
     email: 'test-admin@rotv.local',
     is_admin: true,
     role: 'admin'
   }
   ```
3. Returns `true` to signal bypass was applied

All auth middleware functions (`isAuthenticated`, `isAdmin`, `isMediaAdmin`, `isPoiAdmin`) check this bypass before checking actual authentication.

### 3. Test Configuration

The `backend/vitest.config.js` file automatically sets these environment variables:

```javascript
test: {
  env: {
    NODE_ENV: 'test',
    BYPASS_AUTH: 'true'
  }
}
```

This means all tests run with the bypass enabled by default.

## Security Guarantees

1. **Environment-Scoped**: Only activates when `NODE_ENV=test`
2. **Double Check**: Requires both `NODE_ENV` AND `BYPASS_AUTH` to be set
3. **No Production Risk**: Production containers never set `NODE_ENV=test`
4. **Explicit Flag**: The `BYPASS_AUTH` flag makes the bypass obvious in logs/debugging

## Usage in Tests

### Automatic (Recommended)

Just run tests normally - the bypass is enabled automatically:

```bash
./run.sh test
```

### Manual Testing

To manually test admin endpoints in a dev container:

```bash
# Start container with test bypass enabled
NODE_ENV=test BYPASS_AUTH=true npm start

# Make admin API requests (no auth required)
curl http://localhost:8080/api/admin/playwright/status
```

**Warning**: Don't use this in production or with real user data.

## Example Tests

Before bypass (old pattern):
```javascript
it('should return Playwright status', async () => {
  const response = await fetch('http://localhost:8080/api/admin/playwright/status');

  // Accept auth failures as valid
  expect([200, 401, 403]).toContain(response.status);

  // Can't test actual functionality
});
```

After bypass (new pattern):
```javascript
it('should return Playwright status', async () => {
  const response = await fetch('http://localhost:8080/api/admin/playwright/status');

  // Bypass enabled - expect success
  expect(response.status).toBe(200);

  // Test actual functionality
  const data = await response.json();
  expect(data).toHaveProperty('status');
  expect(data.status).toBe('working');
});
```

## Files Modified

- `backend/middleware/auth.js` - Added `testBypass()` helper
- `backend/vitest.config.js` - Added test environment variables
- `backend/tests/playwright.integration.test.js` - Updated to expect 200 responses
- `.env.example` - Documented test variables
- `.env.test` - Created test environment template

## Alternatives Considered

1. **Playwright session storage** - Requires maintaining session state files
2. **Test user + auto-elevation** - Requires managing test OAuth accounts
3. **Mock OAuth endpoints** - Complex, fragile

The environment-based bypass is simpler and more maintainable than these alternatives.
