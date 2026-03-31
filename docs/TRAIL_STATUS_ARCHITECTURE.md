# MTB Trail Status Collection Architecture

## Introduction: How It Works

The MTB Trail Status collection system tracks the current condition of mountain bike trails in Northeast Ohio. It renders configured status pages (Twitter/X accounts, park websites, etc.) and uses AI to extract structured status information.

### The Problem We're Solving

Mountain bikers need real-time trail status information before heading out for a ride. Trails can be closed due to wet conditions, seasonal maintenance, or weather events. This information is typically scattered across multiple sources:
- Twitter/X accounts maintained by trail stewards
- Park district websites with status pages
- Trail reporting platforms like Trail Forks or MTB Project
- Facebook groups and local forums

Manually checking all these sources before every ride is time-consuming and error-prone. Our system centralizes this information and presents it in a single, easy-to-read Status tab.

### Design Principle: Status URL Required

Trail status is only collected for POIs that have a `status_url` configured. This ensures every trail has a verified, authoritative source and prevents unnecessary AI queries. All collection queries filter on `WHERE status_url IS NOT NULL`.

### How Collection Works

**1. Render the Configured URL**

Each trail's `status_url` points to its authoritative status source (e.g., `https://x.com/CVNPmtb` for East Rim Trail). The system:
- Renders the URL using Playwright for JavaScript-heavy sites
- Feeds the rendered content to AI for analysis
- Saves status with the configured URL as the source

**2. AI-Powered Status Extraction**

Google Gemini Flash extracts status from the rendered page content (no search grounding — content is already rendered):
- Identifies trail status (open, closed, limited, maintenance)
- Extracts conditions, weather impacts, dates
- Returns results in a standardized format

**180-Day Collection Window:**

The AI system only considers status updates from the **last 180 days** (approximately 6 months). This design ensures:
- **Recent information**: Outdated status from previous seasons is rejected
- **All statuses treated equally**: Open, closed, limited, and maintenance all use the same 180-day window
- **Seasonal relevance**: Captures full seasonal cycles (winter closures, spring maintenance, summer/fall riding)
- **Protection against stale data**: Prevents AI from using year-old posts that may no longer be relevant

The AI prompts explicitly instruct the model to:
- **Reject posts older than 180 days**: Ignores updates from previous years or old seasons
- **Use most recent within window**: If multiple posts exist, select the newest one
- **Check post dates carefully**: Parse timestamps, relative times ("2h ago"), and absolute dates

This window was chosen because:
- **Winter closures** can last 3-4 months but should still be captured
- **Maintenance projects** may span multiple months
- **Six months** provides enough history without including truly outdated information
- **Prevents confusion** from mixing current season with previous season status

**3. Data Acquisition by Source Type**

Different trail status sources require different extraction methods:

| Source Type | Method | Service | Example |
|-------------|--------|---------|---------|
| Twitter/X | Playwright + cookies | contentExtractor.js | @CVNPmtb (East Rim) |
| Facebook | Apify cloud scraper | apifyService.js | medinaTRAILS (Reagan-Huffman) |
| Bluesky | Playwright | contentExtractor.js | Summit Metro Parks |
| Park websites | Playwright | contentExtractor.js | Cleveland Metroparks |

**URL Routing in trailStatusService.js:**

```
if Facebook URL → apifyService.fetchFacebookPosts → text
else → contentExtractor.extractPageContent (with cookies for Twitter) → markdown
```

Both paths produce text that feeds into the same Gemini prompt. The rest of the pipeline (prompt building, Gemini call, JSON parsing, saveTrailStatus) is identical regardless of source.

**Playwright + Readability (Twitter/X, Bluesky, Park Websites)**

Most status URLs are rendered via `contentExtractor.js` (Playwright + Readability + Turndown), which produces clean markdown for Gemini to analyze. Playwright and Chromium browsers are installed in the **base container image** (`Containerfile.base`) to optimize build times:
- Base image installs Playwright globally and downloads Chromium browsers (~400MB)
- Base image records the installed version in `/etc/playwright-version`
- App image installs the matching Playwright npm package version

