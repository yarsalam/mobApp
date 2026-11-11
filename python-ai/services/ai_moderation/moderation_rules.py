"""Conservative, context-aware Persian-first moderation rules.

These rules intentionally match actionable harmful behavior, not isolated
mentions of broad words such as "group", "price", "threat" or "Instagram".
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any


MAX_TEXT_LENGTH = 2000

_ARABIC_TRANSLATION = str.maketrans({
    "ي": "ی",
    "ى": "ی",
    "ك": "ک",
    "ۀ": "ه",
    "ة": "ه",
    "ؤ": "و",
    "إ": "ا",
    "أ": "ا",
    "ٱ": "ا",
    "ـ": "",
    "\u200c": "",
    "\u200d": "",
    "\ufeff": "",
})


def normalize_for_rules(text: str) -> str:
    """Normalize common Arabic/Persian variants and remove diacritics."""
    value = unicodedata.normalize("NFKC", text).translate(_ARABIC_TRANSLATION).casefold()
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = re.sub(r"\s+", " ", value).strip()
    return value


# Each pattern describes an action or a clearly actionable destination/link.
# Merely mentioning a platform, a channel, a group, a price or a threat is not
# sufficient to trigger a hard block.
_RULES: tuple[tuple[str, str, tuple[re.Pattern[str], ...]], ...] = (
    (
        "banned_keyword",
        "external_contact",
        (
            re.compile(r"(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me|wa\.me|instagram\.com)/\S+", re.I),
            re.compile(r"(?:بیا|بریم|برو|بیایم|منتقل شو).{0,35}(?:تلگرام|واتساپ|واتس\s*اپ|اینستاگرام)", re.I),
            re.compile(r"(?:تلگرام|واتساپ|واتس\s*اپ|اینستاگرام).{0,35}(?:بیا|بریم|صحبت کنیم|حرف بزنیم|پیام بده|ادامه بده)", re.I),
            re.compile(
                r"(?:(?:آیدی|ایدی|شناسه|یوزرنیم).{0,35}(?:تلگرام|واتساپ|واتس\s*اپ|اینستاگرام)|"
                r"(?:تلگرام|واتساپ|واتس\s*اپ|اینستاگرام).{0,35}(?:آیدی|ایدی|شناسه|یوزرنیم))"
                r".{0,25}(?:بده|بفرست|ارسال کن|بنویس)",
                re.I,
            ),
            re.compile(
                r"(?=.*(?:خارج از|بیرون از|خارج برنامه|بیرون برنامه|خارج اپ|بیرون اپ))"
                r"(?=.*(?:شماره|تلفن|موبایل))(?=.*(?:بده|بفرست|ارسال|پیام))",
                re.I,
            ),
        ),
    ),
    (
        "banned_keyword",
        "financial_solicitation",
        (
            re.compile(r"کارت\s*به\s*کارت", re.I),
            re.compile(r"شماره\s*کارت", re.I),
            re.compile(r"کارت\s*بانکی", re.I),
            re.compile(r"(?:سود تضمینی|درآمد تضمینی).{0,55}(?:پول|مبلغ|وجه|حساب|واریز|منتقل)", re.I),
            re.compile(r"(?:پول|مبلغ|وجه).{0,35}(?:واریز کن|واریز کنید|منتقل کن|منتقل کنید)", re.I),
            re.compile(r"(?:واریز کن|واریز کنید|انتقال بده|انتقال دهید).{0,35}(?:پول|مبلغ|وجه)", re.I),
        ),
    ),
    (
        "violence_keyword",
        "harassment",
        (
            re.compile(r"به مرزهای.{0,25}احترام نمیگذارم", re.I),
            re.compile(r"به خواسته ات احترام نمیگذارم", re.I),
        ),
    ),
    (
        "violence_keyword",
        "direct_threat",
        (
            re.compile(r"تهدیدت? میکنم", re.I),
            re.compile(r"(?:به تو|بهت).{0,20}(?:آسیب|صدمه).{0,15}(?:میزنم|خواهم زد)", re.I),
            re.compile(r"(?:پیدات میکنم|پیدا میکنمت).{0,45}(?:آسیب|صدمه|میکشمت|میزنمت)", re.I),
            re.compile(r"(?:میکشمت|خواهم کشت|میزنمت|آسیب میزنمت)", re.I),
            re.compile(r"\bi will (?:kill|hurt) you\b", re.I),
            re.compile(r"\b(?:kill|hurt) you\b", re.I),
        ),
    ),
    (
        "violence_keyword",
        "self_harm_encouragement",
        (
            re.compile(r"(?:خودکشی کن|به خودت آسیب بزن|خودت را بکش)", re.I),
            re.compile(r"\b(?:kill yourself|hurt yourself)\b", re.I),
        ),
    ),
)


def rule_based_check(text: str) -> dict[str, Any]:
    """Return an allow/block decision only for high-specificity rule matches."""
    if not isinstance(text, str) or not text.strip():
        return {
            "allowed": False,
            "reason": "invalid_input",
            "confidence": 0.0,
            "layer": "validation",
        }

    if len(text) > MAX_TEXT_LENGTH:
        return {
            "allowed": False,
            "reason": "text_too_long",
            "confidence": 1.0,
            "layer": "rule",
        }

    normalized = normalize_for_rules(text)
    for reason, category, patterns in _RULES:
        for pattern in patterns:
            match = pattern.search(normalized)
            if match:
                return {
                    "allowed": False,
                    "reason": reason,
                    "category": category,
                    "matched": match.group(0)[:120],
                    "confidence": 0.96,
                    "layer": "rule",
                }

    return {"allowed": True, "reason": None, "confidence": 1.0, "layer": "rule"}
