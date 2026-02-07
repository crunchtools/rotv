# News & Events Collection Architecture

## Introduction: How It Works

The News & Events collection system automatically discovers, extracts, and organizes relevant news articles and upcoming events for every destination in the Roots of The Valley application. This system combines Playwright browser rendering, Gemini AI content extraction, and PostgreSQL deduplication to deliver accurate, up-to-date information.

### The Problem We're Solving

Traditional web scraping struggles with modern websites that rely heavily on JavaScript frameworks (like Wix, Squarespace, and WordPress). Simply fetching HTML often returns empty pages or loading spinners because the content is generated client-side after page load. Additionally, manually maintaining news and events for hundreds of destinations is impractical and error-prone.

### Our Multi-Layered Solution

**1. Intelligent JavaScript Rendering**
When the system encounters a website that uses JavaScript frameworks, it automatically launches a headless Chromium browser using Playwright. This real browser renders the page exactly as users see it, waits for all JavaScript to execute, and extracts the fully-rendered content. This works seamlessly with Wix, Squarespace, and other dynamic platforms that would otherwise be invisible to traditional scrapers.

**2. AI-Powered Content Discovery**
The system uses Google Gemini AI with Google Search grounding to intelligently search for and extract relevant content. For news collection, it employs a two-pass strategy:
- **First pass**: Analyzes the organization's dedicated news page (if available) using relaxed filtering criteria (75% confidence threshold)
- **Second pass**: Searches Google News, PR Newswire, and news outlets for external coverage using strict filtering (95% confidence threshold)

This dual approach ensures comprehensive coverage - catching both the organization's own announcements and third-party media coverage.

**3. Smart URL Resolution**
Google Search results initially return redirect URLs (like `vertexaisearch.cloud.google.com/grounding-api-redirect/...`) rather than direct links. Our system automatically resolves these redirects to extract the real destination URLs. This provides two major benefits:
- **Faster user experience**: Users click directly to articles without intermediate redirects
- **Better deduplication**: The same article found through different search queries resolves to the same final URL, making it easy to detect duplicates

**4. Dual-Check Deduplication**
The system prevents duplicates using two complementary strategies:
- **URL matching**: Same resolved URL = same article (catches articles found via different search queries)
- **Normalized title matching**: Strips date suffixes like "| January 30" or "| 2026-01-30" before comparing (catches same content with different title formatting)

This robust deduplication allows admins to refresh news multiple times without creating duplicates, even when the AI finds the same articles through different search paths.

**5. Multi-Provider AI Strategy**
The system supports multiple AI providers with automatic fallback. Administrators can configure:
- **Primary Provider**: First choice for searches (Gemini or Perplexity)
- **Secondary Provider**: Fallback when primary reaches rate limits
- **Usage Limits**: Configure per-job request limits for each provider (0 = unlimited)

When the primary provider hits its configured limit or returns rate-limiting errors (HTTP 429), the system automatically switches to the secondary provider. This ensures uninterrupted collection even under heavy load.

**6. Timezone-Aware Date Parsing**
All dates are interpreted in the user's configured timezone (defaults to Eastern Time for Cuyahoga Valley). The AI extracts dates in ISO 8601 format (YYYY-MM-DD), ensuring consistency across all sources and preventing timezone-related bugs. This is especially important for event start dates and news publication dates.

**7. Real-Time Progress Tracking**
The UI displays a scrollable status widget that moves through distinct phases:
- Rendering JavaScript-heavy pages
- AI search with Google Search grounding
- Matching deep links to extracted items
- Searching Google News for external coverage
- Saving items to database

The progress widget also displays real-time AI provider statistics:
- Current primary/secondary provider being used
- Number of requests made to each provider
- Total usage across the job session

Admins can scroll down to see newly added items while the collection is still running, providing immediate feedback and transparency into what the system is finding.

**8. Batch Job Cancellation**
Long-running batch jobs can be cancelled at any time via the Cancel button. When cancelled:
- The system stops starting new POI collections
- In-flight POIs complete naturally (no data loss)
- Job status updates to "cancelled" with a distinctive UI badge
- Progress shows how many POIs were processed before cancellation

