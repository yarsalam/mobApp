import os
from typing import Dict


class Settings:
    REDIS_HOST: str = os.getenv("REDIS_HOST", "redis")
    REDIS_PORT: int = int(os.getenv("REDIS_PORT", 6379))
    REDIS_DB: int = int(os.getenv("REDIS_DB", 0))

    BACKEND_API_URL: str = os.getenv("BACKEND_API_URL", "http://backend:5000")

    AWS_ACCESS_KEY: str = os.getenv("AWS_ACCESS_KEY", "")
    AWS_SECRET_KEY: str = os.getenv("AWS_SECRET_KEY", "")
    S3_BUCKET: str = os.getenv("S3_BUCKET", "app-archive")
    S3_REGION: str = os.getenv("AWS_REGION", "us-east-1")

    THRESHOLDS: Dict[str, float] = {
        "cpu_warning": 70.0,
        "cpu_critical": 85.0,
        "ram_warning": 75.0,
        "ram_critical": 90.0,
        "disk_warning": 80.0,
        "disk_critical": 95.0,
        "response_time_warning": 300.0,
        "response_time_critical": 500.0,
        "error_rate_warning": 0.02,
        "error_rate_critical": 0.05,
    }

    WORKER_INTERVALS: Dict[str, int] = {
        "metrics": 60,
        "performance": 300,
        "capacity": 3600,
        "revenue": 3600,
        "archive": 86400,
    }


settings = Settings()
