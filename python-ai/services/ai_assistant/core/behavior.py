from collections import Counter
from typing import Dict, List

import pandas as pd


def analyze_behavior(events: List[Dict]) -> Dict:
    if not events:
        return {
            "counts": {},
            "total_events": 0,
            "like_rate": 0.0,
            "message_rate": 0.0,
            "tips": ["تعامل کافی ثبت نشده؛ چند اقدام (دیدن/لایک/پیام) انجام بده."],
            "profile_completeness": 0.5,
        }

    df = pd.DataFrame(events)

    if "action" not in df.columns:
        return {
            "counts": {},
            "total_events": len(events),
            "like_rate": 0.0,
            "message_rate": 0.0,
            "tips": ["لاگ‌های رفتاری فرمت مورد انتظار را ندارند."],
            "profile_completeness": 0.5,
        }

    counts = Counter(df["action"].fillna("unknown").tolist())
    total = sum(counts.values()) or 1
    like_rate = counts.get("like", 0) / total
    message_rate = counts.get("message", 0) / total

    tips: List[str] = []
    if like_rate < 0.1:
        tips.append(
            "نسبت لایک‌ها پایینه — الگوریتم سلیقه رو کمتر می‌فهمه. کمی فعال‌تر لایک کن."
        )
    if message_rate < 0.05:
        tips.append(
            "نسبت پیام پایین است؛ پیام‌های شخصی‌تر نرخ پاسخ را بالا می‌برند (+~30%)."
        )

    if "createdAt" in df.columns:
        try:
            df["createdAt"] = pd.to_datetime(df["createdAt"], errors="coerce")
            if not df["createdAt"].isna().all():
                peak = int(df["createdAt"].dt.hour.mode().iat[0])
                tips.append(
                    f"پربازده‌ترین ساعت شما: {peak}:00 — امتحان کن در آن زمان فعال‌تر باشی."
                )
        except Exception:
            pass

    return {
        "counts": dict(counts),
        "total_events": total,
        "like_rate": round(like_rate, 2),
        "message_rate": round(message_rate, 2),
        "tips": tips,
        "profile_completeness": 0.5,
    }
