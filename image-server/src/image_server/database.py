"""PostgreSQL + pgvector database management."""

from __future__ import annotations

import logging
from typing import Any

import psycopg
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import get_config

logger = logging.getLogger(__name__)

_pool: ConnectionPool | None = None

SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS assets (
    id SERIAL PRIMARY KEY,
    poi_id INTEGER,
    asset_type VARCHAR(20) NOT NULL DEFAULT 'image',
    role VARCHAR(20) NOT NULL DEFAULT 'gallery',
    theme VARCHAR(20),
    filename VARCHAR(255) NOT NULL UNIQUE,
    original_filename VARCHAR(255),
    mime_type VARCHAR(50) NOT NULL,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    sort_order INTEGER DEFAULT 0,
    caption TEXT,
    tags JSONB DEFAULT '[]',
    exif JSONB DEFAULT '{}',
    embedding vector(384),
    search_vector tsvector,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assets_poi ON assets(poi_id);
CREATE INDEX IF NOT EXISTS idx_assets_role ON assets(poi_id, role);
CREATE INDEX IF NOT EXISTS idx_assets_theme ON assets(poi_id, theme) WHERE theme IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_primary ON assets(poi_id) WHERE role = 'primary';
CREATE INDEX IF NOT EXISTS idx_assets_search ON assets USING gin(search_vector);
"""

VECTOR_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_assets_embedding
ON assets USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 10);
"""


def get_pool() -> ConnectionPool:
    """Get or create the connection pool."""
    global _pool
    if _pool is None:
        cfg = get_config()
        _pool = ConnectionPool(
            cfg.dsn,
            min_size=2,
            max_size=10,
            kwargs={"row_factory": dict_row, "autocommit": False},
        )
        with _pool.connection() as conn:
            register_vector(conn)
    return _pool


def init_schema() -> None:
    """Create tables and indexes if they don't exist."""
    pool = get_pool()
    with pool.connection() as conn:
        conn.execute(SCHEMA_SQL)
        conn.commit()
    logger.info("Database schema initialized")


def create_vector_index() -> None:
    """Create the ivfflat vector index (requires existing rows)."""
    pool = get_pool()
    with pool.connection() as conn:
        try:
            conn.execute(VECTOR_INDEX_SQL)
            conn.commit()
            logger.info("Vector index created")
        except Exception:
            conn.rollback()
            logger.warning("Could not create vector index (need rows first)")


def insert_asset(
    *,
    poi_id: int | None,
    asset_type: str,
    role: str,
    theme: str | None,
    filename: str,
    original_filename: str | None,
    mime_type: str,
    file_size: int | None,
    width: int | None,
    height: int | None,
    sort_order: int = 0,
    caption: str | None = None,
    tags: list[str] | None = None,
    exif: dict[str, Any] | None = None,
    embedding: list[float] | None = None,
) -> dict[str, Any]:
    """Insert a new asset and return its record."""
    import json

    pool = get_pool()
    with pool.connection() as conn:
        register_vector(conn)

        search_parts = []
        if caption:
            search_parts.append(caption)
        if original_filename:
            search_parts.append(original_filename)
        if tags:
            search_parts.extend(tags)
        search_text = " ".join(search_parts) if search_parts else ""

        asset_row = conn.execute(
            """
            INSERT INTO assets (
                poi_id, asset_type, role, theme, filename, original_filename,
                mime_type, file_size, width, height, sort_order,
                caption, tags, exif, embedding, search_vector
            ) VALUES (
                %(poi_id)s, %(asset_type)s, %(role)s, %(theme)s, %(filename)s,
                %(original_filename)s, %(mime_type)s, %(file_size)s, %(width)s,
                %(height)s, %(sort_order)s, %(caption)s,
                %(tags)s::jsonb, %(exif)s::jsonb, %(embedding)s,
                to_tsvector('english', %(search_text)s)
            )
            RETURNING *
            """,
            {
                "poi_id": poi_id,
                "asset_type": asset_type,
                "role": role,
                "theme": theme,
                "filename": filename,
                "original_filename": original_filename,
                "mime_type": mime_type,
                "file_size": file_size,
                "width": width,
                "height": height,
                "sort_order": sort_order,
                "caption": caption,
                "tags": json.dumps(tags or []),
                "exif": json.dumps(exif or {}),
                "embedding": embedding,
                "search_text": search_text,
            },
        ).fetchone()
        conn.commit()
        return dict(asset_row) if asset_row else {}


def get_asset(asset_id: int) -> dict[str, Any] | None:
    """Get an asset by ID."""
    pool = get_pool()
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT * FROM assets WHERE id = %s", (asset_id,)
        ).fetchone()
        return dict(row) if row else None


