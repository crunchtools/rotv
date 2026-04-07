# Serper Integration Documentation

## Overview

Serper integration adds Layer 2 (external news) to the news collection system, providing comprehensive news coverage through two parallel layers:

**Layer 1:** Official POI URLs (news_url field) - primary source
**Layer 2:** Serper external news - runs for every POI

Both layers use the same Playwright rendering → Gemini extraction pipeline.

---

## Architecture

```
News Collection Flow:
├── Layer 1: Official POI Content
│   ├── If news_url exists: render with Playwright
│   ├── Gemini classifier (LISTING/DETAIL/HYBRID)
│   └── Extract structured news items
│
└── Layer 2: External News via Serper (NEW)
    ├── Geographic grounding via PostGIS
    │   └── Query: "POI_NAME BOUNDARY_NAME news"
    ├── Serper API search (returns 9-10 URLs)
    ├── Render each URL with Playwright (1.5s delay)
    ├── Gemini extraction (no search grounding)
    └── Deduplicate with Layer 1 by title
```

---

## Geographic Grounding

### How It Works

Uses PostGIS spatial queries to find the smallest boundary polygon containing each POI:

```sql
SELECT boundary.name
FROM pois AS point
LEFT JOIN pois AS boundary
  ON boundary.poi_type = 'boundary'
  AND ST_Contains(
    ST_SetSRID(boundary.geometry::geometry, 4326),
    ST_SetSRID(ST_MakePoint(point.longitude, point.latitude), 4326)
  )
WHERE point.id = $1
  AND point.poi_type = 'point'
ORDER BY ST_Area(boundary.geometry::geometry) ASC  -- Smallest boundary first
LIMIT 1
```

### Examples

- **POI in CVNP:** "Ledges Trail" → "Ledges Trail Cuyahoga Valley National Park news"
- **POI in Akron:** "Main Street" → "Main Street Akron news"
- **POI in smaller park:** "Oak Grove Park" (inside Brecksville) → "Oak Grove Park news" (park wins)
- **POI outside boundaries:** "Cleveland Museum of Art" → "Cleveland Museum of Art news" (no grounding)

### Test Results

| POI | Without Grounding | With Grounding | Improvement |
|-----|-------------------|----------------|-------------|
| Ledges Trail | 20% Ohio / 40% Iowa | 100% Ohio / 0% Iowa | +80 pts |
| Main Street Akron | 0% Akron | 100% Akron | +100 pts |
| Public Library | 0% local | 80% local | +80 pts |
| Community Center | 0% local / 40% NC | 90% local / 0% NC | +90 pts |

**Average improvement: +87 percentage points**

---

## Implementation Details

### Phase 1: Serper Service

**File:** `backend/services/serperService.js`

**Functions:**
1. `getGeographicContext(pool, poiId)` - PostGIS spatial query
2. `searchNewsUrls(pool, poi)` - Serper API with grounding
3. `testSerperApiKey(pool)` - API key validation

**Tests:** `backend/tests/serperService.unit.test.js` (16 test cases)

### Phase 3: Integration

**File:** `backend/services/newsService.js`

**Integration Point:** Lines 1218-1388

**Flow:**
1. Layer 1 completes (official URLs)
2. If `collectionType !== 'events'`:
   - Call `searchNewsUrls(pool, poi)`
   - Render each Serper URL with Playwright
   - Extract news with Gemini (no search grounding)
   - Deduplicate by title (case-insensitive)
   - Merge with Layer 1 results

**Progress Tracking Phases:**
- `serper_search`: "Searching for external news coverage..."
- `extracting_external_news`: "Extracting news from N external sources..."

### Phase 4: Admin Settings UI

**File:** `frontend/src/components/DataCollectionSettings.jsx`

**UI Components:**
- API key input (password field)
- Save button
- Test button (appears when key configured)
- Status indicator (configured/not configured)
- Help text with cost estimate

**API Endpoints:**
- `PUT /api/admin/settings/serper_api_key` - Save key
- `POST /api/admin/settings/serper-api-key/test` - Test key

---

## Configuration

### 1. Set Serper API Key

**Via UI (Recommended):**
1. Navigate to Settings → Data Collection
2. Scroll to "Serper API Key" section
3. Enter your API key
4. Click "Save API Key"
5. Click "Test API Key" to validate

**Via Direct Database:**
```sql
INSERT INTO admin_settings (key, value)
VALUES ('serper_api_key', 'your-api-key-here')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

**Via API:**
```bash
curl -X PUT http://localhost:8080/api/admin/settings/serper_api_key \
  -H "Content-Type: application/json" \
  -d '{"value":"your-api-key-here"}' \
  --cookie "session=..."
