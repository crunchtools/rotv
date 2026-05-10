"""Tests for API endpoints (unit-level, no database required)."""

from fastapi.testclient import TestClient

from image_server.api import app


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