**9. Quality Filters and Validation**
- **Date filtering**: News older than 365 days is automatically excluded (unless from a dedicated news page)
- **Past event filtering**: Events with end dates in the past are skipped
- **Failed URL resolution**: Items with unresolvable redirect URLs are discarded to maintain data quality
- **Confidence thresholds**: Dedicated pages use relaxed filtering (75%), while general searches use strict filtering (95%)

### Key Benefits

**For End Users:**
- **Fresh, relevant content**: Automatic updates ensure news and events stay current
- **Fast navigation**: Direct URLs mean instant access to articles (no redirect delays)
- **Comprehensive coverage**: Captures both organizational announcements and media coverage
- **Accurate dates**: Timezone-aware parsing ensures event times are correct

**For Administrators:**
- **Zero maintenance**: No manual updates required - just click "Refresh News" or "Refresh Events"
- **No duplicates**: Multiple refreshes don't create duplicate entries thanks to dual-check deduplication
- **Transparent process**: Real-time progress tracking shows exactly what the system is finding
- **Scalable**: Works for hundreds of destinations without performance degradation
- **Flexible**: Handles any website type - static HTML, Wix, Squarespace, WordPress, etc.

**For Developers:**
- **Modular architecture**: Clear separation between rendering, AI search, and data persistence
- **Crash-recoverable**: Uses pg-boss job queue for batch processing that survives container restarts
- **Comprehensive logging**: Detailed logs show URL resolution, duplicate detection, and filtering decisions
- **Extensible**: Easy to add new event types, news categories, or content sources

### Technology Stack

- **Playwright**: Headless browser automation for JavaScript rendering
- **AI Providers** (configurable primary/secondary):
  - **Google Gemini 2.0 Flash**: AI-powered content extraction with search grounding
  - **Perplexity Sonar Pro**: Alternative AI with built-in web search capability
- **PostgreSQL**: Structured storage for news, events, and deduplication
- **pg-boss**: Job queue for reliable background processing
- **Node.js/Express**: Backend API and orchestration
- **React**: Real-time progress tracking UI

## Overview

The News & Events collection system uses AI-powered research combined with headless browser rendering to automatically discover and extract relevant news articles and upcoming events for Points of Interest (POIs) in the Cuyahoga Valley National Park region.

