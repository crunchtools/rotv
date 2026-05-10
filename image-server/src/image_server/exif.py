"""EXIF metadata extraction using Pillow."""

from __future__ import annotations

import io
import logging
from typing import Any

from PIL import Image
from PIL.ExifTags import TAGS

logger = logging.getLogger(__name__)


def extract_exif(data: bytes) -> dict[str, Any]:
    """Extract EXIF data from image bytes.

    Returns a JSON-serializable dict of EXIF tags.
    """
    result: dict[str, Any] = {}

    try:
        with Image.open(io.BytesIO(data)) as img:
            exif_data = img.getexif()
            if not exif_data:
                return result

            for tag_id, value in exif_data.items():
                tag_name = TAGS.get(tag_id, str(tag_id))
                if isinstance(value, (tuple, list)):
                    result[tag_name] = [_sanitize_value(v) for v in value]
                else:
                    result[tag_name] = _sanitize_value(value)

    except Exception:
        logger.debug("Failed to extract EXIF data", exc_info=True)

    return result


def _sanitize_value(value: Any) -> Any:
    """Make a value JSON-serializable and PostgreSQL-safe."""
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8", errors="replace").replace("\x00", "")
        except Exception:
            return f"<binary {len(value)} bytes>"
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, (int, float, bool)):
        return value
    return str(value).replace("\x00", "")
