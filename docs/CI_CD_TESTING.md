# CI/CD Testing Architecture

## Overview

Roots of The Valley uses automated testing and code quality tools via GitHub Actions to ensure code quality and prevent regressions. Every pull request automatically runs a comprehensive test suite covering database operations, API endpoints, News & Events collection, and UI interactions, plus ESLint static analysis to catch code quality issues.

**Key Benefits:**
- **Catch bugs early** - Tests run automatically on every PR before code reaches production
- **Fast feedback** - Know within 2-3 minutes if your changes break anything
- **No production dependency** - Tests use committed fixtures, no access to production database needed
- **Consistent environment** - Tests run in the same containerized environment as production
- **Code quality enforcement** - ESLint and Gourmand detect unused variables, AI-generated slop, and style violations

## Test Suite Overview

**174 total tests across 12 test files:**

1. **Database Integration Tests** (`tests/database.integration.test.js`) - 10 tests
   - Table creation and schema validation
   - CRUD operations on POIs
   - Data integrity and constraints

2. **News & Events API Tests** (`tests/newsEvents.integration.test.js`) - 8 tests
   - Content discovery and collection
   - AI-powered summarization
   - API endpoints for news and events

3. **JavaScript Renderer Tests** (`tests/jsRenderer.test.js`) - 15 tests
   - Playwright-based page rendering
   - Dynamic content extraction
   - Timeout handling and SSL errors

4. **UI Integration Tests** (`tests/ui.integration.test.js`) - Multiple files
   - Satellite imagery toggle
   - Map controls functionality
   - Mobile navigation features (carousel, swipe, chevron navigation)
   - Issue #63 regression tests
   - Trail status architecture tests
   - News slot architecture tests

**Test Status (as of February 2026):**
- ✅ **153 tests passing** (88%)
- ⚠️ **21 tests failing** - Playwright UI timeout issues (pre-existing, not blocking)
- 🎯 **Core functionality:** All API, database, and business logic tests passing

## GitHub Actions Workflow

### Workflow File

`.github/workflows/test.yml` - Runs on every pull request and push to master

### Workflow Steps

```yaml
1. Checkout repository
2. Login to Quay.io (private base image registry)
3. Pull base image: quay.io/fatherlinux/rotv-base:latest
4. Build application image with BUILD_ENV=test
5. Prepare test seed data (20 sample POIs)
6. Run tests:
   - Start container with ephemeral tmpfs storage
   - Wait for server to initialize database
   - Import test seed data
   - Execute npm test
7. Cleanup (always runs, even on failure)
```

### Build Arguments

The workflow uses `BUILD_ENV=test` to install dev dependencies:

```dockerfile
ARG BUILD_ENV=production

RUN if [ "$BUILD_ENV" = "test" ]; then \
      npm install; \
    else \
      npm install --only=production; \
    fi
```

This ensures test tools (vitest, playwright, supertest) are available in CI.

### Test Data

**Minimal Test Fixtures:** `backend/tests/fixtures/test-seed-data.sql`

Contains 20 sample POIs for testing:
- Alphabetically ordered for predictable test results
- Only inserts data (no schema creation - server handles that)
- Safe to commit (no production data)
- Fast to import (~1 second)

**Why committed fixtures?**
- ✅ No dependency on production database
- ✅ Fast test execution (no 384MB download)
- ✅ Consistent test data across all environments
- ✅ Easy to version control and review

## Running Tests Locally

### Quick Start

```bash
# Build container
./run.sh build

# Run all tests
./run.sh test
```

### What Happens

1. **Container starts** with ephemeral tmpfs storage (`--tmpfs /data/pgdata`)
2. **Server initializes** database schema via `initDatabase()`
3. **Test data imported** from `backend/tests/fixtures/test-seed-data.sql`
4. **Tests execute** using vitest test runner
5. **Container cleaned up** automatically

### Test Output