Twitter/X pages require authenticated access to load tweet content:
- Cookies are stored in `admin_settings` table with key `twitter_cookies`
- `trailStatusService.js` loads cookies and passes them to `contentExtractor`
- `contentExtractor.js` injects cookies into the Playwright browser context before navigation
- Cookie `sameSite` values are normalized to Playwright-compatible values (`Strict`, `Lax`, `None`)
- **Cookies expire after 30-90 days and must be refreshed periodically** via Settings > Data Collection
- Twitter gets an extended `dynamicContentWait` (8s vs 3s) for SPA rendering

**Apify Cloud Scraper (Facebook)**

Facebook pages cannot be scraped with Playwright because the SPA doesn't yield extractable content. The system uses Apify's first-party Facebook scraper (`apify/facebook-posts-scraper`) via `apifyService.js`:
- API token stored in `admin_settings` table with key `apify_api_token`
- Calls the Apify sync API: `POST /v2/acts/{actorId}/run-sync-get-dataset-items`
- Returns post text concatenated with timestamps, same format as contentExtractor output
- Configurable via Settings > Data Collection in the admin UI
- Estimated usage: ~1,440 requests/month (1 trail × 48/day × 30 days), within Apify's free tier

**Why Not Apify for Twitter?**

Apify's community Twitter/X scrapers were evaluated (apidojo/tweet-scraper, apidojo/twitter-scraper-lite, apidojo/twitter-profile-scraper, quacker/twitter-url-scraper) and all failed to return current tweet data — returning `noResults`, `demo` placeholders, or stale cached data. Twitter's anti-bot measures make third-party scrapers unreliable. Playwright with authenticated cookies remains the most reliable approach for Twitter.

**4. Source URL Override Pattern**

This is a critical feature: when a trail has a configured `status_url`, the system **always** uses that URL as the source link, even if the AI found the information elsewhere. This ensures:
- Users always see the official source
- Deep links go to the authoritative page
- Trail stewards control their trail's source attribution

**5. Scheduled Collection**

The system uses pg-boss for reliable background job processing:
- Default interval: Every 30 minutes (Gemini Flash is essentially free at this volume)
- Admin-configurable via `scheduleTrailStatusCollection()` cron parameter
- Automatic updates without manual intervention

### Key Benefits

**For End Users:**
- **Single source of truth**: All trail status in one place
- **Real-time updates**: Fresh information collected automatically
- **Direct links**: Click through to official sources for more details
- **Clear status badges**: Open, Closed, Limited, Maintenance states

**For Trail Administrators:**
- **Configurable sources**: Set the official status URL for each trail
- **Manual collection**: Trigger immediate updates via admin panel
- **Batch processing**: Update all trails at once
- **Job monitoring**: Track collection progress in real-time

**For Developers:**
- **Modular architecture**: Clear separation between collection, storage, and display
- **Extensible**: Easy to add new trail sources or status types
- **Well-tested**: Integration tests ensure critical functionality works

### Technology Stack

