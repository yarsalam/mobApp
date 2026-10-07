import asyncio
import hashlib
import json
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)


def encode_text(model, text: str) -> List[float]:
    return model.encode(text).tolist()


def encode_batch(model, texts: List[str]) -> List[List[float]]:
    return model.encode(texts).tolist()


class EmbeddingWorker:
    def __init__(self, model, redis_client, mysql_pool, vector_store, executor):
        self.model = model
        self.redis_client = redis_client
        self.mysql_pool = mysql_pool
        self.vector_store = vector_store
        self.pool = executor

    async def process_batch(self, items: List[Dict]) -> None:
        if not items:
            return

        texts = [item["text"] for item in items]
        loop = asyncio.get_event_loop()
        embeddings: List[List[float]] = await loop.run_in_executor(
            self.pool, encode_batch, self.model, texts
        )

        # قبلاً store_user_vector/store_content_vector همین‌جا صدا زده می‌شد،
        # یعنی نوشتن در Redis فوراً commit می‌شد در حالی که insert توی MySQL
        # هنوز داخل transaction معلق بود. اگر MySQL rollback می‌کرد، vector
        # توی Redis یتیم می‌ماند (بدون متادیتای متناظر). حالا: اول MySQL را
        # کامل commit می‌کنیم، فقط بعد از موفقیت آن، وارد Redis می‌شویم.
        redis_pipe = self.redis_client.pipeline()
        mysql_conn = await self.mysql_pool.acquire()
        mysql_committed = False

        try:
            async with mysql_conn.cursor() as cursor:
                await mysql_conn.begin()

                for item, emb in zip(items, embeddings):
                    text_hash = hashlib.md5(item["text"].encode()).hexdigest()
                    redis_pipe.setex(f"embed:text:{text_hash}", 86400, json.dumps(emb))

                    if item["type"] == "user":
                        await cursor.execute(
                            """
                            INSERT INTO user_embeddings_meta (user_id, profile_text, embedding_version, last_updated)
                            VALUES (%s, %s, %s, NOW())
                            ON DUPLICATE KEY UPDATE
                                profile_text = VALUES(profile_text),
                                embedding_version = VALUES(embedding_version),
                                last_updated = NOW()
                            """,
                            (item["id"], item["text"], "v1"),
                        )
                    else:
                        await cursor.execute(
                            """
                            INSERT INTO content_embeddings_meta (content_id, content_type, text, embedding_version, created_at)
                            VALUES (%s, %s, %s, %s, NOW())
                            """,
                            (item["id"], item["type"], item["text"], "v1"),
                        )

                await mysql_conn.commit()
                mysql_committed = True

            # فقط بعد از commit موفق MySQL، وارد Redis می‌شویم — هم متادیتای
            # ساده (redis_pipe) و هم vectorهای واقعی (vector_store).
            await redis_pipe.execute()

            for item, emb in zip(items, embeddings):
                if item["type"] == "user":
                    await self.vector_store.store_user_vector(item["id"], emb)
                else:
                    await self.vector_store.store_content_vector(
                        item["id"], item["type"], emb
                    )

            logger.info("Batch processed %d items", len(items))

        except Exception as exc:
            if not mysql_committed:
                await mysql_conn.rollback()
                logger.error("Batch failed before commit, rolled back: %s", exc)
            else:
                # این حالت بدتره: MySQL commit شده ولی نوشتن توی Redis fail کرده.
                # اینجا دیگه نمی‌شه rollback کرد، پس باید صریح لاگ بزنیم که
                # ممکنه این batch نیاز به sync دستی یا retry مجزا داشته باشه.
                logger.error(
                    "MySQL committed but Redis write failed — data inconsistency "
                    "for %d items, needs manual reconciliation: %s",
                    len(items),
                    exc,
                )
            raise
        finally:
            self.mysql_pool.release(mysql_conn)
