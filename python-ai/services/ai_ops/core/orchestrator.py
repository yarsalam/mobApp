import logging
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from collectors.system_collector import SystemCollector
from config.settings import settings
from storage.redis_client import RedisClient
from workers.archive_worker import ArchiveWorker
from workers.performance_worker import PerformanceWorker
from workers.revenue_worker import RevenueWorker

logger = logging.getLogger(__name__)

_ARCHIVE_TABLES = [
    ("user_event_logs", 90),
    ("interactions", 90),
    ("notifications", 30),
    ("feed_cache", 7),
]


class OpsOrchestrator:
    def __init__(self):
        self.scheduler = BackgroundScheduler(
            job_defaults={"misfire_grace_time": 60, "coalesce": True}
        )
        self.redis = RedisClient()
        self.collector = SystemCollector(redis_client=self.redis)
        self.performance_worker = PerformanceWorker()
        self.revenue_worker = RevenueWorker()
        self.archive_worker = ArchiveWorker()

    def start(self) -> None:
        iv = settings.WORKER_INTERVALS

        self.scheduler.add_job(
            self._collect_metrics,
            IntervalTrigger(seconds=iv["metrics"]),
            id="collect_metrics",
        )
        self.scheduler.add_job(
            self._analyze_performance,
            IntervalTrigger(seconds=iv["performance"]),
            id="analyze_performance",
        )
        self.scheduler.add_job(
            self._analyze_revenue,
            IntervalTrigger(seconds=iv["revenue"]),
            id="analyze_revenue",
        )
        self.scheduler.add_job(
            self._daily_archive,
            "cron",
            hour=2,
            minute=0,
            id="daily_archive",
        )

        self.scheduler.start()
        logger.info("OpsOrchestrator started")

    def stop(self) -> None:
        self.scheduler.shutdown(wait=False)
        logger.info("OpsOrchestrator stopped")

    # ── jobs ───────────────────────────────────────────────────────────────────

    def _collect_metrics(self) -> None:
        metrics = self.collector.collect()
        if not metrics:
            return
        ts = datetime.now().isoformat()
        self.redis.set_metric(f"system:{ts}", metrics, ttl=86400)
        # latest snapshot — مورد نیاز بقیه jobها
        self.redis.set_metric("latest:system", metrics, ttl=86400)
        logger.debug("Metrics collected")

    def _analyze_performance(self) -> None:
        metrics = self.redis.get_metric("latest:system")
        if not metrics:
            return

        issues = self.performance_worker.analyze(metrics)
        if not issues:
            return

        ts = datetime.now().isoformat()
        self.redis.set_metric(f"issues:{ts}", issues, ttl=86400)
        self.redis.set_metric("latest:issues", issues, ttl=86400)

        critical = [i for i in issues if i.get("severity") == "critical"]
        if critical:
            self._push_alert(critical)

    def _analyze_revenue(self) -> None:
        issues = self.redis.get_metric("latest:issues")
        if not issues:
            return

        revenue_issues = self.revenue_worker.analyze(issues)
        if not revenue_issues:
            return

        ts = datetime.now().isoformat()
        self.redis.set_metric(f"revenue_issues:{ts}", revenue_issues, ttl=86400)
        self.redis.set_metric("latest:revenue_issues", revenue_issues, ttl=86400)

    def _daily_archive(self) -> None:
        for table, days in _ARCHIVE_TABLES:
            try:
                result = self.archive_worker.archive_table(table, days)
                logger.info("Archived %d rows from %s", result["archived_count"], table)
            except Exception as exc:
                logger.error("Archive failed for %s: %s", table, exc)

    def _push_alert(self, alerts: list) -> None:
        """ارسال به Redis Stream (سازگار با BullMQ در سمت Node)."""
        try:
            import json

            payload = json.dumps(
                {"alerts": alerts, "timestamp": datetime.now().isoformat()},
                default=str,
            )
            # Redis Stream — Node.js worker آن را consume می‌کند
            self.redis.client.xadd("stream:ops-alerts", {"data": payload})
            logger.info("Alert pushed to stream:ops-alerts (%d items)", len(alerts))
        except Exception as exc:
            logger.error("Failed to push alert: %s", exc)
