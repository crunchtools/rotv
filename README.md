# Roots of The Valley

An interactive map application for exploring the Cuyahoga Valley region, featuring points of interest, trails, and AI-powered news and events collection.

## Features

- Interactive Leaflet map with POI markers, trails, and municipal boundaries
- AI-powered news and events collection (Google Gemini, Perplexity)
- OAuth authentication (Google, Facebook)
- Admin interface for content management
- Trail status monitoring

## Quick Start

```bash
# Build and start the container
./run.sh build
./run.sh start

# Open in browser
open http://localhost:8080
```

## Development

```bash
# Hot reload during development
./run.sh reload-app

# Run tests
./run.sh test

# View logs
./run.sh logs
```

See [CLAUDE.md](CLAUDE.md) for development guidelines and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution instructions.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Container | Podman, Fedora |
| Database | PostgreSQL 17 |
| Backend | Node.js 20, Express |
| Frontend | React 18, Vite 5 |
| Maps | Leaflet, React-Leaflet |
| Testing | Vitest, Playwright, Supertest |

## Documentation

- [Development Architecture](docs/DEVELOPMENT_ARCHITECTURE.md)
- [News & Events Architecture](docs/NEWS_EVENTS_ARCHITECTURE.md)
- [Trail Status Architecture](docs/TRAIL_STATUS_ARCHITECTURE.md)
- [CI/CD & Testing](docs/CI_CD_TESTING.md)

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.
