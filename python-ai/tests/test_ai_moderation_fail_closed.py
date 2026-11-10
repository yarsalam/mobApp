import unittest
from unittest.mock import patch

from moderation_engine import ModerationEngine, _BANNED_EXEMPLARS


class FailingEmbeddingClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        raise RuntimeError("embedding dependency unavailable")


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class IncompleteBatchClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *args, **kwargs):
        if url.endswith("/embed"):
            return FakeResponse({"embedding": [0.1, 0.2]})
        if url.endswith("/embed/batch"):
            return FakeResponse({"embeddings": [[0.1, 0.2]]})
        raise AssertionError(f"Unexpected embedding endpoint: {url}")


class SimilarityClient:
    def __init__(self, similarity):
        self.similarity = similarity

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *args, **kwargs):
        if url.endswith("/embed"):
            return FakeResponse({"embedding": [0.1, 0.2]})
        if url.endswith("/embed/batch"):
            return FakeResponse({
                "embeddings": [[0.1, 0.2] for _ in _BANNED_EXEMPLARS]
            })
        if url.endswith("/similarity"):
            return FakeResponse({"similarity": self.similarity})
        raise AssertionError(f"Unexpected embedding endpoint: {url}")


class ModerationFailClosedTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_message_is_not_allowed(self):
        engine = ModerationEngine()
        result = await engine.moderate_text("   ")

        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "invalid_input")
        self.assertEqual(result["layer"], "validation")

    async def test_semantic_dependency_failure_is_not_allowed(self):
        engine = ModerationEngine()
        with patch("moderation_engine.httpx.AsyncClient", return_value=FailingEmbeddingClient()):
            result = await engine._semantic_check("hello")

        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "moderation_unavailable")
        self.assertEqual(result["layer"], "semantic_unavailable")
        self.assertEqual(result["confidence"], 0.0)

    async def test_unavailable_result_is_not_cached_as_safe(self):
        engine = ModerationEngine()
        with patch("moderation_engine.httpx.AsyncClient", return_value=FailingEmbeddingClient()) as client:
            first = await engine.moderate_text("ordinary text", "message")
            second = await engine.moderate_text("ordinary text", "message")

        self.assertFalse(first["allowed"])
        self.assertFalse(second["allowed"])
        self.assertEqual(client.call_count, 2)

    async def test_incomplete_exemplar_batch_fails_closed(self):
        engine = ModerationEngine()
        with patch("moderation_engine.httpx.AsyncClient", return_value=IncompleteBatchClient()):
            result = await engine._semantic_check("ordinary conversation")

        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "moderation_unavailable")
        self.assertEqual(result["layer"], "semantic_unavailable")

    async def test_non_finite_similarity_fails_closed(self):
        engine = ModerationEngine()
        with patch("moderation_engine.httpx.AsyncClient", return_value=SimilarityClient(float("nan"))):
            result = await engine._semantic_check("ordinary conversation")

        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "moderation_unavailable")
        self.assertEqual(result["layer"], "semantic_unavailable")

    async def test_complete_valid_semantic_scan_can_return_allowed(self):
        engine = ModerationEngine()
        with patch("moderation_engine.httpx.AsyncClient", return_value=SimilarityClient(0.1)):
            result = await engine._semantic_check("ordinary conversation")

        self.assertTrue(result["allowed"])
        self.assertEqual(result["layer"], "semantic")


if __name__ == "__main__":
    unittest.main()