def get_assets_for_poi(
    poi_id: int, *, role: str | None = None
) -> list[dict[str, Any]]:
    """Get all assets for a POI, optionally filtered by role."""
    pool = get_pool()
    with pool.connection() as conn:
        if role:
            rows = conn.execute(
                "SELECT * FROM assets WHERE poi_id = %s AND role = %s ORDER BY sort_order, id",
                (poi_id, role),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM assets WHERE poi_id = %s ORDER BY sort_order, id",
                (poi_id,),
            ).fetchall()
        return [dict(r) for r in rows]


_UPDATE_FIELD_FORMATTERS = {
    "tags": lambda key: (f"{key} = %({key})s::jsonb", True),
    "embedding": lambda key: (f"{key} = %({key})s", False),
}


def update_asset(
    asset_id: int, **updates: Any
) -> dict[str, Any] | None:
    """Update an asset's metadata fields."""
    import json

    allowed = {"role", "theme", "sort_order", "caption", "tags", "embedding"}
    filtered = {k: v for k, v in updates.items() if k in allowed}
    if not filtered:
        return get_asset(asset_id)

    pool = get_pool()
    with pool.connection() as conn:
        if "embedding" in filtered:
            register_vector(conn)

        set_clauses = []
        params: dict[str, Any] = {"asset_id": asset_id}

        for key, value in filtered.items():
            formatter = _UPDATE_FIELD_FORMATTERS.get(key)
            if formatter:
                clause, needs_json = formatter(key)
                set_clauses.append(clause)
                params[key] = json.dumps(value) if needs_json else value
            else:
                set_clauses.append(f"{key} = %({key})s")
                params[key] = value

        set_clauses.append("updated_at = CURRENT_TIMESTAMP")

        if "caption" in filtered or "tags" in filtered:
            asset = get_asset(asset_id)
            if asset:
                caption = filtered.get("caption", asset.get("caption", ""))
                tags_list = filtered.get("tags", asset.get("tags", []))
                orig_name = asset.get("original_filename", "")
                parts = []
                if caption:
                    parts.append(caption)
                if orig_name:
                    parts.append(orig_name)
                if isinstance(tags_list, list):
                    parts.extend(tags_list)
                search_text = " ".join(parts)
                set_clauses.append("search_vector = to_tsvector('english', %(search_text)s)")
                params["search_text"] = search_text

        sql = f"UPDATE assets SET {', '.join(set_clauses)} WHERE id = %(asset_id)s RETURNING *"
        updated_row = conn.execute(sql, params).fetchone()
        conn.commit()
        return dict(updated_row) if updated_row else None


def get_all_assets() -> list[dict[str, Any]]:
    """Get all assets across all POIs."""
    pool = get_pool()
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT * FROM assets ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]


def delete_asset(asset_id: int) -> bool:
    """Delete an asset. Returns True if deleted."""
    pool = get_pool()
    with pool.connection() as conn:
        delete_result = conn.execute(
            "DELETE FROM assets WHERE id = %s", (asset_id,)
        )
        conn.commit()
        return (delete_result.rowcount or 0) > 0


def search_assets(
    query_embedding: list[float],
    *,
    limit: int = 20,
    poi_id: int | None = None,
    role: str | None = None,
) -> list[dict[str, Any]]:
    """Semantic search using vector similarity."""
    pool = get_pool()
    with pool.connection() as conn:
        register_vector(conn)

        conditions = ["embedding IS NOT NULL"]
        params: dict[str, Any] = {"query": query_embedding, "limit": limit}

        if poi_id is not None:
            conditions.append("poi_id = %(poi_id)s")
            params["poi_id"] = poi_id
        if role is not None:
            conditions.append("role = %(role)s")
            params["role"] = role

        where = " AND ".join(conditions)
        rows = conn.execute(
            f"""
            SELECT *, 1 - (embedding <=> %(query)s) AS similarity
            FROM assets
            WHERE {where}
            ORDER BY embedding <=> %(query)s
            LIMIT %(limit)s
            """,
            params,
        ).fetchall()
        return [dict(r) for r in rows]


def fulltext_search(
    query: str, *, limit: int = 20, poi_id: int | None = None
) -> list[dict[str, Any]]:
    """Full-text search using PostgreSQL tsvector."""
    pool = get_pool()
    with pool.connection() as conn:
        conditions = ["search_vector @@ plainto_tsquery('english', %(query)s)"]
        params: dict[str, Any] = {"query": query, "limit": limit}

        if poi_id is not None:
            conditions.append("poi_id = %(poi_id)s")
            params["poi_id"] = poi_id

        where = " AND ".join(conditions)
        rows = conn.execute(
            f"""
            SELECT *, ts_rank(search_vector, plainto_tsquery('english', %(query)s)) AS rank
            FROM assets
            WHERE {where}
            ORDER BY rank DESC
            LIMIT %(limit)s
            """,
            params,
        ).fetchall()
        return [dict(r) for r in rows]


def close_pool() -> None:
    """Close the connection pool."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
