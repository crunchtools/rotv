"""Tests for thumbnail generation."""

from pathlib import Path

from PIL import Image

from image_server.thumbnails import (
    generate_thumbnail,
    generate_thumbnail_from_bytes,
    get_image_dimensions,
)


def test_generate_thumbnail(sample_jpeg, tmp_path, monkeypatch):
    """Thumbnail is generated at configured size."""
    monkeypatch.setenv("THUMBNAIL_SIZE", "50")

    dest = tmp_path / "thumb.jpg"
    w, h = generate_thumbnail(sample_jpeg, dest)

    assert dest.exists()
    assert w <= 50
    assert h <= 50

    with Image.open(dest) as img:
        assert img.format == "JPEG"


def test_generate_thumbnail_from_bytes(sample_jpeg_bytes, tmp_path, monkeypatch):
    """Thumbnail from bytes works the same as from file."""
    monkeypatch.setenv("THUMBNAIL_SIZE", "80")

    dest = tmp_path / "thumb.jpg"
    w, h = generate_thumbnail_from_bytes(sample_jpeg_bytes, dest)

    assert dest.exists()
    assert w <= 80
    assert h <= 80


def test_rgba_conversion(sample_png, tmp_path, monkeypatch):
    """RGBA images are converted to RGB for JPEG output."""
    monkeypatch.setenv("THUMBNAIL_SIZE", "100")

    dest = tmp_path / "thumb.jpg"
    w, h = generate_thumbnail(sample_png, dest)

    assert dest.exists()
    with Image.open(dest) as img:
        assert img.mode == "RGB"


def test_get_image_dimensions(sample_jpeg_bytes):
    """Dimensions are correctly extracted."""
    w, h = get_image_dimensions(sample_jpeg_bytes)
    assert w == 100
    assert h == 80
