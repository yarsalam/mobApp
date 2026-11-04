"""Provider adapters for AEO visibility checks.

Only configured providers are called. Missing keys are reported as unavailable
by the API layer; they are never converted into a negative brand mention.
"""
from __future__ import annotations

import os
from typing import Any

from openai import AsyncOpenAI


class PerplexityProvider:
    """Perplexity Sonar adapter using its OpenAI-compatible chat API."""

    name = "perplexity"

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.api_key = api_key if api_key is not None else os.getenv("PERPLEXITY_API_KEY")
        self.model = model or os.getenv("PERPLEXITY_MODEL", "sonar")
        self._client = (
            AsyncOpenAI(
                api_key=self.api_key,
                base_url="https://api.perplexity.ai",
                max_retries=0,
                timeout=20.0,
            )
            if self.api_key else None
        )

    async def ask_with_metadata(self, prompt: str) -> dict[str, Any]:
        if self._client is None:
            raise RuntimeError("PERPLEXITY_API_KEY is not configured")

        response = await self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=500,
        )
        message = response.choices[0].message
        text = message.content or ""

        raw = response.model_dump() if hasattr(response, "model_dump") else {}
        citations = getattr(response, "citations", None) or raw.get("citations", [])
        normalized_citations: list[str] = []
        for citation in citations or []:
            if isinstance(citation, str):
                normalized_citations.append(citation)
            elif isinstance(citation, dict):
                url = citation.get("url")
                if isinstance(url, str) and url:
                    normalized_citations.append(url)

        return {
            "text": text,
            "citations": normalized_citations,
            "model": getattr(response, "model", None) or self.model,
        }

    async def ask(self, prompt: str) -> str:
        result = await self.ask_with_metadata(prompt)
        return result["text"]
