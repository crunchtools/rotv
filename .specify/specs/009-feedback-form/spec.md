# Specification: Feedback Form with GitHub Issue Creation

> **Spec ID:** 009-feedback-form
> **Status:** Draft
> **Version:** 0.1.0
> **Author:** Scott McCarty
> **Date:** 2026-05-10

## Overview

Add a public feedback form to ROTV that lets any visitor submit feedback, bug reports, or feature suggestions. Submissions are automatically created as GitHub Issues in the `crunchtools/rotv` repository, giving the community a direct voice without requiring them to have a GitHub account.

---

## User Stories

### Public Feedback

**US-001: Submit Feedback**
> As a park visitor using ROTV, I want to submit feedback or report a problem so that the development team can improve the site.

Acceptance Criteria:
- [ ] A "Feedback" button is accessible from every page (header or footer)
- [ ] The form works without requiring login
- [ ] Form collects: feedback type, message, and optional name/email
- [ ] Submitting creates a GitHub Issue in `crunchtools/rotv`
- [ ] User sees a success confirmation after submission
- [ ] Form is protected against spam (rate limiting + honeypot)

**US-002: Categorized Issues**
> As a project maintainer, I want feedback submissions labeled by type so that I can triage them efficiently.

Acceptance Criteria:
- [ ] Issues are created with labels matching the feedback type (bug, feature-request, feedback)
- [ ] Issue body includes the submitter's message and optional contact info
- [ ] Issues are tagged with a `user-submitted` label for easy filtering

---

## API Endpoints

### New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/feedback` | Submit feedback, creates GitHub Issue | No (public, rate-limited) |

### POST `/api/feedback`

**Request Body:**
```json
{
  "type": "bug | feature | general",
  "message": "Description of the feedback",
  "name": "Optional name",
  "email": "Optional email",
  "hp": ""
}
```

**Response (201):**
```json
{
  "success": true,
  "issueNumber": 218
}
```

**Response (429):**
```json
{
  "error": "Too many submissions. Please try again later."
}
```

---

## UI/UX Requirements

### New Components

- `FeedbackForm.jsx` — Modal dialog with the feedback form, accessible from a persistent "Feedback" button

### Design

- Small "Feedback" button in the header tab bar (visible to all users, not just authenticated)
- Clicking opens a modal overlay (consistent with existing modal patterns like Lightbox)
- Form fields:
  - **Type** (required): Radio buttons — Bug Report / Feature Request / General Feedback
  - **Message** (required): Textarea, 10-1000 characters
  - **Name** (optional): Text input
  - **Email** (optional): Text input (in case they want a response)
  - **Honeypot** (hidden): Empty text field, invisible to users, rejects if filled
- Submit button with loading state
- Success message with the issue number
- Error message on failure

---

## Non-Functional Requirements

**NFR-001: Spam Prevention**
- Rate limit: 3 submissions per IP per hour
- Honeypot field to catch bots
- Message length validation (10-1000 chars)

**NFR-002: Security**
- GitHub token stored server-side only (never exposed to frontend)
- Input sanitization before creating the issue (prevent markdown injection)
- No PII stored in the database — feedback goes directly to GitHub

**NFR-003: Availability**
- If GitHub API is unavailable, return a clear error asking the user to try again later
- Form should degrade gracefully (no blank screens on API failure)

---

## Dependencies

- **GitHub Personal Access Token** — Fine-grained PAT with `issues:write` scope for `crunchtools/rotv`
- Environment variable: `GITHUB_TOKEN`

---

## Open Questions

1. ~~Should the form require login?~~ No — public form to maximize feedback.
2. Should we store submissions locally as a backup? (Proposed: No — keep it simple, GitHub is the system of record)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-05-10 | Initial draft |
