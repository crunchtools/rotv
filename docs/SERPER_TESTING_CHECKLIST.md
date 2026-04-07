# Serper Integration Testing Checklist

## Pre-Testing Setup

- [ ] Container is running (`./run.sh start`)
- [ ] Have valid Serper API key from https://serper.dev/
- [ ] Logged into admin UI
- [ ] Have test POI IDs ready

---

## Phase 1: API Key Configuration

### Test 1.1: Save API Key
- [ ] Navigate to Settings → Data Collection
- [ ] Find "Serper API Key" section
- [ ] Verify status shows "API key not configured" (red indicator)
- [ ] Enter API key in password field
- [ ] Click "Save API Key"
- [ ] Verify success message appears
- [ ] Verify status changes to "API key configured" (green indicator)
- [ ] Verify Test button appears

### Test 1.2: Test API Key
- [ ] Click "Test API Key" button
- [ ] Verify success message: "Serper API key is valid and working!"
- [ ] Check browser console for errors (should be none)

### Test 1.3: Invalid API Key
- [ ] Enter invalid API key (e.g., "invalid-key-123")
- [ ] Click "Save API Key"
- [ ] Click "Test API Key"
- [ ] Verify error message appears
- [ ] Re-enter valid key and save

### Test 1.4: Database Verification
```sql
SELECT key,
       CASE WHEN value IS NOT NULL THEN 'SET' ELSE 'NOT SET' END as status
FROM admin_settings
WHERE key = 'serper_api_key';
```
- [ ] Verify query returns "SET" status

---

## Phase 2: Geographic Grounding

### Test 2.1: POI Inside CVNP

**Test POI:** Ledges Trail (or similar CVNP POI)

```sql
-- Get POI ID
SELECT id, name, latitude, longitude
FROM pois
WHERE name LIKE '%Ledges%'
  AND poi_type = 'point';

-- Test grounding (replace 123 with actual POI ID)
SELECT boundary.name as grounding_context
FROM pois AS point
LEFT JOIN pois AS boundary
  ON boundary.poi_type = 'boundary'
  AND ST_Contains(
    ST_SetSRID(boundary.geometry::geometry, 4326),
    ST_SetSRID(ST_MakePoint(point.longitude, point.latitude), 4326)
  )
WHERE point.id = 123
  AND point.poi_type = 'point'
ORDER BY ST_Area(boundary.geometry::geometry) ASC
LIMIT 1;
```

- [ ] Query returns "Cuyahoga Valley National Park"
- [ ] Not empty string
- [ ] Not null

### Test 2.2: POI Inside Municipality

**Test POI:** Any POI in Akron, Brecksville, etc.

```sql
-- Find POI in Akron
SELECT id, name, latitude, longitude
FROM pois
WHERE poi_type = 'point'
  AND ST_Contains(
    (SELECT ST_SetSRID(geometry::geometry, 4326) FROM pois WHERE name = 'Akron' AND poi_type = 'boundary'),
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
  )
LIMIT 1;

-- Test grounding (replace 456 with actual POI ID)
SELECT boundary.name as grounding_context
FROM pois AS point
LEFT JOIN pois AS boundary
  ON boundary.poi_type = 'boundary'
  AND ST_Contains(
    ST_SetSRID(boundary.geometry::geometry, 4326),
    ST_SetSRID(ST_MakePoint(point.longitude, point.latitude), 4326)
  )
WHERE point.id = 456
  AND point.poi_type = 'point'
ORDER BY ST_Area(boundary.geometry::geometry) ASC
LIMIT 1;
```

- [ ] Query returns municipality name (e.g., "Akron")
- [ ] Not "Cuyahoga Valley National Park" (unless POI is in both)

### Test 2.3: POI Outside All Boundaries

**Test POI:** Cleveland Museum of Art or other Cleveland POI

