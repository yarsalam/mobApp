"""Bounded on-page HTML audit for public HTTP(S) websites.

Application-level DNS checks are defense in depth only. Production deployments must
also enforce network egress rules that prevent access to private, loopback, link-local,
and cloud metadata networks, including against DNS rebinding.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup
from fastapi import HTTPException

logger = logging.getLogger(__name__)

MAX_AUDIT_BYTES = 1_500_000
MAX_REDIRECTS = 3
AUDIT_TIMEOUT_SECONDS = 10.0
AUDIT_USER_AGENT = "YarSalam-SEO-Audit/1.0"


def normalize_public_http_url(raw_url: str) -> tuple[str, str, int]:
    """Validate URL syntax and reject non-public IP literals before any request."""
    if not isinstance(raw_url, str) or not raw_url.strip():
        raise HTTPException(422, "A public HTTP or HTTPS URL is required")

    try:
        parsed = urlsplit(raw_url.strip())
        scheme = parsed.scheme.lower()
        if scheme not in {"http", "https"}:
            raise HTTPException(422, "Only HTTP and HTTPS URLs are supported")
        if not parsed.hostname or parsed.username is not None or parsed.password is not None:
            raise HTTPException(422, "URL must include a hostname and must not include credentials")

        hostname = parsed.hostname.rstrip(".").encode("idna").decode("ascii").lower()
        expected_port = 443 if scheme == "https" else 80
        port = parsed.port or expected_port
        if port != expected_port:
            raise HTTPException(422, "Only the default HTTP/HTTPS ports are allowed")
        if (
            hostname in {"localhost", "localhost.localdomain"}
            or hostname.endswith(".localhost")
            or hostname.endswith(".local")
        ):
            raise HTTPException(422, "Local hostnames are not allowed")

        try:
            literal_ip = ipaddress.ip_address(hostname)
        except ValueError:
            literal_ip = None
        if literal_ip is not None and not literal_ip.is_global:
            raise HTTPException(422, "Private, loopback, link-local, and reserved IPs are not allowed")

        host_for_url = f"[{hostname}]" if ":" in hostname else hostname
        netloc = host_for_url if port == expected_port else f"{host_for_url}:{port}"
        normalized = urlunsplit((scheme, netloc, parsed.path or "/", parsed.query, ""))
        return normalized, hostname, port
    except HTTPException:
        raise
    except (UnicodeError, ValueError) as exc:
        raise HTTPException(422, "URL is malformed") from exc


async def resolve_public_hostname(hostname: str, port: int) -> None:
    """Reject DNS names that resolve to any non-global address.

    This does not eliminate DNS rebinding between validation and connection.
    Production egress policy must deny private/internal destinations as well.
    """
    try:
        ipaddress.ip_address(hostname)
        return
    except ValueError:
        pass

    try:
        loop = asyncio.get_running_loop()
        records = await loop.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise HTTPException(502, "Could not resolve the requested public hostname") from exc

    addresses = {record[4][0].split("%", 1)[0] for record in records}
    if not addresses:
        raise HTTPException(502, "The requested hostname has no address records")

    for address in addresses:
        try:
            parsed_ip = ipaddress.ip_address(address)
        except ValueError as exc:
            raise HTTPException(502, "Hostname resolved to an invalid IP address") from exc
        if not parsed_ip.is_global:
            raise HTTPException(422, "Hostname resolves to a non-public IP address")


async def validated_public_url(raw_url: str) -> str:
    normalized, hostname, port = normalize_public_http_url(raw_url)
    await resolve_public_hostname(hostname, port)
    return normalized


def audit_html(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    html_tag = soup.find("html")
    title_tag = soup.find("title")
    title = title_tag.get_text(" ", strip=True) if title_tag else ""
    description_tag = soup.find(
        "meta", attrs={"name": lambda value: value and value.lower() == "description"}
    )
    description = (description_tag.get("content") or "").strip() if description_tag else ""
    h1_tags = soup.find_all("h1")
    h2_tags = soup.find_all("h2")
    canonical_tag = soup.find(
        "link",
        rel=lambda value: value and "canonical" in [
            item.lower() for item in (value if isinstance(value, list) else value.split())
        ],
    )
    canonical = (canonical_tag.get("href") or "").strip() if canonical_tag else ""
    viewport_tag = soup.find(
        "meta", attrs={"name": lambda value: value and value.lower() == "viewport"}
    )
    images = soup.find_all("img")
    images_missing_alt = sum(1 for image in images if not (image.get("alt") or "").strip())
    anchors = soup.find_all("a", href=True)
    robots_tag = soup.find(
        "meta", attrs={"name": lambda value: value and value.lower() == "robots"}
    )
    robots = (robots_tag.get("content") or "").strip() if robots_tag else ""

    checks = [
        {"id": "title", "label": "Page title exists", "passed": bool(title), "details": title[:200]},
        {"id": "meta_description", "label": "Meta description exists", "passed": bool(description), "details": description[:200]},
        {"id": "h1", "label": "At least one H1 exists", "passed": len(h1_tags) >= 1, "details": f"{len(h1_tags)} H1 elements"},
        {"id": "h1_count", "label": "A single H1 is used", "passed": len(h1_tags) == 1, "details": f"{len(h1_tags)} H1 elements"},
        {"id": "h2", "label": "H2 structure exists", "passed": len(h2_tags) >= 1, "details": f"{len(h2_tags)} H2 elements"},
        {"id": "canonical", "label": "Canonical URL exists", "passed": bool(canonical), "details": canonical[:300]},
        {"id": "viewport", "label": "Viewport meta exists", "passed": bool(viewport_tag), "details": "present" if viewport_tag else "missing"},
        {"id": "html_lang", "label": "HTML language is declared", "passed": bool(html_tag and html_tag.get("lang")), "details": (html_tag.get("lang") if html_tag else "") or "missing"},
        {"id": "image_alt", "label": "Images have alternative text", "passed": images_missing_alt == 0, "details": f"{images_missing_alt} of {len(images)} images missing alt"},
        {"id": "links", "label": "Page contains navigable links", "passed": len(anchors) > 0, "details": f"{len(anchors)} links"},
        {"id": "robots_noindex", "label": "Page is not explicitly noindex", "passed": "noindex" not in robots.lower(), "details": robots or "no robots meta tag"},
    ]
    passed = sum(1 for item in checks if item["passed"])
    return {
        "title": title,
        "description": description,
        "h1_count": len(h1_tags),
        "h2_count": len(h2_tags),
        "canonical": canonical,
        "image_count": len(images),
        "link_count": len(anchors),
        "checks": checks,
        "score": round(100 * passed / len(checks)),
        "score_type": "heuristic_on_page_checklist_not_google_ranking",
    }


async def _fetch_public_html(initial_url: str) -> tuple[int, str, str, str]:
    current_url = await validated_public_url(initial_url)
    timeout = httpx.Timeout(AUDIT_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=False,
        trust_env=False,
        headers={"User-Agent": AUDIT_USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
    ) as client:
        for redirect_count in range(MAX_REDIRECTS + 1):
            try:
                async with client.stream("GET", current_url) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location or redirect_count >= MAX_REDIRECTS:
                            raise HTTPException(422, "Too many redirects or missing redirect target")
                        current_url = await validated_public_url(urljoin(current_url, location))
                        continue

                    if not 200 <= response.status_code < 300:
                        raise HTTPException(422, f"Target website returned HTTP {response.status_code}")

                    content_type = response.headers.get("content-type", "").lower()
                    if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
                        raise HTTPException(415, "Target URL did not return HTML content")

                    declared_length = response.headers.get("content-length")
                    if declared_length:
                        try:
                            if int(declared_length) > MAX_AUDIT_BYTES:
                                raise HTTPException(413, "Target HTML exceeds the 1.5 MB audit limit")
                        except ValueError:
                            pass

                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_AUDIT_BYTES:
                            raise HTTPException(413, "Target HTML exceeds the 1.5 MB audit limit")

                    try:
                        html = body.decode(response.encoding or "utf-8", errors="replace")
                    except LookupError:
                        html = body.decode("utf-8", errors="replace")
                    return response.status_code, current_url, content_type, html
            except HTTPException:
                raise
            except httpx.TimeoutException as exc:
                raise HTTPException(504, "Target website request timed out") from exc
            except httpx.HTTPError as exc:
                raise HTTPException(502, "Could not fetch target website") from exc

    raise HTTPException(422, "Redirect limit exceeded")


async def audit_public_url(raw_url: str) -> dict:
    """Fetch and run a bounded technical checklist for a public URL."""
    status_code, final_url, content_type, html = await _fetch_public_html(raw_url)
    return {
        "url": raw_url,
        "final_url": final_url,
        "status_code": status_code,
        "content_type": content_type,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        **audit_html(html),
    }