```

### 2. Get Serper API Key

1. Go to https://serper.dev/
2. Sign up for account
3. Navigate to Dashboard → API Keys
4. Copy your API key

**Pricing:** $50 for 5,000 credits (1 credit per search)
**Cost for ROTV:** ~$0.03/month for 100 POIs monthly collection

---

## Testing

### Unit Tests

Run Serper service unit tests:
```bash
./run.sh test
```

Tests cover:
- Geographic grounding (POI inside/outside boundaries, nested boundaries)
- Serper API integration (query construction, error handling)
- API key validation

### Manual Testing

#### 1. Test API Key Configuration

```bash
# Start container
./run.sh start

# Test API key endpoint
curl -X POST http://localhost:8080/api/admin/settings/serper-api-key/test \
  --cookie "session=..." | jq

# Expected response:
# {"success": true, "message": "Serper API key is valid"}
```

#### 2. Test Geographic Grounding

**Test POI inside CVNP:**
```sql
-- Get POI ID for Ledges Trail
SELECT id, name FROM pois WHERE name LIKE '%Ledges%';

-- Test grounding function
SELECT * FROM get_geographic_context(123);
-- Expected: "Cuyahoga Valley National Park"
```

**Test POI in municipality:**
```sql
-- Get POI in Akron
SELECT id, name FROM pois WHERE name LIKE '%Main Street%' AND poi_type = 'point';

-- Test grounding
SELECT * FROM get_geographic_context(456);
-- Expected: "Akron"
```

#### 3. Test End-to-End News Collection

**Trigger news collection for test POI:**
1. Navigate to Jobs tab in admin UI
2. Click "Collect News"
3. Filter to single POI (e.g., Peninsula Art Academy)
4. Click "Start Job"
5. Monitor progress in real-time

**Check logs:**
```bash
./run.sh logs | grep -A 5 "\[Serper\]"
```

**Expected log output:**
```
[Serper] 🔍 Layer 2: Searching for external news coverage...
[Serper] Found 10 URLs (grounded: true, query: "Peninsula Art Academy Cuyahoga Valley National Park news")
[Serper] Rendering https://example.com/news1...
[Serper] ✓ Rendered https://example.com/news1 (2847 chars)
...
[Serper] Rendered 8 of 10 URLs
[Serper] ✓ Extracted 5 news items from external sources
[Serper] Adding 3 unique items from external sources
```

#### 4. Verify Results

**Check database:**
```sql
-- Get recent news for POI
SELECT id, title, source_url, published_date, created_at
FROM news
WHERE poi_id = 123
ORDER BY created_at DESC
LIMIT 20;

-- Check for external sources (non-POI URLs)
SELECT COUNT(*) as external_count
FROM news
WHERE poi_id = 123
  AND source_url NOT LIKE '%' || (SELECT more_info_link FROM pois WHERE id = 123) || '%';