**Key Features:**
- Automatic detection and rendering of JavaScript-heavy websites (Wix, Squarespace, etc.)
- Playwright-based headless browser for dynamic content extraction
- Google Gemini AI with Google Search grounding for intelligent content discovery
- Relaxed filtering for dedicated events/news URLs vs. strict filtering for general web searches
- Per-POI refresh capability with progress tracking
- Batch processing for multiple POIs

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend UI                             │
│  - Refresh News/Events buttons (per-POI, edit mode)             │
│  - "Update News & Events" batch button (map, edit mode)         │
│  - Event/News counters and scrollable lists                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend API Routes                         │
│  POST /api/admin/pois/:id/news/collect  - Single POI            │
│  POST /api/admin/pois/:id/events/collect - Single POI (alias)   │
│  POST /api/admin/news/batch-collect - Batch multiple POIs       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    News Service Layer                           │
│  (backend/services/newsService.js)                              │
│                                                                 │
│  1. collectNewsForPoi(poi) - Main collection logic              │
│     ├─ Check events_url & news_url for JS-heavy sites          │
│     ├─ Render with Playwright if needed                        │
│     ├─ Build AI prompt with rendered content                   │
│     └─ Parse and return {news[], events[]}                     │
│                                                                 │
│  2. saveNewsItems(poiId, news[]) - Dedupe & save               │
│  3. saveEventItems(poiId, events[]) - Dedupe & save            │
│  4. batchCollectNews(poiIds[], jobId) - Parallel processing    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 JavaScript Renderer Service                     │
│  (backend/services/jsRenderer.js)                               │
│                                                                 │
│  1. isJavaScriptHeavySite(url)                                  │
│     ├─ Check domain patterns (wix.com, squarespace.com, etc.)  │
│     ├─ Check HTTP headers (x-wix-request-id, server: Pepyaka)  │
│     └─ Check HTML signatures (wixstatic, parastorage, etc.)    │
│                                                                 │
│  2. renderJavaScriptPage(url, options)                          │
│     ├─ Launch headless Chromium via Playwright                 │
│     ├─ Navigate to URL, wait for networkidle                   │
│     ├─ Wait additional time for JS execution (default 3s)      │
│     ├─ Extract: document.body.innerText, innerHTML, title      │
│     └─ Return {text, html, title, success}                     │
│                                                                 │
│  3. extractEventContent(text) - [DEPRECATED]                    │
│     └─ Originally filtered content, now using full text        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Playwright / Chromium                        │
│  - Headless browser execution                                   │
│  - JavaScript rendering engine                                  │
│  - DOM manipulation and content extraction                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   AI Search Factory                             │
│  (backend/services/aiSearchFactory.js)                          │
│                                                                 │
│  - Selects AI provider based on configuration                   │
│  - Tracks usage per job session                                 │
│  - Auto-fallback on rate limits (429 errors)                    │
│  - Provides unified interface for news/events collection        │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────────┐
│   Google Gemini 2.0 Flash   │ │     Perplexity Sonar Pro        │
│  (geminiService.js)         │ │    (perplexityService.js)       │
│                             │ │                                 │
│  - Google Search grounding  │ │  - Built-in web search          │
│  - Custom prompts           │ │  - Citations included           │
│  - Structured JSON output   │ │  - Structured JSON output       │
│  - Temperature: 0.1         │ │  - Temperature: 0.1             │
└─────────────────────────────┘ └─────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                          │
│                                                                 │
│  pois table:                                                    │
│    - events_url: Dedicated events page URL                      │
│    - news_url: Dedicated news page URL                          │
│                                                                 │
│  poi_news table:                                                │
│    - poi_id, title, summary, source_url, published_at          │
│    - news_type: general|closure|seasonal|maintenance|wildlife   │
│                                                                 │
│  poi_events table:                                              │
│    - poi_id, title, description, start_date, end_date          │
│    - event_type: guided-tour|program|festival|volunteer|etc    │
│    - location_details, source_url                               │
│                                                                 │
│  news_job_status table:                                         │
│    - job_id, status, progress tracking, resumability            │
└─────────────────────────────────────────────────────────────────┘
```

## JavaScript Rendering System

### Detection Logic

The system automatically detects JavaScript-heavy websites using multiple strategies:

**1. Domain Pattern Matching**
```javascript
const jsHeavyDomains = [
  'wix.com', 'wixsite.com', 'wixstatic.com',
  'squarespace.com', 'webflow.io', 'webflow.com',
  'carrd.co', 'weebly.com', 'wordpress.com',
  'sites.google.com'
];
```

**2. HTTP Header Detection**
- `server: Pepyaka` (Wix platform)
- `x-wix-request-id` (Wix-specific header)

**3. HTML Content Signatures**
```javascript
const signatures = [
  'wix.com', 'wixstatic.com', 'parastorage.com',
  'thunderbolt', 'window.wixSite', '__NEXT_DATA__'
];
```

### Rendering Process

When a JavaScript-heavy site is detected:

1. **Launch Browser**: Chromium headless instance via Playwright
2. **Navigate**: Load URL with `waitUntil: 'networkidle'` (network quiet for 500ms)
3. **Wait**: Additional configurable wait (default 3-4 seconds) for lazy-loaded content
4. **Extract**: Capture `document.body.innerText` and `innerHTML`
5. **Cleanup**: Close browser gracefully
6. **Limits**: Extract up to 15,000 characters for AI processing

**Configuration Options:**
```javascript
renderJavaScriptPage(url, {
  timeout: 20000,        // Max page load time (20s)
  waitTime: 4000,        // Additional JS execution wait (4s)
  waitForSelector: null  // Optional specific element to wait for
})
```

## AI Provider System

### Provider Configuration

The system supports two AI providers that can be configured as primary or secondary:

| Provider | Model | Key Features |
|----------|-------|--------------|
| **Gemini** | gemini-2.0-flash | Google Search grounding, high accuracy |
| **Perplexity** | sonar-pro | Built-in web search, includes citations |

**Configuration is stored in the database (`ai_config` table) and can be changed via the Admin Settings UI.**

### AI Search Factory

The `aiSearchFactory.js` module provides a unified interface for AI searches:

```javascript
// Factory exports
import {
  performAiSearch,    // Main search function - auto-selects provider
  getJobStats,        // Get current usage stats for display
  resetJobUsage,      // Reset counters for new job session
  forceProviderSwitch // Manually switch providers (for testing)
} from '../services/aiSearchFactory.js';

