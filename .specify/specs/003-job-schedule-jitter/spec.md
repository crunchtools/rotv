# Specification: Job Schedule Jitter

> **Spec ID:** 003-job-schedule-jitter
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-04-01

## Overview

Add randomized delay (1-60 seconds) to all scheduled job executions so they don't fire at exact cron times. This makes scraping patterns less recognizable to external services (Twitter/X, park websites, etc.) that detect and block automated access based on predictable timing.

---

## User Stories

### Anti-Bot Detection

**US-001: Randomized Job Start Times**
> As a system operator, I want scheduled jobs to start at slightly randomized times so that external services cannot detect scraping based on clock-precise request patterns.

Acceptance Criteria:
- [ ] All scheduled jobs (news, trail status, moderation sweep, backups) wait a random 1-60 second delay before executing their handler
- [ ] The jitter is per-execution (re-randomized each time the job fires)
- [ ] The actual jitter delay used is logged for observability
- [ ] Admin-triggered (manual) jobs are NOT jittered — only cron-scheduled jobs
- [ ] Existing job behavior is unchanged aside from the delayed start

---

## Data Model

No schema changes required.

---

## API Endpoints

No new endpoints. No changes to existing endpoints.

---

## Non-Functional Requirements

**NFR-001: Jitter Range**
- Minimum delay: 1 second
- Maximum delay: 60 seconds
- Distribution: uniform random (crypto-grade randomness not required)

**NFR-002: Observability**
- Each jittered execution logs the delay applied (e.g., `[Jitter] news-collection delayed by 37s`)

**NFR-003: Manual Jobs Exempt**
- Jobs triggered via admin UI or API bypass jitter entirely

---

## Open Questions

None — approach is straightforward.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-04-01 | Initial draft |