- **Google Gemini Flash**: AI-powered status extraction (no search grounding — content is pre-rendered)
- **Playwright + Readability + Turndown**: Renders pages and converts to clean markdown (`contentExtractor.js`)
- **PostgreSQL**: Status storage and trail configuration
- **pg-boss**: Reliable job scheduling and background processing
- **Node.js/Express**: Backend API
- **React**: Status tab UI component

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend UI                             │
│  - Status badge + Source link in Info tab badges row            │
│  - Trail Status section (conditions, weather, updated)          │
│  - Refresh button (admin edit mode)                             │
│  - Apify API token config in Settings > Data Collection         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend API Routes                         │
│  GET  /api/pois/:id/status              - Get trail status      │
│  POST /api/admin/pois/:id/status/collect - Collect single       │
│  POST /api/admin/trail-status/collect-batch - Batch collect     │
│  PUT  /api/admin/trail-status/batch-collect/:id/cancel          │
│  GET  /api/admin/trail-status/job-status/:jobId                 │
│  GET  /api/admin/trail-status/ai-stats                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Trail Status Service Layer                      │
│  (backend/services/trailStatusService.js)                       │
│                                                                 │
│  1. collectTrailStatus(pool, poi)                               │
│     ├─ Skip if no status_url configured                        │
│     ├─ Route by URL type:                                      │
│     │   ├─ Facebook → apifyService.fetchFacebookPosts          │
│     │   └─ All others → contentExtractor (+ cookies for X)     │
│     ├─ Extract status via Gemini Flash (no search grounding)   │
│     ├─ Override source_url with configured status_url          │
│     └─ Return {status, conditions, source_url, ...}            │
│                                                                 │
│  2. saveTrailStatus(pool, poiId, status)                        │
│     ├─ Reject status older than 90 days                        │
│     ├─ Check for existing recent status (dedup)                │
│     └─ Insert new status record                                │
│                                                                 │
│  3. runTrailStatusBatchCollection(pool, poiIds, jobId)          │
│     ├─ Create job record in trail_status_job_status            │
│     ├─ Process trails with concurrency (10 concurrent)         │
│     ├─ Checkpoint progress after each trail                    │
│     └─ Handle cancellation gracefully                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
┌────────────────────────────┐ ┌────────────────────────────────┐
│   contentExtractor.js      │ │   apifyService.js              │
│                            │ │                                │
│  Playwright + Readability  │ │  Apify Cloud Scraper           │
│  + Turndown → markdown     │ │  (Facebook only)               │
│                            │ │                                │
│  Used for:                 │ │  Used for:                     │
│  - Twitter/X (+ cookies)   │ │  - Facebook pages              │
│  - Bluesky                 │ │                                │
│  - Park websites           │ │  Actor: apify/facebook-posts-  │
│  - Any other URL           │ │         scraper                │
└────────────────────────────┘ └────────────────────────────────┘
                    │                   │
                    └─────────┬─────────┘
                              ▼
              ┌───────────────────────────────┐
              │       geminiService.js        │
              │                               │
              │  Gemini Flash                  │
              │  useSearchGrounding: false     │
              │  Extracts structured status    │
              └───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                          │
│                                                                 │
│  pois table extensions:                                         │
│    - status_url: Configured status page URL                     │
│      (MTB trails identified by having a non-empty status_url)   │
│                                                                 │
│  trail_status table:                                            │
│    - poi_id, status, conditions, last_updated                   │
│    - source_name, source_url                                    │
│    - weather_impact, seasonal_closure                           │
│                                                                 │
│  trail_status_job_status table:                                 │
│    - Job tracking, progress, resumability                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### POI Table Extensions

```sql
ALTER TABLE pois ADD COLUMN status_url VARCHAR(500);  -- Dedicated status page URL

-- MTB trails are identified by having a non-empty status_url
-- No additional flag column needed
```

### Trail Status Table

```sql
CREATE TABLE trail_status (
  id SERIAL PRIMARY KEY,
  poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,

  -- Status information
  status VARCHAR(50) NOT NULL,  -- 'open'|'closed'|'limited'|'maintenance'|'unknown'
  conditions TEXT,               -- Trail condition description
  last_updated TIMESTAMP,        -- When this status was reported

  -- Source tracking
  source_name VARCHAR(200),      -- e.g., "Twitter/X", "Summit Metro Parks"
  source_url VARCHAR(1000),      -- Deep link to status page

  -- Weather/seasonal
  weather_impact TEXT,           -- e.g., "Muddy after rain", "Snow covered"
  seasonal_closure BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trail_status_poi_id ON trail_status(poi_id);
CREATE INDEX idx_trail_status_updated ON trail_status(last_updated DESC);
CREATE INDEX idx_trail_status_status ON trail_status(status);
```

### Job Status Table

```sql
CREATE TABLE trail_status_job_status (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(50),          -- 'scheduled_collection'|'batch_collection'
  status VARCHAR(20),            -- 'queued'|'running'|'completed'|'failed'|'cancelled'
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  total_trails INTEGER,
  trails_processed INTEGER,
  status_found INTEGER,
  error_message TEXT,

  -- Resumability
  poi_ids TEXT,                  -- JSON array of all trail POI IDs
  processed_poi_ids TEXT,        -- JSON array of completed trail POI IDs
  pg_boss_job_id VARCHAR(100),
  ai_usage TEXT,                 -- JSON object tracking AI provider usage

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trail_status_job_status_created ON trail_status_job_status(created_at DESC);
CREATE INDEX idx_trail_status_job_status_status ON trail_status_job_status(status);
```

