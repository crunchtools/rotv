# Implementation Plan: Job Schedule Jitter

> **Spec ID:** 003-job-schedule-jitter
> **Status:** Planning
> **Last Updated:** 2026-04-01
> **Estimated Effort:** S

## Summary

Add a `withJitter()` wrapper in `jobScheduler.js` that wraps any scheduled job handler with a random 1-60 second delay. Apply it to all cron-scheduled handlers (news, trail status, moderation sweep, image backup, database backup). Manual/batch triggers remain immediate.

---

## Architecture

### Data Flow

1. pg-boss fires a cron-scheduled job
2. The registered handler is wrapped with `withJitter(originalHandler)`
3. `withJitter` generates a random delay (1-60s), logs it, then `setTimeout` before calling the original handler
4. The original handler executes as normal after the delay

---

## Implementation Steps

### Phase 1: Add Jitter Utility

- [ ] Add `withJitter(handler, jobName)` function to `jobScheduler.js`
- [ ] Function generates `Math.floor(Math.random() * 60) + 1` seconds
- [ ] Logs: `[Jitter] <jobName> delayed by <N>s`
- [ ] Returns a promise that resolves after delay + handler execution

### Phase 2: Apply to Scheduled Handlers

- [ ] Wrap the handler in `registerNewsCollectionHandler` callbacks in `server.js`
- [ ] Wrap the handler in `registerTrailStatusHandler` callbacks in `server.js`
- [ ] Wrap the handler in `registerModerationSweepHandler` callbacks in `server.js`
- [ ] Wrap the handler in `registerImageBackupHandler` callbacks in `server.js`
- [ ] Wrap the handler in `registerDatabaseBackupHandler` callbacks in `server.js`

### Phase 3: Test

- [ ] Add unit test for `withJitter` in existing test suite
- [ ] Full build passes
- [ ] Existing tests pass

---

## File Changes

### Modified Files

| File | Changes |
|------|---------|
| `backend/services/jobScheduler.js` | Add `withJitter()` utility function, export it |
| `backend/server.js` | Wrap 5 scheduled handler registrations with jitter |

---

## Database Migrations

None.

---

## Testing Strategy

### Unit Tests

- [ ] `withJitter` calls the wrapped handler after a delay
- [ ] `withJitter` delay is in range [1, 60] seconds
- [ ] `withJitter` propagates errors from the wrapped handler

### Manual Testing

1. Start the container with `./run.sh reload-app`
2. Check logs for `[Jitter]` messages when scheduled jobs fire
3. Verify manual triggers from admin UI execute immediately (no jitter log)

---

## Rollback Plan

If issues are discovered:
1. Revert the two files — no schema changes, no data migration

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Job timeout with 60s jitter | Low | pg-boss expire times are 15-120 min, 60s is negligible |
| Overlapping jobs from jitter | Low | pg-boss handles concurrency; jitter is max 60s on 15-30 min intervals |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-04-01 | Initial plan |