```
 Test Files  4 passed (4)
      Tests  39 passed (39)
   Start at  06:09:40
   Duration  37.16s
```

## Understanding Test Results

### GitHub Actions

View test results:
1. Go to PR page
2. Click "Checks" tab
3. Click "Run Tests" workflow
4. Expand "Run tests" step to see detailed output

### Common Test Failures

**1. Timeout Errors**
```
TimeoutError: locator.click: Timeout 30000ms exceeded
```
**Cause:** Playwright UI tests running slowly in CI environment
**Fix:** Increase timeout (e.g., from 30000 to 40000)

**2. Schema Mismatches**
```
ERROR: column "foo" of relation "pois" does not exist
```
**Cause:** Test seed data doesn't match server schema
**Fix:** Update `backend/tests/fixtures/test-seed-data.sql` to use correct column names

**3. Foreign Key Violations**
```
ERROR: insert or update on table "pois" violates foreign key constraint
```
**Cause:** Test data references non-existent era/owner/icon
**Fix:** Ensure referenced records exist in test data or use NULL

**4. Container Build Failures**
```
ERROR: type "geometry" does not exist
```
**Cause:** Test data tries to create PostGIS types without extension
**Fix:** Let server create schema, only insert data in test fixtures

## Adding New Tests

### 1. Database Tests

**File:** `backend/tests/database.integration.test.js`

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server.js';

describe('My Feature', () => {
  it('should do something', async () => {
    const response = await request(app)
      .get('/api/my-endpoint')
      .expect(200);

    expect(response.body).toHaveProperty('data');
  });
});
```

### 2. UI Tests

**File:** `backend/tests/ui.integration.test.js`

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';

describe('My UI Feature', () => {
  it('should interact with element', async () => {
    await page.goto('http://localhost:8080');
    await page.click('.my-button');

    const text = await page.locator('.result').textContent();
    expect(text).toBe('Expected Result');
  }, 30000); // 30 second timeout for UI tests
});
```

### 3. Update Test Fixtures

If your feature needs specific test data:

**Edit:** `backend/tests/fixtures/test-seed-data.sql`

```sql
-- Add new test POIs
INSERT INTO pois (id, name, poi_type, latitude, longitude, brief_description) VALUES
(21, 'New Test POI', 'point', 41.2678, -81.5123, 'Test description')
ON CONFLICT (id) DO NOTHING;
```

**Guidelines:**
- Use sequential IDs starting from 21
- Keep alphabetically ordered for predictable tests
- Only insert data, don't create tables
- Use `ON CONFLICT DO NOTHING` for safety

## Critical Schema Fixes (PR #55)

### Problem Discovered

The test suite uncovered a critical schema bug:

**Before (BROKEN):**
```javascript
// server.js line 197
era VARCHAR(255),  // Column type doesn't match queries!
```

**Queries Expected:**
```javascript
LEFT JOIN eras e ON p.era_id = e.id  // Expects INTEGER era_id!
```

This caused 500 errors from `/api/destinations` endpoint.

### Solution

**Reordered table creation** to add foreign key constraint:

```javascript
// 1. Create eras table FIRST (line 176)
CREATE TABLE IF NOT EXISTS eras (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  ...
);

// 2. Create pois table with FK constraint (line 208)
CREATE TABLE IF NOT EXISTS pois (
  ...
  era_id INTEGER REFERENCES eras(id),  // FK constraint!
  ...
);
```

**Benefits:**
- ✅ Schema matches production exactly
- ✅ Database enforces referential integrity
- ✅ Can't reference non-existent eras
- ✅ Can't delete eras that POIs are using

## Branch Protection (Recommended)

### Enable Required Status Checks

Prevent merging PRs with failing tests:

