"""Tests for thumbnail generation."""

import io
from pathlib import Path

from PIL import Image

from image_server.thumbnails import (
    generate_thumbnail,
    generate_thumbnail_from_bytes,
    get_image_dimensions,
)

# EXIF Orientation tag id; value 6 = stored landscape, displays rotated 90deg
# (i.e. a portrait photo). exif_transpose must swap the dimensions.
_ORIENTATION_TAG = 0x0112


def _landscape_jpeg_tagged_portrait() -> bytes:
    """A 100x50 JPEG carrying EXIF Orientation=6 (should display as 50x100)."""
    img = Image.new("RGB", (100, 50), color=(0, 0, 255))
    exif = img.getexif()
    exif[_ORIENTATION_TAG] = 6
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


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


def test_get_image_dimensions_honors_exif_orientation():
    """A landscape buffer tagged Orientation=6 reports portrait dimensions (#393)."""
    w, h = get_image_dimensions(_landscape_jpeg_tagged_portrait())
    # Without exif_transpose this would be (100, 50).
    assert (w, h) == (50, 100)


def test_thumbnail_applies_exif_orientation(tmp_path, monkeypatch):
    """Thumbnail of an Orientation=6 image comes out portrait, not sideways (#393)."""
    monkeypatch.setenv("THUMBNAIL_SIZE", "100")

    dest = tmp_path / "thumb.jpg"
    w, h = generate_thumbnail_from_bytes(_landscape_jpeg_tagged_portrait(), dest)

    # The 100x50 landscape buffer must be rotated to portrait (taller than wide).
    assert h > w
    with Image.open(dest) as img:
        assert img.height > img.width


def test_thumbnail_from_file_applies_exif_orientation(tmp_path, monkeypatch):
    """The file entry point shares _write_thumbnail, so #393 must hold there too."""
    monkeypatch.setenv("THUMBNAIL_SIZE", "100")

    source = tmp_path / "landscape-tagged-portrait.jpg"
    source.write_bytes(_landscape_jpeg_tagged_portrait())
    dest = tmp_path / "thumb.jpg"

    w, h = generate_thumbnail(source, dest)

    assert h > w
    with Image.open(dest) as img:
        assert img.height > img.width