### Admin Settings

```sql
INSERT INTO admin_settings (setting_key, setting_value, description) VALUES
('trail_status_collection_enabled', 'true', 'Enable/disable trail status collection'),
('trail_status_collection_interval_minutes', '30', 'Minutes between status collection runs');
```

---

## MTB Trail Status Date Logic

Every MTB trail in the Results → MTB Trail Status list displays a "Last Updated" date to show data freshness. The date system uses a cascading fallback priority to ensure every trail shows a meaningful date, even if it doesn't have status records yet.

### Date Priority Cascade

The system selects the most recent date from the following sources (in priority order):

1. **`trail_status.last_updated`** - Most recent status update timestamp
2. **`trail_status.created_at`** - When the status record was created (if `last_updated` is NULL)
3. **`pois.updated_at`** - When the POI itself was last modified
4. **`pois.created_at`** - When the POI was created

### Implementation

**Backend API Query** (`/api/trail-status/mtb-trails`):

```sql
SELECT
  p.id,
  p.name,
  p.poi_type,
  p.latitude,
  p.longitude,
  p.geometry,
  p.status_url,
  ts.status,
  ts.conditions,
  COALESCE(ts.last_updated, p.updated_at, p.created_at) as last_updated,
  ts.source_name
FROM pois p
LEFT JOIN LATERAL (
  SELECT status, conditions,
         COALESCE(last_updated, created_at) as last_updated,
         source_name
  FROM trail_status
  WHERE poi_id = p.id
  ORDER BY last_updated DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1
) ts ON true
WHERE p.status_url IS NOT NULL
  AND p.status_url != ''
  AND (p.deleted IS NULL OR p.deleted = FALSE)
ORDER BY p.name
```

**Frontend Display** (`ResultsTile.jsx`):

```javascript
{statusData.last_updated && (
  <div className="status-updated">
    Updated: {new Date(statusData.last_updated).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric'
    })}
  </div>
)}
```

### Date Format

Dates are displayed in **US format**: `MM/DD/YYYY` (e.g., `02/05/2026`)

The `toLocaleDateString('en-US', ...)` method ensures consistent formatting regardless of user's browser locale.

### What This Means for Users

- **Trails with active status monitoring**: Show when their status was last checked
- **Trails without status records**: Show when the trail POI was last modified
- **New trails**: Show their creation date until first status is collected
- **All trails**: Always display a date to indicate data freshness

### Example Scenarios

| Trail Scenario | Status Record | POI Metadata | Date Shown | Meaning |
|---------------|---------------|--------------|------------|---------|
| East Rim Trail | ✅ last_updated: 02/05/2026 | updated_at: 01/15/2026 | **02/05/2026** | Status checked today |
| Bolton Field | ✅ created_at: 01/20/2026 | updated_at: 01/10/2026 | **01/20/2026** | Status first collected on 1/20 |
| New Trail | ❌ No status record | created_at: 02/01/2026 | **02/01/2026** | Trail created 2/1, no status yet |
| Updated POI | ❌ No status record | updated_at: 02/03/2026 | **02/03/2026** | Trail info updated 2/3, no status yet |

### Why This Design

1. **Always shows a date**: Users never see blank/unknown dates
2. **Meaningful fallbacks**: POI update dates indicate when trail info was last verified
3. **Data freshness**: Users can judge whether to trust the status or check source directly
4. **Consistent ordering**: SQL handles NULL values properly with `NULLS LAST`

---

## Source Attribution Pattern

The system ensures that saved status records always reference the configured `status_url` as the source. Here's how it works:

### How It Works

When status is collected for a trail:
1. The system renders the configured `status_url`
2. The AI extracts status information from the rendered content
3. The saved status record uses the configured `status_url` as the source

