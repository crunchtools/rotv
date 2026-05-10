# Implementation Plan: Feedback Form with GitHub Issue Creation

> **Spec ID:** 009-feedback-form
> **Status:** Planning
> **Last Updated:** 2026-05-10
> **Estimated Effort:** S

## Summary

Add a public-facing feedback form modal and a backend API endpoint that creates GitHub Issues. No database changes required — all data flows directly to GitHub.

---

## Architecture

### Data Flow

```
User fills form → POST /api/feedback → Server validates → GitHub API → Issue created → 201 response
```

### Component Diagram

```
┌──────────────────────────────┐
│         Frontend             │
│                              │
│   ┌──────────────────────┐   │
│   │   FeedbackForm.jsx   │   │
│   │   (modal component)  │   │
│   └──────────┬───────────┘   │
│              │ POST          │
└──────────────┼───────────────┘
               │
┌──────────────▼───────────────┐
│         Backend              │
│                              │
│   ┌──────────────────────┐   │
│   │  routes/feedback.js  │   │
│   │  (validation + rate  │   │
│   │   limit + GitHub API)│   │
│   └──────────┬───────────┘   │
│              │               │
└──────────────┼───────────────┘
               │
               ▼
       GitHub Issues API
       (crunchtools/rotv)
```

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| GitHub API | `fetch` (Node built-in) | No new dependency needed, GitHub REST API is simple |
| Rate limiting | `express-rate-limit` | Already in the project |
| Spam prevention | Honeypot field | Simple, no external service needed |

---

## Implementation Steps

### Phase 1: Backend

- [ ] Create `backend/routes/feedback.js` with POST `/api/feedback` endpoint
- [ ] Add rate limiter (3 req/hour per IP)
- [ ] Add input validation (type enum, message length, honeypot check)
- [ ] Add GitHub issue creation via REST API
- [ ] Wire route into `server.js`
- [ ] Add `GITHUB_TOKEN` to `.env.example`

### Phase 2: Frontend

- [ ] Create `frontend/src/components/FeedbackForm.jsx` (modal component)
- [ ] Add "Feedback" button to the header tab bar in `App.jsx`
- [ ] Add CSS styles for the modal and form
- [ ] Handle loading/success/error states

### Phase 3: Testing

- [ ] Add integration test for the feedback endpoint
- [ ] Manual browser testing of the form

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `backend/routes/feedback.js` | Feedback API endpoint |
| `frontend/src/components/FeedbackForm.jsx` | Feedback form modal component |
| `frontend/src/components/FeedbackForm.css` | Styles for the feedback modal |

### Modified Files

| File | Changes |
|------|---------|
| `backend/server.js` | Import and mount feedback route |
| `frontend/src/App.jsx` | Add Feedback button to header, import FeedbackForm |
| `frontend/src/App.css` | Feedback button styling (if not in FeedbackForm.css) |
| `.env.example` | Add `GITHUB_TOKEN` |

---

## Database Migrations

None required. Feedback goes directly to GitHub.

---

## API Implementation

### Endpoint: `POST /api/feedback`

**Request:**
```json
{
  "type": "bug",
  "message": "The map doesn't load on my phone",
  "name": "Jane",
  "email": "jane@example.com",
  "hp": ""
}
```

**Server-side flow:**
1. Check honeypot field — reject if non-empty
2. Validate `type` is one of: `bug`, `feature`, `general`
3. Validate `message` length (10-1000 chars)
4. Sanitize all inputs (strip HTML/markdown injection)
5. Map type to GitHub label: `bug` → `bug`, `feature` → `enhancement`, `general` → `feedback`
6. Create issue via `POST https://api.github.com/repos/crunchtools/rotv/issues`
7. Return `{ success: true, issueNumber: N }`

**GitHub Issue Format:**
```
Title: [Feedback] <type>: <first 80 chars of message>

Body:
## User Feedback

**Type:** Bug Report

**Message:**
<sanitized message>

---
*Submitted via ROTV feedback form*
*Name: Jane*
*Email: jane@example.com*
```

**Response (201):**
```json
{ "success": true, "issueNumber": 218 }
```

---

## Testing Strategy

### Integration Tests

- [ ] `backend/tests/feedback.test.js` — POST with valid data (mock GitHub API), honeypot rejection, missing fields, rate limiting

### Manual Testing

1. Open ROTV in browser, click Feedback button
2. Fill form with each feedback type, verify issue created on GitHub
3. Submit with honeypot filled — verify rejection
4. Submit 4 times rapidly — verify rate limit kicks in
5. Submit with empty message — verify validation error
6. Test on mobile viewport — verify modal is responsive

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| GitHub API rate limit (5000/hr) | Low | User-facing rate limit of 3/hr/IP ensures we never approach this |
| Spam submissions | Med | Honeypot + rate limiting; can add CAPTCHA later if needed |
| GitHub token exposure | High | Token is server-side only, never sent to frontend |
| Markdown injection in issues | Med | Sanitize input before creating issue body |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-10 | Initial plan |
