import os
import httpx
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)

class EmbeddingClient:
    """کلاینت سرویس متمرکز Embedding"""
    
    def __init__(self):
        self.embedding_service_url = os.getenv(
            "EMBEDDING_SERVICE_URL", 
            "http://embedded_ai:8100"
        )
        self.timeout = 30.0  # ثانیه
    
    async def get_embedding(self, text: str) -> Optional[List[float]]:
        """دریافت Embedding برای یک متن"""
        if not text or not text.strip():
            return None
            
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.embedding_service_url}/embed",
                    json={"text": text.strip()}
                )
                response.raise_for_status()
                return response.json()["embedding"]
        except Exception as e:
            logger.error(f"خطا در دریافت Embedding: {e}")
            return None
    
    async def get_batch_embeddings(self, texts: List[str]) -> List[List[float]]:
        """دریافت Embedding برای چند متن به صورت دسته‌ای"""
        if not texts:
            return []
            
        cleaned_texts = [t.strip() for t in texts if t and t.strip()]
        if not cleaned_texts:
            return []
            
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.embedding_service_url}/embed/batch",
                    json={"texts": cleaned_texts}
                )
                response.raise_for_status()
                return response.json()["embeddings"]
        except Exception as e:
            logger.error(f"خطا در دریافت Batch Embedding: {e}")
            return []
    
    async def compute_similarity(self, vec_a: List[float], vec_b: List[float]) -> float:
        """محاسبه شباهت کسینوسی دو بردار"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.embedding_service_url}/similarity",
                    json={"vector_a": vec_a, "vector_b": vec_b}
                )
                response.raise_for_status()
                return response.json()["similarity"]
        except Exception as e:
            logger.error(f"خطا در محاسبه شباهت: {e}")
            return 0.0