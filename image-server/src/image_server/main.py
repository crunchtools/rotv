"""Image server entry point."""

from __future__ import annotations

import logging

import uvicorn

from .api import app  # noqa: F401 — re-exported for uvicorn
from .config import get_config
from .database import init_schema

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

logger = logging.getLogger(__name__)


def main() -> None:
    """Start the image server."""
    cfg = get_config()

    # Ensure media directories exist
    cfg.ensure_media_dirs()
    logger.info("Media path: %s", cfg.media_path)

    # Initialize database schema
    init_schema()
    logger.info("Database initialized: %s:%s/%s", cfg.pg_host, cfg.pg_port, cfg.pg_database)

    # Log AI capabilities
    if cfg.vision_backend != "none":
        logger.info("Vision backend: %s (%s)", cfg.vision_backend, cfg.vision_model)
    else:
        logger.info("Vision backend: disabled")

    logger.info("Embedding model: %s", cfg.embedding_model)

    # Start server
    uvicorn.run(
        "image_server.main:app",
        host=cfg.host,
        port=cfg.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