```sql
-- Get POI outside boundaries
SELECT id, name, latitude, longitude
FROM pois
WHERE name LIKE '%Cleveland%'
  AND poi_type = 'point'
LIMIT 1;

-- Test grounding (replace 789 with actual POI ID)
SELECT boundary.name as grounding_context
FROM pois AS point
LEFT JOIN pois AS boundary
  ON boundary.poi_type = 'boundary'
  AND ST_Contains(
    ST_SetSRID(boundary.geometry::geometry, 4326),
    ST_SetSRID(ST_MakePoint(point.longitude, point.latitude), 4326)
  )
WHERE point.id = 789
  AND point.poi_type = 'point'
ORDER BY ST_Area(boundary.geometry::geometry) ASC
LIMIT 1;
```

- [ ] Query returns empty result or NULL
- [ ] Grounding context should be empty string in logs

---

## Phase 3: End-to-End News Collection

### Test 3.1: Trigger News Collection Job

**Test POI:** Peninsula Art Academy (obscure POI, good test case)

1. Navigate to Jobs tab
2. Click "Collect News"
3. Filter to single POI:
   - [ ] Select Peninsula Art Academy (or test POI)
   - [ ] Uncheck "Collect Events"
   - [ ] Check "Collect News"
4. Click "Start Job"
5. Monitor progress panel

**Expected Progress Phases:**
- [ ] "initializing" → "Starting news search..."
- [ ] "classifying_news" or "rendering_news" → Layer 1
- [ ] "serper_search" → "Searching for external news coverage..."
- [ ] "extracting_external_news" → "Extracting news from N external sources..."
- [ ] "complete" → "Complete! Found X news"

### Test 3.2: Monitor Logs

```bash
# Watch logs in real-time
./run.sh logs -f | grep -E "\[Serper\]|\[AI Research\]"
```

**Expected log output:**
- [ ] `[Serper] 🔍 Layer 2: Searching for external news coverage...`
- [ ] `[Serper] Found X URLs (grounded: true/false, query: "...")`
- [ ] `[Serper] Rendering https://...`
- [ ] `[Serper] ✓ Rendered https://... (XXXX chars)`
- [ ] `[Serper] Rendered X of Y URLs`
- [ ] `[Serper] ✓ Extracted X news items from external sources`
- [ ] `[Serper] Adding X unique items from external sources`

**Grounding verification:**
- [ ] Query in logs includes boundary name (if applicable)
- [ ] Example: "Peninsula Art Academy Cuyahoga Valley National Park news"

### Test 3.3: Verify Results in Database

```sql
-- Get news for test POI (replace 123 with actual POI ID)
SELECT
  id,
  title,
  source_url,
  source_name,
  published_date,
  created_at
FROM news
WHERE poi_id = 123
ORDER BY created_at DESC
LIMIT 20;
```

**Verify:**
- [ ] Results include both Layer 1 and Layer 2 news
- [ ] Layer 2 news has external source URLs (not POI website)
- [ ] No duplicate titles (case-insensitive check)
- [ ] Published dates populated when available
- [ ] All news items have valid source_url

### Test 3.4: Check Deduplication

```sql
-- Check for duplicate titles (should be 0)
SELECT title, COUNT(*) as count
FROM news
WHERE poi_id = 123
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY LOWER(TRIM(title))
HAVING COUNT(*) > 1;
```

- [ ] Query returns no results (no duplicates)

### Test 3.5: Verify in UI

1. Navigate to POI detail page (Peninsula Art Academy)
2. Click "News" tab

**Verify:**
- [ ] News items displayed
- [ ] Both Layer 1 (if available) and Layer 2 news visible
- [ ] External sources have different domains than POI website
- [ ] Dates displayed correctly
- [ ] Source links work when clicked

---

## Phase 4: Edge Cases & Error Handling

### Test 4.1: POI Without news_url (Layer 2 Only)

```sql
-- Find POI without news_url
SELECT id, name, news_url
FROM pois
WHERE news_url IS NULL OR news_url = ''
LIMIT 1;
```

