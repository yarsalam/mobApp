import json
import logging
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException

from core.behavior import analyze_behavior
from core.nlp import analyze_personality, sentiment_of_text
from core.utils import load_json, save_json

logger = logging.getLogger(__name__)
router = APIRouter()

USER_CACHE_TTL = 604800


async def _get_redis():
    from app import redis_client

    return redis_client


@router.post("/analyze")
async def analyze_user(payload: Dict = Body(...)):
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(400, "user_id required")

    bio: str = payload.get("bio", "")
    messages: List[str] = payload.get("messages", [])
    events: List[Dict] = payload.get("events", [])
    text_blob = (bio + " " + " ".join(messages))[:2000].strip()

    personality = await analyze_personality(text_blob)
    behavior = analyze_behavior(events)
    sentiment = sentiment_of_text(messages[-1]) if messages else None

    result = {
        "user_id": user_id,
        "personality": personality,
        "behavior": behavior,
        "sentiment": sentiment,
        "analyzed_at": datetime.now().isoformat(),
    }

    redis = await _get_redis()
    await redis.setex(f"assistant:user:{user_id}", USER_CACHE_TTL, json.dumps(result))
    save_json(f"user_{user_id}", result)
    return result


@router.get("/advice/{user_id}")
async def get_advice(user_id: int):
    redis = await _get_redis()
    cached = await redis.get(f"assistant:user:{user_id}")
    data = json.loads(cached) if cached else load_json(f"user_{user_id}")

    if not data:
        raise HTTPException(404, "User not found. Please POST /analyze first")

    personality: Dict = data.get("personality", {})
    behavior: Dict = data.get("behavior", {})
    like_rate: float = behavior.get("like_rate", 0)
    message_rate: float = behavior.get("message_rate", 0)

    tips: List[str] = []
    if behavior.get("profile_completeness", 0.5) < 0.7:
        tips.append("📝 پروفایل خود را کامل کنید")
    if personality.get("extraversion", 0.5) > 0.7:
        tips.append("👥 با توجه به شخصیت برون‌گرا، عکس‌های اجتماعی بگذارید")
    else:
        tips.append("🎯 با توجه به شخصیت درون‌گرا، عکس‌های طبیعی انتخاب کنید")
    if like_rate < 0.1:
        tips.append("❤️ با لایک کردن روزانه ۵ نفر، شانس دیده شدن خود را افزایش دهید")
    if message_rate < 0.05:
        tips.append("💬 پیام‌های شخصی‌سازی شده، نرخ پاسخ را تا ۳۰٪ افزایش می‌دهد")

    return {
        "user_id": user_id,
        "personality_summary": _summarize_personality(personality),
        "behavior_summary": {
            "like_rate": like_rate,
            "message_rate": message_rate,
            "total_events": behavior.get("total_events", 0),
        },
        "tips": tips[:5],
        "generated_at": datetime.now().isoformat(),
    }


@router.post("/chat")
async def chat(payload: Dict = Body(...)):
    user_id = payload.get("user_id")
    message: Optional[str] = payload.get("message")
    conv_id = payload.get("convId")

    if not user_id or not message:
        raise HTTPException(400, "user_id and message required")

    # strip + lower برای مطابقت صحیح فارسی
    message_clean = message.strip().lower()
    sentiment = sentiment_of_text(message)

    static_responses = {
        "سلام": "سلام! چطور می‌تونم کمکت کنم؟",
        "help": "می‌تونم در این موارد کمکت کنم:\n- بهبود پروفایل\n- افزایش تعامل\n- خرید اشتراک",
        "پروفایل": "برای بهبود پروفایل، عکس با کیفیت و توضیحات کامل اضافه کن",
    }
    reply = static_responses.get(
        message_clean, "متوجه شدم. برای راهنمایی بیشتر، 'help' رو بفرست."
    )
    return {"reply": reply, "sentiment": sentiment, "convId": conv_id}


def _summarize_personality(personality: Dict) -> str:
    traits: List[str] = []
    traits.append(
        "برون‌گرا" if personality.get("extraversion", 0.5) > 0.6 else "درون‌گرا"
    )
    if personality.get("openness", 0.5) > 0.6:
        traits.append("خلاق")
    if personality.get("agreeableness", 0.5) > 0.6:
        traits.append("مهربان")
    return ("شخصیت " + "، ".join(traits)) if traits else "شخصیت متعادل"