// Usage tracking per job session
const stats = getJobStats();
// Returns: { gemini: 15, perplexity: 5, rateLimitHits: 2 }
```

### Fallback Behavior

1. **Usage Limit Fallback**: When primary provider reaches configured limit, switches to secondary
2. **Rate Limit Fallback**: On HTTP 429 errors, automatically retries with secondary provider
3. **Error Tracking**: Rate limit hits are counted and displayed in the UI

### Admin Settings UI

Administrators can configure AI providers via the Settings page:

- **Primary Provider**: Select Gemini or Perplexity as default
- **Primary Limit**: Maximum requests before switching (0 = unlimited)
- **Secondary Provider**: Fallback provider
- **Secondary Limit**: Maximum secondary requests (0 = unlimited)

The UI displays real-time statistics during collection:
```
AI Stats: Gemini: 10 | Perplexity: 5 | Rate Limits: 0
```

## AI Collection Prompt System

### Dual-Tier Filtering Strategy

**Tier 1: Strict Filtering (General Web Search)**
- **Confidence**: 95% that content is specifically about the POI
- **Name Matching**: Must explicitly mention POI by name
- **Context**: "It is better to return empty arrays than false positives"

**Tier 2: Relaxed Filtering (Dedicated URLs Only)**
- **Confidence**: 75% that content is relevant
- **Assumption**: Content on official events/news pages is inherently relevant
- **Directive**: "Include ALL events that appear to be listed on this page"

### Prompt Components

**1. POI Context**
```
Search for recent news and upcoming events SPECIFICALLY about: "{{name}}"
Location type: {{poi_type}}
Activities: {{activities}}

Official website: {{website}}
Dedicated events page: {{eventsUrl}}
Dedicated news page: {{newsUrl}}
```

**2. Priority Sources**
- National Park Service (NPS)
- Ohio Department of Transportation (ODOT)
- Summit Metro Parks
- Cleveland Metroparks
- Local news outlets

**3. Alternative Search Strategies** (for JS-heavy sites)
- Facebook Events (most reliable for organizations)
- Eventbrite, Meetup
- Instagram announcements
- Google Business Profile
- Local event aggregators

**4. Rendered Content Injection**
```
RENDERED EVENTS PAGE CONTENT:
We rendered the JavaScript-heavy events page and extracted this content:

[15,000 chars of rendered text]

**SPECIAL INSTRUCTIONS FOR RENDERED EVENTS PAGE:**
Since this content comes directly from the organization's dedicated events page,
use RELAXED requirements:
- You only need 75% confidence (not 95%) that an event is relevant
- Events listed on this official page can be assumed to be associated with
  "Open Trail Collective" even if the name isn't explicitly mentioned
