import logging
from datetime import datetime
from typing import Dict, Optional

import psutil

from storage.redis_client import RedisClient

logger = logging.getLogger(__name__)


class SystemCollector:
    def __init__(self, redis_client: Optional[RedisClient] = None):
        # اگر orchestrator یک instance آماده بده، از همون استفاده کن؛
        # وگرنه یک instance جدید بساز (سازگار با فراخوانی بدون آرگومان)
        self.redis = redis_client or RedisClient()

    def collect(self) -> Dict:
        try:
            cpu_per_core = psutil.cpu_percent(interval=1, percpu=True)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage("/")

            return {
                "timestamp": datetime.now().isoformat(),
                "system": {
                    "cpu": {
                        "percent_per_core": cpu_per_core,
                        "average": sum(cpu_per_core) / len(cpu_per_core),
                        "count": psutil.cpu_count(),
                    },
                    "memory": {
                        "total_gb": round(mem.total / 1024**3, 2),
                        "used_gb": round(mem.used / 1024**3, 2),
                        "percent": mem.percent,
                    },
                    "disk": {
                        "total_gb": round(disk.total / 1024**3, 2),
                        "used_gb": round(disk.used / 1024**3, 2),
                        "percent": disk.percent,
                    },
                },
                "app": self._collect_app_metrics(),
            }
        except Exception as exc:
            logger.error("System metrics collection failed: %s", exc)
            return {}

    def _collect_app_metrics(self) -> Dict:
        """میانگین زمان پاسخ و نرخ خطا از میدل‌ور NestJS backend اصلی می‌آید.
        اگر هنوز چیزی در Redis نبود (سرویس تازه بالا آمده یا میدل‌ور فعال نیست)،
        صفر برمی‌گرده ولی is_available=False تا فرانت‌اند بتونه فرق بذاره
        بین «صفر واقعی» و «داده در دسترس نیست»."""
        perf = self.redis.get_metric("app:performance")
        if not perf:
            return {"avg_response_time": 0, "error_rate": 0, "is_available": False}

        return {
            "avg_response_time": perf.get("avg_response_time", 0),
            "error_rate": perf.get("error_rate", 0),
            "is_available": True,
            "sample_size": perf.get("sample_size", 0),
            "updated_at": perf.get("updated_at"),
        }