import unittest
from unittest.mock import patch

from moderation_engine import ModerationEngine


class FailingEmbeddingClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        raise RuntimeError("embedding dependency unavailable")


class ModerationFailClosedTests(unittest.IsolatedAsyncioTestCase):
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


if __name__ == "__main__":
    unittest.main()
