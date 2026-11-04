"""Small, bounded on-page HTML audit with SSRF-oriented destination checks.

This is a technical checklist, not a search-engine ranking predictor. A DNS
check cannot fully eliminate DNS rebinding by itself; deployments exposed to
untrusted callers must also enforce outbound egress rules at the network layer.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
from html import unescape
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup

MAX_HTML_BYTES = 1_500_000
MAX_REDIRECTS = 3
REQUEST_TIMEOUT_SECONDS = 8.0
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".home", ".lan", ".test", ".invalid")


class UnsafeTargetError(ValueError):
    """The URL is not an allowed public HTTP(S) target."""


class AuditFetchError(RuntimeError):
    """The remote page could not be fetched safely."""


class AuditTimeoutError(AuditFetchError):
    """The remote server timed out."""


class AuditResponseTooLargeError(AuditFetchError):
    """The response exceeded the bounded HTML size."""


class AuditNotHTMLResponseError(AuditFetchError):
    """The remote resource did not return an HTML document."""


def validate_url_syntax(raw_url: str) -> str:
    """Normalize a URL and reject schemes, hosts, credentials, and ports we do not support."""
    if not isinstance(raw_url, str) or not raw_url.strip() or len(raw_url) > 2048:
        raise UnsafeTargetError("Provide a URL between 1 and 2048 characters.")

    value = raw_url.strip()
    if any(ord(char) < 32 for char in value) or "\\" in value:
        raise UnsafeTargetError("URL contains unsupported control characters.")

    try:
        parsed = urlsplit(value)
        scheme = parsed.scheme.lower()
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise UnsafeTargetError("URL syntax is invalid.") from exc

    if scheme not in {"http", "https"}:
        raise UnsafeTargetError("Only http and https URLs are supported.")
    if not hostname or parsed.username is not None or parsed.password is not None:
        raise UnsafeTargetError("URL must have a public hostname and no embedded credentials.")
    if "%" in hostname:
        raise UnsafeTargetError("IPv6 zone identifiers are not allowed.")

    try:
        ascii_host = hostname.encode("idna").decode("ascii").lower().rstrip(".")
    except UnicodeError as exc:
        raise UnsafeTargetError("Hostname is invalid.") from exc

    if not ascii_host or ascii_host == "localhost" or ascii_host.endswith(BLOCKED_SUFFIXES):
        raise UnsafeTargetError("Private or local hostnames are not allowed.")

    default_port = 443 if scheme == "https" else 80
    if port is not None and port != default_port:
        raise UnsafeTargetError("Only the default HTTP/HTTPS ports are allowed.")

    try:
        literal_ip = ipaddress.ip_address(ascii_host)
    except ValueError:
        literal_ip = None
    if literal_ip is not None and not literal_ip.is_global:
        raise UnsafeTargetError("Private, reserved, or non-public IP addresses are not allowed.")

    # Validate ordinary DNS names. This is not intended as a complete IDNA/URL parser.
    if literal_ip is None:
        labels = ascii_host.split(".")
        if len(labels) < 2 or any(
            not label or len(label) > 63 or label.startswith("-") or label.endswith("-")
            or not all(ch.isalnum() or ch == "-" for ch in label)
            for label in labels
        ):
            raise UnsafeTargetError("A fully qualified public hostname is required.")

    netloc_host = f"[{ascii_host}]" if ":" in ascii_host else ascii_host
    netloc = netloc_host if port is None else f"{netloc_host}:{port}"
    # Fragments are client-side only and are not sent to the server.
    return urlunsplit((scheme, netloc, parsed.path or "/", parsed.query, ""))


async def _resolve_and_check_public_target(raw_url: str) -> str:
    normalized = validate_url_syntax(raw_url)
    parsed = urlsplit(normalized)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)

    try:
        records = await asyncio.to_thread(
            socket.getaddrinfo, host, port, 0, socket.SOCK_STREAM
        )
    except (OSError, socket.gaierror) as exc:
        raise AuditFetchError("The hostname did not resolve.") from exc

    addresses: set[str] = set()
    for record in records:
        try:
            addresses.add(str(ipaddress.ip_address(record[4][0].split("%", 1)[0])))
        except (ValueError, IndexError, TypeError):
            continue
    if not addresses:
        raise AuditFetchError("The hostname did not resolve to an IP address.")
    if any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise UnsafeTargetError("The hostname resolves to a private or non-public IP address.")
    return normalized


def _meta_content(soup: BeautifulSoup, name: str) -> str | None:
    for tag in soup.find_all("meta"):
        if str(tag.get("name", "")).strip().lower() == name.lower():
            value = tag.get("content")
            if isinstance(value, str):
                return " ".join(unescape(value).split()) or None
    return None


def extract_html_audit(
    html: str, final_url: str, status_code: int, response_headers: dict[str, str] | None = None
) -> dict:
    """Extract safe-to-return metadata and a transparent checklist; never returns page body."""
    soup = BeautifulSoup(html, "html.parser")
    headers = {str(k).lower(): str(v) for k, v in (response_headers or {}).items()}

    title = " ".join(soup.title.get_text(" ", strip=True).split()) if soup.title else ""
    description = _meta_content(soup, "description")
    h1_count = len(soup.find_all("h1"))
    canonical_tag = soup.find("link", attrs={"rel": lambda value: value and "canonical" in [
        token.lower() for token in (value if isinstance(value, list) else str(value).split())
    ]})
    canonical = canonical_tag.get("href") if canonical_tag else None
    canonical = urljoin(final_url, str(canonical).strip()) if canonical else None

    html_tag = soup.find("html")
    language = html_tag.get("lang", "").strip() if html_tag and isinstance(html_tag.get("lang", ""), str) else ""
    viewport = any(
        str(tag.get("name", "")).strip().lower() == "viewport" for tag in soup.find_all("meta")
    )
    robots_values = [
        _meta_content(soup, "robots") or "",
        _meta_content(soup, "googlebot") or "",
        headers.get("x-robots-tag", ""),
    ]
    noindex = any("noindex" in value.lower() for value in robots_values)

    images = soup.find_all("img")
    images_missing_alt = sum(1 for image in images if not image.has_attr("alt"))

    final_host = (urlsplit(final_url).hostname or "").lower().rstrip(".")
    internal_links = 0
    external_links = 0
    for link in soup.find_all("a", href=True):
        href = str(link.get("href", "")).strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
            continue
        target = urlsplit(urljoin(final_url, href))
        if target.scheme not in {"http", "https"} or not target.hostname:
            continue
        if target.hostname.lower().rstrip(".") == final_host:
            internal_links += 1
        else:
            external_links += 1

    checks: list[dict[str, str]] = []
    def add_check(check_id: str, ok: bool, success: str, warning: str) -> None:
        checks.append({"id": check_id, "status": "pass" if ok else "warn", "message": success if ok else warning})

    add_check("http_status", 200 <= status_code < 300, "Page returned a successful HTTP status.", f"Page returned HTTP {status_code}.")
    add_check("title", bool(title), "Title tag is present.", "Title tag is missing.")
    add_check("title_length", 10 <= len(title) <= 60, "Title length is within a heuristic 10–60 character range.", f"Title length is {len(title)}; review it (heuristic range: 10–60).")
    add_check("meta_description", bool(description), "Meta description is present.", "Meta description is missing.")
    add_check("description_length", description is not None and 70 <= len(description) <= 160, "Meta description length is within a heuristic 70–160 character range.", f"Meta description length is {len(description or '')}; review it (heuristic range: 70–160).")
    add_check("h1", h1_count == 1, "Exactly one H1 was found.", f"Found {h1_count} H1 tags; review page heading structure.")
    add_check("language", bool(language), "HTML language is declared.", "HTML lang attribute is missing.")
    add_check("viewport", viewport, "Viewport meta tag is present.", "Viewport meta tag is missing.")
    add_check("canonical", bool(canonical), "Canonical link is present.", "Canonical link is missing; verify whether one is needed.")
    add_check("images_alt", images_missing_alt == 0, "All images have an alt attribute.", f"{images_missing_alt} of {len(images)} images lack an alt attribute.")
    add_check("indexability", not noindex, "No noindex directive was detected.", "A noindex directive is present; confirm that this is intentional.")

    return {
        "url": final_url,
        "status_code": status_code,
        "content_type": headers.get("content-type", ""),
        "title": title or None,
        "title_length": len(title),
        "meta_description": description,
        "description_length": len(description or ""),
        "h1_count": h1_count,
        "canonical": canonical,
        "language": language or None,
        "viewport": viewport,
        "noindex": noindex,
        "image_count": len(images),
        "images_missing_alt": images_missing_alt,
        "internal_links": internal_links,
        "external_links": external_links,
        "checks": checks,
        "score_type": "heuristic_on_page_checklist_not_google_ranking",
        "disclaimer": "Technical HTML checks only; this is not a Google ranking score or a full SEO audit.",
    }


async def audit_public_url(raw_url: str) -> dict:
    """Fetch a public HTML page with redirect, timeout, and decoded-size bounds."""
    current_url = await _resolve_and_check_public_target(raw_url)
    timeout = httpx.Timeout(REQUEST_TIMEOUT_SECONDS, connect=5.0)
    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
            headers={
                "User-Agent": "YarSalamSEOAudit/1.0 (+on-page technical checks)",
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Encoding": "gzip, deflate",
            },
        ) as client:
            for hop in range(MAX_REDIRECTS + 1):
                current_url = await _resolve_and_check_public_target(current_url)
                try:
                    async with client.stream("GET", current_url) as response:
                        if response.status_code in REDIRECT_STATUSES:
                            location = response.headers.get("location")
                            if not location:
                                raise AuditFetchError("Redirect response did not include a Location header.")
                            if hop >= MAX_REDIRECTS:
                                raise AuditFetchError("The page exceeded the redirect limit.")
                            current_url = urljoin(current_url, location)
                            continue

                        if not 200 <= response.status_code < 300:
                            raise AuditFetchError(f"Remote server returned HTTP {response.status_code}.")
                        content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                        if content_type not in {"text/html", "application/xhtml+xml"}:
                            raise AuditNotHTMLResponseError("The URL did not return an HTML document.")

                        declared_length = response.headers.get("content-length")
                        if declared_length:
                            try:
                                if int(declared_length) > MAX_HTML_BYTES:
                                    raise AuditResponseTooLargeError("HTML response exceeds the 1.5 MB limit.")
                            except ValueError:
                                pass
                        chunks: list[bytes] = []
                        received = 0
                        async for chunk in response.aiter_bytes():
                            received += len(chunk)
                            if received > MAX_HTML_BYTES:
                                raise AuditResponseTooLargeError("HTML response exceeds the 1.5 MB limit.")
                            chunks.append(chunk)
                        encoding = response.encoding or "utf-8"
                        html = b"".join(chunks).decode(encoding, errors="replace")
                        result = extract_html_audit(html, current_url, response.status_code, dict(response.headers))
                        result["bytes_read"] = received
                        result["redirects_followed"] = hop
                        return result
                except httpx.TimeoutException as exc:
                    raise AuditTimeoutError("The remote server timed out.") from exc
                except httpx.HTTPError as exc:
                    raise AuditFetchError("Could not fetch the remote page.") from exc
    except (UnsafeTargetError, AuditFetchError):
        raise
    except Exception as exc:
        raise AuditFetchError("Could not complete the URL audit.") from exc
    raise AuditFetchError("Could not complete the URL audit.")