This ensures consistency - the source URL always points to the page that was actually analyzed.

### Implementation

```javascript
// In trailStatusService.js, around line 310
if (poi.status_url && poi.status_url !== 'No dedicated status page') {
  console.log(`[Trail Status]   Overriding source_url with configured status_url: ${poi.status_url}`);
  status.source_url = poi.status_url;

  // Extract source name from the URL
  if (poi.status_url.includes('x.com') || poi.status_url.includes('twitter.com')) {
    status.source_name = 'Twitter/X';
  } else if (poi.status_url.includes('bsky.app')) {
    status.source_name = 'Bluesky';
  } else if (poi.status_url.includes('trailforks.com')) {
    status.source_name = 'IMBA Trail Forks';
  } else if (poi.status_url.includes('mtbproject.com')) {
    status.source_name = 'MTB Project';
  }
}
```

### Why This Matters

1. **Accuracy**: The source URL matches the page that was actually analyzed
2. **Authority**: Trail stewards control which source is used for their trail
3. **Deep Links**: Click-through goes to the official source
4. **Trust**: Users can verify the status by visiting the same page

---

## API Endpoints

### Get Trail Status

**GET /api/pois/:id/status**

Returns the most recent status for a trail.

**Response:**
```json
{
  "status": "open",
  "conditions": "Trails are dry and in excellent condition",
  "last_updated": "2026-01-24T14:30:00Z",
  "source_name": "Twitter/X",
  "source_url": "https://x.com/CVNPmtb",
  "weather_impact": null,
  "seasonal_closure": false
}
```

### Collect Status (Single Trail)

**POST /api/admin/pois/:id/status/collect**

Triggers immediate status collection for a single trail.

**Response:**
```json
{
  "success": true,
  "message": "Trail status collected for East Rim Trail",
  "statusFound": 1,
  "statusSaved": 1
}
```

### Batch Collection

**POST /api/admin/trail-status/collect-batch**

Starts a batch collection job for multiple trails.

**Request:**
```json
{
  "poiIds": [1, 2, 3, 4, 5]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Trail status collection started for 5 trails",
  "jobId": "abc-123"
}
```

### Job Status

**GET /api/admin/trail-status/job-status/:jobId**

Returns progress of a batch collection job.

**Response:**
```json
{
  "jobId": "abc-123",
  "status": "running",
  "totalTrails": 50,
  "trailsProcessed": 25,
  "statusFound": 20,
  "aiUsage": { "gemini": 15, "perplexity": 10 }
}
```

### Cancel Job

**PUT /api/admin/trail-status/batch-collect/:jobId/cancel**

Cancels a running batch job gracefully.

---

## Frontend UI

### Trail Status in Info Tab

Trail status is displayed inline on the Info tab (no separate Status tab). For POIs with a configured `status_url`:

**Badges row** (top of Info): Status badge (Open/Closed/Limited/Maintenance) + Source link badge
**Trail Status section** (below badges, above Overview): Conditions, weather impact, updated timestamp, seasonal closure warning, admin Refresh button

**File:** `frontend/src/components/Sidebar.jsx` (ReadOnlyView component)

### Status Badge Styling

```css
.status-badge {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  font-weight: bold;
  margin-bottom: 1rem;
}

.status-open { background: #4caf50; color: white; }
.status-closed { background: #f44336; color: white; }
.status-limited { background: #ff9800; color: white; }
.status-maintenance { background: #2196f3; color: white; }
.status-unknown { background: #9e9e9e; color: white; }
```

---

## Integration Tests

The Trail Status system includes comprehensive integration tests that verify the complete AI-powered collection workflow with real data.

**File:** `backend/tests/trailStatus.integration.test.js`

### Test Philosophy: No Mock Data

**The tests use REAL AI collection, not mock data.** This ensures:
- The complete workflow is tested end-to-end
- AI prompt engineering actually works
- Twitter page rendering loads real tweets
- Source attribution uses the configured status_url
- Database persistence is verified with actual data

### Test Setup

The tests configure Twitter authentication and ensure required data exists:

