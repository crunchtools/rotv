# Specification: [Feature Name]

> **Spec ID:** XXX-feature-name
> **Status:** Draft | In Progress | Implemented
> **Version:** 0.1.0
> **Author:** [Name]
> **Date:** YYYY-MM-DD

## Overview

[2-3 sentence description of what this feature does and why it matters]

---

## User Stories

### [Category Name]

**US-XXX: [Story Title]**
> As a [user type], I want to [action] so that I can [benefit].

Acceptance Criteria:
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

---

## Data Model

### New Tables

| Table | Description |
|-------|-------------|
| `table_name` | [Description] |

### Schema Changes

```sql
-- Add column to existing table
ALTER TABLE pois ADD COLUMN new_column TEXT;
```

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/new-endpoint` | [Description] | No |
| POST | `/api/admin/new-endpoint` | [Description] | Admin |

---

## UI/UX Requirements

### New Components

- `ComponentName` - [Description]

### Wireframes

[Link to wireframes or ASCII diagrams]

---

## Non-Functional Requirements

**NFR-XXX: [Category]**
- [Requirement 1]
- [Requirement 2]

---

## Dependencies

- Depends on: [Spec ID or external dependency]
- Blocks: [Spec ID that depends on this]

---

## Open Questions

1. [Question that needs resolution before implementation]
2. [Another question]

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | YYYY-MM-DD | Initial draft |