```

**Check UI:**
1. Navigate to POI detail page
2. Click "News" tab
3. Verify external news items appear
4. Check source URLs are from external domains

---

## Troubleshooting

### API Key Issues

**Error: "Serper API key not configured"**
- Verify key is saved in admin_settings table
- Check Settings → Data Collection shows "configured"

**Error: "Serper API error: 401"**
- API key is invalid
- Get new key from https://serper.dev/api-key
- Re-save in Settings UI
- Click "Test API Key" to validate

**Error: "Serper API error: 429"**
- Rate limit exceeded
- Wait before retrying
- Check if 1.5s delay is working

### Geographic Grounding Issues

**No grounding for POIs that should be grounded:**
- Check POI has valid lat/long coordinates
- Verify boundary polygons exist in database:
  ```sql
  SELECT name, poi_type FROM pois WHERE poi_type = 'boundary';
  ```
- Check PostGIS spatial query:
  ```sql
  SELECT ST_Contains(
    ST_SetSRID(boundary.geometry::geometry, 4326),
    ST_SetSRID(ST_MakePoint(-81.5156, 41.2415), 4326)
  ) as contains
  FROM pois WHERE poi_type = 'boundary';
  ```

**Wrong boundary selected (larger instead of smaller):**
- Verify `ORDER BY ST_Area ASC` in query
- Check boundary polygons don't overlap incorrectly

### Integration Issues

**Layer 2 not running:**
- Check logs for "[Serper]" messages
- Verify `collectionType !== 'events'` (Serper only runs for news)
- Check API key is configured

**No external news found:**
- Check Serper returned URLs (log shows "Found N URLs")
- Verify Playwright rendered URLs successfully
- Check Gemini extraction didn't filter out all results
- Review mission scope filtering (CVNP themes)

**Duplicates not being removed:**
- Check title-based deduplication logic
- Verify titles are being normalized (lowercase, trim)
- Review logs for "Adding N unique items from external sources"

### Performance Issues

**News collection takes too long:**
- Check 1.5s delay between Serper URL renders
- Verify Playwright timeout settings (30s/60s)
- Monitor number of Serper URLs being rendered (should be ~10)

**Gemini extraction slow:**
- Check if using Gemini without search grounding (faster)
- Verify `forceProvider: 'gemini'` is set
- Monitor Gemini API response times

---

## Monitoring

### Key Metrics

**Serper API Usage:**
- Credits per POI: 1 (one search query)
- URLs per query: 9-10 average
- Date coverage: ~52% of URLs

**Geographic Grounding:**
- Grounding rate: % of POIs with boundary context
- Relevance improvement: 80-100% with grounding

**Layer 2 Performance:**
- URLs rendered per POI: Target 8-10 (some may fail)
- News items extracted: Varies by POI
- Unique items added: After deduplication

### Log Monitoring

**Search for errors:**
```bash
./run.sh logs | grep -i "serper.*error"
```

**Monitor progress:**
```bash
./run.sh logs | grep "\[Serper\]" | tail -20
```

**Check grounding effectiveness:**
```bash
./run.sh logs | grep "grounded: true"
```

---

## API Reference

### Serper Service Functions

#### `getGeographicContext(pool, poiId)`

**Purpose:** Get smallest boundary containing POI

**Parameters:**
- `pool` - Database connection pool
- `poiId` - POI ID to check

**Returns:** `Promise<string>` - Boundary name or empty string

**Example:**
```javascript
const context = await getGeographicContext(pool, 123);
// Returns: "Cuyahoga Valley National Park"
```

#### `searchNewsUrls(pool, poi)`

**Purpose:** Search for external news with geographic grounding

**Parameters:**
- `pool` - Database connection pool
- `poi` - POI object `{id, name, latitude, longitude}`

**Returns:** `Promise<object>`
```javascript
{
  query: "Ledges Trail Cuyahoga Valley National Park news",
  grounded: true,
  groundingContext: "Cuyahoga Valley National Park",
  urls: [
    {url: "https://...", title: "...", snippet: "...", date: "2026-04-01"},
    ...
  ],
  credits: 1
}
```

**Throws:**
- `Error` - If API key not configured
- `Error` - If Serper API returns error

#### `testSerperApiKey(pool)`

**Purpose:** Validate API key

**Parameters:**
- `pool` - Database connection pool

**Returns:** `Promise<boolean>` - True if valid

**Example:**
```javascript
const isValid = await testSerperApiKey(pool);
// Returns: true
```

---

## Performance Characteristics

### Timing

**Per POI (Layer 2 only):**
- Serper API call: ~1-2 seconds
- Render 10 URLs with 1.5s delay: ~20-25 seconds
- Gemini extraction: ~3-5 seconds
- **Total:** ~25-32 seconds per POI

**Full News Collection (both layers):**
- Layer 1 (official URLs): ~10-15 seconds
- Layer 2 (Serper): ~25-32 seconds
- **Total:** ~35-47 seconds per POI

### Costs

**Serper API:**
- Cost per search: 1 credit
- Credit price: $50 / 5,000 = $0.01
- Cost per POI: $0.01
- **Monthly (100 POIs):** $1.00
- **Monthly (300 POIs):** $3.00

**Gemini API:**
- Extraction cost: ~$0.002 per POI (Layer 2)
- Combined with Layer 1: ~$0.005 per POI total

**Total Monthly Cost (100 POIs):**
- Serper: $1.00
- Gemini: $0.50
- **Total: ~$1.50/month**

---

## Security Considerations

### API Key Storage

- Stored in `admin_settings` table
- Masked in GET /settings response
- Only accessible to admin users
- Never logged or exposed in UI

### SQL Injection Prevention

- All queries use parameterized statements ($1, $2)
- No string concatenation in SQL
- PostGIS functions handle geometry safely

### Rate Limiting

- 1.5 second delay between URL renders
- Prevents overwhelming Serper API
- Matches Events system timing

---

## Future Enhancements

### Potential Improvements

1. **Usage Tracking:**
   - Track Serper credits used per job
   - Display in admin UI
   - Alert when approaching monthly budget

2. **Quality Metrics:**
   - Track external news acceptance rate
   - Monitor deduplication effectiveness
   - Measure geographic relevance

3. **Caching:**
   - Cache Serper results for 24 hours
   - Reduce API calls for repeated POIs
   - Save costs on re-runs

4. **Additional Boundaries:**
   - Cleveland Metroparks polygons
   - Summit County Metro Parks
   - Individual park boundaries
   - See issue #198

5. **Advanced Filtering:**
   - Source domain reputation
   - Content freshness scoring
   - Relevance threshold tuning

---

## Related Documentation

- **Architecture:** `docs/NEWS_EVENTS_ARCHITECTURE.md`
- **Development:** `docs/DEVELOPMENT_ARCHITECTURE.md`
- **Testing:** `docs/CI_CD_TESTING.md`
- **Issue:** GitHub issue #196

---

## Change Log

**2026-04-06:** Initial implementation (v1.0.0)
- Phase 1: Serper service with PostGIS grounding
- Phase 3: Integration with news collection
- Phase 4: Admin Settings UI
- Test results: 87% average relevance improvement

