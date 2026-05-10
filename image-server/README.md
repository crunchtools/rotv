# Image Server

Lightweight image server with AI captioning and semantic search. Purpose-built replacement for Immich in the ROTV stack.

## Features

- Image upload with automatic thumbnail generation
- EXIF metadata extraction
- AI captioning via Gemini vision
- Semantic search via fastembed + pgvector
- Full-text search via PostgreSQL tsvector
- Theme video serving
- REST API (FastAPI)

## Quick Start

```bash
podman build -t quay.io/crunchtools/image-server .

podman run -d --name image-server \
  -p 8000:8000 \
  -v image-server-pgdata:/var/lib/pgsql/data:Z \
  -v image-server-media:/data/media:Z \
  --systemd=always \
  quay.io/crunchtools/image-server
```

## API

See `src/image_server/api.py` for full endpoint documentation.

## License

AGPL-3.0-or-later
