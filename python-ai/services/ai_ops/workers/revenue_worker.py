import logging
from typing import Dict, List

import requests

from config.settings import settings
from storage.redis_client import RedisClient

logger = logging.getLogger(__name__)


class RevenueWorker:
    def __init__(self):
        self.redis = RedisClient()

    def analyze(self, issues: List[Dict]) -> List[Dict]:
        daily_revenue = self._fetch_daily_revenue()
        result: List[Dict] = []

        for issue in issues:
            rev_impact = issue.get("revenue_impact", 0)
            if rev_impact <= 0:
                continue

            daily_loss = daily_revenue * rev_impact
            monthly_loss = daily_loss * 30

            issue = dict(issue)
            issue["estimated_daily_loss"] = round(daily_loss, 2)
            issue["estimated_monthly_loss"] = round(monthly_loss, 2)
            issue["priority"] = (
                "critical"
                if monthly_loss > 1000
                else (
                    "high"
                    if monthly_loss > 500
                    else "medium" if monthly_loss > 100 else "low"
                )
            )
            result.append(issue)

        return result

    def _fetch_daily_revenue(self) -> float:
        try:
            resp = requests.get(
                f"{settings.BACKEND_API_URL}/ops/daily-revenue",
                timeout=5,
                headers={"X-Internal": "true"},
            )
            if resp.status_code == 200:
                return float(resp.json().get("revenue", 0))
        except Exception as exc:
            logger.warning("Could not fetch daily revenue: %s", exc)
        return 0.0