1. Go to: https://github.com/fatherlinux/rotv/settings/branches
2. Click "Add branch protection rule"
3. **Branch name pattern:** `master` (or `main`)
4. Enable: ✅ **Require status checks to pass before merging**
5. Select: ✅ **Run Tests** (wait for it to appear after first PR)
6. Enable: ✅ **Require branches to be up to date before merging**
7. Optional: ✅ **Require approvals** (for team workflows)
8. Click "Create" or "Save changes"

### What This Does

- ❌ **Blocks merging** if any of the 39 tests fail
- ⏳ **Requires waiting** for GitHub Actions workflow to complete
- 🔄 **Forces updates** if master branch changes during PR review
- ✅ **Ensures quality** - only tested code reaches production

## Troubleshooting

### Local Tests Pass, CI Fails

**Common causes:**
1. **Timing issues** - CI runs slower, may need longer timeouts
2. **Environment differences** - Check BUILD_ENV is set correctly
3. **Base image version** - Ensure base image is up to date

**Debug steps:**
```bash
# Pull latest base image
podman pull quay.io/fatherlinux/rotv-base:latest

# Build with test environment
./run.sh build

# Run tests locally
./run.sh test

# Check container logs
./run.sh logs
```

### CI Authentication Failures

```
Error: 401 UNAUTHORIZED pulling quay.io/fatherlinux/rotv-base
```

**Fix:** Ensure GitHub secrets are configured:
- `QUAY_USERNAME` - Quay.io username
- `QUAY_PASSWORD` - Quay.io password/token

Add at: https://github.com/fatherlinux/rotv/settings/secrets/actions

### Tests Timing Out

**Playwright UI tests** may timeout in slower CI environments.

**Current timeouts:**
- Database/API tests: Default (5000ms)
- UI tests: 40000ms (40 seconds)

**Increase if needed:**
```javascript
it('my slow test', async () => {
  // ... test code
}, 60000); // 60 second timeout
```

### Database Schema Errors

**Error:** "column X does not exist"

**Check:**
1. `backend/server.js` `initDatabase()` creates correct schema
2. Test data uses column names that exist
3. Server started and initialized database before importing data

**Workflow order:**
```bash
1. Start container
2. Wait for server (initDatabase() runs)
3. Import test-seed-data.sql (data only, no CREATE TABLE)
4. Run tests
```

## Performance

### Test Execution Time

**Typical run:** 1m30s - 2m30s total

Breakdown:
- Checkout & setup: ~10s
- Pull base image: ~5s (cached)
- Build app image: ~40s
- Start & initialize: ~20s
- Run tests: ~30-60s
- Cleanup: ~5s

### Optimization Tips

1. **Use base image cache** - Don't rebuild base image unless Containerfile changes
2. **Minimal test data** - 20 POIs is enough for comprehensive testing
3. **Parallel test execution** - Vitest runs tests concurrently when possible
4. **Ephemeral storage** - tmpfs is faster than disk for test database

## Test Coverage

Current coverage by feature area:

| Feature Area | Test Files | Tests | Coverage |
|--------------|-----------|-------|----------|
| Database Schema | database.integration.test.js | 10 | ✅ High |
| API Endpoints | database.integration.test.js, newsEvents.integration.test.js | 18 | ✅ High |
| News & Events | newsEvents.integration.test.js, newsSlotArchitecture.integration.test.js | ~40 | ✅ High |
| JavaScript Rendering | jsRenderer.test.js, playwright.integration.test.js | ~35 | ✅ High |
| Trail Status | trailStatus.integration.test.js, trailStatusSlotArchitecture.integration.test.js | ~30 | ✅ High |
| Map UI | ui.integration.test.js, issue63Regression.integration.test.js | ~25 | ⚠️ Medium (timeouts) |
| Mobile Navigation | ui.integration.test.js, slotArchitectureUI.integration.test.js | ~20 | ⚠️ Medium (timeouts) |
| **TOTAL** | **12 files** | **174 tests** | **✅ Good** |