```javascript
const EAST_RIM_STATUS_URL = 'https://x.com/CVNPmtb';
const EAST_RIM_NAME = 'East Rim Trail';

// Twitter cookies for authenticated access (valid ~1 year)
// Note: sameSite values normalized to Playwright-compatible values
const TWITTER_COOKIES = [
  {"domain":".x.com","name":"auth_token","sameSite":"None",...},
  {"domain":".x.com","name":"ct0","sameSite":"Lax",...},
  // ... more cookies
];

async function setupEastRimTrail(pool) {
  // 1. Insert Twitter cookies for authenticated access
  await pool.query(`
    INSERT INTO admin_settings (key, value, updated_at)
    VALUES ('twitter_cookies', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = $1
  `, [JSON.stringify(TWITTER_COOKIES)]);

  // 2. Ensure East Rim Trail exists with status_url
  // 3. Clear existing status for fresh collection
}
```

### Test Cases

| Test | Description |
|------|-------------|
| **Configuration Tests** | |
| East Rim Trail exists | Verifies the test trail is in the database |
| Correct status URL | Ensures `status_url = 'https://x.com/CVNPmtb'` |
| **API Tests** | |
| GET /api/pois/:id/status | Verifies the status endpoint returns 200 |
| POST /api/admin/pois/:id/status/collect | Verifies the collect endpoint exists |
| **Schema Tests** | |
| trail_status table schema | Confirms all required columns exist |
| trail_status_job_status table | Confirms job tracking table exists |
| **AI Collection Tests (Real Data)** | |
| Collect status via AI | Calls `collectTrailStatus()` with real Gemini AI + Twitter rendering |
| Save valid status value | Verifies status is one of: open, closed, limited, maintenance, unknown |
| Source attribution | **Critical**: Verifies saved status uses configured Twitter URL as source |
| Populate conditions | Verifies AI extracts meaningful condition text from tweets |
| Source URL matches config | Confirms `source_url = 'https://x.com/CVNPmtb'` and `source_name = 'Twitter/X'` |

### AI Collection Test Details

The AI collection tests verify the complete workflow:

1. **Twitter Page Rendering**: Playwright loads `https://x.com/CVNPmtb` with authenticated cookies
2. **Tweet Extraction**: Waits for `article[data-testid="tweet"]` selector, scrolls to load more tweets
3. **AI Analysis**: Gemini 2.0 Flash extracts status from rendered content
4. **Source Attribution**: Status saved with configured `status_url` as the source
5. **Database Persistence**: Status saved to `trail_status` table with correct source attribution

### Running Tests

```bash
# From the project root
./run.sh test

# Tests run in the container with full database access
# Output shows: ✓ Trail Status Integration Tests (13 tests)
# AI collection tests have 60-second timeout for API calls
```

---

## Known MTB Trail Sources

### East Rim Trail (CVNP)

- **Status URL:** `https://x.com/CVNPmtb`
- **Source Name:** Twitter/X
- **Notes:** Official CVNP mountain bike Twitter account posts trail conditions

### Future Trail Sources

The migration file (`001_add_trail_status_support.sql`) automatically configures known trails:

```sql
-- East Rim Trail - status from CVNP MTB Twitter account
UPDATE pois
SET status_url = 'https://x.com/CVNPmtb'
WHERE name LIKE '%East Rim%'
  AND status_url IS DISTINCT FROM 'https://x.com/CVNPmtb';
```

Additional trails can be added by:
1. Configuring the `status_url` to the official source (any POI with a non-empty `status_url` is treated as an MTB trail)

---

## Troubleshooting

### Status Not Showing

1. **Verify `status_url` is configured**: Query: `SELECT id, name, status_url FROM pois WHERE name LIKE '%Trail Name%';`
   - The POI must have a non-empty `status_url` to be identified as an MTB trail
2. **Check recent collection**: Status may need to be collected first via admin panel or API

### Wrong Source URL Showing

The source URL override only works if:
1. `poi.status_url` is set and not empty
2. The value is not `'No dedicated status page'`

Check the service logs for:
```
[Trail Status]   Overriding source_url with configured status_url: https://x.com/CVNPmtb
```

### Collection Failing

1. **Rate limits**: AI provider may be rate-limited; check fallback
2. **Network issues**: Status page may be down
3. **JS rendering**: Twitter/X pages require Playwright

### Database Migration Issues

If tables are missing, run migrations manually:
```bash
psql -U postgres -d rotv -f backend/migrations/001_add_trail_status_support.sql
```

---

## Future Enhancements

### Planned Improvements

1. **Push notifications**: Alert users when trail status changes
2. **Historical tracking**: Show status history over time
3. **Weather integration**: Auto-predict closures based on weather
4. **User reports**: Allow riders to submit condition updates
5. **Map indicators**: Show status icons on the map layer

### Data Sources to Add

- Summit Metro Parks trail systems
- Cleveland Metroparks MTB trails
- Stark Parks trail network
- Ohio Erie Canalway trails

---

## Changelog

**Version 3.0.0 (2026-03-31)**
- Added Apify integration for Facebook trail status (Reagan-Huffman via medinaTRAILS page)
- New `apifyService.js` — Apify cloud scraper client (Facebook only)
- URL routing in `trailStatusService.js`: Facebook → Apify, everything else → Playwright
- Twitter/X remains on Playwright + cookies (Apify Twitter actors evaluated and rejected as unreliable)
- Extended Twitter dynamic content wait from 3s to 8s for SPA rendering
- Bumped status age threshold from 30 to 90 days (trail accounts post infrequently)
- Collapsed Status tab into Info section — badges in top row, details below
- Added Apify API token configuration in Settings > Data Collection
- Added Facebook to source_name mapping

**Version 2.0.0 (2026-03-30)**
- Replaced search-grounded AI (Perplexity/Gemini search) with Playwright rendering + Gemini Flash extraction
- Pipeline: contentExtractor.js (Readability + Turndown) → geminiService.js (useSearchGrounding: false)
- Removed aiSearchFactory.js and jsRenderer.js dependencies
- Added cookie support to contentExtractor.js for Twitter/X authentication
- Increased default collection frequency from every 2 hours to every 30 minutes
- Simplified AI usage tracking (Gemini-only, no provider selection logic)

**Version 1.3.0 (2026-02-06)**
- Added "MTB Trail Status Date Logic" section documenting date priority cascade
- Fixed date format to US format (MM/DD/YYYY) instead of browser locale
- Fixed missing dates for trails without status records (now use POI metadata as fallback)
- Backend query now uses `COALESCE(ts.last_updated, p.updated_at, p.created_at)` for complete date coverage
- **Unified collection window**: All trail statuses now use 180-day window (previously: open=30d, closed=180d)
- Added "180-Day Collection Window" section explaining design rationale and seasonal relevance

**Version 1.2.0 (2026-02-03)**
- Clarified documentation: AI only analyzes configured status_url, does NOT search the web
- Updated "Source URL Override" to "Source Attribution" pattern (more accurate terminology)
- Documented Playwright/Chromium base image architecture for faster builds
- Fixed cookie `sameSite` normalization (handles null, "no_restriction", lowercase values)

**Version 1.1.0 (2026-02-03)**
- Added real AI collection integration tests (no mock data)
- Implemented Twitter cookie authentication for Playwright
- Added `waitForSelector` for tweet loading reliability
- Improved Twitter page scrolling for lazy-loaded content
- Clarified that status_url is REQUIRED for collection (no other POIs processed)
- Normalized cookie `sameSite` values for Playwright compatibility
- All 53 tests passing including 5 AI collection tests

**Version 1.0.0 (2026-01-24)**
- Initial MTB Trail Status collection system
- East Rim Trail configured with Twitter status URL
- Source URL override pattern implemented
- Integration tests for trail status feature
- Status tab UI in Sidebar
- Scheduled collection via pg-boss

---

## References

- **Migration file:** `backend/migrations/001_add_trail_status_support.sql`
- **Service file:** `backend/services/trailStatusService.js`
- **Test file:** `backend/tests/trailStatus.integration.test.js`
- **Plan document:** See plan file for full implementation details
