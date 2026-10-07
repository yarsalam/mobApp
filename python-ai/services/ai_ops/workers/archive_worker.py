import gzip
import json
import logging
import time
from datetime import datetime
from typing import Dict

import boto3
import requests

from config.settings import settings

logger = logging.getLogger(__name__)

BATCH_SIZE = 1000
SLEEP_BETWEEN_BATCHES = 5


class ArchiveWorker:
    def __init__(self):
        self.s3 = boto3.client(
            "s3",
            aws_access_key_id=settings.AWS_ACCESS_KEY,
            aws_secret_access_key=settings.AWS_SECRET_KEY,
            region_name=settings.S3_REGION,
        )

    def archive_table(self, table: str, older_than_days: int) -> Dict:
        logger.info("Archiving %s older than %d days", table, older_than_days)
        offset = 0
        total = 0

        while True:
            try:
                resp = requests.post(
                    f"{settings.BACKEND_API_URL}/ops/export-batch",
                    json={
                        "table": table,
                        "older_than_days": older_than_days,
                        "offset": offset,
                        "limit": BATCH_SIZE,
                    },
                    timeout=30,
                )
                if resp.status_code != 200:
                    logger.error("Export batch returned %d", resp.status_code)
                    break

                records = resp.json().get("records", [])
                if not records:
                    break

                compressed = gzip.compress(json.dumps(records, default=str).encode())
                key = (
                    f"archive/{table}/"
                    f"{datetime.now().strftime('%Y/%m/%d')}/"
                    f"batch_{offset}.json.gz"
                )
                self.s3.put_object(
                    Bucket=settings.S3_BUCKET,
                    Key=key,
                    Body=compressed,
                    StorageClass="GLACIER",
                )

                requests.post(
                    f"{settings.BACKEND_API_URL}/ops/confirm-archived",
                    json={
                        "table": table,
                        "record_ids": [r["id"] for r in records],
                    },
                    timeout=10,
                )

                total += len(records)
                offset += len(records)
                logger.info("Archived %d records from %s so far", total, table)
                time.sleep(SLEEP_BETWEEN_BATCHES)

            except Exception as exc:
                logger.error("Archive batch failed: %s", exc)
                break

        return {
            "table": table,
            "archived_count": total,
            "destination": f"s3://{settings.S3_BUCKET}/archive/{table}/",
        }
