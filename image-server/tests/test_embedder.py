"""Tests for embedding generation."""

import pytest


def test_embed_texts_empty():
    """Empty list returns empty list."""
    from image_server.embedder import embed_texts

    result = embed_texts([])
    assert result == []


@pytest.mark.slow
def test_embed_texts_single():
    """Single text produces a 384-dim vector."""
    from image_server.embedder import embed_texts

    result = embed_texts(["a covered bridge in winter"])
    assert len(result) == 1
    assert len(result[0]) == 384
    assert all(isinstance(v, float) for v in result[0])


@pytest.mark.slow
def test_embed_query():
    """Query embedding produces a 384-dim vector."""
    from image_server.embedder import embed_query

    result = embed_query("snow covered trail")
    assert len(result) == 384
