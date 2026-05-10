"""Tests for vision backend."""

from image_server.vision import get_backend, reset_backend


def test_vision_disabled_by_default(monkeypatch):
    """Default config has vision disabled."""
    monkeypatch.setenv("VISION_BACKEND", "none")
    reset_backend()
    backend = get_backend()
    assert backend is None


def test_gemini_backend_created(monkeypatch):
    """Gemini backend is created when configured."""
    monkeypatch.setenv("VISION_BACKEND", "gemini")
    monkeypatch.setenv("VISION_MODEL", "gemini-2.5-flash")
    reset_backend()
    backend = get_backend()
    assert backend is not None
    assert backend._model == "gemini-2.5-flash"


def test_unknown_backend(monkeypatch):
    """Unknown backend returns None."""
    monkeypatch.setenv("VISION_BACKEND", "unknown")
    reset_backend()
    backend = get_backend()
    assert backend is None
