"""Test fixtures for image server."""

import os

import pytest


@pytest.fixture(autouse=True)
def _reset_singletons():
    """Reset module-level singletons between tests."""
    from image_server.config import reset_config
    from image_server.vision import reset_backend

    reset_config()
    reset_backend()
    yield
    reset_config()
    reset_backend()


@pytest.fixture
def test_env(tmp_path, monkeypatch):
    """Set up test environment variables."""
    media_path = tmp_path / "media"
    media_path.mkdir()

    monkeypatch.setenv("PGHOST", "localhost")
    monkeypatch.setenv("PGPORT", "5432")
    monkeypatch.setenv("PGDATABASE", "imageserver_test")
    monkeypatch.setenv("PGUSER", "imageserver")
    monkeypatch.setenv("PGPASSWORD", "imageserver")
    monkeypatch.setenv("MEDIA_PATH", str(media_path))
    monkeypatch.setenv("VISION_BACKEND", "none")

    return {"media_path": media_path}


@pytest.fixture
def sample_jpeg(tmp_path):
    """Create a minimal valid JPEG file."""
    from PIL import Image

    img = Image.new("RGB", (100, 80), color=(255, 0, 0))
    path = tmp_path / "test.jpg"
    img.save(path, "JPEG")
    return path


@pytest.fixture
def sample_jpeg_bytes(sample_jpeg):
    """Return bytes of a minimal valid JPEG."""
    return sample_jpeg.read_bytes()


@pytest.fixture
def sample_png(tmp_path):
    """Create a minimal valid PNG file with RGBA mode."""
    from PIL import Image

    img = Image.new("RGBA", (200, 150), color=(0, 255, 0, 128))
    path = tmp_path / "test.png"
    img.save(path, "PNG")
    return path
