# Implementation Plan: Privacy Statement

> **Spec ID:** 008-privacy-statement
> **Status:** Planning
> **Last Updated:** 2026-05-09
> **Estimated Effort:** S

## Summary

Add a `PrivacyPolicy.jsx` component rendered at `/privacy`, link it from the login dropdown, user settings, and sidebar. Pure frontend change — no backend, no database, no migrations.

---

## Implementation Steps

### Phase 1: Privacy Page Component

- [ ] Create `frontend/src/components/PrivacyPolicy.jsx` with the privacy statement content
- [ ] Style it to match existing full-page views (similar to how permalink pages work)
- [ ] Add route handling in `App.jsx` for `/privacy`

### Phase 2: Link Integration

- [ ] Add "Privacy Policy" link in `LoginButton.jsx` below the OAuth buttons
- [ ] Add "Privacy Policy" link in user settings area
- [ ] Add subtle "Privacy" link at the bottom of the sidebar

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/PrivacyPolicy.jsx` | Privacy statement page component |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/App.jsx` | Add route handling for `/privacy`, render PrivacyPolicy component |
| `frontend/src/App.css` | Styles for the privacy page |
| `frontend/src/components/LoginButton.jsx` | Add privacy link below OAuth buttons |
| `frontend/src/components/Sidebar.jsx` | Add privacy link at sidebar bottom |

---

## Testing Strategy

### Manual Testing

1. Navigate to `/privacy` directly — page renders
2. Click "Privacy Policy" in login dropdown — navigates to privacy page
3. Click privacy link in sidebar — navigates to privacy page
4. Back button returns to map view
5. Mobile responsive — privacy page readable on phone

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Route conflicts with existing path handling | Low | ROTV uses path-based POI selection; `/privacy` won't conflict since it's not a POI slug |

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-05-09 | Initial plan |
