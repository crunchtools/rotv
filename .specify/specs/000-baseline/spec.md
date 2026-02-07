# Baseline Specification: Roots of The Valley

> **Spec ID:** 000-baseline
> **Status:** Implemented
> **Version:** 1.16.0

## Overview

Roots of The Valley (ROTV) is an interactive map application for exploring the Cuyahoga Valley region. It provides information about points of interest (POIs), trails, rivers, and municipal boundaries with AI-powered news and events collection.

---

## User Stories

### Map Exploration

**US-001: View Interactive Map**
> As a visitor, I want to view an interactive map of the Cuyahoga Valley so that I can explore destinations in the region.

Acceptance Criteria:
- [ ] Map displays centered on Cuyahoga Valley
- [ ] POI markers are visible and clickable
- [ ] Trail geometries are rendered on the map
- [ ] Municipal boundaries are visible
- [ ] River geometry is rendered

**US-002: View POI Details**
> As a visitor, I want to click on a POI marker to see detailed information about that destination.

Acceptance Criteria:
- [ ] Clicking marker opens info panel
- [ ] Panel shows name, description, address
- [ ] Panel shows contact information (phone, website)
- [ ] Panel shows category and photos

**US-003: Filter POIs by Category**
> As a visitor, I want to filter POIs by category so that I can find specific types of destinations.

Acceptance Criteria:
- [ ] Category filter is available in UI
- [ ] Selecting category filters visible markers
- [ ] Multiple categories can be selected
- [ ] "All" option shows all POIs

### News & Events

**US-010: View POI News**
> As a visitor, I want to see recent news articles related to a POI so that I can stay informed about the destination.

Acceptance Criteria:
- [ ] News tab visible in POI info panel
- [ ] News items show title, source, date
- [ ] Clicking news item opens article in new tab
- [ ] News is sorted by date (newest first)

**US-011: View POI Events**
> As a visitor, I want to see upcoming events at a POI so that I can plan my visit.

Acceptance Criteria:
- [ ] Events tab visible in POI info panel
- [ ] Events show title, date range, description
- [ ] Past events are filtered out
- [ ] Events sorted by start date

### Authentication

**US-020: Sign In with Google**
> As a user, I want to sign in with my Google account so that I can access admin features if authorized.

Acceptance Criteria:
- [ ] "Sign in with Google" button visible
- [ ] OAuth flow redirects to Google
- [ ] Successful auth creates session
- [ ] User name/avatar shown when logged in

**US-021: Sign Out**
> As a logged-in user, I want to sign out so that I can end my session.

Acceptance Criteria:
- [ ] Sign out button visible when logged in
- [ ] Clicking sign out clears session
- [ ] UI updates to show logged-out state

### Admin Features

**US-030: Collect News for POI**
> As an admin, I want to trigger news collection for a POI so that I can refresh its news content.

Acceptance Criteria:
- [ ] "Collect News" button visible to admins
- [ ] Progress indicator shows collection status
- [ ] New news items appear after collection
- [ ] Duplicate detection prevents re-adding same items

**US-031: Batch News Collection**
> As an admin, I want to collect news for all POIs at once so that I can keep the entire system updated.

Acceptance Criteria:
- [ ] "Collect All" button in admin panel
- [ ] Progress shows POIs processed / total
- [ ] Job can be cancelled mid-process
- [ ] Results summary shown on completion

**US-032: Edit POI Information**
> As an admin, I want to edit POI details so that I can keep information accurate.

Acceptance Criteria:
- [ ] Edit mode available for POIs
- [ ] Can modify name, description, contact info
- [ ] Changes saved to database
- [ ] Google Sheets sync updates remote spreadsheet

**US-033: Add New POI**
> As an admin, I want to add new POIs to the map so that I can expand coverage.

Acceptance Criteria:
- [ ] "Add POI" interface available
- [ ] Can set location by clicking map
- [ ] All fields can be populated
- [ ] New POI appears immediately on map

**US-040: Collect Trail Status**
> As an admin, I want to collect trail status information so that visitors know current conditions.

Acceptance Criteria:
- [ ] Trail status collection available
- [ ] Status includes conditions, closures
- [ ] Status displayed on trail info

---

## Data Model

### POI Types

| Type | Description | Count (approx) |
|------|-------------|----------------|
| `point` | Traditional POI markers | 188 |
| `trail` | Trail geometries | 180 |
| `river` | River geometries | 1 |
| `boundary` | Municipal boundaries | 9 |

### Key Tables

- `pois` - All geographic features with `poi_type` discriminator
- `news` - News articles linked to POIs
- `events` - Events linked to POIs
- `users` - Authenticated users
- `sessions` - Session storage for auth

---

## Non-Functional Requirements

**NFR-001: Performance**
- Map loads within 3 seconds
- POI clicks respond within 500ms
- News collection completes within 60s per POI

**NFR-002: Reliability**
- Container self-heals on service failures
- Database persists across restarts (production)
- Graceful degradation when AI services unavailable

**NFR-003: Security**
- Admin features require authentication
- OAuth-only auth (no password storage)
- Session cookies are httpOnly and secure

**NFR-004: Compatibility**
- Works in Chrome, Firefox, Safari
- Responsive design for mobile
- Leaflet map works on touch devices
