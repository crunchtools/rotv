"""Embedding generation using fastembed (ONNX runtime)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .config import get_config

if TYPE_CHECKING:
    from fastembed import TextEmbedding

_model: TextEmbedding | None = None


def get_model() -> TextEmbedding:
    """Get or create the singleton embedding model."""
    global _model
    if _model is None:
        from fastembed import TextEmbedding

        cfg = get_config()
        kwargs: dict[str, str] = {"model_name": cfg.embedding_model}
        if cfg.embedding_cache_dir:
            kwargs["cache_dir"] = cfg.embedding_cache_dir
        _model = TextEmbedding(**kwargs)
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a list of texts."""
    if not texts:
        return []
    model = get_model()
    embeddings = list(model.embed(texts))
    return [emb.tolist() for emb in embeddings]


def embed_query(text: str) -> list[float]:
    """Generate an embedding for a single query text."""
    model = get_model()
    embeddings = list(model.query_embed(text))
    return embeddings[0].tolist()
