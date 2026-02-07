# Implementation Plan: [Feature Name]

> **Spec ID:** XXX-feature-name
> **Status:** Planning | In Progress | Complete
> **Last Updated:** YYYY-MM-DD
> **Estimated Effort:** [S/M/L/XL]

## Summary

[1-2 sentence summary of implementation approach]

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────┐
│              [Component A]              │
│                                         │
│   ┌───────────────────────────────┐    │
│   │        [Sub-component]        │    │
│   └───────────────────────────────┘    │
│                   │                     │
│                   ▼                     │
│   ┌───────────────────────────────┐    │
│   │        [Sub-component]        │    │
│   └───────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### Data Flow

1. [Step 1]
2. [Step 2]
3. [Step 3]

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| [Component] | [Tech] | [Why this choice] |

---

## Implementation Steps

### Phase 1: [Name]

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

### Phase 2: [Name]

- [ ] Task 4
- [ ] Task 5

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `path/to/new/file.js` | [Description] |

### Modified Files

| File | Changes |
|------|---------|
| `path/to/existing/file.js` | [What changes] |

---

## Database Migrations

```sql
-- Migration: XXX_feature_name
-- Description: [What this migration does]

CREATE TABLE IF NOT EXISTS new_table (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API Implementation

### Endpoint: `GET /api/new-endpoint`

**Request:**
```
GET /api/new-endpoint?param=value
```

**Response:**
```json
{
  "data": [],
  "status": "success"
}
```

---

## Testing Strategy

### Unit Tests

- [ ] `test/unit/feature.test.js` - [What it tests]

### Integration Tests

- [ ] `test/integration/feature.test.js` - [What it tests]

### Manual Testing

1. [Step to verify manually]
2. [Another step]

---

## Rollback Plan

If issues are discovered:
1. [Rollback step 1]
2. [Rollback step 2]

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk 1] | [High/Med/Low] | [How to mitigate] |

---

## Changelog

| Date | Changes |
|------|---------|
| YYYY-MM-DD | Initial plan |