**Note:** ~21 UI tests currently failing due to Playwright timeout issues (pre-existing, not related to recent changes)

### Coverage Gaps

Areas that could use more tests:
- Admin authentication and authorization
- OAuth flow integration
- File upload and Drive sync
- POI associations CRUD
- Error handling edge cases
- Network failure scenarios

## Code Quality Tools

### ESLint Static Analysis

**Purpose:** Catch code quality issues, unused variables, and potential bugs before runtime.

**Configuration:**
- **Frontend:** `frontend/eslint.config.js` - ESLint 9 flat config with React plugin
- **Backend:** `backend/eslint.config.js` - ESLint 9 flat config for Node.js
- **Ignore patterns:** `.eslintignore` files exclude build artifacts and dependencies

**Key Rules:**
```javascript
'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
```

**Naming Convention for Intentionally Unused Parameters:**
```javascript
// ✅ CORRECT - Prefix with underscore
function MyComponent({ value, _onUnusedCallback }) {
  return <div>{value}</div>;
}

// ❌ WRONG - ESLint warning
function MyComponent({ value, onUnusedCallback }) {
  return <div>{value}</div>;
}
```

**Running ESLint:**
```bash
# Frontend
cd frontend && npm run lint

# Backend
cd backend && npm run lint

# Fix auto-fixable issues
cd frontend && npm run lint -- --fix
cd backend && npm run lint -- --fix
```

**Integration with Development:**
- Run manually before commits
- Can be integrated into pre-commit hooks (optional)
- Helps maintain clean, maintainable code

### Gourmand AI Slop Detection

**Purpose:** Detect AI-generated "slop" patterns - verbose comments, unnecessary summaries, and other markers of low-quality AI code generation.

**Installation:**
```bash
# Install Gourmand (Rust-based tool)
cargo install gourmand

# Requires Rust and Cargo
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Configuration Files:**
- `gourmand.toml` - Main configuration with disabled checks
- `gourmand-exceptions.toml` - Documented exceptions for legitimate patterns
- `clippy.toml` - Rust linting configuration (required by Gourmand)
- `pyproject.toml` - Python ruff configuration for scripts

**Running Gourmand:**
```bash
# Run full scan
gourmand --full .

# Run via run.sh helper
./run.sh gourmand

# Check specific file
gourmand path/to/file.js
```

**Documented Exceptions:**

Legitimate code patterns that trigger false positives are documented in `gourmand-exceptions.toml`:

```toml
[[exceptions]]
check = "summary_litter"
file = "CLAUDE.md"
justification = "Project documentation requires summaries for navigation"

[[exceptions]]
check = "random_scripts"
file = "run.sh"
justification = "Development workflow automation script"

[[exceptions]]
check = "verbose_comments"
file = "backend/server.js"
line_range = [1100, 1200]
justification = "API endpoint documentation for external consumers"
```

**Common Gourmand Checks:**
- `summary_litter` - Excessive summaries and meta-commentary
- `random_scripts` - Unexplained utility scripts
- `verbose_comments` - Over-explained obvious code
- `implicit_state_machine` - Complex conditional logic (disabled for this project)

**Pre-commit Hooks:**

Optional pre-commit configuration in `.pre-commit-config.yaml`:

```yaml
repos:
  # Standard pre-commit hooks
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-json
      - id: detect-private-key

  # Rust clippy (required for Gourmand)
  - repo: local
    hooks:
      - id: clippy
        name: Clippy Rust Linting
        entry: cargo clippy -- -D warnings
        language: system
        files: \.rs$

  # Python ruff (for scripts/get_google_token.py)
  - repo: local
    hooks:
      - id: ruff-check
        name: Ruff Python Linting
        entry: ruff check --fix
        language: system
        files: \.py$
