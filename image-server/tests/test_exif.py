"""Tests for EXIF extraction."""

import io

import pytest
from PIL import Image

from image_server.exif import extract_exif


def test_extract_exif_no_data():
    """Image without EXIF returns empty dict."""
    img = Image.new("RGB", (10, 10))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    exif_result = extract_exif(buf.getvalue())
    assert isinstance(exif_result, dict)


def test_extract_exif_invalid_data():
    """Invalid data raises an exception."""
    with pytest.raises(Exception):
        extract_exif(b"not an image")


def test_extract_exif_png():
    """PNG images handled gracefully."""
    img = Image.new("RGB", (10, 10))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    exif_result = extract_exif(buf.getvalue())
    assert isinstance(exif_result, dict)
