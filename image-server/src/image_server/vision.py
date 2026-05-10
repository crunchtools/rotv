"""Gemini vision backend for image captioning."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .config import get_config

logger = logging.getLogger(__name__)

_IMAGE_MIMES: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".heic": "image/heic",
    ".heif": "image/heif",
}


class GeminiBackend:
    """Gemini vision backend for generating image captions."""

    def __init__(self, model: str, prompt: str) -> None:
        self._model = model
        self._prompt = prompt
        self._client: Any = None

    def _get_client(self) -> Any:
        """Get or create the Gemini client (lazy, reused across calls)."""
        if self._client is not None:
            return self._client

        try:
            from google import genai
        except ImportError as exc:
            msg = "google-genai not installed (pip install google-genai)"
            raise RuntimeError(msg) from exc

        import os

        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            msg = "GEMINI_API_KEY not set"
            raise RuntimeError(msg)

        timeout_s = get_config().vision_timeout
        self._client = genai.Client(
            api_key=api_key,
            http_options={"timeout": timeout_s * 1000},
        )
        return self._client

    def caption(self, image_path: Path) -> str:
        """Generate a caption for an image file."""
        try:
            from google.genai import types
        except ImportError as exc:
            msg = "google-genai not installed"
            raise RuntimeError(msg) from exc

        client = self._get_client()
        suffix = image_path.suffix.lower()
        mime = _IMAGE_MIMES.get(suffix)
        if not mime:
            msg = f"Unknown image MIME type for extension: {suffix}"
            raise ValueError(msg)
        file_bytes = image_path.read_bytes()

        content = types.Content(
            parts=[
                types.Part.from_bytes(data=file_bytes, mime_type=mime),
                types.Part.from_text(text=self._prompt),
            ]
        )
        try:
            response = client.models.generate_content(
                model=self._model,
                contents=content,
            )
        except Exception as exc:
            msg = f"Gemini captioning failed for {image_path}: {exc}"
            raise RuntimeError(msg) from exc

        if response.text:
            return str(response.text)
        msg = f"Gemini returned empty response for {image_path}"
        raise RuntimeError(msg)

    def caption_bytes(self, caption_data: bytes, mime_type: str) -> str:
        """Generate a caption from raw image bytes."""
        try:
            from google.genai import types
        except ImportError as exc:
            msg = "google-genai not installed"
            raise RuntimeError(msg) from exc

        client = self._get_client()
        content = types.Content(
            parts=[
                types.Part.from_bytes(data=caption_data, mime_type=mime_type),
                types.Part.from_text(text=self._prompt),
            ]
        )
        try:
            response = client.models.generate_content(
                model=self._model,
                contents=content,
            )
        except Exception as exc:
            msg = f"Gemini captioning failed: {exc}"
            raise RuntimeError(msg) from exc

        if response.text:
            return str(response.text)
        msg = "Gemini returned empty response"
        raise RuntimeError(msg)


_backend: GeminiBackend | None = None


def get_backend() -> GeminiBackend | None:
    """Get the configured vision backend, or None if vision is disabled."""
    global _backend
    if _backend is not None:
        return _backend

    cfg = get_config()
    if cfg.vision_backend != "gemini":
        return None

    _backend = GeminiBackend(cfg.vision_model, cfg.vision_prompt)
    return _backend


def reset_backend() -> None:
    """Reset the cached backend (for testing)."""
    global _backend
    _backend = None
