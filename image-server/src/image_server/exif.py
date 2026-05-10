"""EXIF metadata extraction using Pillow."""

from __future__ import annotations

import io
from typing import Any

from PIL import Image
from PIL.ExifTags import TAGS


def extract_exif(image_bytes: bytes) -> dict[str, Any]:
    """Extract EXIF data from image bytes.

    Returns a JSON-serializable dict of EXIF tags.
    Raises OSError, KeyError, ValueError, or AttributeError on failure.
    """
    exif_tags: dict[str, Any] = {}

    with Image.open(io.BytesIO(image_bytes)) as img:
        raw_exif = img.getexif()
        if not raw_exif:
            return exif_tags

        for tag_id, value in raw_exif.items():
            tag_name = TAGS.get(tag_id, str(tag_id))
            match value:
                case tuple() | list():
                    sanitized = []
                    for item in value:
                        match item:
                            case bytes():
                                sanitized.append(item.decode("utf-8", errors="replace").replace("\x00", ""))
                            case str():
                                sanitized.append(item.replace("\x00", ""))
                            case int() | float() | bool():
                                sanitized.append(item)
                            case _:
                                sanitized.append(str(item).replace("\x00", ""))
                    exif_tags[tag_name] = sanitized
                case bytes():
                    exif_tags[tag_name] = value.decode("utf-8", errors="replace").replace("\x00", "")
                case str():
                    exif_tags[tag_name] = value.replace("\x00", "")
                case int() | float() | bool():
                    exif_tags[tag_name] = value
                case _:
                    exif_tags[tag_name] = str(value).replace("\x00", "")

    return exif_tags
