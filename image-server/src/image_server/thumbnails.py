"""Thumbnail generation using Pillow."""

from __future__ import annotations

import io
import logging
from pathlib import Path

from PIL import Image

from .config import THUMBNAIL_SIZES, get_config

logger = logging.getLogger(__name__)


def generate_thumbnail(source_path: Path, dest_path: Path) -> tuple[int, int]:
    """Generate a JPEG thumbnail from an image file.

    Returns (width, height) of the thumbnail.
    """
    cfg = get_config()
    size = cfg.thumbnail_size

    with Image.open(source_path) as img:
        # Convert RGBA/P to RGB for JPEG output
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        img.thumbnail((size, size), Image.Resampling.LANCZOS)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest_path, "JPEG", quality=85, optimize=True)
        logger.info("Generated thumbnail: %s (%dx%d)", dest_path.name, img.width, img.height)
        return img.width, img.height


def generate_thumbnail_from_bytes(
    data: bytes, dest_path: Path
) -> tuple[int, int]:
    """Generate a JPEG thumbnail from raw image bytes.

    Returns (width, height) of the thumbnail.
    """
    cfg = get_config()
    size = cfg.thumbnail_size

    with Image.open(io.BytesIO(data)) as img:
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        img.thumbnail((size, size), Image.Resampling.LANCZOS)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest_path, "JPEG", quality=85, optimize=True)
        return img.width, img.height


def generate_all_thumbnails_from_bytes(data: bytes, file_uuid: str) -> None:
    """Generate small, medium, and large thumbnails from raw image bytes."""
    cfg = get_config()
    base = Path(cfg.media_path) / "thumbnails"

    with Image.open(io.BytesIO(data)) as img:
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        for size_name, max_dim in THUMBNAIL_SIZES.items():
            # Skip sizes larger than the original
            if img.width <= max_dim and img.height <= max_dim:
                # Original is smaller than this size — save at original dimensions
                thumb = img.copy()
            else:
                thumb = img.copy()
                thumb.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

            dest = base / size_name / f"{file_uuid}.jpg"
            dest.parent.mkdir(parents=True, exist_ok=True)
            thumb.save(dest, "JPEG", quality=85, optimize=True)
            logger.info(
                "Generated %s thumbnail: %s (%dx%d)",
                size_name, dest.name, thumb.width, thumb.height,
            )


def generate_all_thumbnails_from_path(source_path: Path, file_uuid: str) -> None:
    """Generate small, medium, and large thumbnails from an image file on disk."""
    with open(source_path, "rb") as f:
        data = f.read()
    generate_all_thumbnails_from_bytes(data, file_uuid)


def get_image_dimensions(data: bytes) -> tuple[int, int]:
    """Get width and height from image bytes without fully decoding."""
    with Image.open(io.BytesIO(data)) as img:
        return img.width, img.height
