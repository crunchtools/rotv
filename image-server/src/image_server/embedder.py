"""Embedding generation using fastembed (ONNX runtime)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

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
        # Not dict[str, str]: TextEmbedding's parameters are variously int,
        # bool and Device, so splatting a str-valued dict makes mypy check
        # every one of them against str.
        kwargs: dict[str, Any] = {"model_name": cfg.embedding_model}
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
    # numpy's tolist() is typed Any; this one is a 1-D float array.
    return cast("list[float]", embeddings[0].tolist())
