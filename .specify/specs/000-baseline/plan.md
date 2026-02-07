# Baseline Implementation Plan

> **Spec ID:** 000-baseline
> **Status:** Implemented
> **Last Updated:** 2025-02-06

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                 │
│                    http://localhost:8080                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Container: quay.io/fatherlinux/rotv                │
│                        Port 8080                                │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │ Frontend (React + Vite)                                 │  │
│   │ - Leaflet map with markers, trails, boundaries          │  │
│   │ - Info panels for POI details                           │  │
│   │ - Admin UI for news/events collection                   │  │
│   └─────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │ Backend (Express.js on :8080)                           │  │
│   │ - REST API for POIs, news, events                       │  │
│   │ - OAuth via Passport.js                                 │  │
│   │ - Job scheduler (pg-boss) for batch operations          │  │
│   │ - AI services (Gemini, Perplexity) for content          │  │
│   └─────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │ PostgreSQL 17                                           │  │
│   │ - pois, news, events, users, sessions tables            │  │
│   │ - pg-boss job queue tables                              │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   Development: tmpfs /data/pgdata (ephemeral, 2GB in-memory)   │
│   Production:  ~/.rotv/pgdata → /data/pgdata (persistent)      │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

### Frontend
| Technology | Purpose | Version |
|------------|---------|---------|
| React | UI framework | 18.x |
| Vite | Build tool & dev server | 5.x |
| Leaflet | Interactive maps | 1.9.x |
| React-Leaflet | React bindings for Leaflet | 4.x |
| React Router | Client-side routing | 7.x |

### Backend
| Technology | Purpose | Version |
|------------|---------|---------|
| Express.js | HTTP server & API | 4.x |
| PostgreSQL | Primary database | 17 |
| pg | PostgreSQL client | 8.x |
| Passport.js | OAuth authentication | 0.7.x |
| pg-boss | Job queue | 12.x |
| Playwright | JavaScript rendering | 1.58.x |
| Sharp | Image processing | 0.33.x |

### AI Services
| Service | Purpose |
|---------|---------|
| Google Gemini | Content extraction, search grounding |
| Perplexity | Fallback AI provider |

### Infrastructure
| Technology | Purpose |
|------------|---------|
| Podman | Container runtime |
| Fedora | Base OS |
| systemd | Service management |
| GitHub Actions | CI/CD |

## API Endpoints

### Public Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/destinations` | List all POIs (type=point) |
| GET | `/api/destinations/:id` | Get single POI with news/events |
| GET | `/api/trails` | List all trails |
| GET | `/api/boundaries` | List municipal boundaries |
| GET | `/api/health` | Health check endpoint |

### Auth Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/google` | Initiate Google OAuth |
| GET | `/auth/google/callback` | OAuth callback |
| GET | `/auth/facebook` | Initiate Facebook OAuth |
| GET | `/auth/user` | Get current user |
| POST | `/auth/logout` | End session |

### Admin Endpoints (Authenticated)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/collect-news/:id` | Collect news for POI |
| POST | `/api/admin/batch-news` | Batch news collection |
| POST | `/api/admin/collect-trail-status` | Collect trail status |
| PUT | `/api/admin/pois/:id` | Update POI |
| POST | `/api/admin/pois` | Create POI |
| DELETE | `/api/admin/pois/:id` | Delete POI |

## File Structure

```
rotv/
├── backend/
│   ├── server.js           # Main Express app
│   ├── routes/
│   │   ├── auth.js         # OAuth routes
│   │   └── admin.js        # Admin API routes
│   ├── services/
│   │   ├── newsService.js      # News collection logic
│   │   ├── trailStatusService.js # Trail status
│   │   ├── jobScheduler.js     # pg-boss integration
│   │   └── sheetsSync.js       # Google Sheets sync
│   └── config/
│       └── passport.js     # OAuth configuration
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # Main React component
│   │   ├── components/     # React components
│   │   └── hooks/          # Custom React hooks
│   └── vite.config.js      # Vite configuration
├── docs/                   # Architecture documentation
├── .specify/               # Spec-kit governance
├── run.sh                  # Container management
├── Containerfile           # Container definition
└── Containerfile.base      # Base image definition
```

## Testing Strategy

### Unit Tests (Vitest)
- Service function tests
- API endpoint tests with Supertest
- Database query tests

### Integration Tests
- Full API flow tests
- Authentication flow tests
- News collection pipeline tests

### E2E Tests (Playwright)
- Map interaction tests
- POI panel tests
- Admin workflow tests

**Test Execution:**
```bash
./run.sh test  # Runs all 39+ tests
```

## Deployment

### Development
1. `./run.sh build` - Build container
2. `./run.sh start` - Start with ephemeral storage
3. `./run.sh test` - Validate functionality

### Production
1. Push tag to GitHub
2. GitHub Actions builds container
3. Image pushed to `quay.io/fatherlinux/rotv`
4. Pull and deploy on production server

## Key Implementation Details

### News Collection Flow
1. Admin triggers collection via UI
2. Backend creates pg-boss job
3. Job handler:
   - Renders POI website with Playwright (if JS-heavy)
   - Sends content to Gemini with search grounding
   - Resolves redirect URLs to final destinations
   - Deduplicates by URL and normalized title
   - Saves new items to database
4. UI updates with progress and results

### Authentication Flow
1. User clicks "Sign in with Google"
2. Redirect to Google OAuth
3. Callback creates/updates user record
4. Session stored in PostgreSQL
5. Subsequent requests include session cookie

### Data Seeding
1. First container start checks for seed data
2. Downloads from production server if missing
3. Imports into PostgreSQL
4. Development always uses fresh import (ephemeral)
