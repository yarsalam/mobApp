import logging
from datetime import datetime
from typing import Dict, List

from config.settings import settings
from storage.redis_client import RedisClient

logger = logging.getLogger(__name__)


class PerformanceWorker:
    def __init__(self):
        self.redis = RedisClient()

    def analyze(self, metrics: Dict) -> List[Dict]:
        issues: List[Dict] = []
        system = metrics.get("system", {})

        cpu = system.get("cpu", {}).get("average", 0)
        ram = system.get("memory", {}).get("percent", 0)
        rt = metrics.get("app", {}).get("avg_response_time", 0)

        self._check_threshold(
            issues,
            "cpu",
            cpu,
            settings.THRESHOLDS["cpu_warning"],
            settings.THRESHOLDS["cpu_critical"],
            impact="کندی در پردازش",
            suggestion="بهینه‌سازی کد یا افزایش CPU",
        )
        self._check_threshold(
            issues,
            "ram",
            ram,
            settings.THRESHOLDS["ram_warning"],
            settings.THRESHOLDS["ram_critical"],
            impact="ریسک کرش سرویس",
            suggestion="افزایش RAM یا رفع memory leak",
        )
        self._check_threshold(
            issues,
            "latency",
            rt,
            settings.THRESHOLDS["response_time_warning"],
            settings.THRESHOLDS["response_time_critical"],
            impact="تجربه کاربری ضعیف",
            suggestion="بهینه‌سازی endpointهای کند",
        )

        return issues

    @staticmethod
    def _check_threshold(
        issues: List[Dict],
        metric: str,
        value: float,
        warn: float,
        crit: float,
        impact: str,
        suggestion: str,
    ) -> None:
        if value > crit:
            severity = "critical"
        elif value > warn:
            severity = "warning"
        else:
            return

        revenue_impact = 0.0
        if metric == "latency":
            excess = max(0, (value - warn) / 100)
            revenue_impact = excess * 0.2

        issues.append(
            {
                "type": f"{metric}_{severity}",
                "value": value,
                "threshold": crit if severity == "critical" else warn,
                "severity": severity,
                "impact": impact,
                "suggestion": suggestion,
                "revenue_impact": revenue_impact,
                "detected_at": datetime.now().isoformat(),
            }
        )
