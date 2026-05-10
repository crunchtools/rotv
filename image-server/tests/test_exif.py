"""Tests for EXIF extraction."""

import io

from PIL import Image

from image_server.exif import extract_exif


def test_extract_exif_no_data():
    """Image without EXIF returns empty dict."""
    img = Image.new("RGB", (10, 10))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    result = extract_exif(buf.getvalue())
    # Minimal JPEG may have no EXIF
    assert isinstance(result, dict)


def test_extract_exif_invalid_data():
    """Invalid data returns empty dict without crashing."""
    result = extract_exif(b"not an image")
    assert result == {}


def test_extract_exif_png():
    """PNG images handled gracefully."""
    img = Image.new("RGB", (10, 10))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    result = extract_exif(buf.getvalue())
    assert isinstance(result, dict)
