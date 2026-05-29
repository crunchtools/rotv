# Implementation Plan: Three-Gate Auto-Moderation

> **Spec ID:** 030-moderation-gates
> **Status:** Planning
> **Last Updated:** 2026-05-29
> **Estimated Effort:** M

## Summary

Refactor the news/event branch of `processItem()` in `moderationService.js` into three
explicit gates — **Date**, **Relevance**, **POI** — each returning a `{verdict, reason}`,
combine them into the publish/reject/pending decision, persist the verdicts in a new
`moderation_gates` JSONB column, and surface them in the moderation card. Fold the POI
Tier-1 check into the existing relevance votes; add geo-driven Tier-2 auto-reassign. Make
the sweep batch size configurable so a monthly dump clears quickly.

---

## Architecture

### Decision flow (news/event)

```
processItem(news|event)
  ├─ hard rejects (unchanged): duplicate · no source URL · deny list
  │
  ├─ Gate: DATE        evaluateDateGate(row, { threshold, floorYear, trustedDomains })
  │        pass  = date present, not future, year ≥ floor, AND (consensus ≥ threshold OR trusted domain)
  │        review = missing / implausible / low-consensus-untrusted
  │
  ├─ Gate: RELEVANCE   from runContentRelevanceVotes() (3 votes, each {relevant, about_poi})
  │        pass  = unanimous YES
  │        fail  = unanimous NO     → REJECT (hard)
  │        review= split
  │
  ├─ Gate: POI         evaluatePoiGate(pool, row, votes)
  │        Tier 1 pass  = majority about_poi=YES (free, from votes)
  │        Tier 2       = on Tier-1 miss, getReassignmentCandidates() → 1 LLM call picks
  │                       owner/boundary/none; match ⇒ reassign poi_id + pass
  │        Tier 3 review= none confirmed
  │
  └─ COMBINE
       all three pass            → auto_approved (moderated_by = AUTO_PUBLISHER_USER_ID)
       relevance fail            → rejected
       otherwise                 → pending
     persist: moderation_status, moderation_gates JSONB, ai_reasoning (summary),
              relevance_signals (votes), confidence_score, moderation_processed=true
```

### Data flow for Tier-2 reassignment

1. Tier 1 misses (content relevant but not about the assigned POI).
2. `getReassignmentCandidates(pool, poiId)` returns `{ owner: {id,name}|null, boundary: {id,name}|null }`
   — owner from `pois.owner_id`, boundary = smallest containing boundary POI.
3. One structured LLM call: given title/summary + candidate names, return `assigned|owner|boundary|none`.
4. `owner`/`boundary` ⇒ `UPDATE … SET poi_id = <newId>`, gate `pass`, record `reassigned_from/to`.
5. `none`/no candidates/geo error ⇒ Tier 3 `review`.

---

## Implementation Steps

### Phase 1: Schema + settings
- [ ] `backend/migrations/070_moderation_gates.sql` — `ADD COLUMN IF NOT EXISTS moderation_gates JSONB` on `poi_news` and `poi_events`; insert `moderation_date_floor_year` (2010) and `moderation_sweep_batch_size` (50) into `admin_settings` (ON CONFLICT DO NOTHING).
- [ ] `backend/routes/admin.js` — add both keys to the allowed-settings write list (~line 515–532).

### Phase 2: Gate logic (backend)
- [ ] `geoService.js` — add `getReassignmentCandidates(pool, poiId)` (owner via `owner_id`; smallest containing boundary POI id+name). Graceful `{owner:null,boundary:null}` on error.
- [ ] `geminiService.js` — extend the relevance-vote response contract to include `about_poi` (boolean); add `assignBestPoi(pool, item, candidates)` returning `assigned|owner|boundary|none`.
- [ ] `moderationService.js`:
  - [ ] `evaluateDateGate(row, cfg)` → `{verdict, reason, trusted_source}`.
  - [ ] `evaluatePoiGate(pool, row, votes)` → `{verdict, tier, reason, reassigned_from, reassigned_to}` (does the reassign UPDATE on Tier 2).
  - [ ] derive relevance gate from votes (`unanimousYes`/`unanimousNo`/split).
  - [ ] replace the inline decision block (lines ~374–427) with the three-gate combine; write `moderation_gates`.
  - [ ] `processPendingItems()` — read `moderation_sweep_batch_size` and use it for the three `LIMIT` queries (default 50).
  - [ ] `getQueue()` — add `n.moderation_gates` / `e.moderation_gates` to the SELECT lists (NULL for photos).

### Phase 3: Admin UI
- [ ] `ModerationExtras.jsx` — render three gate badges (Date / Relevance / POI) colored by verdict (green/orange/red) with reason tooltips; show reassignment ("→ Liberty Park") on Tier-2; expand to list relevance votes. Render only when `moderation_gates` present.

### Phase 4: Tests
- [ ] `backend/tests/services/moderationService.test.js` — unit-test `evaluateDateGate` (trusted vs untrusted, floor-year, future, missing) and the combine logic; keep existing `applyQualityFilters`/`getDomainReputation` tests or migrate them.
- [ ] Add a focused test for `evaluatePoiGate` Tier-1/2/3 with mocked candidates + LLM.

---

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `backend/migrations/070_moderation_gates.sql` | `moderation_gates` column + 2 settings |

### Modified Files
| File | Changes |
|------|---------|
| `backend/services/moderationService.js` | three-gate refactor of `processItem`, configurable sweep batch, `getQueue` SELECT |
| `backend/services/geoService.js` | `getReassignmentCandidates()` |
| `backend/services/geminiService.js` | `about_poi` in vote contract; `assignBestPoi()` |
| `backend/routes/admin.js` | allow new settings keys |
| `frontend/src/components/ModerationExtras.jsx` | gate badges + votes |
| `backend/tests/services/moderationService.test.js` | gate unit tests |

---

## Database Migrations

```sql
-- Migration: 070_moderation_gates
ALTER TABLE poi_news   ADD COLUMN IF NOT EXISTS moderation_gates JSONB;
ALTER TABLE poi_events ADD COLUMN IF NOT EXISTS moderation_gates JSONB;

INSERT INTO admin_settings (key, value, updated_at) VALUES
  ('moderation_date_floor_year', '2010', CURRENT_TIMESTAMP),
  ('moderation_sweep_batch_size', '50', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
```

---

## Testing Strategy

### Manual Testing (port 8083, container `rotv-modgates`)
1. `./run.sh start`, log in to admin, open Moderation Queue.
2. Trigger a sweep (or wait for the scheduler); confirm pending items gain confidence % + three gate badges.
3. Verify a trusted-source recent-date news item with unanimous-yes relevance auto-publishes.
4. Verify an item about a park (assigned to a sub-POI) gets reassigned to the parent boundary and shows "→ <Park>".
5. Verify a split-relevance or no-date item stays pending with the failing gate flagged.

---

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Tier-2 reassign moves an item to the wrong POI | Med | Only on confident LLM pick among a tiny candidate set; records reassignment for audit; never rejects |
| Extra LLM call raises cost | Low | Tier-2 call fires only on Tier-1 misses, not every item |
| Relaxing/auto-publishing too aggressively | Med | Publish requires ALL three pass + unanimous relevance; defaults conservative |
| Migration re-run on every deploy | Low | Additive + `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` |

---

## Changelog
| Date | Changes |
|------|---------|
| 2026-05-29 | Initial plan |
