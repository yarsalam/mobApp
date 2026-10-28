import asyncio
import io
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict

import redis.asyncio as aioredis
from fastapi import FastAPI, File, HTTPException, UploadFile, BackgroundTasks
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError

from security.exif_cleaner import EXIFCleaner
from security.nsfw_detector import NSFWDetector
from services.face_analyzer import analyze_face
from services.image_enhancer import enhance_image
from services.quality_scorer import get_quality_score
from workers.image_analyzer import ImageAnalyzerWorker

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))
JOB_TTL_SECONDS = int(os.getenv("IMAGE_JOB_TTL_SECONDS", "86400"))
JOB_KEY_PREFIX = "ai_image:job:"
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
redis_client: aioredis.Redis | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    await redis_client.ping()
    yield
    if redis_client is not None:
        await redis_client.aclose()


app = FastAPI(title="AI Image Engine", version="3.1.0", lifespan=lifespan)

exif_cleaner = EXIFCleaner()
nsfw_detector = NSFWDetector()
analyzer_worker = ImageAnalyzerWorker()


async def _read_valid_image(file: UploadFile) -> bytes:
    if not file.content_type or not file.content_type.lower().startswith("image/"):
        raise HTTPException(415, "فایل باید تصویر باشد")

    # Read at most limit + 1 bytes so oversized uploads cannot consume unbounded RAM.
    contents = await file.read(MAX_IMAGE_BYTES + 1)
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f"حجم تصویر نباید بیشتر از {MAX_IMAGE_BYTES} بایت باشد")

    try:
        with Image.open(io.BytesIO(contents)) as image:
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(415, "فرمت یا محتوای تصویر معتبر نیست") from exc

    return contents


def _job_key(job_id: str) -> str:
    return f"{JOB_KEY_PREFIX}{job_id}"


async def _process_background(image_data: bytes, job_id: str) -> None:
    """Process an accepted image and persist the final result in Redis."""
    if redis_client is None:
        logger.error("Redis unavailable for image job %s", job_id)
        return

    await redis_client.setex(
        _job_key(job_id),
        JOB_TTL_SECONDS,
        json.dumps({"status": "processing", "job_id": job_id}),
    )
    try:
        result: Dict[str, Any] = await asyncio.to_thread(analyzer_worker.analyze, image_data)
        state = "failed" if result.get("error") else "completed"
        record = {
            "status": state,
            "job_id": job_id,
            "result": result,
            "completed_at": datetime.now().isoformat(),
        }
        await redis_client.setex(_job_key(job_id), JOB_TTL_SECONDS, json.dumps(record))
    except Exception:
        logger.exception("Background analysis failed for job %s", job_id)
        await redis_client.setex(
            _job_key(job_id),
            JOB_TTL_SECONDS,
            json.dumps({
                "status": "failed",
                "job_id": job_id,
                "error": "image_analysis_failed",
                "completed_at": datetime.now().isoformat(),
            }),
        )


@app.post("/image/upload")
async def upload_image(
    file: UploadFile = File(...), background_tasks: BackgroundTasks = None
):
    if background_tasks is None:
        raise HTTPException(500, "Background processing is unavailable")

    contents = await _read_valid_image(file)
    cleaned = exif_cleaner.clean(contents)
    if cleaned is None:
        raise HTTPException(status_code=400, detail="Image could not be processed")

    nsfw_result = nsfw_detector.predict(cleaned)
    if nsfw_result.get("is_nsfw", False):
        return JSONResponse(
            {
                "status": "rejected",
                "reason": "nsfw_detected",
                "confidence": nsfw_result.get("confidence"),
                "message": "تصویر نامناسب تشخیص داده شد",
            },
            status_code=400,
        )

    if redis_client is None:
        raise HTTPException(503, "Image job storage is unavailable")

    job_id = uuid.uuid4().hex
    await redis_client.setex(
        _job_key(job_id),
        JOB_TTL_SECONDS,
        json.dumps({"status": "queued", "job_id": job_id}),
    )
    background_tasks.add_task(_process_background, cleaned, job_id)

    return {
        "status": "accepted",
        # Keep filename for compatibility with the existing status endpoint contract.
        "filename": job_id,
        "job_id": job_id,
        "original_filename": file.filename,
        "size": len(cleaned),
        "message": "تصویر پذیرفته شد؛ نتیجه از endpoint وضعیت قابل دریافت است.",
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/image/status/{filename}")
async def get_status(filename: str):
    if redis_client is None:
        raise HTTPException(503, "Image job storage is unavailable")
    record = await redis_client.get(_job_key(filename))
    if record is None:
        raise HTTPException(404, "Image job was not found or has expired")
    return json.loads(record)


@app.post("/image/analyze")
async def analyze_image(file: UploadFile = File(...)):
    data = await _read_valid_image(file)
    enhanced = enhance_image(data)
    face_data = analyze_face(enhanced)
    quality = get_quality_score(enhanced)
    return {"status": "success", "quality_score": quality, "faces": face_data}


@app.get("/health")
async def health():
    redis_ok = False
    try:
        if redis_client is not None:
            await redis_client.ping()
            redis_ok = True
    except Exception:
        pass
    payload = {
        "status": "healthy" if redis_ok else "unavailable",
        "service": "ai_image",
        "version": "3.1.0",
        "redis": redis_ok,
        "timestamp": datetime.now().isoformat(),
    }
    return JSONResponse(content=payload, status_code=200 if redis_ok else 503)
