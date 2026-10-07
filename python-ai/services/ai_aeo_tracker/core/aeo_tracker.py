import asyncio
import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
CACHE_TTL_SECONDS = int(os.getenv("AEO_CACHE_TTL", 6 * 3600))  # 6h — جواب مدل‌ها زیاد سریع عوض نمی‌شه
HISTORY_TTL_SECONDS = 86400 * 180  # 180 روز — برای دیدن روند بلندمدت دیده‌شدن برند
HISTORY_REDIS_KEY_FMT = "aeo:history:{brand}"

_API_KEY = os.getenv("OPENAI_API_KEY")
if not _API_KEY:
    # به‌جای اجرای بی‌صدا با کلید فیک: خطای واضح در زمان استارت سرویس.
    # بهتره سرویس بالا نیاد تا اینکه بی‌صدا همه‌ی درخواست‌ها fail بشن.
    logger.warning(
        "OPENAI_API_KEY تنظیم نشده — درخواست‌های AEO تا وقتی تنظیم نشه fail می‌شوند."
    )

_client: Optional[AsyncOpenAI] = AsyncOpenAI(api_key=_API_KEY) if _API_KEY else None

class AEOProvider:
    """
    انتزاع ساده برای پشتیبانی چند موتور AI (OpenAI, و در آینده Claude/Gemini/Perplexity).
    فعلاً فقط OpenAI پیاده‌سازی شده، ولی هر provider جدید فقط باید این متد رو پیاده کنه.
    """

    name = "openai"

    async def ask(self, prompt: str) -> str:
        if _client is None:
            raise RuntimeError("OPENAI_API_KEY تنظیم نشده است")

        response = await _client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=500,
        )
        return response.choices[0].message.content or ""

class AEOVisibilityTracker:
    def __init__(self, provider: Optional[AEOProvider] = None, redis_client=None):
        self.provider = provider or AEOProvider()
        self._redis = redis_client or self._init_redis()

    def _init_redis(self):
        try:
            import redis

            client = redis.Redis(
                host=os.getenv("REDIS_HOST", "redis"),
                port=int(os.getenv("REDIS_PORT", 6379)),
                decode_responses=True,
                socket_connect_timeout=2,
            )
            client.ping()
            return client
        except Exception as exc:
            logger.warning("Redis در دسترس نیست، کش و تاریخچه غیرفعال می‌شود: %s", exc)
            return None

    async def check_mentions(
        self, brand: str, prompts: List[str], persist: bool = True
    ) -> List[Dict]:
        tasks = [self._check_single(brand, p) for p in prompts]
        results = await asyncio.gather(*tasks)

        if persist and self._redis:
            self._save_snapshot(brand, results)

        return results

    async def _check_single(self, brand: str, prompt: str) -> Dict:
        # جایگزین .format() برای جلوگیری از KeyError روی پرامپت‌هایی که
        # حاوی { یا } خارج از {brand} هستند (مثلاً سال به‌صورت {۲۰۲۶})
        rendered_prompt = prompt.replace("{brand}", brand)

        cache_key = self._cache_key(brand, rendered_prompt)
        if self._redis:
            cached = self._redis.get(cache_key)
            if cached:
                return json.loads(cached)

        result = await self._call_with_retry(brand, prompt, rendered_prompt)

        if self._redis:
            try:
                self._redis.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(result))
            except Exception as exc:
                logger.warning("Could not cache AEO result: %s", exc)

        return result

    async def _call_with_retry(
        self, brand: str, original_prompt: str, rendered_prompt: str, attempts: int = 3
    ) -> Dict:
        last_error: Optional[Exception] = None
        for attempt in range(attempts):
            try:
                text = await self.provider.ask(rendered_prompt)
                mentioned = brand.lower() in text.lower()
                return {
                    "prompt": original_prompt,
                    "engine": self.provider.name,
                    "mentioned": mentioned,
                    "sentiment": await self._analyze_sentiment(text, brand),
                    "response_preview": text[:200],
                    "checked_at": datetime.now(timezone.utc).isoformat(),
                }
            except Exception as exc:
                last_error = exc
                # backoff نمایی ساده بدون وابستگی جدید
                if attempt < attempts - 1:
                    await asyncio.sleep(2**attempt)

        logger.error("AEO check failed after %d attempts: %s", attempts, last_error)
        return {
            "prompt": original_prompt,
            "engine": self.provider.name,
            "mentioned": False,
            "sentiment": "unknown",
            "error": str(last_error),
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }

    async def _analyze_sentiment(self, text: str, brand: str) -> str:
        """
        تحلیل احساسات مبتنی بر کلمه‌کلیدی انگلیسی روی متن فارسی عملاً همیشه 'neutral'
        برمی‌گرداند. راه‌حل درست: از خودِ مدل بخواهیم طبقه‌بندی کند — چون داریم روی
        متنی که خودمان تولیدش کردیم کار می‌کنیم، این یک فراخوانی سبک و ارزان است.
        """
        if brand.lower() not in text.lower():
            return "not_mentioned"

        try:
            classification_prompt = (
                f'متن زیر را نسبت به برند "{brand}" از نظر لحن (مثبت/منفی/خنثی) '
                f"طبقه‌بندی کن. فقط یکی از این سه کلمه انگلیسی را برگردان: "
                f"positive, negative, neutral.\n\nمتن: {text[:500]}"
            )
            raw = await self.provider.ask(classification_prompt)
            normalized = raw.strip().lower()
            for label in ("positive", "negative", "neutral"):
                if label in normalized:
                    return label
            return "neutral"
        except Exception as exc:
            logger.warning("Sentiment classification failed, defaulting: %s", exc)
            return "unknown"

    def _cache_key(self, brand: str, rendered_prompt: str) -> str:
        digest = hashlib.sha256(f"{brand}:{rendered_prompt}".encode()).hexdigest()[:16]
        return f"aeo:cache:{self.provider.name}:{digest}"

    def _save_snapshot(self, brand: str, results: List[Dict]) -> None:
        key = HISTORY_REDIS_KEY_FMT.format(brand=brand)
        snapshot = {
            "date": datetime.now(timezone.utc).date().isoformat(),
            "mention_rate": sum(1 for r in results if r.get("mentioned")) / max(len(results), 1),
            "results": results,
        }
        try:
            history_raw = self._redis.get(key)
            history = json.loads(history_raw) if history_raw else []
            history.append(snapshot)
            history = history[-180:]  # حداکثر ۱۸۰ نقطه‌ی تاریخی
            self._redis.setex(key, HISTORY_TTL_SECONDS, json.dumps(history))
        except Exception as exc:
            logger.warning("Could not save AEO history: %s", exc)

    def get_history(self, brand: str) -> List[Dict]:
        if not self._redis:
            return []
        try:
            raw = self._redis.get(HISTORY_REDIS_KEY_FMT.format(brand=brand))
            return json.loads(raw) if raw else []
        except Exception:
            return []