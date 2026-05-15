# Specification: News/Events URL Ownership

> **Spec ID:** 012-news-url-ownership
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-14

## Overview

When collecting news and events for a POI, the AI sometimes finds content hosted on a domain that belongs to a different organization POI (e.g., a news article about Botzum Station sourced from cvsr.org, which is CVSR's domain). Currently these items get assigned to the POI being collected, not to the organization that owns the URL. This feature adds domain-based ownership detection to the collection pipeline so that items are automatically reassigned to the correct organization POI.

---

## User Stories

### Data Integrity

**US-012-1: Automatic URL Ownership Reassignment**
> As a site administrator, I want news and events collected from an organization's domain to be attributed to that organization so that content is correctly categorized without manual intervention.

Acceptance Criteria:
- [ ] During save, if a news/event source_url domain matches another POI's news_url or events_url domain, the item is saved under the domain-owning POI instead
- [ ] The reassignment is logged so administrators can see what happened
- [ ] Existing misattributed items are corrected via a one-time data migration

**US-012-2: Data Cleanup**
> As a site administrator, I want existing misattributed news and events corrected so that the database is accurate going forward.

Acceptance Criteria:
- [ ] A migration script identifies and reassigns all news/events whose source_url domain matches a different POI's news_url or events_url
- [ ] The migration logs each reassignment for audit purposes

---

## Data Model

### Schema Changes

No schema changes required. The fix operates on existing `poi_id` foreign keys in `poi_news` and `poi_events`.

---

## API Endpoints

No new endpoints required. The change is internal to the collection pipeline.

---

## Non-Functional Requirements

**NFR-012-1: Performance**
- Domain lookup query must be cached per collection run, not executed per-item
- No measurable impact on collection throughput

---

## Dependencies

- Depends on: Existing news/events collection pipeline in `newsService.js`
- Depends on: POIs having `news_url` and `events_url` fields populated

---

## Open Questions

None — behavior confirmed: reassign to the domain-owning POI.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-14 | Initial draft |