- Include ALL events that appear to be listed on this page
```

### Response Format

The AI returns structured JSON:

```json
{
  "news": [
    {
      "title": "Trail Closure on Blue Hen Falls Path",
      "summary": "Blue Hen Falls trail temporarily closed for bridge repair...",
      "source_name": "NPS.gov",
      "source_url": "https://www.nps.gov/cuva/...",
      "published_date": "2026-01-15",
      "news_type": "closure"
    }
  ],
  "events": [
    {
      "title": "Guided Hike: Winter Bird Watching",
      "description": "Join naturalists for a winter bird watching hike...",
      "start_date": "2026-02-10",
      "end_date": null,
      "event_type": "guided-tour",
      "location_details": "Meets at Blue Hen Falls Trailhead",
      "source_url": "https://example.org/events/winter-birds"
    }
  ]
}
```

## Database Schema

### POI Extensions

```sql
ALTER TABLE pois ADD COLUMN events_url VARCHAR(500);
ALTER TABLE pois ADD COLUMN news_url VARCHAR(500);
```

### News Table

```sql
CREATE TABLE poi_news (
  id SERIAL PRIMARY KEY,
  poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  summary TEXT,
  source_name VARCHAR(200),
  source_url VARCHAR(1000),
  published_at TIMESTAMP,
  news_type VARCHAR(50), -- general|closure|seasonal|maintenance|wildlife
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_poi_news_poi_id ON poi_news(poi_id);
CREATE INDEX idx_poi_news_published ON poi_news(published_at DESC);
```

### Events Table

```sql
CREATE TABLE poi_events (
  id SERIAL PRIMARY KEY,
  poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  event_type VARCHAR(50), -- guided-tour|program|festival|volunteer|educational|concert
  location_details VARCHAR(500),
  source_url VARCHAR(1000),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_poi_events_poi_id ON poi_events(poi_id);
CREATE INDEX idx_poi_events_start_date ON poi_events(start_date);
```

### Deduplication Logic

**News Items:**
```sql
SELECT id FROM poi_news
WHERE poi_id = $1
  AND title = $2
  AND published_at = $3
LIMIT 1
```

**Events:**
```sql
SELECT id FROM poi_events
WHERE poi_id = $1
  AND title = $2
  AND start_date = $3
LIMIT 1
```

## API Endpoints

### Single POI Collection

**POST /api/admin/pois/:id/news/collect**

Collects news and events for a single POI.

**Request:**
```bash
curl -X POST http://localhost:3001/api/admin/pois/123/news/collect \
  -H "Cookie: session=..." \
  --cookie-jar cookies.txt
```

**Response:**
```json
{
  "success": true,
  "message": "News collection completed for Open Trail Collective",
  "newsFound": 5,
  "newsSaved": 3,
  "eventsFound": 8,
  "eventsSaved": 6
}
```

**Process:**
1. Fetch POI from database (id, name, events_url, news_url, etc.)
2. Call `collectNewsForPoi(pool, poi)`
3. Save results with deduplication
4. Return counts

### Batch Collection

**POST /api/admin/news/batch-collect**

Collects news/events for multiple POIs in parallel.

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
  "message": "News collection started for 5 POIs",
  "jobId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Process:**
1. Create job record in `news_job_status` table
2. Launch pg-boss background job
3. Process POIs in parallel (concurrency: 15)
4. Update job progress as POIs complete
5. Mark job complete when done

**Job Status Tracking:**
```sql
SELECT status, processed_count, total_count, error_message
FROM news_job_status
WHERE job_id = $1
```

### Cancel Batch Job

**PUT /api/admin/news/batch-collect/:jobId/cancel**

Cancels a running batch job.

**Response:**
```json
{
  "success": true,
  "message": "Job 550e8400-e29b-41d4-a716-446655440000 cancelled"
}
```

### Read Endpoints

**GET /api/pois/:id/news?limit=20**

Returns news items for a POI, newest first.

**GET /api/pois/:id/events**

Returns upcoming events for a POI, sorted by start_date.

**GET /api/admin/news/job-status/:jobId**

Returns batch job status and progress.

**GET /api/admin/news/ai-stats**

Returns current AI provider usage statistics.

```json
{
  "gemini": 15,
  "perplexity": 5,
  "rateLimitHits": 2
}
```

## Job Scheduling

### Daily Scheduled Collection

The system uses pg-boss for reliable job scheduling with PostgreSQL as the backing store.

**Schedule:** Daily at 6:00 AM Eastern Time

```javascript
// Cron expression: 0 6 * * * (6 AM daily)
await scheduleNewsCollection('0 6 * * *');
```

**Job Types:**

| Job Name | Purpose |
|----------|---------|
| `news-collection` | Scheduled daily collection for all POIs |
| `news-collection-poi` | Individual POI processing (internal) |
| `news-batch-collection` | Admin-triggered batch collection |

### Batch Job Lifecycle

1. **Submit**: Admin clicks "Update News & Events" → creates job in `news_job_status` table
2. **Queue**: Job submitted to pg-boss queue for background processing
3. **Process**: Worker picks up job, processes POIs with configurable concurrency
4. **Progress**: Real-time updates written to database, polled by frontend
5. **Complete/Cancel**: Job finishes normally or is cancelled by admin

### Cancellation Flow

```
Admin clicks Cancel → PUT /api/admin/news/batch-collect/:id/cancel
                    → Database status set to 'cancelled'
                    → Worker checks status before each new POI
                    → In-flight POIs complete naturally
                    → No new POIs started
                    → Final status remains 'cancelled'
```

## Frontend Components

### Sidebar News/Events Tabs

**File:** `frontend/src/components/Sidebar.jsx`

**Components:**
- `PoiNews({ poiId, isAdmin, editMode, onCountChange })`
- `PoiEvents({ poiId, isAdmin, editMode, onCountChange })`

**Features:**
- Scrollable lists with hidden scrollbars
- Sticky refresh buttons (edit mode only)
- Event/News counters on buttons
- Delete functionality (edit mode only)
- Real-time collection feedback

**UI States:**
- **View Mode**: Tab shows count (e.g., "News (6)"), no refresh button
- **Edit Mode**: Refresh button shows count (e.g., "🔍 Refresh News (6)")

**Refresh Button (Edit Mode):**
```javascript
<button className="refresh-content-btn" onClick={handleCollectNews}>
  {collecting ? '🔄 Searching...' : `🔍 Refresh News${news.length > 0 ? ` (${news.length})` : ''}`}
</button>
```

**CSS Styling:**
```css
.poi-tab-actions {
  position: sticky;
  top: 0;
  padding: 1rem;
  background: #f8f9fa;
  border-bottom: 1px solid #dee2e6;
  z-index: 10;
}

.poi-news-list, .poi-events-list {
  max-height: calc(100vh - 300px);
  overflow-y: auto;
  scrollbar-width: none; /* Firefox */
}
```

### Map Batch Collection Button

**File:** `frontend/src/App.jsx`

**Feature:** "Update News & Events" button on map (edit mode only)

**Process:**
1. Collect visible POI IDs from current map viewport
2. POST to `/api/admin/news/batch-collect` with poiIds
3. Display progress notification
4. Poll job status until complete

## Configuration

### Environment Variables

```bash
# AI Provider API Keys
GEMINI_API_KEY=your_gemini_api_key_here
PERPLEXITY_API_KEY=your_perplexity_api_key_here

# Database
POSTGRES_USER=rotv
POSTGRES_PASSWORD=rotv
POSTGRES_DB=rotv
```

### AI Configuration Table

The `ai_config` table stores provider settings:

```sql
CREATE TABLE ai_config (
  key VARCHAR(100) PRIMARY KEY,
  value VARCHAR(500) NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Default values
INSERT INTO ai_config (key, value) VALUES
  ('primary_provider', 'gemini'),
  ('secondary_provider', 'perplexity'),
  ('primary_limit', '0'),      -- 0 = unlimited
  ('secondary_limit', '0');
```

### Dependencies

**Backend:**
```json
{
  "@google/generative-ai": "^0.2.0",
  "pg-boss": "^10.0.0"
}
```

**Note:** Perplexity API uses standard HTTP requests, no additional package required.

**Playwright Infrastructure:**

Playwright and Chromium browsers are installed in the **base container image** (`Containerfile.base`):
- Base image installs Playwright globally and downloads Chromium browsers
- Base image records the version in `/etc/playwright-version`
- App image installs the matching Playwright npm package version

This ensures browser binaries match the npm package and avoids large downloads on every build.

## Performance Considerations

### Rendering Timeouts

- **Page Load**: 20 seconds max (configurable)
- **JS Execution Wait**: 3-4 seconds (configurable)
- **Network Idle**: 500ms of no network activity

### Parallel Processing

- **Batch Jobs**: 15 concurrent POIs
- **Character Limits**: 15,000 chars per rendered page
- **AI Request Rate**: Controlled by Gemini API limits

### Caching Strategy

**No caching currently implemented.** Future considerations:
- Cache rendered pages for 1 hour
- Cache AI responses for 24 hours
- Invalidate on manual refresh

## Error Handling

### Playwright Failures

```javascript
if (rendered.success) {
  // Use rendered content
} else {
  console.log(`Failed to render: ${rendered.error}`);
  // Fall back to standard web search without rendered content
}
```

### AI Parsing Failures

```javascript
const jsonMatch = response.match(/\{[\s\S]*\}/);
if (!jsonMatch) {
  console.log('No JSON found in AI response');
  return { news: [], events: [] };
}
```

### Database Errors

- Duplicate insertions are silently skipped (deduplication)
- Foreign key violations logged but don't fail batch jobs
- Transaction rollbacks on critical errors

## Testing

### Test Script

**File:** `backend/test-playwright.js`

```bash
cd backend
node test-playwright.js
```

**What it tests:**
1. `isJavaScriptHeavySite()` - Detection accuracy
2. `renderJavaScriptPage()` - Full rendering pipeline
3. `extractEventContent()` - Content extraction (deprecated)
4. Output preview - First 1000 chars of rendered content

### Manual Testing

1. **Single POI**: Navigate to POI in edit mode, click "🔍 Refresh Events"
2. **Batch Collection**: Click "Update News & Events" on map
3. **Verify Results**: Check News/Events tabs for new content

### Expected Results

**Open Trail Collective (Wix site):**
- Should detect as JS-heavy: ✓
- Should render with Playwright: ✓
- Should extract 8 events: ✓
- Should save deduplicated events: ✓

## Future Enhancements

### Planned Improvements

1. **Incremental Updates**: Only fetch new content since last collection
2. **Event Expiration**: Auto-delete past events after 30 days
3. **News Archival**: Move old news to archive table
4. **Image Extraction**: Pull event images from rendered pages
5. **Calendar Export**: iCal/Google Calendar integration
6. **Webhooks**: Notify on new events/news
7. **RSS Feeds**: Generate feeds per POI

### Optimization Opportunities

1. **Browser Pooling**: Reuse Playwright browser instances
2. **Selective Rendering**: Only render if content changed (ETag/Last-Modified)
3. **Smart Scheduling**: Auto-refresh high-traffic POIs more frequently
4. **AI Model Tuning**: Fine-tune prompts based on success rates
5. **Response Caching**: Cache AI responses with TTL

## Troubleshooting

### Common Issues

**1. "No events found" despite visible events on page**
- Check if character limit (15,000) is truncating content
- Verify AI confidence threshold (should be 75% for dedicated URLs)
- Increase `waitTime` if lazy-loaded content not appearing

**2. Playwright browser fails to launch**
- Verify base image was built with Playwright: check `/etc/playwright-version` exists
- Ensure app image installed matching Playwright npm version
- Check Settings > Data Collection for Playwright status indicator
- System dependencies (libx11, libgbm, etc.) are pre-installed in base image

**3. Events duplicating on refresh**
- Check deduplication query (title + start_date match)
- Verify event titles are consistent across refreshes

**4. Slow collection times**
- Reduce `waitTime` from 4s to 2s if acceptable
- Lower concurrency from 15 to 10
- Check Gemini API rate limits

### Debug Logging

Enable verbose logging:
```javascript
console.log(`[AI Research] Starting search for: ${poi.name}`);
console.log(`[AI Research] Events URL: ${eventsUrl}`);
console.log(`[JS Renderer] Detected JS-heavy site: ${url}`);
console.log(`[JS Renderer] Rendered ${content.text.length} chars`);
```

## Changelog

**Version 1.4.1 (2026-02-03)**
- 📝 Updated docs to reflect Playwright/Chromium installation in base container image
- 📝 Added Playwright status indicator reference in troubleshooting

**Version 1.4.0 (2026-01-22)**
- ✨ Added multi-provider AI support (Gemini + Perplexity with automatic fallback)
- ✨ Added AI provider configuration UI in Admin Settings
- ✨ Added real-time AI usage statistics display during collection
- ✨ Added batch job cancellation feature with Cancel button
- ✨ Added cancelled status badge for stopped jobs
- 🔧 Simplified scheduling to single daily job at 6 AM Eastern (removed tier system)
- 🐛 Fixed single-POI collection not respecting provider fallback limits
- 🐛 Fixed Primary Limit input UX (step by 100, empty field shows 0)
- 📝 Updated architecture documentation

**Version 1.3.0 (2026-01-20)**
- ✨ Added Playwright JavaScript rendering for Wix/Squarespace sites
- ✨ Implemented dual-tier filtering (strict vs. relaxed)
- ✨ Added sticky refresh buttons in sidebar
- ✨ Added event/news counters on UI buttons
- 🐛 Fixed missing events from JS-heavy pages (6→8 events)
- 📝 Created comprehensive architecture documentation

**Version 1.2.0 (2025-12)**
- Added `events_url` and `news_url` fields to POI schema
- Created dedicated refresh buttons per POI
- Separated batch collection from individual POI refresh

**Version 1.0.0 (2025-11)**
- Initial News & Events collection system
- Google Gemini integration with search grounding
- Basic web search without JS rendering