1. Run news collection for this POI
2. **Verify:**
   - [ ] Layer 1 skipped (no official news URL)
   - [ ] Layer 2 still runs (Serper search)
   - [ ] External news items collected
   - [ ] Logs show "[Serper]" messages

### Test 4.2: POI With news_url (Both Layers)

```sql
-- Find POI with news_url
SELECT id, name, news_url
FROM pois
WHERE news_url IS NOT NULL AND news_url != ''
LIMIT 1;
```

1. Run news collection for this POI
2. **Verify:**
   - [ ] Layer 1 runs first (official news URL rendered)
   - [ ] Layer 2 runs after (Serper search)
   - [ ] Results merged
   - [ ] Deduplication works (no duplicates between layers)

### Test 4.3: Missing API Key

1. Delete Serper API key from database:
```sql
DELETE FROM admin_settings WHERE key = 'serper_api_key';
```

2. Run news collection
3. **Verify:**
   - [ ] Error logged: "Serper API key not configured"
   - [ ] Layer 1 still works (official news collected)
   - [ ] Layer 2 fails gracefully (doesn't crash job)
   - [ ] Job completes successfully

4. Re-configure API key via UI

### Test 4.4: Invalid API Key

1. Set invalid API key:
```sql
UPDATE admin_settings
SET value = 'invalid-key-123'
WHERE key = 'serper_api_key';
```

2. Run news collection
3. **Verify:**
   - [ ] Error logged: "Serper API error: 401"
   - [ ] Layer 1 still works
   - [ ] Layer 2 fails gracefully
   - [ ] Job completes

4. Re-configure valid API key

### Test 4.5: Serper Returns No Results

**Test POI:** Very obscure POI unlikely to have news

1. Run news collection
2. **Verify:**
   - [ ] Logs show "Found 0 URLs" or "No external news URLs found"
   - [ ] No errors thrown
   - [ ] Layer 1 results still displayed (if available)
   - [ ] Job completes successfully

### Test 4.6: Playwright Rendering Failures

Monitor logs for URLs that fail to render:

**Expected:**
- [ ] Some URLs may fail (network issues, timeouts, etc.)
- [ ] Logs show "❌ Failed to render" with reason
- [ ] Other URLs continue rendering
- [ ] Job doesn't crash
- [ ] Partial results still extracted

---

## Phase 5: Performance Testing

### Test 5.1: Timing Verification

```bash
# Monitor timing for single POI
./run.sh logs | grep -E "Starting|Serper.*Found|Rendered|Complete"
```

**Expected timing:**
- [ ] Serper search: ~1-2 seconds
- [ ] 1.5s delay between URL renders
- [ ] Total Layer 2 time: ~25-35 seconds for 10 URLs
- [ ] Full job (both layers): ~35-50 seconds

### Test 5.2: Bulk Collection

1. Run news collection for 10 POIs
2. Monitor system resources:
```bash
# In another terminal
watch -n 1 'ps aux | grep node'
```

**Verify:**
- [ ] Memory usage stable (not growing indefinitely)
- [ ] CPU usage reasonable
- [ ] All POIs complete successfully
- [ ] No crashes or timeouts

### Test 5.3: URL Rendering Count

```bash
# Count rendered URLs per POI
./run.sh logs | grep "\[Serper\] Rendered" | grep -o "Rendered [0-9]* of [0-9]*"
```

**Expected:**
- [ ] Most POIs render 8-10 URLs (some may fail)
- [ ] Serper API returns 9-10 URLs per query
- [ ] Rendering success rate > 70%

---

## Phase 6: Data Quality

### Test 6.1: Geographic Relevance

For POI with grounding (e.g., Ledges Trail in CVNP):

```sql
SELECT title, source_url, summary
FROM news
WHERE poi_id = 123  -- POI ID for Ledges Trail
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

**Manual review:**
- [ ] News is geographically relevant (Ohio, not Iowa or other states)
- [ ] News mentions CVNP or nearby areas
- [ ] No off-topic results (different "Ledges Trail" in other states)

**Expected:** 80-100% geographic relevance (based on Phase 1 testing)

### Test 6.2: Date Coverage

```sql
SELECT
  COUNT(*) as total,
  COUNT(published_date) as with_date,
  ROUND(100.0 * COUNT(published_date) / COUNT(*), 2) as date_coverage_pct
FROM news
WHERE poi_id IN (SELECT id FROM pois LIMIT 10)
  AND created_at > NOW() - INTERVAL '1 hour';
```

**Expected:**
- [ ] Date coverage: ~50-60% (Serper provides dates for ~52% of URLs)
- [ ] Mix of news with and without dates
- [ ] Dates in ISO 8601 format (YYYY-MM-DD)

### Test 6.3: Mission Scope Filtering

```sql
SELECT title, summary, news_type
FROM news
WHERE poi_id = 123
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

**Manual review:**
- [ ] News relates to CVNP themes (nature, trails, conservation, etc.)
- [ ] No generic urban news (restaurants, nightlife, sports)
- [ ] No off-topic entertainment news
- [ ] News_type categorization looks accurate

---

## Phase 7: Integration Regression Testing

### Test 7.1: Existing Features Still Work

**Events collection:**
- [ ] Run events collection (should NOT trigger Serper)
- [ ] Verify no "[Serper]" messages in logs
- [ ] Events collected normally

**News collection without Serper:**
1. Delete Serper API key
2. Run news collection
3. **Verify:**
   - [ ] Layer 1 still works (official URLs)
   - [ ] No crashes or errors
   - [ ] Results displayed in UI

**Combined collection:**
- [ ] Run both news + events collection
- [ ] Verify both complete successfully
- [ ] Serper only runs for news portion

---

## Test Results Summary

### Pass Criteria

All items below should be checked before marking DONE:

**Configuration:**
- [ ] API key saved successfully via UI
- [ ] Test button validates API key
- [ ] Status indicator works correctly

**Geographic Grounding:**
- [ ] POIs in CVNP get park grounding
- [ ] POIs in municipalities get city grounding
- [ ] POIs outside boundaries work (no grounding)

**Integration:**
- [ ] Layer 1 + Layer 2 both run for news
- [ ] Deduplication works (no duplicate titles)
- [ ] Progress tracking displays correctly
- [ ] Logs show Serper activity

**Error Handling:**
- [ ] Missing API key fails gracefully
- [ ] Invalid API key fails gracefully
- [ ] URL rendering failures don't crash job
- [ ] Layer 1 works even if Layer 2 fails

**Performance:**
- [ ] Timing within expected ranges
- [ ] Memory usage stable
- [ ] No crashes during bulk collection

**Data Quality:**
- [ ] Geographic relevance 80%+
- [ ] Date coverage 50%+
- [ ] Mission scope filtering working
- [ ] No duplicates in results

### Known Issues / Limitations

Document any issues found during testing:

1. Issue: _________________________________________
   - Impact: _______________________________________
   - Workaround: ___________________________________

2. Issue: _________________________________________
   - Impact: _______________________________________
   - Workaround: ___________________________________

---

## Next Steps After Testing

Once all tests pass:

1. **Production Deployment:**
   - [ ] Push commits to remote
   - [ ] Tag release version
   - [ ] Deploy to production
   - [ ] Configure Serper API key in production

2. **Phase 2 Work (Manual):**
   - [ ] POI URL audit (find official news_url for POIs)
   - [ ] Update POI records with news_url fields
   - [ ] Re-run news collection to use Layer 1 + Layer 2

3. **Monitoring:**
   - [ ] Set up Serper credit usage tracking
   - [ ] Monitor geographic relevance metrics
   - [ ] Track deduplication effectiveness

4. **Future Enhancements:**
   - [ ] Issue #198: Add park boundary GeoJSON data
   - [ ] Implement usage tracking in UI
   - [ ] Add caching for Serper results