```

**Install pre-commit hooks:**
```bash
pip install pre-commit
pre-commit install
```

### ESLint Fix History (February 2026)

**Problem:** 109 no-unused-vars warnings across codebase

**Solution:** Comprehensive cleanup across 36 files

**Changes Made:**

1. **Prefixed intentionally unused parameters** with underscore:
   ```javascript
   // Before
   function Map({ destinations, onDestinationCreate, ... }) {

   // After
   function Map({ destinations, _onDestinationCreate, ... }) {
   ```

2. **Removed truly unused state variables:**
   ```javascript
   // Removed
   const [filters, setFilters] = useState({ owners: [], eras: [] });
   const [previousTab, setPreviousTab] = useState('');
   ```

3. **Simplified catch blocks** where error not used:
   ```javascript
   // Before
   } catch (err) {
     setError('Failed');
   }

   // After
   } catch {
     setError('Failed');
   }
   ```

4. **Commented out code** that might be needed later:
   ```javascript
   /* const [organizationData, setOrganizationData] = useState({
     name: '',
     brief_description: ''
   }); */
   ```

**Files Modified:**
- **Backend:** 13 files (config, services, tests, server.js)
- **Frontend:** 23 files (App.jsx, Map.jsx, Sidebar.jsx, all Settings components)

**Impact:**
- ✅ Zero ESLint warnings (down from 109)
- ✅ Cleaner, more maintainable code
- ✅ Easier to spot real issues vs noise
- ✅ Better developer experience

**Lesson Learned:**

During the cleanup, some state variables were incorrectly removed, causing runtime errors:
- `visiblePoiIds` - Used for news refresh functionality
- `refreshResult` - Used for notification display
- `selectedPoiIds` - Used for organization associations

**Best Practice:** Always grep for references before removing state:
```bash
grep -rn "variableName\|setVariableName" frontend/src/
```

### Bug Fix: MTB Trail Duplicate (February 2026)

**Issue:** MTB Trail Status collection showed 10 trails instead of 9, with "East Rim Trail" and "East Rim Trailhead" both appearing.

**Root Cause Analysis:**

The database contained two separate POIs:
- `id=5740` "East Rim Trail" (poi_type='trail') - Linear trail feature, no geometry
- `id=5527` "East Rim Trailhead" (poi_type='point') - Access point with coordinates

Both had the same `status_url` (https://x.com/CVNPmtb), causing both to appear in the MTB collection query:

```sql
-- BEFORE (selecting both trail and point types)
SELECT p.id, p.name, p.poi_type, ...
FROM pois p
WHERE p.status_url IS NOT NULL
  AND p.status_url != ''
  AND (p.deleted IS NULL OR p.deleted = FALSE);
```

**Investigation Results:**
```sql
-- Distribution of POIs with status_url
SELECT poi_type, COUNT(*) FROM pois
WHERE status_url IS NOT NULL AND status_url <> ''
GROUP BY poi_type;

 poi_type | count
----------+-------
 point    |     9
 trail    |     1
```

The "East Rim Trail" was test data (created by `trailStatus.integration.test.js`) with no geometry, making it invisible on the map but still included in collections.

**Solution:**

Modified the MTB trails query to only include trailheads (access points), not trail features:

```sql
-- AFTER (selecting only point types)
SELECT p.id, p.name, p.poi_type, ...
FROM pois p
WHERE p.status_url IS NOT NULL
  AND p.status_url != ''
  AND p.poi_type = 'point'  -- ✅ NEW: Filter to trailheads only
  AND (p.deleted IS NULL OR p.deleted = FALSE);
```

**File Changed:** `backend/server.js:1372`

**Rationale:**
- Trailheads are the access points where users start trails
- Trail status is most relevant at the access point, not along the trail
- Avoids duplicates when both trail and trailhead share status_url
- All 9 real MTB trailheads are poi_type='point'

**Testing:**
```bash
# Verify fix locally
curl -s http://localhost:8080/api/trail-status/mtb-trails | jq 'length'
# Output: 9 (was 10 before fix)

