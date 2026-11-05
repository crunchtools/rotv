"""Tests for API endpoints (unit-level, no database required)."""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from image_server.api import _media_path, app


def test_health():
    """Health endpoint returns ok."""
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "image-server"


def test_list_assets_requires_poi_id():
    """List assets requires poi_id parameter."""
    client = TestClient(app)
    response = client.get("/api/assets")
    assert response.status_code == 400


def test_theme_video_invalid_theme():
    """Invalid theme returns 404."""
    client = TestClient(app)
    response = client.get("/api/theme-videos/invalid")
    assert response.status_code == 404


def test_search_requires_query():
    """Search requires a query field."""
    client = TestClient(app)
    response = client.post("/api/search", json={})
    assert response.status_code == 400


def test_media_path_allows_plain_filename(test_env):
    """A normal filename resolves inside the media root."""
    resolved = _media_path("originals", "photo.jpg")
    assert resolved == (test_env["media_path"].resolve() / "originals" / "photo.jpg")


@pytest.mark.usefixtures("test_env")
def test_media_path_rejects_traversal():
    """A relative part that escapes the media root is rejected."""
    with pytest.raises(HTTPException) as excinfo:
        _media_path("originals", "../../etc/passwd")
    assert excinfo.value.status_code == 400


@pytest.mark.usefixtures("test_env")
def test_media_path_rejects_absolute():
    """An absolute part would discard the media root, so it is rejected."""
    with pytest.raises(HTTPException) as excinfo:
        _media_path("originals", "/etc/passwd")
    assert excinfo.value.status_code == 400


def test_media_path_rejects_symlink_escape(test_env, tmp_path):
    """A symlink inside the media root that points outside it is rejected.

    This is the case the string guard on `filename` cannot catch -- the name
    holds no separator and no `..` -- so it is what `resolve()` buys beyond it.
    """
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("not for the web")

    originals = test_env["media_path"] / "originals"
    originals.mkdir()
    (originals / "escape.txt").symlink_to(outside / "secret.txt")

    with pytest.raises(HTTPException) as excinfo:
        _media_path("originals", "escape.txt")
    assert excinfo.value.status_code == 400


def test_serve_media_file_rejects_symlink_escape(test_env, tmp_path):
    """The endpoint refuses a symlinked file rather than serving what it targets."""
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("not for the web")

    originals = test_env["media_path"] / "originals"
    originals.mkdir()
    (originals / "escape.txt").symlink_to(outside / "secret.txt")

    client = TestClient(app)
    response = client.get("/api/media/originals/escape.txt")
    assert response.status_code == 400
    assert "not for the web" not in response.text


def test_serve_media_file_rejects_encoded_dots():
    """Percent-encoded dots are decoded before the filename guard runs."""
    client = TestClient(app)
    response = client.get("/api/media/originals/%2e%2e")
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid filename"


def test_serve_media_file_encoded_slash_never_reaches_handler():
    """An encoded separator is decoded before routing, so the path stops matching.

    Starlette unquotes the path before it matches, so `..%2F..%2Fetc%2Fpasswd`
    becomes four segments and `/api/media/{subdir}/{filename}` no longer
    matches at all. The traversal is refused by the router, not the handler --
    worth pinning down, because the guard in the handler is written as though
    it were the thing that catches this.
    """
    client = TestClient(app)
    response = client.get("/api/media/originals/..%2F..%2Fetc%2Fpasswd")
    assert response.status_code == 404


def test_serve_media_file_rejects_unknown_subdir():
    """A subdir outside the allowlist is rejected."""
    client = TestClient(app)
    response = client.get("/api/media/bogus/photo.jpg")
    assert response.status_code == 400


def test_bulk_caption_requires_asset_ids():
    """A missing or empty asset_ids list is rejected."""
    client = TestClient(app)
    assert client.post("/api/bulk/caption", json={}).status_code == 400
    assert client.post("/api/bulk/caption", json={"asset_ids": []}).status_code == 400
    assert client.post("/api/bulk/caption", json={"asset_ids": "7"}).status_code == 400


@pytest.mark.parametrize("bad_id", ["7\ninjected", "7", 1.9, 1.0, True, None, [7]])
def test_bulk_caption_rejects_non_integer_ids(bad_id):
    """Anything that is not an integer is refused, not coerced.

    `1.9` must not quietly become asset 1, and `True` must not become asset 1
    either -- both would caption the wrong asset. A string id is refused rather
    than parsed, which is also what keeps request text out of the log
    (py/log-injection).
    """
    client = TestClient(app)
    response = client.post("/api/bulk/caption", json={"asset_ids": [bad_id]})
    assert response.status_code == 400
    assert response.json()["detail"] == "asset_ids must be integers"


def test_bulk_caption_hides_exception_text(test_env, monkeypatch):
    """A captioning failure is logged, and the caller gets a fixed string."""
    from image_server import api

    media = test_env["media_path"] / "originals"
    media.mkdir(parents=True)
    (media / "a.jpg").write_bytes(b"not really a jpeg")

    secret = "psycopg: connection to host=db user=imageserver failed"

    class _ExplodingBackend:
        def caption(self, path):
            raise RuntimeError(secret)

    monkeypatch.setattr(api, "get_backend", _ExplodingBackend)
    monkeypatch.setattr(
        api.db,
        "get_asset",
        lambda asset_id: {"id": asset_id, "asset_type": "image", "filename": "a.jpg"},
    )

    client = TestClient(app)
    response = client.post("/api/bulk/caption", json={"asset_ids": [7]})

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "captioned": 0,
        "failed": 1,
        "errors": [{"id": 7, "error": "Captioning failed"}],
    }
    assert secret not in response.text
