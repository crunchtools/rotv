"""FastAPI REST API routes for image server."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from . import database as db
from .config import get_config
from .embedder import embed_query, embed_texts
from .exif import extract_exif
from .thumbnails import generate_all_thumbnails_from_bytes, generate_thumbnail_from_bytes, get_image_dimensions
from .vision import get_backend

logger = logging.getLogger(__name__)

app = FastAPI(title="Image Server", version="0.1.0")

IMAGE_MIMES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/bmp", "image/tiff", "image/heic", "image/heif",
}
VIDEO_MIMES = {"video/mp4", "video/quicktime", "video/webm", "video/x-matroska"}

MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-matroska": ".mkv",
}


def _serialize_asset(asset: dict[str, Any]) -> dict[str, Any]:
    """Convert asset dict for JSON response (handle non-serializable types)."""
    serialized = {}
    for key, value in asset.items():
        if key == "embedding":
            continue
        if key == "search_vector":
            continue
        if hasattr(value, "isoformat"):
            serialized[key] = value.isoformat()
        else:
            serialized[key] = value
    return serialized


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {"service": "image-server", "health": "/api/health"}


@app.get("/api/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok", "service": "image-server"}


_upload_file = File(...)


@app.post("/api/assets")
async def upload_asset(
    file: UploadFile = _upload_file,
    poi_id: int | None = Form(None),
    role: str = Form("gallery"),
    theme: str | None = Form(None),
    sort_order: int = Form(0),
) -> JSONResponse:
    """Upload an image or video file."""
    if not file.content_type:
        raise HTTPException(status_code=400, detail="Missing content type")

    mime = file.content_type
    is_image = mime in IMAGE_MIMES
    is_video = mime in VIDEO_MIMES

    if not is_image and not is_video:
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {mime}")

    asset_type = "image" if is_image else "video"
    ext = MIME_TO_EXT.get(mime, ".bin")
    file_uuid = str(uuid.uuid4())
    filename = f"{file_uuid}{ext}"

    cfg = get_config()
    data = await file.read()
    file_size = len(data)

    if is_image:
        original_path = Path(cfg.media_path) / "originals" / filename
    else:
        subdir = "theme-videos" if role == "theme_video" else "videos"
        original_path = Path(cfg.media_path) / subdir / filename

    original_path.parent.mkdir(parents=True, exist_ok=True)
    original_path.write_bytes(data)

    width = None
    height = None
    if is_image:
        try:
            width, height = get_image_dimensions(data)
        except Exception:
            logger.warning("Could not get image dimensions for %s", filename)

        try:
            thumb_path = Path(cfg.media_path) / "thumbnails" / f"{file_uuid}.jpg"
            generate_thumbnail_from_bytes(data, thumb_path)
            generate_all_thumbnails_from_bytes(data, file_uuid)
        except Exception:
            logger.warning("Could not generate thumbnails for %s", filename)

    exif_data: dict[str, Any] = {}
    if is_image:
        try:
            exif_data = extract_exif(data)
        except Exception:
            logger.warning("Could not extract EXIF for %s", filename)

    caption = None
    if is_image:
        backend = get_backend()
        if backend:
            try:
                caption = backend.caption_bytes(data, mime)
                logger.info("Generated caption for %s: %s", filename, caption[:80])
            except Exception:
                logger.warning("Vision captioning failed for %s", filename, exc_info=True)

    embedding = None
    embed_text = caption or file.filename or filename
    try:
        embeddings = embed_texts([embed_text])
        if embeddings:
            embedding = embeddings[0]
    except Exception:
        logger.warning("Embedding generation failed for %s", filename, exc_info=True)

    asset = db.insert_asset(
        poi_id=poi_id,
        asset_type=asset_type,
        role=role,
        theme=theme,
        filename=filename,
        original_filename=file.filename,
        mime_type=mime,
        file_size=file_size,
        width=width,
        height=height,
        sort_order=sort_order,
        caption=caption,
        exif=exif_data,
        embedding=embedding,
    )

    return JSONResponse(content=_serialize_asset(asset), status_code=201)


@app.get("/api/assets/{asset_id}/original")
async def serve_original(asset_id: int) -> FileResponse:
    """Serve the original file for an asset."""
    asset = db.get_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    cfg = get_config()

    if asset["asset_type"] == "video":
        subdir = "theme-videos" if asset["role"] == "theme_video" else "videos"
    else:
        subdir = "originals"

    file_path = Path(cfg.media_path) / subdir / asset["filename"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type=asset["mime_type"],
        filename=asset.get("original_filename") or asset["filename"],
    )


@app.get("/api/assets/{asset_id}/thumbnail")
async def serve_thumbnail(
    asset_id: int, size: str | None = Query(None)
) -> FileResponse:
    """Serve a thumbnail for an asset.

    Optional size parameter: small (100px), medium (600px), large (1200px).
    Without size parameter, returns the legacy 250px thumbnail.
    """
    asset = db.get_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    if asset["asset_type"] != "image":
        raise HTTPException(status_code=400, detail="Thumbnails only available for images")

    cfg = get_config()
    file_uuid = asset["filename"].rsplit(".", 1)[0]

    if size and size in ("small", "medium", "large"):
        thumb_path = Path(cfg.media_path) / "thumbnails" / size / f"{file_uuid}.jpg"
    else:
        thumb_path = Path(cfg.media_path) / "thumbnails" / f"{file_uuid}.jpg"

    if not thumb_path.exists():
        fallback = Path(cfg.media_path) / "thumbnails" / f"{file_uuid}.jpg"
        if fallback.exists():
            thumb_path = fallback
        else:
            raise HTTPException(status_code=404, detail="Thumbnail not found")

    return FileResponse(path=str(thumb_path), media_type="image/jpeg")


@app.delete("/api/assets/{asset_id}")
async def delete_asset(asset_id: int) -> dict[str, Any]:
    """Delete an asset and its files."""
    asset = db.get_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    cfg = get_config()

    if asset["asset_type"] == "video":
        subdir = "theme-videos" if asset["role"] == "theme_video" else "videos"
    else:
        subdir = "originals"

    original_path = Path(cfg.media_path) / subdir / asset["filename"]
    if original_path.exists():
        original_path.unlink()

    if asset["asset_type"] == "image":
        file_uuid = asset["filename"].rsplit(".", 1)[0]
        thumb_path = Path(cfg.media_path) / "thumbnails" / f"{file_uuid}.jpg"
        if thumb_path.exists():
            thumb_path.unlink()
        for size_name in ("small", "medium", "large"):
            sized_path = Path(cfg.media_path) / "thumbnails" / size_name / f"{file_uuid}.jpg"
            if sized_path.exists():
                sized_path.unlink()

    db.delete_asset(asset_id)

    return {"deleted": True, "id": asset_id}


@app.get("/api/assets/all")
async def list_all_assets() -> list[dict[str, Any]]:
    """List all assets across all POIs."""
    assets = db.get_all_assets()
    return [_serialize_asset(a) for a in assets]


@app.get("/api/assets")
async def list_assets(
    poi_id: int | None = Query(None),
    role: str | None = Query(None),
) -> list[dict[str, Any]]:
    """List assets, optionally filtered by poi_id and/or role."""
    if poi_id is None:
        raise HTTPException(status_code=400, detail="poi_id query parameter required")

    assets = db.get_assets_for_poi(poi_id, role=role)
    return [_serialize_asset(a) for a in assets]


@app.put("/api/assets/{asset_id}")
async def update_asset(asset_id: int, body: dict[str, Any]) -> dict[str, Any]:
    """Update asset metadata (tags, role, theme, sort_order)."""
    asset = db.get_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    if "caption" in body or "tags" in body:
        caption = body.get("caption", asset.get("caption", ""))
        tags = body.get("tags", asset.get("tags", []))
        embed_text = caption or " ".join(tags) if tags else asset.get("original_filename", "")
        try:
            embeddings = embed_texts([embed_text])
            if embeddings:
                body["embedding"] = embeddings[0]
        except Exception:
            logger.warning("Re-embedding failed for asset %d", asset_id)

    updated = db.update_asset(asset_id, **body)
    if not updated:
        raise HTTPException(status_code=404, detail="Asset not found after update")

    return _serialize_asset(updated)


@app.post("/api/assets/{asset_id}/caption")
async def trigger_caption(asset_id: int) -> dict[str, Any]:
    """Trigger AI captioning for an asset."""
    asset = db.get_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    if asset["asset_type"] != "image":
        raise HTTPException(status_code=400, detail="Captioning only available for images")

    backend = get_backend()
    if not backend:
        raise HTTPException(status_code=503, detail="Vision backend not configured")

    cfg = get_config()
    file_path = Path(cfg.media_path) / "originals" / asset["filename"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Original file not found")

    caption = backend.caption(file_path)

    embedding = None
    try:
        embeddings = embed_texts([caption])
        if embeddings:
            embedding = embeddings[0]
    except Exception:
        logger.warning("Embedding failed after captioning asset %d", asset_id)

    updates: dict[str, Any] = {"caption": caption}
    if embedding:
        updates["embedding"] = embedding

    updated = db.update_asset(asset_id, **updates)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update asset")

    return _serialize_asset(updated)


@app.post("/api/search")
async def search(body: dict[str, Any]) -> list[dict[str, Any]]:
    """Semantic search for assets by text query."""
    query = body.get("query", "")
    if not query:
        raise HTTPException(status_code=400, detail="query field required")

    limit = body.get("limit", 20)
    poi_id = body.get("poi_id")
    role = body.get("role")

    try:
        query_vec = embed_query(query)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {exc}") from exc

    results = db.search_assets(query_vec, limit=limit, poi_id=poi_id, role=role)
    return [_serialize_asset(r) for r in results]


@app.get("/api/theme-videos/{theme}")
async def serve_theme_video(theme: str) -> FileResponse:
    """Serve a theme background video."""
    valid_themes = {
        "winter", "spring", "summer", "fall",
        "night", "christmas", "halloween", "newyears",
    }
    if theme not in valid_themes:
        raise HTTPException(status_code=404, detail=f"Unknown theme: {theme}")

    cfg = get_config()
    video_path = Path(cfg.media_path) / "theme-videos" / f"{theme}.mp4"

    if not video_path.exists():
        assets = db.get_assets_for_poi(0, role="theme_video")
        for asset in assets:
            if asset.get("theme") == theme:
                alt_path = Path(cfg.media_path) / "theme-videos" / asset["filename"]
                if alt_path.exists():
                    return FileResponse(path=str(alt_path), media_type="video/mp4")

        raise HTTPException(status_code=404, detail=f"Theme video not found: {theme}")

    return FileResponse(path=str(video_path), media_type="video/mp4")


@app.post("/api/bulk/caption")
async def bulk_caption(body: dict[str, Any]) -> dict[str, Any]:
    """Batch AI captioning for multiple assets."""
    asset_ids: list[int] = body.get("asset_ids", [])
    if not asset_ids:
        raise HTTPException(status_code=400, detail="asset_ids list required")

    backend = get_backend()
    if not backend:
        raise HTTPException(status_code=503, detail="Vision backend not configured")

    cfg = get_config()
    caption_results: dict[str, Any] = {"captioned": 0, "failed": 0, "errors": []}

    for asset_id in asset_ids:
        asset = db.get_asset(asset_id)
        if not asset or asset["asset_type"] != "image":
            caption_results["failed"] += 1
            caption_results["errors"].append({"id": asset_id, "error": "Not found or not an image"})
            continue

        file_path = Path(cfg.media_path) / "originals" / asset["filename"]
        if not file_path.exists():
            caption_results["failed"] += 1
            caption_results["errors"].append({"id": asset_id, "error": "File not found"})
            continue

        try:
            caption = backend.caption(file_path)
            embedding = None
            try:
                embeddings = embed_texts([caption])
                if embeddings:
                    embedding = embeddings[0]
            except Exception:
                pass

            updates: dict[str, Any] = {"caption": caption}
            if embedding:
                updates["embedding"] = embedding
            db.update_asset(asset_id, **updates)
            caption_results["captioned"] += 1
        except Exception as exc:
            caption_results["failed"] += 1
            caption_results["errors"].append({"id": asset_id, "error": str(exc)})

    return caption_results


MEDIA_SUBDIRS = {"originals", "thumbnails", "videos", "theme-videos"}


def _pg_env() -> dict[str, str]:
    """Build environment dict for pg_dump / psql subprocesses."""
    cfg = get_config()
    return {
        "PGHOST": cfg.pg_host,
        "PGPORT": str(cfg.pg_port),
        "PGDATABASE": cfg.pg_database,
        "PGUSER": cfg.pg_user,
        "PGPASSWORD": cfg.pg_password,
    }


@app.get("/api/backup/db")
async def backup_db() -> StreamingResponse:
    """Stream a pg_dump of the image server database."""
    env = _pg_env()
    try:
        proc = await asyncio.create_subprocess_exec(
            "pg_dump", "--clean", "--if-exists",
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="pg_dump not found on server") from exc

    async def _stream() -> asyncio.AsyncIterator[bytes]:
        assert proc.stdout is not None
        while True:
            chunk = await proc.stdout.read(64 * 1024)
            if not chunk:
                break
            yield chunk
        retcode = await proc.wait()
        if retcode != 0:
            assert proc.stderr is not None
            err = (await proc.stderr.read()).decode(errors="replace")
            logger.error("pg_dump exited %d: %s", retcode, err)

    return StreamingResponse(
        _stream(),
        media_type="application/sql",
        headers={"Content-Disposition": "attachment; filename=imageserver-backup.sql"},
    )


_restore_file = File(...)


@app.post("/api/restore/db")
async def restore_db(file: UploadFile = _restore_file) -> dict[str, Any]:
    """Restore the image server database from a SQL dump upload."""
    env = _pg_env()
    try:
        proc = await asyncio.create_subprocess_exec(
            "psql",
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="psql not found on server") from exc

    assert proc.stdin is not None
    while chunk := await file.read(64 * 1024):
        proc.stdin.write(chunk)
        await proc.stdin.drain()
    proc.stdin.close()
    await proc.stdin.wait_closed()

    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        err_msg = stderr.decode(errors="replace")[:500]
        logger.error("psql restore failed (exit %d): %s", proc.returncode, err_msg)
        raise HTTPException(status_code=500, detail=f"psql restore failed: {err_msg}")

    return {"restored": True, "output": stdout.decode(errors="replace")[:1000]}


@app.get("/api/media/files")
async def list_media_files() -> list[dict[str, Any]]:
    """List all files in media subdirectories."""
    cfg = get_config()
    base = Path(cfg.media_path)
    files: list[dict[str, Any]] = []
    for subdir in sorted(MEDIA_SUBDIRS):
        dir_path = base / subdir
        if not dir_path.is_dir():
            continue
        for file_path in sorted(dir_path.iterdir()):
            if not file_path.is_file():
                continue
            stat = file_path.stat()
            files.append({
                "subdir": subdir,
                "filename": file_path.name,
                "size": stat.st_size,
                "modified": stat.st_mtime,
            })
    return files


_media_upload_file = File(...)


@app.get("/api/media/{subdir}/{filename}")
async def serve_media_file(subdir: str, filename: str) -> FileResponse:
    """Serve any file from a media subdirectory."""
    if subdir not in MEDIA_SUBDIRS:
        raise HTTPException(status_code=400, detail=f"Invalid subdir: {subdir}")

    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    cfg = get_config()
    file_path = Path(cfg.media_path) / subdir / filename

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    mime, _ = mimetypes.guess_type(filename)
    return FileResponse(path=str(file_path), media_type=mime or "application/octet-stream")


@app.put("/api/media/{subdir}/{filename}")
async def upload_media_file(
    subdir: str, filename: str, file: UploadFile = _media_upload_file
) -> dict[str, Any]:
    """Upload (restore) a file to a media subdirectory."""
    if subdir not in MEDIA_SUBDIRS:
        raise HTTPException(status_code=400, detail=f"Invalid subdir: {subdir}")

    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    cfg = get_config()
    dir_path = Path(cfg.media_path) / subdir
    dir_path.mkdir(parents=True, exist_ok=True)

    file_path = dir_path / filename
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    size = file_path.stat().st_size
    return {"uploaded": True, "subdir": subdir, "filename": filename, "size": size}
