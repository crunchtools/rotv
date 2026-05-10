"""Configuration for image-server from environment variables."""

from __future__ import annotations

import os
from pathlib import Path

_config: Config | None = None

DEFAULT_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
DEFAULT_THUMBNAIL_SIZE = 250
DEFAULT_VISION_TIMEOUT = 120

# Multi-size thumbnail configuration: name → max dimension (width or height)
THUMBNAIL_SIZES = {
    "small": 100,
    "medium": 600,
    "large": 1200,
}

DEFAULT_VISION_PROMPT = (
    "Describe this image concisely for search indexing. Include: what you see, "
    "any identifiable location, season or time of day, and any readable text or signs. "
    "Focus on the main subject and setting."
)


class Config:
    """Image server configuration from environment variables."""

    def __init__(self) -> None:
        # PostgreSQL
        self.pg_host: str = os.environ.get("PGHOST", "localhost")
        self.pg_port: int = int(os.environ.get("PGPORT", "5432"))
        self.pg_database: str = os.environ.get("PGDATABASE", "imageserver")
        self.pg_user: str = os.environ.get("PGUSER", "imageserver")
        self.pg_password: str = os.environ.get("PGPASSWORD", "imageserver")

        # AI capabilities
        self.vision_backend: str = os.environ.get("VISION_BACKEND", "none").lower()
        self.vision_model: str = os.environ.get(
            "VISION_MODEL", self._default_vision_model()
        )
        self.vision_prompt: str = os.environ.get("VISION_PROMPT", DEFAULT_VISION_PROMPT)
        self.vision_timeout: int = int(
            os.environ.get("VISION_TIMEOUT", str(DEFAULT_VISION_TIMEOUT))
        )

        # Embeddings
        self.embedding_model: str = os.environ.get(
            "EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL
        )
        self.embedding_cache_dir: str | None = os.environ.get("EMBEDDING_CACHE_DIR")

        # Storage
        self.media_path: str = os.environ.get("MEDIA_PATH", "/data/media")
        self.thumbnail_size: int = int(
            os.environ.get("THUMBNAIL_SIZE", str(DEFAULT_THUMBNAIL_SIZE))
        )

        # Server
        self.host: str = os.environ.get("HOST", "0.0.0.0")  # noqa: S104
        self.port: int = int(os.environ.get("PORT", "8000"))

    def _default_vision_model(self) -> str:
        """Return default model name based on vision backend."""
        defaults = {
            "gemini": "gemini-2.5-flash",
        }
        return defaults.get(self.vision_backend, "")

    @property
    def dsn(self) -> str:
        """PostgreSQL connection string."""
        return (
            f"host={self.pg_host} port={self.pg_port} "
            f"dbname={self.pg_database} user={self.pg_user} "
            f"password={self.pg_password}"
        )

    def ensure_media_dirs(self) -> None:
        """Create media directories if they don't exist."""
        base = Path(self.media_path)
        for subdir in ("originals", "thumbnails", "videos", "theme-videos"):
            (base / subdir).mkdir(parents=True, exist_ok=True)
        # Multi-size thumbnail directories
        for size_name in THUMBNAIL_SIZES:
            (base / "thumbnails" / size_name).mkdir(parents=True, exist_ok=True)


def get_config() -> Config:
    """Get or create the singleton configuration."""
    global _config
    if _config is None:
        _config = Config()
    return _config


def reset_config() -> None:
    """Reset the cached config (for testing)."""
    global _config
    _config = None