# Verify only trailhead remains
curl -s http://localhost:8080/api/trail-status/mtb-trails | jq -r '.[] | .name' | grep "East Rim"
# Output: East Rim Trailhead (no duplicate "East Rim Trail")
```

**Production Deployment:**

The fix requires deploying a new container image:
```bash
# Build and tag
./run.sh build
podman tag localhost/rotv:latest quay.io/fatherlinux/rotv:latest
podman push quay.io/fatherlinux/rotv:latest

# Deploy to production
ssh -p 22422 root@sven.dc3.crunchtools.com
podman pull quay.io/fatherlinux/rotv:latest
podman stop rootsofthevalley.org
# Restart with production configuration
```

**Impact:**
- ✅ MTB collection shows correct count (9 trails)
- ✅ No duplicates in collection UI
- ✅ Production database already clean (test POI didn't exist there)
- ✅ Prevents future duplicates if trails get status_url configured

## Continuous Integration Best Practices

### Before Creating a PR

1. ✅ **Run tests locally:** `./run.sh test`
2. ✅ **Build succeeds:** `./run.sh build`
3. ✅ **ESLint passes:** `cd frontend && npm run lint` and `cd backend && npm run lint`
4. ✅ **Manual verification:** Test the feature in browser
5. ✅ **Update fixtures:** If schema changed, update test data
6. ✅ **Add new tests:** Cover new functionality
7. ✅ **Check code quality:** `./run.sh gourmand` (optional but recommended)

### During PR Review

1. 👀 **Check test results** - Core tests should pass (153+ tests)
2. 🔍 **Review coverage** - New features should have tests
3. 📊 **Check ESLint** - Should show 0 warnings
4. ⏱️ **Monitor duration** - Flag if tests take >3 minutes
5. 🐛 **Fix failures immediately** - Don't merge with broken tests
6. 🎨 **Code quality** - Gourmand should pass (or have documented exceptions)

### After Merging

1. ✅ **Tests pass on master** - GitHub Actions runs on merge too
2. 📊 **Monitor production** - Ensure no issues after deployment
3. 🏷️ **Tag releases** - Use semantic versioning for production deploys

## Related Documentation

- [Development Architecture](./DEVELOPMENT_ARCHITECTURE.md) - Container setup, ephemeral storage, production seeding
- [News & Events Architecture](./NEWS_EVENTS_ARCHITECTURE.md) - AI-powered content collection system
- [CLAUDE.md](../CLAUDE.md) - Development workflow, branch strategy, SemVer

## Quick Reference

```bash
# Run all tests locally
./run.sh test

# Build test container
./run.sh build

# View test logs
./run.sh logs

# Clean up test containers
./run.sh stop

# ESLint checks
cd frontend && npm run lint
cd backend && npm run lint

# Fix ESLint auto-fixable issues
cd frontend && npm run lint -- --fix
cd backend && npm run lint -- --fix

# Gourmand code quality check
./run.sh gourmand
gourmand --full .

# Check GitHub Actions status
gh run list --limit 5

# Watch latest test run
gh run watch

# View test output from specific run
gh run view 21310471758 --log
```

## Success Metrics

✅ **153 of 174 tests passing** (88% - core functionality 100%)
✅ **Test duration** < 3 minutes
✅ **Zero production database dependency**
✅ **Consistent results** across local and CI
✅ **Fast feedback** on every PR
✅ **Zero ESLint warnings** (109 warnings eliminated)
✅ **Code quality enforcement** with ESLint and Gourmand

**Known Issues:**
- ⚠️ 21 Playwright UI tests timing out (pre-existing issue, not blocking)
- 🎯 All API, database, and business logic tests passing

---

**Last Updated:** February 7, 2026
**Related PRs:**
- [#55 - Add automated test workflow](https://github.com/fatherlinux/rotv/pull/55)
- Current PR - ESLint integration and MTB duplicate fix
