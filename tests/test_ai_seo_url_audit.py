from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

SERVICE_ROOT = Path(__file__).resolve().parents[1] / "python-ai" / "services" / "ai_seo"
sys.path.insert(0, str(SERVICE_ROOT))

from core.url_audit import audit_html, normalize_public_http_url


def test_normalize_public_https_url():
    url, hostname, port = normalize_public_http_url("https://Example.com/path?q=1#fragment")
    assert url == "https://example.com/path?q=1"
    assert hostname == "example.com"
    assert port == 443


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/",
        "http://localhost/",
        "http://service.local/",
        "http://127.0.0.1/",
        "http://10.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://example.com:8080/",
        "http://user:password@example.com/",
    ],
)
def test_reject_unsafe_or_unsupported_url(url):
    with pytest.raises(HTTPException):
        normalize_public_http_url(url)


def test_audit_html_returns_expected_checklist_contract():
    html = """
    <!doctype html>
    <html lang="fa">
      <head>
        <title>YarSalam example</title>
        <meta name="description" content="A short description">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="https://example.com/">
      </head>
      <body>
        <h1>Main title</h1>
        <h2>Section</h2>
        <img src="/hero.png" alt="Hero image">
        <a href="/about">About</a>
      </body>
    </html>
    """
    result = audit_html(html)
    assert result["title"] == "YarSalam example"
    assert result["h1_count"] == 1
    assert result["score_type"] == "heuristic_on_page_checklist_not_google_ranking"
    assert len(result["checks"]) >= 8
    assert all(isinstance(item["passed"], bool) for item in result["checks"])
