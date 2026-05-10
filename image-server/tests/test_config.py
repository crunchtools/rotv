"""Tests for configuration module."""

from image_server.config import Config, get_config, reset_config


def test_defaults():
    """Config has sensible defaults."""
    reset_config()
    cfg = Config()
    assert cfg.pg_host == "localhost"
    assert cfg.pg_port == 5432
    assert cfg.pg_database == "imageserver"
    assert cfg.media_path == "/data/media"
    assert cfg.thumbnail_size == 250
    assert cfg.vision_backend == "none"
    assert cfg.embedding_model == "BAAI/bge-small-en-v1.5"
    assert cfg.port == 8000


def test_env_override(monkeypatch):
    """Environment variables override defaults."""
    monkeypatch.setenv("PGHOST", "db.example.com")
    monkeypatch.setenv("PGPORT", "5433")
    monkeypatch.setenv("MEDIA_PATH", "/opt/images")
    monkeypatch.setenv("THUMBNAIL_SIZE", "400")
    monkeypatch.setenv("VISION_BACKEND", "gemini")

    reset_config()
    cfg = Config()
    assert cfg.pg_host == "db.example.com"
    assert cfg.pg_port == 5433
    assert cfg.media_path == "/opt/images"
    assert cfg.thumbnail_size == 400
    assert cfg.vision_backend == "gemini"
    assert cfg.vision_model == "gemini-2.5-flash"


def test_dsn():
    """DSN string is properly formatted."""
    reset_config()
    cfg = Config()
    dsn = cfg.dsn
    assert "host=localhost" in dsn
    assert "port=5432" in dsn
    assert "dbname=imageserver" in dsn


def test_singleton():
    """get_config returns the same instance."""
    reset_config()
    c1 = get_config()
    c2 = get_config()
    assert c1 is c2


def test_ensure_media_dirs(tmp_path, monkeypatch):
    """ensure_media_dirs creates expected subdirectories."""
    monkeypatch.setenv("MEDIA_PATH", str(tmp_path / "media"))
    reset_config()
    cfg = Config()
    cfg.ensure_media_dirs()

    for subdir in ("originals", "thumbnails", "videos", "theme-videos"):
        assert (tmp_path / "media" / subdir).is_dir()
